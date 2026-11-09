//! The server build's reactive primitives (solid/src/server/signals.ts): the
//! server is single-pass and pull-based. A signal is its value, a store is
//! its plain object, a memo computes once (eagerly unless `lazy`) under its
//! own owner, and setters are inert. Only owners matter beyond values: every
//! memo takes a hydration child id where the client's computation takes one.
//!
//! Ported as far as a plan v2 app runs it (measured with V8 coverage of the
//! server builds; docs/SSR.md, "What runs"): `createSignal` (value form),
//! `createMemo` (its sync tail: plan values are never promises or async
//! iterables, so `processResult` takes its last branch), `createSyncMemo`,
//! `createOptimistic` (function form), `createStore` (value form), `mapArray`
//! (keyed by default, no fallback), `action`, `ssrScope`, and
//! `@solidjs/web`'s `memo`.
//!
//! Not ported (unreachable from a plan app): the async machinery
//! (`processResult`'s thenable and iterator branches, `subscribePendingRetry`,
//! `NotReadyError` latches, `ssrSource`, `loadingValue`, `deferStream`,
//! serialization of async values), epochs (`commitEpoch` is frame renders
//! only), dependency edges (`edgeHooks` is null outside the frames server),
//! live-hole sweeps in `mapArray`, projections, `repeat`, and the dev-only
//! `warnServerWrite` diagnostics.
use super::owner::OwnerId;
use super::value::{call, JsVal, Res, Thrown};
use super::Server;
use std::{cell::RefCell, rc::Rc};

pub type Compute = Rc<dyn Fn(&mut Server, JsVal) -> Res<JsVal>>;
/// A memo's `update` / `pull`: runs the compute once.
type Run<T> = Rc<dyn Fn(&mut Server) -> Res<T>>;

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

/// The server's `ServerComputation` (signals.ts:769-798), sync fields only.
struct Comp {
    value: JsVal,
    error: Option<Thrown>,
    computed: bool,
    disposed: bool,
}

// Solid: signals.ts:1407-1608 (`createMemo`). `sync` goes to
// `createSyncMemo`. Otherwise: an owner (an id, as the client's computed
// takes one), `update()` runs the compute under it after
// `resetOwnerForRerun`, and `processResult` keeps the value (signals.ts:
// 2403-2423, its synchronous tail: no plan value is a promise or an async
// iterable). An error is kept and thrown on every read.
pub fn create_memo(s: &mut Server, compute: Compute, options: MemoOptions) -> Res<JsVal> {
    if options.sync {
        return create_sync_memo(s, compute, options);
    }
    let owner = s.create_owner(options.id.clone(), options.transparent)?;
    let comp = Rc::new(RefCell::new(Comp {
        value: JsVal::Undefined,
        error: None,
        computed: false,
        disposed: false,
    }));
    let update: Run<()> = {
        let comp = comp.clone();
        Rc::new(move |s: &mut Server| {
            if comp.borrow().disposed {
                return Ok(());
            }
            comp.borrow_mut().error = None;
            // `run`: resetOwnerForRerun, then the compute under the owner (and
            // its observer, which only async reads consult).
            let prev = comp.borrow().value.clone();
            let result = s
                .reset_owner_for_rerun(owner)
                .and_then(|_| s.run_with_owner(Some(owner), |s| compute(s, prev)));
            let mut c = comp.borrow_mut();
            match result {
                Ok(v) => {
                    c.computed = true;
                    // processResult: a synchronous value.
                    c.value = v;
                }
                Err(e) => {
                    c.error = Some(e);
                    c.computed = true;
                }
            }
            Ok(())
        })
    };
    if !options.lazy {
        update(s)?;
    }
    Ok(JsVal::func(0, move |s, _| {
        if !comp.borrow().computed {
            update(s)?;
        }
        let c = comp.borrow();
        match &c.error {
            Some(e) => Err(e.clone()),
            None => Ok(c.value.clone()),
        }
    }))
}

struct SyncMemo {
    value: JsVal,
    error: Option<Thrown>,
    cached: bool,
}

// Solid: signals.ts:1637-1742 (`createSyncMemo`): an owner, an eager pull
// unless `lazy`, and a read that returns the cached value or rethrows the
// cached error.
pub fn create_sync_memo(s: &mut Server, compute: Compute, options: MemoOptions) -> Res<JsVal> {
    let owner = s.create_owner(options.id.clone(), options.transparent)?;
    let state = Rc::new(RefCell::new(SyncMemo {
        value: JsVal::Undefined,
        error: None,
        cached: false,
    }));
    let pull: Run<JsVal> = {
        let state = state.clone();
        Rc::new(move |s: &mut Server| {
            let prev_owner = s.current;
            s.current = Some(owner);
            let prev = state.borrow().value.clone();
            let result = s
                .reset_owner_for_rerun(owner)
                .and_then(|_| compute(s, prev));
            s.current = prev_owner;
            let mut st = state.borrow_mut();
            st.cached = true;
            match result {
                Ok(v) => {
                    st.value = v.clone();
                    st.error = None;
                    Ok(v)
                }
                Err(e) => {
                    st.error = Some(e.clone());
                    Err(e)
                }
            }
        })
    };
    if !options.lazy {
        // The error is recorded; it surfaces on read.
        let _ = pull(s);
    }
    Ok(JsVal::func(0, move |s, _| {
        {
            let st = state.borrow();
            if st.cached {
                return match &st.error {
                    Some(e) => Err(e.clone()),
                    None => Ok(st.value.clone()),
                };
            }
        }
        pull(s)
    }))
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
            return Err(Thrown(
                "a store setter returning a replacement is not ported (replaceState)".into(),
            ));
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

// Solid: signals.ts:706-765 (`ssrScope`): reserve one id slot of the nearest
// id-bearing owner now; each evaluation runs with that slot as the owner's id
// and a zeroed child counter, and unwraps accessor chains inside the scope.
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
    Ok(JsVal::func(0, move |s, _| {
        let o = s.owner(parent);
        let (prev_id, prev_slot, prev_count) = (o.id.clone(), o.scope_slot, o.child_count);
        let o = s.owner_mut(parent);
        o.id = Some(prefix.clone());
        o.scope_slot = slot as i64;
        o.child_count = 0;
        let mut result = call(s, &f, &[]);
        while let Ok(JsVal::Fn(_)) = &result {
            let next = result.expect("checked");
            result = call(s, &next, &[]);
        }
        let o = s.owner_mut(parent);
        o.id = prev_id;
        o.scope_slot = prev_slot;
        o.child_count = prev_count;
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
// sweep runs in `renderToString`, so the row cache is never read or filled.
pub fn map_array(s: &mut Server, list: JsVal, map_fn: JsVal, options: MapOptions) -> Res<JsVal> {
    let JsVal::Fn(mf) = &map_fn else {
        return Err(Thrown(
            "mapArray: the map function is not a function".into(),
        ));
    };
    let indexes = mf.arity > 1;
    if indexes || options.keyed == Some(false) {
        return Err(Thrown(
            "mapArray with an index argument or keyed: false is not ported".into(),
        ));
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
                return Err(Thrown(format!("mapArray over {other:?} is not ported")));
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
