//! The part of the JS host that Solid's server render of async data runs
//! on: promises with ECMAScript's semantics (ECMA-262 §27.2: the resolving
//! functions, thenable adoption through `NewPromiseResolveThenableJob`,
//! `PerformPromiseThen`, reaction jobs, `Promise.resolve`/`reject`/`all`/
//! `allSettled`/`race`, `await`), the microtask queue, and Node's
//! `setImmediate` queue. The chunks `renderToStream` writes depend on the
//! exact order of microtasks (which writes coalesce into one chunk, which
//! fulfillment seroval meets first), so every `.then`, `Promise.resolve`,
//! `queueMicrotask` and `await` of the ported code goes through here, one for
//! one.
//!
//! Not modelled: `setTimeout` (Solid's server reaches it only in
//! `scheduleFlush`'s no-progress retry, which no measured render took; a
//! render that schedules one fails closed), unhandled-rejection tracking
//! (Solid defuses every promise it leaves unobserved), and subclassing
//! (`Promise[Symbol.species]` is `Promise` throughout).
use super::value::{call, ErrClass, JsError, JsVal, Res, Thrown};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub type Job = Box<dyn FnOnce(&mut Server)>;
/// A reaction handler: a JS function or a native closure.
pub type Handler = Rc<dyn Fn(&mut Server, JsVal) -> Res<JsVal>>;

pub enum PState {
    Pending {
        fulfill: Vec<Reaction>,
        reject: Vec<Reaction>,
    },
    Fulfilled(JsVal),
    Rejected(JsVal),
}

pub struct Reaction {
    capability: Option<Resolvers>,
    handler: Option<Handler>,
    fulfill: bool,
}

/// A promise, with the expando fields Solid and seroval write on promises:
/// `s` (1 fulfilled, 2 rejected, 3 retrying an iterable), `v` (the value) and
/// `d` (the deferred a retry settles).
pub struct JsPromise {
    pub state: RefCell<PState>,
    pub s: Cell<u8>,
    pub v: RefCell<JsVal>,
    pub d: RefCell<Option<Rc<Deferred>>>,
}

impl JsPromise {
    fn pending() -> Rc<JsPromise> {
        Rc::new(JsPromise {
            state: RefCell::new(PState::Pending {
                fulfill: vec![],
                reject: vec![],
            }),
            s: Cell::new(0),
            v: RefCell::new(JsVal::Undefined),
            d: RefCell::new(None),
        })
    }

    pub fn is_pending(&self) -> bool {
        matches!(*self.state.borrow(), PState::Pending { .. })
    }
}

/// A promise's resolving functions (§27.2.1.3), sharing one
/// `[[AlreadyResolved]]` record.
#[derive(Clone)]
pub struct Resolvers {
    pub promise: Rc<JsPromise>,
    already: Rc<Cell<bool>>,
}

impl Resolvers {
    fn new(promise: Rc<JsPromise>) -> Resolvers {
        Resolvers {
            promise,
            already: Rc::new(Cell::new(false)),
        }
    }

    // §27.2.1.3.2 Promise Resolve Functions
    pub fn resolve(&self, s: &mut Server, resolution: JsVal) {
        if self.already.replace(true) {
            return;
        }
        resolve_promise(s, &self.promise, resolution);
    }

    // §27.2.1.3.1 Promise Reject Functions
    pub fn reject(&self, s: &mut Server, reason: JsVal) {
        if self.already.replace(true) {
            return;
        }
        reject_promise(s, &self.promise, reason);
    }

    /// The resolve function as a JS function value (`resolver.s`).
    pub fn resolve_fn(&self) -> JsVal {
        let r = self.clone();
        JsVal::func(1, move |s, args| {
            r.resolve(s, args.first().cloned().unwrap_or(JsVal::Undefined));
            Ok(JsVal::Undefined)
        })
    }

    /// The reject function as a JS function value (`resolver.f`).
    pub fn reject_fn(&self) -> JsVal {
        let r = self.clone();
        JsVal::func(1, move |s, args| {
            r.reject(s, args.first().cloned().unwrap_or(JsVal::Undefined));
            Ok(JsVal::Undefined)
        })
    }
}

/// The resolution steps after `[[AlreadyResolved]]` (§27.2.1.3.2, 7-16): a
/// thenable is adopted through a `NewPromiseResolveThenableJob`; the only
/// thenables here are promises (whose `then` is the built-in one).
fn resolve_promise(s: &mut Server, promise: &Rc<JsPromise>, resolution: JsVal) {
    if let JsVal::Promise(p) = &resolution {
        if Rc::ptr_eq(p, promise) {
            let e = JsError::new(ErrClass::TypeError, "Chaining cycle detected for promise");
            reject_promise(s, promise, JsVal::Error(e));
            return;
        }
        // §27.2.2.2 NewPromiseResolveThenableJob: in a job, call
        // `thenable.then(resolve, reject)` with fresh resolving functions.
        let (promise, thenable) = (promise.clone(), p.clone());
        s.queue_microtask(Box::new(move |s| {
            let r = Resolvers::new(promise);
            let (a, b) = (r.clone(), r);
            then(
                s,
                &thenable,
                Some(Rc::new(move |s, v| {
                    a.resolve(s, v);
                    Ok(JsVal::Undefined)
                })),
                Some(Rc::new(move |s, e| {
                    b.reject(s, e);
                    Ok(JsVal::Undefined)
                })),
            );
        }));
        return;
    }
    // A thenable that is not a promise (an object with a callable `then`:
    // frames' dynamic() flight box, solid/src/server/dynamic.ts:152-163) is
    // adopted the same way, calling its own `then`.
    if let Some(then_fn) = thenable_then(&resolution) {
        let promise = promise.clone();
        s.queue_microtask(Box::new(move |s| {
            let r = Resolvers::new(promise);
            let (a, b) = (r.clone(), r.clone());
            let res = call(s, &then_fn, &[a.resolve_fn(), b.reject_fn()]);
            if let Err(e) = res {
                r.reject(s, e.0);
            }
        }));
        return;
    }
    fulfill_promise(s, promise, resolution);
}

/// The callable `then` of a plain record (a thenable that is not a promise).
pub fn thenable_then(v: &JsVal) -> Option<JsVal> {
    let JsVal::Rec(r) = v else { return None };
    let found = r
        .borrow()
        .iter()
        .find(|(k, _)| k == "then")
        .map(|(_, f)| f.clone());
    match found {
        Some(f @ JsVal::Fn(_)) => Some(f),
        _ => None,
    }
}

// §27.2.1.4 FulfillPromise
fn fulfill_promise(s: &mut Server, promise: &Rc<JsPromise>, value: JsVal) {
    let prev = std::mem::replace(
        &mut *promise.state.borrow_mut(),
        PState::Fulfilled(value.clone()),
    );
    if let PState::Pending { fulfill, .. } = prev {
        trigger(s, fulfill, value);
    }
}

// §27.2.1.7 RejectPromise
fn reject_promise(s: &mut Server, promise: &Rc<JsPromise>, reason: JsVal) {
    let prev = std::mem::replace(
        &mut *promise.state.borrow_mut(),
        PState::Rejected(reason.clone()),
    );
    if let PState::Pending { reject, .. } = prev {
        trigger(s, reject, reason);
    }
}

// §27.2.1.8 TriggerPromiseReactions
fn trigger(s: &mut Server, reactions: Vec<Reaction>, argument: JsVal) {
    for r in reactions {
        let arg = argument.clone();
        s.queue_microtask(Box::new(move |s| reaction_job(s, r, arg)));
    }
}

// §27.2.2.1 NewPromiseReactionJob
fn reaction_job(s: &mut Server, r: Reaction, argument: JsVal) {
    let result = match &r.handler {
        None if r.fulfill => Ok(argument),
        None => Err(Thrown(argument)),
        Some(h) => h(s, argument),
    };
    if let Some(cap) = r.capability {
        match result {
            Ok(v) => cap.resolve(s, v),
            Err(e) => cap.reject(s, e.0),
        }
    }
}

// §27.2.5.4.1 PerformPromiseThen
fn perform_then(
    s: &mut Server,
    promise: &Rc<JsPromise>,
    on_fulfilled: Option<Handler>,
    on_rejected: Option<Handler>,
    capability: Option<Resolvers>,
) {
    let fulfill = Reaction {
        capability: capability.clone(),
        handler: on_fulfilled,
        fulfill: true,
    };
    let reject = Reaction {
        capability,
        handler: on_rejected,
        fulfill: false,
    };
    let state = &mut *promise.state.borrow_mut();
    match state {
        PState::Pending {
            fulfill: f,
            reject: rj,
        } => {
            f.push(fulfill);
            rj.push(reject);
        }
        PState::Fulfilled(v) => {
            let v = v.clone();
            s.queue_microtask(Box::new(move |s| reaction_job(s, fulfill, v)));
        }
        PState::Rejected(e) => {
            let e = e.clone();
            s.queue_microtask(Box::new(move |s| reaction_job(s, reject, e)));
        }
    }
}

/// `promise.then(onFulfilled, onRejected)` (§27.2.5.4): the derived promise.
pub fn then(
    s: &mut Server,
    promise: &Rc<JsPromise>,
    on_fulfilled: Option<Handler>,
    on_rejected: Option<Handler>,
) -> Rc<JsPromise> {
    let derived = JsPromise::pending();
    let cap = Resolvers::new(derived.clone());
    perform_then(s, promise, on_fulfilled, on_rejected, Some(cap));
    derived
}

/// `promise.catch(onRejected)`: `then(undefined, onRejected)`.
pub fn catch(s: &mut Server, promise: &Rc<JsPromise>, on_rejected: Handler) -> Rc<JsPromise> {
    then(s, promise, None, Some(on_rejected))
}

/// A handler that does nothing (`() => {}`).
pub fn noop() -> Handler {
    Rc::new(|_, _| Ok(JsVal::Undefined))
}

/// A JS function value as a reaction handler.
pub fn handler_of(f: JsVal) -> Handler {
    Rc::new(move |s, v| call(s, &f, &[v]))
}

/// `new Promise(executor)`: the executor runs now with the resolving
/// functions; a throw rejects.
pub fn new_promise(
    s: &mut Server,
    executor: impl FnOnce(&mut Server, Resolvers) -> Res<()>,
) -> Rc<JsPromise> {
    let p = JsPromise::pending();
    let r = Resolvers::new(p.clone());
    if let Err(e) = executor(s, r.clone()) {
        r.reject(s, e.0);
    }
    p
}

/// A pending promise and its resolving functions (`let resolve, reject; new
/// Promise((r, j) => …)`).
pub fn with_resolvers() -> Resolvers {
    Resolvers::new(JsPromise::pending())
}

/// `Promise.resolve(x)` (§27.2.4.7, PromiseResolve): a promise is returned
/// as is; anything else is wrapped (and a thenable adopted).
pub fn promise_resolve(s: &mut Server, x: JsVal) -> Rc<JsPromise> {
    if let JsVal::Promise(p) = &x {
        return p.clone();
    }
    let r = with_resolvers();
    r.resolve(s, x);
    r.promise
}

/// `Promise.reject(e)`.
pub fn promise_reject(s: &mut Server, e: JsVal) -> Rc<JsPromise> {
    let r = with_resolvers();
    r.reject(s, e);
    r.promise
}

/// `Promise.all(items)` (§27.2.4.1, PerformPromiseAll).
pub fn promise_all(s: &mut Server, items: Vec<JsVal>) -> Rc<JsPromise> {
    let cap = with_resolvers();
    let values = Rc::new(RefCell::new(vec![JsVal::Undefined; items.len()]));
    let remaining = Rc::new(Cell::new(1usize));
    for (index, item) in items.into_iter().enumerate() {
        let next = promise_resolve(s, item);
        remaining.set(remaining.get() + 1);
        let called = Rc::new(Cell::new(false));
        let (values2, remaining2, cap2) = (values.clone(), remaining.clone(), cap.clone());
        let on_f: Handler = Rc::new(move |s, x| {
            if called.replace(true) {
                return Ok(JsVal::Undefined);
            }
            values2.borrow_mut()[index] = x;
            remaining2.set(remaining2.get() - 1);
            if remaining2.get() == 0 {
                let vs = values2.borrow().clone();
                cap2.resolve(s, JsVal::array(vs));
            }
            Ok(JsVal::Undefined)
        });
        let cap3 = cap.clone();
        let on_r: Handler = Rc::new(move |s, e| {
            cap3.reject(s, e);
            Ok(JsVal::Undefined)
        });
        // `Invoke(nextPromise, "then", …)`: the built-in then, which makes a
        // derived promise.
        then(s, &next, Some(on_f), Some(on_r));
    }
    remaining.set(remaining.get() - 1);
    if remaining.get() == 0 {
        let vs = values.borrow().clone();
        cap.resolve(s, JsVal::array(vs));
    }
    cap.promise
}

/// `Promise.allSettled(items)` (§27.2.4.2): the settlement records are not
/// read by any ported caller, only the timing; each is `undefined` here.
pub fn promise_all_settled(s: &mut Server, items: Vec<JsVal>) -> Rc<JsPromise> {
    let cap = with_resolvers();
    let len = items.len();
    let remaining = Rc::new(Cell::new(1usize));
    for item in items {
        let next = promise_resolve(s, item);
        remaining.set(remaining.get() + 1);
        let called = Rc::new(Cell::new(false));
        let element =
            |called: Rc<Cell<bool>>, remaining: Rc<Cell<usize>>, cap: Resolvers| -> Handler {
                Rc::new(move |s, _| {
                    if called.replace(true) {
                        return Ok(JsVal::Undefined);
                    }
                    remaining.set(remaining.get() - 1);
                    if remaining.get() == 0 {
                        cap.resolve(s, JsVal::array(vec![JsVal::Undefined; len]));
                    }
                    Ok(JsVal::Undefined)
                })
            };
        let on_f = element(called.clone(), remaining.clone(), cap.clone());
        let on_r = element(called, remaining.clone(), cap.clone());
        then(s, &next, Some(on_f), Some(on_r));
    }
    remaining.set(remaining.get() - 1);
    if remaining.get() == 0 {
        cap.resolve(s, JsVal::array(vec![JsVal::Undefined; len]));
    }
    cap.promise
}

/// `Promise.race(items)` (§27.2.4.5).
pub fn promise_race(s: &mut Server, items: Vec<JsVal>) -> Rc<JsPromise> {
    let cap = with_resolvers();
    for item in items {
        let next = promise_resolve(s, item);
        let (a, b) = (cap.clone(), cap.clone());
        then(
            s,
            &next,
            Some(Rc::new(move |s, v| {
                a.resolve(s, v);
                Ok(JsVal::Undefined)
            })),
            Some(Rc::new(move |s, e| {
                b.reject(s, e);
                Ok(JsVal::Undefined)
            })),
        );
    }
    cap.promise
}

/// `await value` in an async function (§27.7.5.3 Await): `PromiseResolve`,
/// then `PerformPromiseThen` with the continuation and no derived promise.
pub fn await_value(
    s: &mut Server,
    value: JsVal,
    on_fulfilled: impl FnOnce(&mut Server, JsVal) + 'static,
    on_rejected: impl FnOnce(&mut Server, JsVal) + 'static,
) {
    let p = promise_resolve(s, value);
    let f = RefCell::new(Some(on_fulfilled));
    let r = RefCell::new(Some(on_rejected));
    perform_then(
        s,
        &p,
        Some(Rc::new(move |s, v| {
            if let Some(k) = f.borrow_mut().take() {
                k(s, v);
            }
            Ok(JsVal::Undefined)
        })),
        Some(Rc::new(move |s, e| {
            if let Some(k) = r.borrow_mut().take() {
                k(s, e);
            }
            Ok(JsVal::Undefined)
        })),
        None,
    );
}

/// Solid's `createDeferredPromise` record (solid/src/server/signals.ts:
/// 1071-1115): a promise, its resolving functions, and the `s`/`v` marks it
/// writes on the promise when it settles.
pub struct Deferred {
    pub promise: Rc<JsPromise>,
    settled: Cell<bool>,
    resolvers: Resolvers,
}

impl Deferred {
    // Solid: signals.ts:1071-1115 (`createDeferredPromise`)
    pub fn new(s: &mut Server) -> Rc<Deferred> {
        let resolvers = with_resolvers();
        let promise = resolvers.promise.clone();
        // `promise.then(undefined, () => {})`: never unhandled.
        then(s, &promise, None, Some(noop()));
        Rc::new(Deferred {
            promise,
            settled: Cell::new(false),
            resolvers,
        })
    }

    pub fn resolve(&self, s: &mut Server, value: JsVal) {
        if self.settled.replace(true) {
            return;
        }
        self.promise.s.set(1);
        *self.promise.v.borrow_mut() = value.clone();
        self.resolvers.resolve(s, value);
    }

    pub fn reject(&self, s: &mut Server, error: JsVal) {
        if self.settled.replace(true) {
            return;
        }
        self.promise.s.set(2);
        *self.promise.v.borrow_mut() = error.clone();
        self.resolvers.reject(s, error);
    }
}

impl Server {
    /// `queueMicrotask(job)`, and every promise job.
    pub fn queue_microtask(&mut self, job: Job) {
        self.microtasks.push_back(job);
    }

    /// Node's `setImmediate(fn)`.
    pub fn set_immediate(&mut self, job: Job) {
        self.immediates.push_back(job);
    }

    /// Runs microtasks until the queue is empty.
    pub fn drain_microtasks(&mut self) {
        while let Some(job) = self.microtasks.pop_front() {
            job(self);
        }
    }

    /// Runs the event loop until nothing is scheduled: the microtasks, then
    /// each immediate in turn with the microtasks it queues. Returns when the
    /// render is idle (it waits only on host answers).
    pub fn run_until_idle(&mut self) {
        loop {
            self.drain_microtasks();
            match self.immediates.pop_front() {
                Some(job) => job(self),
                None => break,
            }
        }
    }
}

/// `queue(fn)` (web/src/server.ts:5863-5865): `Promise.resolve().then(fn)`.
/// `f` returns what the JS callback returns: a returned promise is adopted
/// by the derived promise, which costs the queue two more jobs.
pub fn queue(s: &mut Server, f: impl FnOnce(&mut Server) -> JsVal + 'static) -> Rc<JsPromise> {
    let p = promise_resolve(s, JsVal::Undefined);
    let f = RefCell::new(Some(f));
    then(
        s,
        &p,
        Some(Rc::new(move |s, _| {
            Ok(match f.borrow_mut().take() {
                Some(f) => f(s),
                None => JsVal::Undefined,
            })
        })),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A handler that logs `tag` and returns `undefined`.
    fn push(log: &Rc<RefCell<Vec<&'static str>>>, tag: &'static str) -> Handler {
        let log = log.clone();
        Rc::new(move |_, _| {
            log.borrow_mut().push(tag);
            Ok(JsVal::Undefined)
        })
    }

    #[test]
    fn microtasks_run_in_v8s_order() {
        // The order Node 24 prints for the same program (one `then` per line):
        //   p.then(a).then(b); p.then(c); new Promise(r => r(Promise.resolve(1))).then(q);
        //   Promise.resolve().then(d).then(e).then(f).then(g); queueMicrotask(m);
        //   Promise.all([Promise.resolve(1), 2]).then(all); Promise.all([]).then(all0);
        //   Promise.allSettled([Promise.reject(1)]).then(settled);
        //   Promise.race([new Promise(() => {}), Promise.resolve(3)]).then(race);
        //   (async () => { await Promise.resolve(); await1; await 5; await2; })();
        //   Promise.resolve().then(() => Promise.resolve()).then(ret-promise);
        let mut s = Server::new();
        let log = Rc::new(RefCell::new(vec![]));
        let p = promise_resolve(&mut s, JsVal::Undefined);
        let a = then(&mut s, &p, Some(push(&log, "a")), None);
        then(&mut s, &a, Some(push(&log, "b")), None);
        then(&mut s, &p, Some(push(&log, "c")), None);
        let inner = promise_resolve(&mut s, JsVal::Num(1));
        let q = new_promise(&mut s, |s, r| {
            r.resolve(s, JsVal::Promise(inner));
            Ok(())
        });
        then(&mut s, &q, Some(push(&log, "q")), None);
        let d0 = promise_resolve(&mut s, JsVal::Undefined);
        let d = then(&mut s, &d0, Some(push(&log, "d")), None);
        let e = then(&mut s, &d, Some(push(&log, "e")), None);
        let f = then(&mut s, &e, Some(push(&log, "f")), None);
        then(&mut s, &f, Some(push(&log, "g")), None);
        let l = log.clone();
        s.queue_microtask(Box::new(move |_| l.borrow_mut().push("m")));
        let one = promise_resolve(&mut s, JsVal::Num(1));
        let all = promise_all(&mut s, vec![JsVal::Promise(one), JsVal::Num(2)]);
        then(&mut s, &all, Some(push(&log, "all")), None);
        let all0 = promise_all(&mut s, vec![]);
        then(&mut s, &all0, Some(push(&log, "all0")), None);
        let rej = promise_reject(&mut s, JsVal::Num(1));
        let settled = promise_all_settled(&mut s, vec![JsVal::Promise(rej)]);
        then(&mut s, &settled, Some(push(&log, "settled")), None);
        let never = with_resolvers().promise;
        let three = promise_resolve(&mut s, JsVal::Num(3));
        let race = promise_race(&mut s, vec![JsVal::Promise(never), JsVal::Promise(three)]);
        then(&mut s, &race, Some(push(&log, "race")), None);
        let awaited = promise_resolve(&mut s, JsVal::Undefined);
        let l = log.clone();
        await_value(
            &mut s,
            JsVal::Promise(awaited),
            move |s, _| {
                l.borrow_mut().push("await1");
                let l2 = l.clone();
                await_value(
                    s,
                    JsVal::Num(5),
                    move |_, _| l2.borrow_mut().push("await2"),
                    |_, _| {},
                );
            },
            |_, _| {},
        );
        let r0 = promise_resolve(&mut s, JsVal::Undefined);
        let r1 = then(
            &mut s,
            &r0,
            Some(Rc::new(|s, _| {
                Ok(JsVal::Promise(promise_resolve(s, JsVal::Undefined)))
            })),
            None,
        );
        then(&mut s, &r1, Some(push(&log, "ret-promise")), None);
        s.run_until_idle();
        assert_eq!(
            *log.borrow(),
            [
                "a",
                "c",
                "d",
                "m",
                "all0",
                "await1",
                "b",
                "e",
                "all",
                "settled",
                "race",
                "await2",
                "q",
                "f",
                "g",
                "ret-promise"
            ]
        );
    }

    #[test]
    fn immediates_run_after_the_microtasks_they_follow() {
        let mut s = Server::new();
        let log = Rc::new(RefCell::new(vec![]));
        let l = log.clone();
        s.set_immediate(Box::new(move |s| {
            l.borrow_mut().push("immediate");
            let l2 = l.clone();
            s.queue_microtask(Box::new(move |_| l2.borrow_mut().push("its microtask")));
        }));
        let l = log.clone();
        s.queue_microtask(Box::new(move |_| l.borrow_mut().push("microtask")));
        s.run_until_idle();
        assert_eq!(*log.borrow(), ["microtask", "immediate", "its microtask"]);
    }
}
