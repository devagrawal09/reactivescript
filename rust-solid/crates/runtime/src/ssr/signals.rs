//! The server build's reactive primitives (solid/src/server/signals.ts): the
//! server is pull-based. A signal is its value, a store is its plain object,
//! a memo computes once (eagerly unless `lazy`) under its own owner, and
//! setters are inert. Owners matter beyond values: every memo takes a
//! hydration child id where the client's computation takes one.
//!
//! Async data (plan v2.1): a memo whose compute returns a promise (an async
//! memo, `createMemo(() => host())`) goes through `processResult`'s thenable
//! branch: a deferred promise (`createDeferredPromise`) stands for the
//! answer, is serialized under the memo's id when the render streams, and
//! every read throws a `NotReadyError` carrying it until the answer lands
//! (`settleServerAsync`). A memo whose compute throws a `NotReadyError`
//! subscribes a retry (`subscribePendingRetry`); a sync memo latches it
//! until the microtask after (`latchNotReady`).
//!
//! Ported as far as a plan app runs it (measured with V8 coverage of the
//! server builds; docs/SSR.md, "What runs"). Not ported (unreachable from a
//! plan app): `processResult`'s async-iterator branches (`flattenResolvedIterable`,
//! `pumpIterator`, the hybrid and tapped channels: no host returns an
//! iterable), `ssrSource`, `loadingValue` and `deferStream` options (no plan
//! sets them), client holes (`CLIENT_HOLE`, `ssrSource: "client"`), epochs
//! (`commitEpoch`, frame renders only), dependency edges (`edgeHooks` is
//! null outside the frames server), `asyncReads`/`moving` (read only by the
//! live-hole sweep of `mapArray`), the observer (`runWithObserver`: nothing
//! the server runs reads it), live-hole sweeps in `mapArray`, projections,
//! `repeat`, and the dev-only `warnServerWrite` diagnostics.
use super::js::{promise_resolve, then, Deferred, Handler};
use super::owner::OwnerId;
use super::value::{call, throw, JsError, JsVal, Res, Thrown};
use super::web::{RenderCtx, Slot};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub type Compute = Rc<dyn Fn(&mut Server, JsVal) -> Res<JsVal>>;
/// `settleServerAsync`'s `onSuccess` (the landed value) and `onError`.
type OnSuccess = Rc<dyn Fn(&mut Server, JsVal) -> Res<JsVal>>;
type OnError = Rc<dyn Fn(&mut Server, JsVal)>;

#[derive(Clone, Default)]
pub struct MemoOptions {
    pub sync: bool,
    pub lazy: bool,
    pub id: Option<String>,
    pub transparent: bool,
}

// Solid: signals.ts:1361-1393 (`createSignal`, the value form): no owner, no
// id. The setter writes inert data (`warnServerWrite` is dev-only).
pub fn create_signal(value: JsVal) -> (JsVal, JsVal) {
    let cell = Rc::new(RefCell::new(value));
    let r = cell.clone();
    let read = JsVal::func(0, move |_, _| Ok(r.borrow().clone()));
    let write = JsVal::func(1, move |s, args| {
        let v = args.first().cloned().unwrap_or(JsVal::Undefined);
        let next = match &v {
            JsVal::Fn(_) => {
                let prev = cell.borrow().clone();
                call(s, &v, &[prev])?
            }
            _ => v,
        };
        *cell.borrow_mut() = next.clone();
        Ok(next)
    });
    (read, write)
}

/// The server's `ServerComputation` (signals.ts:769-798).
struct CompState {
    value: JsVal,
    error: Option<Thrown>,
    errored: bool,
    computed: bool,
    disposed: bool,
    dispose_armed: bool,
}

/// A memo of `createMemo`: its owner, the render context it was created
/// under, its compute and state.
struct MemoNode {
    owner: OwnerId,
    ctx: Option<Rc<RenderCtx>>,
    compute: Compute,
    creation_owner: Option<OwnerId>,
    st: RefCell<CompState>,
}

impl MemoNode {
    // Solid: signals.ts:1452-1475 (`armDispose`): the creation owner's
    // disposal marks the computation disposed, so a pending retry stops.
    fn arm_dispose(self: &Rc<Self>, s: &mut Server) {
        if self.st.borrow().dispose_armed {
            return;
        }
        self.st.borrow_mut().dispose_armed = true;
        let Some(o) = self.creation_owner else {
            return;
        };
        let node = self.clone();
        s.owner_mut(o).disposal.push(Rc::new(move |_| {
            node.st.borrow_mut().disposed = true;
        }));
    }

    // Solid: signals.ts:1476-1500 (`run`): rerun under the memo's owner and
    // the render context it was created under.
    fn run(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        s.reset_owner_for_rerun(self.owner)?;
        let prev = std::mem::replace(&mut s.ctx, self.ctx.clone());
        let value = self.st.borrow().value.clone();
        let compute = self.compute.clone();
        let result = s.run_with_owner(Some(self.owner), |s| compute(s, value));
        s.ctx = prev;
        result
    }

    // Solid: signals.ts:1501-1545 (`update`)
    fn update(self: &Rc<Self>, s: &mut Server) {
        if self.st.borrow().disposed {
            return;
        }
        let r = (|| -> Res<()> {
            {
                let mut st = self.st.borrow_mut();
                st.error = None;
                st.errored = false;
            }
            let result = self.run(s)?;
            self.st.borrow_mut().computed = true;
            if matches!(result, JsVal::Promise(_)) {
                self.arm_dispose(s);
            }
            process_result(s, self, result)
        })();
        if let Err(err) = r {
            if err.not_ready().is_some() {
                self.arm_dispose(s);
                let node = self.clone();
                subscribe_pending_retry(s, &err, Rc::new(move |s| node.update(s)));
            }
            let mut st = self.st.borrow_mut();
            st.error = Some(err);
            st.errored = true;
            st.computed = true;
        }
    }

    // Solid: signals.ts:1575-1604 (the read)
    fn read(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        if !self.st.borrow().computed {
            self.update(s);
        }
        let st = self.st.borrow();
        if st.errored {
            return Err(st.error.clone().expect("an errored memo keeps its error"));
        }
        Ok(st.value.clone())
    }
}

// Solid: signals.ts:1407-1608 (`createMemo`). `sync` goes to
// `createSyncMemo`. Otherwise: an owner (an id, as the client's computed
// takes one), the render context of the moment, and `update()` now unless
// `lazy`; the read updates a memo that has not computed and throws its
// error.
pub fn create_memo(s: &mut Server, compute: Compute, options: MemoOptions) -> Res<JsVal> {
    if options.sync {
        return create_sync_memo(s, compute, options);
    }
    let ctx = s.ctx.clone();
    let owner = s.create_owner(options.id.clone(), options.transparent)?;
    let node = Rc::new(MemoNode {
        owner,
        ctx,
        compute,
        creation_owner: s.current,
        st: RefCell::new(CompState {
            value: JsVal::Undefined,
            error: None,
            errored: false,
            computed: false,
            disposed: false,
            dispose_armed: false,
        }),
    });
    if !options.lazy {
        node.update(s);
    }
    Ok(JsVal::func(0, move |s, _| node.read(s)))
}

// Solid: signals.ts:1121-1135 (`subscribePendingRetry`): `error.source.then(
// () => retry(), () => retry())`.
pub(crate) fn subscribe_pending_retry(
    s: &mut Server,
    error: &Thrown,
    retry: Rc<dyn Fn(&mut Server)>,
) -> bool {
    let Some(e) = error.not_ready() else {
        return false;
    };
    let source = e.source.borrow().clone();
    if let JsVal::Promise(p) = source {
        let (a, b) = (retry.clone(), retry);
        then(
            s,
            &p,
            Some(Rc::new(move |s, _| {
                a(s);
                Ok(JsVal::Undefined)
            })),
            Some(Rc::new(move |s, _| {
                b(s);
                Ok(JsVal::Undefined)
            })),
        );
    }
    true
}

// Solid: signals.ts:1157-1166 (`adoptSlot`)
fn adopt_slot(node: &MemoNode, slot: &Slot) {
    let mut st = node.st.borrow_mut();
    if slot.s == 1 {
        st.value = slot.v.clone();
        st.error = None;
        st.errored = false;
    } else {
        st.error = Some(Thrown(slot.v.clone()));
        st.errored = true;
    }
}

// Solid: signals.ts:1859-1894 (`isRenderedOutput`): rendered markup (a
// template object, a `{ t, h, p }` result) or a list holding one. A plan
// host's answer is plain data: records are never templates.
fn is_rendered_output(value: &JsVal) -> bool {
    match value {
        JsVal::Fn(f) => f.lh_skip.get(),
        JsVal::Arr(a) => a.borrow().iter().any(is_rendered_output),
        JsVal::Tmpl(t) => t.starts_with('<'),
        JsVal::Res(_) => true,
        JsVal::Rec(r) => {
            let r = r.borrow();
            match r.iter().find(|(k, _)| k == "t") {
                Some((_, JsVal::Str(t))) => t.starts_with('<') && r.len() == 1,
                _ => false,
            }
        }
        _ => false,
    }
}

// Solid: signals.ts:1896-1912 (`refuseRenderedLanding`)
fn refuse_rendered_landing(value: &JsVal) -> Res<()> {
    if is_rendered_output(value) {
        return throw("[ASYNC_MEMO_ELEMENT] An async memo resolved to rendered output");
    }
    Ok(())
}

// Solid: signals.ts:1914-2423 (`processResult`), its thenable branch (an
// async memo's promise) and its synchronous tail. The iterator branches are
// not ported: no plan host returns an async iterable.
fn process_result(s: &mut Server, comp: &Rc<MemoNode>, result: JsVal) -> Res<()> {
    if comp.st.borrow().disposed {
        return Ok(());
    }
    let id = s.owner(comp.owner).id.clone();
    // `noHydrate`: `getContext(NoHydrateContext, owner)`, false in a plan app.
    let no_hydrate = s.no_hydrate(comp.owner);
    let ctx = comp.ctx.clone();
    let JsVal::Promise(result) = result else {
        let mut st = comp.st.borrow_mut();
        st.value = result;
        return Ok(());
    };
    // `recordSlot(s, v, d)`: the context's settled-slot record for this id,
    // which a later pass over the same id adopts.
    let record_slot = {
        let (id, ctx) = (id.clone(), ctx.clone());
        move |state: u8, v: JsVal, d: Option<Rc<Deferred>>| {
            let (Some(id), Some(ctx)) = (id.as_ref().filter(|i| !i.is_empty()), ctx.as_ref())
            else {
                return;
            };
            let store = ctx.slots_or_create();
            let prev = store
                .borrow()
                .iter()
                .find(|(k, _)| k == id)
                .map(|(_, x)| x.clone());
            match prev {
                Some(prev) => {
                    let mut p = prev.borrow_mut();
                    p.s = state;
                    p.v = v;
                }
                None => store
                    .borrow_mut()
                    .push((id.clone(), Rc::new(RefCell::new(Slot { s: state, v, d })))),
            }
        }
    };
    match result.s.get() {
        1 => {
            let mut st = comp.st.borrow_mut();
            st.value = result.v.borrow().clone();
            st.error = None;
            st.errored = false;
            return Ok(());
        }
        2 => {
            let mut st = comp.st.borrow_mut();
            st.error = Some(Thrown(result.v.borrow().clone()));
            st.errored = true;
            return Ok(());
        }
        3 => return throw("processResult: an iterable's retry (result.s === 3) is not ported"),
        _ => {}
    }
    let slot = match (id.as_ref().filter(|i| !i.is_empty()), ctx.as_ref()) {
        (Some(id), Some(ctx)) => ctx.slot(id),
        _ => None,
    };
    if let Some(slot) = &slot {
        if slot.borrow().s != 0 {
            then(s, &result, None, Some(super::js::noop()));
            adopt_slot(comp, &slot.borrow());
            return Ok(());
        }
    }
    let deferred = match &slot {
        Some(slot) => slot
            .borrow()
            .d
            .clone()
            .expect("a pending slot has its deferred"),
        None => Deferred::new(s),
    };
    let serializes = ctx.as_ref().is_some_and(|c| c.is_async())
        && id.as_ref().is_some_and(|i| !i.is_empty())
        && !no_hydrate;
    match &slot {
        None => {
            record_slot(0, JsVal::Undefined, Some(deferred.clone()));
            if serializes {
                let ctx = ctx.clone().expect("checked");
                ctx.serialize(
                    s,
                    id.clone().expect("checked"),
                    JsVal::Promise(deferred.promise.clone()),
                    false,
                )?;
            }
        }
        Some(slot) => {
            // `settle`: adopt the slot when it settles (no `loadingState`).
            let (a, b) = (slot.clone(), slot.clone());
            let (c1, c2) = (comp.clone(), comp.clone());
            then(
                s,
                &deferred.promise,
                Some(Rc::new(move |_, _| {
                    adopt_slot(&c1, &a.borrow());
                    Ok(JsVal::Undefined)
                })),
                Some(Rc::new(move |_, _| {
                    adopt_slot(&c2, &b.borrow());
                    Ok(JsVal::Undefined)
                })),
            );
        }
    }
    let (on_success, on_error) = {
        let (r1, r2) = (result.clone(), result.clone());
        let (c1, c2) = (comp.clone(), comp.clone());
        let rs1 = Rc::new(record_slot);
        let rs2 = rs1.clone();
        let on_success: OnSuccess = Rc::new(move |_, value: JsVal| {
            if serializes {
                refuse_rendered_landing(&value)?;
            }
            r1.s.set(1);
            *r1.v.borrow_mut() = value.clone();
            rs1(1, value.clone(), None);
            let mut st = c1.st.borrow_mut();
            st.value = value.clone();
            st.error = None;
            st.errored = false;
            // `ctx?.commit?.()`: frame renders only.
            Ok(value)
        });
        let on_error: OnError = Rc::new(move |_, error: JsVal| {
            r2.s.set(2);
            *r2.v.borrow_mut() = error.clone();
            rs2(2, error.clone(), None);
            let mut st = c2.st.borrow_mut();
            st.error = Some(Thrown(error));
            st.errored = true;
        });
        (on_success, on_error)
    };
    let disposed = {
        let c = comp.clone();
        Rc::new(move || c.st.borrow().disposed)
    };
    let rerun = {
        let c = comp.clone();
        Rc::new(move |s: &mut Server| c.run(s))
    };
    settle_server_async(
        s,
        JsVal::Promise(result),
        rerun,
        deferred.clone(),
        on_success,
        on_error,
        disposed,
    );
    let mut st = comp.st.borrow_mut();
    st.error = Some(Thrown(JsVal::Error(JsError::not_ready(JsVal::Promise(
        deferred.promise.clone(),
    )))));
    st.errored = true;
    Ok(())
}

type Rerun = Rc<dyn Fn(&mut Server) -> Res<JsVal>>;

// Solid: signals.ts:1168-1252 (`settleServerAsync`): the first attempt
// takes the initial promise; a `NotReadyError` (a pending read of another
// source) subscribes another attempt, which reruns the compute. A landing
// settles the deferred with `onSuccess`'s value; a failure rejects it.
fn settle_server_async(
    s: &mut Server,
    initial: JsVal,
    rerun: Rerun,
    deferred: Rc<Deferred>,
    on_success: OnSuccess,
    on_error: OnError,
    is_disposed: Rc<dyn Fn() -> bool>,
) {
    struct Settle {
        first: Cell<bool>,
        initial: JsVal,
        rerun: Rerun,
        deferred: Rc<Deferred>,
        on_success: OnSuccess,
        on_error: OnError,
        is_disposed: Rc<dyn Fn() -> bool>,
    }
    impl Settle {
        // `pending`: a NotReadyError subscribes another attempt.
        fn pending(self: &Rc<Self>, s: &mut Server, error: &Thrown) -> bool {
            if error.not_ready().is_none() {
                return false;
            }
            let me = self.clone();
            subscribe_pending_retry(s, error, Rc::new(move |s| me.attempt(s)));
            true
        }

        fn attempt(self: &Rc<Self>, s: &mut Server) {
            if (self.is_disposed)() {
                return;
            }
            let current = if self.first.get() {
                Ok(self.initial.clone())
            } else {
                (self.rerun)(s)
            };
            let current = match current {
                Ok(c) => {
                    self.first.set(false);
                    c
                }
                Err(error) => {
                    if self.pending(s, &error) {
                        return;
                    }
                    (self.on_error)(s, error.0.clone());
                    self.deferred.reject(s, error.0);
                    return;
                }
            };
            let p = promise_resolve(s, current);
            let (a, b) = (self.clone(), self.clone());
            let on_f: Handler = Rc::new(move |s, value| {
                match (a.on_success)(s, value) {
                    Ok(landed) => a.deferred.resolve(s, landed),
                    Err(error) => {
                        (a.on_error)(s, error.0.clone());
                        a.deferred.reject(s, error.0);
                    }
                }
                Ok(JsVal::Undefined)
            });
            let on_r: Handler = Rc::new(move |s, error| {
                let thrown = Thrown(error.clone());
                if b.pending(s, &thrown) {
                    return Ok(JsVal::Undefined);
                }
                (b.on_error)(s, error.clone());
                b.deferred.reject(s, error);
                Ok(JsVal::Undefined)
            });
            then(s, &p, Some(on_f), Some(on_r));
        }
    }
    let st = Rc::new(Settle {
        first: Cell::new(true),
        initial,
        rerun,
        deferred,
        on_success,
        on_error,
        is_disposed,
    });
    st.attempt(s);
}

/// A `NotReadyLatch` (signals.ts:1744-1774): the error a sync memo's pull
/// threw, rethrown by its reads until the microtask after.
pub type Latch = Rc<RefCell<Option<Thrown>>>;

// Solid: signals.ts:1753-1757 (`clearNotReadyLatches`)
fn clear_not_ready_latches(s: &mut Server) {
    s.latch_clear_queued = false;
    for l in std::mem::take(&mut s.latches) {
        *l.borrow_mut() = None;
    }
}

// Solid: signals.ts:1758-1774 (`latchNotReady`)
fn latch_not_ready(s: &mut Server, latch: Option<Latch>, err: Thrown) -> Latch {
    let latch = match latch {
        None => Rc::new(RefCell::new(Some(err))),
        Some(l) => {
            *l.borrow_mut() = Some(err);
            l
        }
    };
    s.latches.push(latch.clone());
    if !s.latch_clear_queued {
        s.latch_clear_queued = true;
        s.queue_microtask(Box::new(clear_not_ready_latches));
    }
    latch
}

struct SyncMemo {
    owner: OwnerId,
    compute: Compute,
    value: RefCell<JsVal>,
    error: RefCell<Option<Thrown>>,
    errored: Cell<bool>,
    cached: Cell<bool>,
    pending: RefCell<Option<Latch>>,
}

impl SyncMemo {
    // Solid: signals.ts:1648-1700 (`pull`)
    fn pull(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        let prev_owner = s.current;
        s.current = Some(self.owner);
        let prev = self.value.borrow().clone();
        let compute = self.compute.clone();
        let result = s
            .reset_owner_for_rerun(self.owner)
            .and_then(|_| compute(s, prev));
        s.current = prev_owner;
        match result {
            Ok(v) => {
                *self.value.borrow_mut() = v.clone();
                *self.error.borrow_mut() = None;
                self.errored.set(false);
                self.cached.set(true);
                Ok(v)
            }
            Err(err) => {
                if err.not_ready().is_some() {
                    let latch = self.pending.borrow_mut().take();
                    let latch = latch_not_ready(s, latch, err.clone());
                    *self.pending.borrow_mut() = Some(latch);
                    return Err(err);
                }
                *self.error.borrow_mut() = Some(err.clone());
                self.errored.set(true);
                self.cached.set(true);
                Err(err)
            }
        }
    }

    // Solid: signals.ts:1708-1741 (the read)
    fn read(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        if self.cached.get() {
            if self.errored.get() {
                return Err(self.error.borrow().clone().expect("an errored memo"));
            }
            return Ok(self.value.borrow().clone());
        }
        let latched = self
            .pending
            .borrow()
            .as_ref()
            .and_then(|l| l.borrow().clone());
        if let Some(e) = latched {
            return Err(e);
        }
        self.pull(s)
    }
}

// Solid: signals.ts:1637-1742 (`createSyncMemo`): an owner, an eager pull
// unless `lazy` (its error is kept or latched), and a read that returns the
// cached value, rethrows the cached error or the latched `NotReadyError`,
// or pulls again.
pub fn create_sync_memo(s: &mut Server, compute: Compute, options: MemoOptions) -> Res<JsVal> {
    let owner = s.create_owner(options.id.clone(), options.transparent)?;
    let m = Rc::new(SyncMemo {
        owner,
        compute,
        value: RefCell::new(JsVal::Undefined),
        error: RefCell::new(None),
        errored: Cell::new(false),
        cached: Cell::new(false),
        pending: RefCell::new(None),
    });
    if !options.lazy {
        let _ = m.pull(s);
    }
    Ok(JsVal::func(0, move |s, _| m.read(s)))
}

// Solid: web/src/render.ts:94-96 (`memo`): the compiler's `_$memo`, a sync
// memo with its own id scope (not transparent).
pub fn memo(s: &mut Server, f: JsVal) -> Res<JsVal> {
    create_memo(
        s,
        Rc::new(move |s, _| call(s, &f, &[])),
        MemoOptions {
            sync: true,
            ..Default::default()
        },
    )
}

// Solid: signals.ts:2697-2720 (`createOptimistic`), the function form:
// `createSignal(fn)`, which is `createMemo(prev => fn(prev))` (signals.ts:
// 1361-1385). The setter is a no-op: server output is settled state.
pub fn create_optimistic(s: &mut Server, seed: Compute) -> Res<(JsVal, JsVal)> {
    let read = create_memo(s, seed, MemoOptions::default())?;
    let r = read.clone();
    let write = JsVal::func(1, move |s, _| call(s, &r, &[]));
    Ok((read, write))
}

// Solid: signals.ts:2745-2762, 2771-2779 (`createStore`, the value form, and
// `storeSetter`): the store is the plain object itself, no proxy.
pub fn create_store(state: JsVal) -> (JsVal, JsVal) {
    let st = state.clone();
    let set = JsVal::func(1, move |s, args| {
        let f = args.first().cloned().unwrap_or(JsVal::Undefined);
        let result = call(s, &f, std::slice::from_ref(&st))?;
        if !matches!(result, JsVal::Undefined) && !result.strict_eq(&st) {
            return throw("a store setter returning a replacement is not ported (replaceState)");
        }
        Ok(JsVal::Undefined)
    });
    (state, set)
}

// Solid: signals.ts:4802-4804 (`action`): the function itself. A plan app's
// handlers never run during a server render.
pub fn action(f: JsVal) -> JsVal {
    f
}

// Solid: signals.ts:4764-4772 (`isPending`): the read's value is dropped; a
// `NotReadyError` propagates (the reader is loading, not pending); any other
// error reads as not pending.
pub fn is_pending(s: &mut Server, f: &JsVal) -> Res<JsVal> {
    match call(s, f, &[]) {
        Ok(_) => Ok(JsVal::Bool(false)),
        Err(e) if e.not_ready().is_some() => Err(e),
        Err(_) => Ok(JsVal::Bool(false)),
    }
}

// Solid: signals.ts:4774-4776 (`latest`): the read itself.
pub fn latest(s: &mut Server, f: &JsVal) -> Res<JsVal> {
    call(s, f, &[])
}

// Solid: signals.ts:706-765 (`ssrScope`): reserve one id slot of the nearest
// id-bearing owner now; each evaluation runs with that slot as the owner's id
// and a zeroed child counter, and unwraps accessor chains inside the scope.
// A `NotReadyError` thrown by a function in the chain keeps that function
// (and the counter it started from) to resume from on the next evaluation.
pub fn ssr_scope(s: &mut Server, f: JsVal) -> Res<JsVal> {
    let Some(mut parent) = s.current else {
        return Ok(f);
    };
    if s.owner(parent).id.is_none() {
        return Ok(f);
    }
    while s.owner(parent).transparent {
        match s.owner(parent).parent {
            Some(p) => parent = p,
            None => break,
        }
    }
    let prefix = if s.owner(parent).scope_slot >= 0 {
        s.materialize_id(parent).expect("materialized")
    } else {
        s.owner(parent).id.clone().expect("checked")
    };
    let slot = s.owner(parent).child_count;
    s.owner_mut(parent).child_count += 1;
    let resume: Rc<RefCell<Option<JsVal>>> = Rc::new(RefCell::new(None));
    let resume_count = Rc::new(Cell::new(0u64));
    Ok(JsVal::func(0, move |s, _| {
        let o = s.owner(parent);
        let (prev_id, prev_slot, prev_count) = (o.id.clone(), o.scope_slot, o.child_count);
        let resuming = resume.borrow().clone();
        let o = s.owner_mut(parent);
        o.id = Some(prefix.clone());
        o.scope_slot = slot as i64;
        o.child_count = if resuming.is_some() {
            resume_count.get()
        } else {
            0
        };
        let mut next: Option<JsVal> = None;
        let mut count = 0u64;
        let mut result = match resuming {
            Some(r) => Ok(r),
            None => call(s, &f, &[]),
        };
        if result.is_ok() {
            *resume.borrow_mut() = None;
        }
        while let Ok(JsVal::Fn(_)) = &result {
            let n = result.expect("checked");
            count = s.owner(parent).child_count;
            next = Some(n.clone());
            result = call(s, &n, &[]);
        }
        let o = s.owner_mut(parent);
        o.id = prev_id;
        o.scope_slot = prev_slot;
        o.child_count = prev_count;
        if let Err(err) = &result {
            if let (Some(n), Some(_)) = (next, err.not_ready()) {
                *resume.borrow_mut() = Some(n);
                resume_count.set(count);
            }
        }
        result
    }))
}

/// `mapArray`'s options as `For` passes them (flow.ts:69-72).
#[derive(Clone)]
pub struct MapOptions {
    /// `keyed: undefined` (For's default) or `true`: rows get the raw item.
    pub keyed: Option<bool>,
    pub fallback: Option<JsVal>,
}

// Solid: signals.ts:3487-3621 (`mapArray`): one row owner whose id is
// rewritten per row (`formatChildId(rowOwnerId, i)`) instead of an owner per
// row, then a sync memo that reads `list` and maps every item. No live-hole
// sweep runs, so the row cache is never read or filled.
pub fn map_array(s: &mut Server, list: JsVal, map_fn: JsVal, options: MapOptions) -> Res<JsVal> {
    let JsVal::Fn(mf) = &map_fn else {
        return throw("mapArray: the map function is not a function");
    };
    let indexes = mf.arity > 1;
    if indexes || options.keyed == Some(false) {
        return throw("mapArray with an index argument or keyed: false is not ported");
    }
    let row_owner: OwnerId = s.create_owner(None, false)?;
    let compute: Compute = Rc::new(move |s, _| {
        let items = call(s, &list, &[])?;
        let mut rows = vec![];
        s.owner_mut(row_owner).child_count = 0;
        let len = match &items {
            JsVal::Arr(a) => a.borrow().len(),
            JsVal::Undefined | JsVal::Null | JsVal::Bool(false) => 0,
            other => {
                return throw(format!("mapArray over {other:?} is not ported"));
            }
        };
        if len > 0 {
            let items = match &items {
                JsVal::Arr(a) => a.borrow().clone(),
                _ => unreachable!("an array"),
            };
            let map_fn = map_fn.clone();
            s.run_with_owner(Some(row_owner), move |s| {
                let orig = s.owner(row_owner).id.clone();
                let mut out = Ok(());
                for item in items.iter() {
                    if let Some(orig) = &orig {
                        let i = rows.len() as u64;
                        s.owner_mut(row_owner).id = Some(super::owner::format_child_id(orig, i));
                    }
                    s.owner_mut(row_owner).child_count = 0;
                    match call(s, &map_fn, std::slice::from_ref(item)) {
                        Ok(row) => rows.push(row),
                        Err(e) => {
                            out = Err(e);
                            break;
                        }
                    }
                }
                // `finally`
                let o = s.owner_mut(row_owner);
                o.id = orig;
                o.child_count = len as u64;
                out.map(|_| JsVal::array(rows))
            })
        } else if let Some(fallback) = &options.fallback {
            let fo = s.run_with_owner(Some(row_owner), |s| s.create_owner(None, false))?;
            let fb = s.run_with_owner(Some(fo), |s| call(s, fallback, &[]))?;
            Ok(JsVal::array(vec![fb]))
        } else {
            Ok(JsVal::array(rows))
        }
    });
    create_memo(
        s,
        compute,
        MemoOptions {
            sync: true,
            ..Default::default()
        },
    )
}
