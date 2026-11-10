//! The server's boundaries for async data: `<Errored>` (`createErrorBoundary`,
//! signals.ts:4167-4558) and `<Loading>` (`createLoadingBoundary` and
//! `ssrLoadingBoundary`, hydration.ts:71-877), the error context they hand
//! to their content (`ErrorContext`, `runWithBoundaryErrorContext`,
//! `ssrHandleError`), the fragment containers, and the sanitizing of errors
//! that cross to the client (`ssrSanitizeError` and its verdicts).
//!
//! A `<Loading>` under `renderToStream` discovers its content: holes that
//! read pending async data suspend (`{ t, h, p }`), and the boundary renders
//! its fallback inside a placeholder (`<template id="pl-ID">` … `<!--pl-ID-->`)
//! and registers a fragment. An async loop then waits for the holes'
//! promises, re-pulls them, and settles the fragment with the content, or,
//! when a read fails, with what the nearest `<Errored>` renders for it. Under
//! `renderToString` (no `ctx.async`) a suspended boundary renders its
//! fallback and serializes `"$$f"` under its id.
//!
//! Not ported (no plan app reaches them; each is refused with an error):
//! reveal groups (`<Reveal>`), `<Loading on>`, client holes
//! (`ssrSource: "client"`, `clientHandoff`), server components
//! (`inServerComponentScope` is false: `escaped` outcomes), regions drawn
//! into an enclosing open fragment (`container.region`, `drawRegions`), an
//! `<Errored>` fallback that suspends (`drawFallback`'s async resume), the
//! server error hook (`configureServerErrors`, `options.onError`: with no
//! hook `reportServerError` only records what it heard, and every wire error
//! is `new Error("Internal Server Error")`), and the observe-tier
//! `record`/findings.
use super::js::{await_value, catch, noop, promise_all};
use super::owner::OwnerId;
use super::value::{call, throw, ErrClass, JsError, JsFn, JsVal, Res, SsrRes, Thrown};
use super::web::{escape, resolve_fresh, ssr, CtxKind, RenderCtx, SerializeBuffer};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

/// The second argument of an `ErrorContext` handler: absent (a render
/// error to handle), `ESCALATE` (a fragment's failure going up), or the id of
/// a Loading boundary whose fragment asks for an outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    None,
    Escalate,
    Id(String),
}

/// An `ErrorContext` value: `(err, outcome) => …`. Its result is what JS
/// returns: `undefined`, `true`, a markup string, or a function.
pub type ErrorHandler = Rc<dyn Fn(&mut Server, Thrown, Outcome) -> Res<JsVal>>;

/// `runWithBoundaryErrorContext`'s `onError`: `(err, previousHandler, outcome)`.
pub type OnBoundaryError =
    Rc<dyn Fn(&mut Server, Thrown, Option<ErrorHandler>, Outcome) -> Res<JsVal>>;

/// An `<Errored>` fallback: `(err) => …`, given the error as an accessor.
pub type Fallback = Rc<dyn Fn(&mut Server, JsVal) -> Res<JsVal>>;

/// An error's verdict for the render's scope (signals.ts:3958-4016): the
/// wire error decided for it.
#[derive(Default)]
pub struct Verdict {
    decided: bool,
    wire: Option<JsVal>,
}

// Solid: signals.ts:4122-4142 (`ssrSanitizeError`), with no server error hook:
// one `new Error("Internal Server Error")` per error object, decided the
// first time; a primitive gets a fresh one each time (`verdictOf` keeps no
// verdict for it).
pub fn ssr_sanitize_error(s: &mut Server, value: &JsVal) -> JsVal {
    let fresh = || JsVal::Error(JsError::new(ErrClass::Error, "Internal Server Error"));
    if value.identity().is_none() {
        return fresh();
    }
    let found = s
        .verdicts
        .iter()
        .find(|(k, _)| k.strict_eq(value))
        .map(|(_, v)| v.clone());
    let verdict = match found {
        Some(v) => v,
        None => {
            let v = Rc::new(RefCell::new(Verdict::default()));
            s.verdicts.push((value.clone(), v.clone()));
            v
        }
    };
    let mut v = verdict.borrow_mut();
    if v.decided {
        return v.wire.clone().expect("a decided verdict has its wire");
    }
    let wire = fresh();
    v.decided = true;
    v.wire = Some(wire.clone());
    wire
}

// Solid: hydration.ts:54-69 (`ssrHandleError`): a `NotReadyError`'s source,
// or, for any other error, the nearest boundary's handler (which throws it
// on after rendering its fallback), or the error rethrown.
pub fn ssr_handle_error(s: &mut Server, err: Thrown, probe: bool) -> Res<Option<JsVal>> {
    if let Some(e) = err.not_ready() {
        return Ok(Some(e.source.borrow().clone()));
    }
    if probe {
        return Ok(None);
    }
    let handler = match s.get_owner() {
        Some(o) => s.error_context(Some(o))?,
        None => None,
    };
    match handler {
        Some(h) => {
            h(s, err, Outcome::None)?;
            Ok(None)
        }
        None => Err(err),
    }
}

/// A Loading boundary's fragment container (hydration.ts:182-189).
pub struct Container {
    pub open: Cell<bool>,
}

// Solid: signals.ts:3758-3765 (`setFragmentContainer`)
fn set_fragment_container(s: &mut Server, owner: OwnerId, c: Option<Rc<Container>>) {
    match c {
        Some(c) => {
            s.containers.insert(owner, c);
        }
        None => {
            s.containers.remove(&owner);
        }
    }
}

// Solid: signals.ts:3767-3781 (`fragmentContainer`)
fn fragment_container(s: &Server, owner: Option<OwnerId>, any: bool) -> Option<Rc<Container>> {
    let mut n = owner;
    while let Some(o) = n {
        if let Some(c) = s.containers.get(&o) {
            if c.open.get() || !any {
                return if c.open.get() { Some(c.clone()) } else { None };
            }
        }
        n = s.owner(o).parent;
    }
    None
}

// Solid: signals.ts:3829-3891 (`runWithBoundaryErrorContext`): the owner is
// current, its `ErrorContext` becomes `(err, outcome) => onError(err,
// previous, outcome)`, and (for a Loading boundary) the render context is
// switched to the boundary's for the render.
pub fn run_with_boundary_error_context(
    s: &mut Server,
    owner: OwnerId,
    render: impl FnOnce(&mut Server) -> Res<JsVal>,
    on_error: OnBoundaryError,
    context: Option<Rc<RenderCtx>>,
) -> Res<JsVal> {
    let prev_ctx = s.ctx.clone();
    if let Some(c) = &context {
        // `_currentBoundaryId` and `_loadingPhase` are set on the context
        // too; they only reach asset tracking and client holes.
        s.ctx = Some(c.clone());
    }
    let prev_owner = s.current;
    s.current = Some(owner);
    let parent_handler = s.error_context(Some(owner))?;
    let handler: ErrorHandler =
        Rc::new(move |s, err, outcome| on_error(s, err, parent_handler.clone(), outcome));
    s.set_error_context(owner, Some(handler));
    let result = render(s);
    s.current = prev_owner;
    if context.is_some() {
        s.ctx = prev_ctx;
    }
    result
}

// ---- <Errored> ----

struct ErrorBoundary {
    ctx: Option<Rc<RenderCtx>>,
    parent: Option<OwnerId>,
    owner: OwnerId,
    output_owner: Option<OwnerId>,
    children: JsVal,
    fallback: Fallback,
    pending: RefCell<Option<Rc<SsrRes>>>,
    shown: RefCell<Option<JsVal>>,
    resolve_id: RefCell<Option<String>>,
    resolve_count: Cell<u64>,
    fallback_result: RefCell<JsVal>,
    fallback_settled: Cell<bool>,
    boundary_id: Option<String>,
    deferred_wire: RefCell<Option<JsVal>>,
    answering: Cell<bool>,
    interceptor: Cell<bool>,
    pulling: Cell<bool>,
    fallback_failed: Cell<bool>,
}

impl ErrorBoundary {
    // Solid: signals.ts (createErrorBoundary `resolveIn`): the content
    // resolves under its own id and counter.
    fn resolve_in(
        &self,
        s: &mut Server,
        run: impl FnOnce(&mut Server) -> Res<JsVal>,
    ) -> Res<JsVal> {
        let Some(rid) = self.resolve_id.borrow().clone() else {
            return run(s);
        };
        let prev_id = s.owner(self.owner).id.clone();
        let prev_count = s.owner(self.owner).child_count;
        s.owner_mut(self.owner).id = Some(rid);
        s.owner_mut(self.owner).child_count = self.resolve_count.get();
        let r = run(s);
        self.resolve_count.set(s.owner(self.owner).child_count);
        let o = s.owner_mut(self.owner);
        o.id = prev_id;
        o.child_count = prev_count;
        r
    }

    // Solid: signals.ts (createErrorBoundary `resolve`): the first pass
    // renders the content under a fresh owner and resolves it; a later pass
    // re-pulls the holes that suspended. Suspended holes throw a
    // `NotReadyError` over all their promises.
    // Only reached under a render context: the pull takes its `ctx` branch.
    fn resolve(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        let pending = self.pending.borrow().clone();
        let resolved = match pending {
            Some(p) => {
                let (t, h) = (p.t.borrow().clone(), p.h.borrow().clone());
                self.resolve_in(s, |s| ssr(s, &t, &h))?
            }
            None => {
                let o = s.create_owner(None, false)?;
                let children = self.children.clone();
                let value = s.run_with_owner(Some(o), |s| call(s, &children, &[]))?;
                let rid = if s.owner(self.owner).id.is_some() {
                    Some(s.next_child_id_for(self.owner, true)?)
                } else {
                    None
                };
                *self.resolve_id.borrow_mut() = rid;
                self.resolve_count.set(0);
                self.resolve_in(s, |s| Ok(JsVal::Res(resolve_fresh(s, &escape(&value))?)))?
            }
        };
        let pending = match &resolved {
            JsVal::Res(r) if !r.p.borrow().is_empty() => Some(r.clone()),
            _ => None,
        };
        *self.pending.borrow_mut() = pending.clone();
        *self.shown.borrow_mut() = Some(resolved.clone());
        if let Some(p) = pending {
            let ps = p.p.borrow().clone();
            let all = promise_all(s, ps);
            catch(s, &all, noop());
            return Err(Thrown(JsVal::Error(JsError::not_ready(JsVal::Promise(
                all,
            )))));
        }
        Ok(resolved)
    }

    // Solid: signals.ts (createErrorBoundary `renderFallback`): the fallback
    // renders under the output owner, given the error as an accessor.
    fn render_fallback(&self, s: &mut Server, err: JsVal) -> Res<JsVal> {
        let fallback = self.fallback.clone();
        let accessor = JsVal::func(0, move |_, _| Ok(err.clone()));
        match self.output_owner {
            Some(out) => s.run_with_owner(self.parent, |s| {
                s.run_with_owner(Some(out), |s| fallback(s, accessor))
            }),
            None => fallback(s, accessor),
        }
    }

    // Solid: signals.ts (createErrorBoundary `serializeError`): the wire
    // error under the boundary's id, for the client's twin.
    fn serialize_error(&self, s: &mut Server, err: JsVal) -> Res<()> {
        if let (Some(ctx), Some(id)) = (&self.ctx, &self.boundary_id) {
            if !id.is_empty() && !s.no_hydrate(self.owner) {
                ctx.serialize(s, id.clone(), err, false)?;
            }
        }
        Ok(())
    }

    // Solid: signals.ts (createErrorBoundary `handleError`): sanitize, then
    // serialize the wire error now or once the fallback settles (`defer`),
    // and render the fallback once.
    fn handle_error(&self, s: &mut Server, err: &Thrown, defer: bool) -> Res<JsVal> {
        if self.fallback_settled.get() {
            return Ok(self.fallback_result.borrow().clone());
        }
        let wire = ssr_sanitize_error(s, &err.0);
        if defer {
            *self.deferred_wire.borrow_mut() = Some(wire.clone());
        } else {
            self.serialize_error(s, wire.clone())?;
        }
        let r = self.render_fallback(s, wire)?;
        *self.fallback_result.borrow_mut() = r.clone();
        self.fallback_settled.set(true);
        Ok(r)
    }

    // Solid: signals.ts (createErrorBoundary `markup`)
    fn markup(&self) -> Option<String> {
        match self.shown.borrow().as_ref()? {
            JsVal::Res(r) => {
                if !r.h.borrow().is_empty() {
                    return None;
                }
                let t = r.t.borrow();
                (t.len() == 1).then(|| t[0].clone())
            }
            JsVal::Tmpl(t) => Some(t.to_string()),
            _ => None,
        }
    }

    // Solid: signals.ts (createErrorBoundary `renderOutcome`): a Loading
    // boundary inside asks what its failed fragment shows; when the content
    // this boundary showed is exactly that boundary's placeholder, its own
    // fallback.
    fn render_outcome(
        self: &Rc<Self>,
        s: &mut Server,
        err: Thrown,
        outcome: &str,
        parent_handler: Option<ErrorHandler>,
    ) -> Res<JsVal> {
        let t = match self.shown.borrow().as_ref() {
            Some(JsVal::Res(r)) => Some(r.t.borrow()[0].clone()),
            Some(JsVal::Tmpl(t)) => Some(t.to_string()),
            _ => None,
        };
        let fits = t.is_some_and(|t| {
            t.starts_with(&format!("<template id=\"pl-{outcome}\""))
                && t.ends_with(&format!("<!--pl-{outcome}-->"))
        });
        if self.ctx.is_none() || self.fallback_failed.get() || !fits {
            return Ok(JsVal::Undefined);
        }
        self.draw_fallback(s, err, Some(outcome.to_string()), parent_handler)
    }

    // Solid: signals.ts (createErrorBoundary `escalated`)
    fn escalated(
        self: &Rc<Self>,
        s: &mut Server,
        err: Thrown,
        up: Option<ErrorHandler>,
    ) -> Res<JsVal> {
        if self.ctx.is_some() && !self.fallback_failed.get() {
            if self.fallback_settled.get() {
                return Ok(JsVal::Bool(true));
            }
            if self.pending.borrow().is_some() || self.pulling.get() {
                self.handle_error(s, &err, false)?;
                return Ok(JsVal::Bool(true));
            }
            let from = self.markup();
            if from.is_some() && fragment_container(s, self.parent, false).is_some() {
                return throw("an <Errored> drawing its fallback into an enclosing open fragment (container.region) is not ported");
            }
        }
        match up {
            Some(up) => up(s, err, Outcome::Escalate),
            None => Ok(JsVal::Undefined),
        }
    }

    // Solid: signals.ts (createErrorBoundary `drawFallback`): the fallback,
    // resolved in the boundary's render context. A fallback that suspends
    // (the async resume) or fails (the escalation) is not ported.
    fn draw_fallback(
        self: &Rc<Self>,
        s: &mut Server,
        err: Thrown,
        _outcome: Option<String>,
        parent_handler: Option<ErrorHandler>,
    ) -> Res<JsVal> {
        if let (Some(ph), false) = (&parent_handler, self.interceptor.get()) {
            self.interceptor.set(true);
            let me = self.clone();
            let ph = ph.clone();
            let handler: ErrorHandler = Rc::new(move |s, e, o| {
                if o == Outcome::None && me.answering.get() {
                    return Err(e);
                }
                ph(s, e, o)
            });
            if let Some(out) = self.output_owner {
                s.set_error_context(out, Some(handler));
            }
        }
        // `inCtx`
        let prev_ctx = std::mem::replace(&mut s.ctx, self.ctx.clone());
        self.answering.set(true);
        let r = (|| -> Res<JsVal> {
            let v = self.handle_error(s, &err, true)?;
            Ok(JsVal::Res(resolve_fresh(s, &escape(&v))?))
        })();
        self.answering.set(false);
        s.ctx = prev_ctx;
        let resolved = match r {
            Ok(v) => Some(v),
            Err(e) if e.not_ready().is_some() => None,
            Err(_) => {
                return throw("an <Errored> fallback that throws (its escalation) is not ported")
            }
        };
        let suspended = matches!(&resolved, Some(JsVal::Res(r)) if !r.h.borrow().is_empty());
        if suspended {
            return throw(
                "an <Errored> fallback that suspends (drawFallback's async resume) is not ported",
            );
        }
        // `finish` (`outcome === true`, a server component's outcome, never
        // occurs here: `outcome` only reaches the escalation, which is refused)
        let Some(JsVal::Res(r)) = resolved else {
            return Ok(JsVal::Undefined);
        };
        if let Some(w) = self.deferred_wire.borrow_mut().take() {
            self.serialize_error(s, w)?;
        }
        let t = r.t.borrow()[0].clone();
        Ok(JsVal::str(&t))
    }

    // Solid: signals.ts (createErrorBoundary's returned accessor)
    fn pull(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        if self.fallback_settled.get() {
            return Ok(self.fallback_result.borrow().clone());
        }
        if self.ctx.is_some() && self.pending.borrow().is_none() {
            s.dispose_owner(self.owner, false)?;
        }
        let handled = Rc::new(Cell::new(false));
        let result: Rc<RefCell<JsVal>> = Rc::new(RefCell::new(JsVal::Undefined));
        let fallback_threw: Rc<RefCell<Option<Thrown>>> = Rc::new(RefCell::new(None));
        self.pulling.set(true);
        let r = if self.ctx.is_some() {
            let me = self.clone();
            let (h2, r2, f2) = (handled.clone(), result.clone(), fallback_threw.clone());
            let on_error: OnBoundaryError = Rc::new(move |s, err, parent, outcome| {
                if err.not_ready().is_some() {
                    return Err(err);
                }
                match outcome {
                    Outcome::Escalate => return me.escalated(s, err, parent),
                    Outcome::Id(id) => return me.render_outcome(s, err, &id, parent),
                    Outcome::None => {}
                }
                h2.set(true);
                match me.handle_error(s, &err, false) {
                    Ok(v) => *r2.borrow_mut() = v,
                    Err(e) => {
                        *f2.borrow_mut() = Some(e.clone());
                        return Err(e);
                    }
                }
                Err(err)
            });
            let me = self.clone();
            run_with_boundary_error_context(s, self.owner, move |s| me.resolve(s), on_error, None)
        } else {
            let children = self.children.clone();
            s.run_with_owner(Some(self.owner), |s| call(s, &children, &[]))
        };
        self.pulling.set(false);
        match r {
            Ok(v) => Ok(v),
            Err(err) => {
                if err.not_ready().is_some() {
                    return Err(err);
                }
                *self.pending.borrow_mut() = None;
                if let Some(e) = fallback_threw.borrow_mut().take() {
                    return Err(e);
                }
                if handled.get() {
                    Ok(result.borrow().clone())
                } else {
                    self.handle_error(s, &err, false)
                }
            }
        }
    }
}

// Solid: signals.ts:4167-4558 (`createErrorBoundary`): an owner (whose id
// keys the serialized error), an output owner for the fallback, and an
// accessor (`$lhSkip`) that renders the content, or the fallback once an
// error reached the boundary.
pub fn create_error_boundary(s: &mut Server, children: JsVal, fallback: Fallback) -> Res<JsVal> {
    let ctx = s.ctx.clone();
    let parent = s.get_owner();
    let owner = s.create_owner(None, false)?;
    // `setContext(RevealGroupContext, null, owner)`: no reveal groups here.
    let output_owner = if ctx.is_some() {
        Some(s.create_owner(None, false)?)
    } else {
        None
    };
    let boundary_id = s.owner(owner).id.clone();
    let b = Rc::new(ErrorBoundary {
        ctx,
        parent,
        owner,
        output_owner,
        children,
        fallback,
        pending: RefCell::new(None),
        shown: RefCell::new(None),
        resolve_id: RefCell::new(None),
        resolve_count: Cell::new(0),
        fallback_result: RefCell::new(JsVal::Undefined),
        fallback_settled: Cell::new(false),
        boundary_id,
        deferred_wire: RefCell::new(None),
        answering: Cell::new(false),
        interceptor: Cell::new(false),
        pulling: Cell::new(false),
        fallback_failed: Cell::new(false),
    });
    Ok(JsVal::Fn(Rc::new(JsFn {
        arity: 0,
        esc: false,
        rw: false,
        lh_skip: Cell::new(true),
        body: Box::new(move |s, _| b.pull(s)),
    })))
}

/// `<Errored>`'s props: `fallback` is the compiled `(err) => …` (a plain
/// field), `children` a getter.
pub struct ErroredProps {
    pub fallback: JsVal,
    pub children: JsVal,
}

// Solid: flow.ts:276-295 (`Errored`): `createErrorBoundary(() =>
// props.children, (err, reset) => typeof f === "function" ? f(err, reset) :
// f)`.
pub fn errored(s: &mut Server, props: ErroredProps) -> Res<JsVal> {
    let ErroredProps { fallback, children } = props;
    let content = JsVal::func(0, move |s, _| call(s, &children, &[]));
    create_error_boundary(
        s,
        content,
        Rc::new(move |s, err| match &fallback {
            JsVal::Fn(_) => {
                let reset = JsVal::func(0, |_, _| Ok(JsVal::Undefined));
                call(s, &fallback, &[err, reset])
            }
            other => Ok(other.clone()),
        }),
    )
}

// ---- <Loading> ----

/// What a failed fragment settles with: the markup an `<Errored>` drew for
/// it.
struct FragmentOutcome {
    value: Option<String>,
}

/// The fragment's settle function (`registerFragment`'s return value):
/// `(value, error) => firstFlushed`.
pub type Settle = Rc<dyn Fn(&mut Server, Option<String>, Option<JsVal>) -> bool>;

struct LoadingBoundary {
    ctx: Rc<RenderCtx>,
    buffered: Rc<RenderCtx>,
    buffer: Rc<SerializeBuffer>,
    parent: Option<OwnerId>,
    parent_handler: Option<ErrorHandler>,
    o: OwnerId,
    id: String,
    content_id: String,
    flatten_id: String,
    children: JsVal,
    container: Rc<Container>,
    done: RefCell<Option<Settle>>,
    discarded: Cell<bool>,
    handled_render_error: RefCell<Option<Thrown>>,
    retry_promise: RefCell<Option<JsVal>>,
    passes: Cell<u64>,
    streamed_on_error: Cell<bool>,
    resolve_count: Cell<u64>,
    ret: RefCell<Option<JsVal>>,
    disposed: Cell<bool>,
    superseded: Cell<bool>,
}

const MAX_RESUME_PASSES: u64 = 10000;

impl LoadingBoundary {
    // Solid: solid/src/server/hydration.ts:365-369 (`flushSerializeBuffer`)
    fn flush_serialize_buffer(&self, s: &mut Server) -> Res<()> {
        let writes = std::mem::take(&mut *self.buffer.buffer.borrow_mut());
        let mut first: Res<()> = Ok(());
        for (id, value, defer) in writes {
            let r = self.ctx.serialize(s, id, value, defer);
            if first.is_ok() {
                first = r;
            }
        }
        self.buffer.flushed.set(true);
        first
    }

    // Solid: solid/src/server/hydration.ts:371-381 (`commitBoundaryState`): the
    // buffered writes, then the boundary's modules (none in a plan app).
    fn commit_boundary_state(&self, s: &mut Server) -> Res<()> {
        self.flush_serialize_buffer(s)
    }

    fn done(&self, s: &mut Server, value: Option<String>, error: Option<JsVal>) -> bool {
        // `done = (value, error, escaped) => (container.open = false,
        // settle(value, error, escaped))`
        self.container.open.set(false);
        let settle = self.done.borrow().clone().expect("a registered fragment");
        settle(s, value, error)
    }

    // Solid: hydration.ts (ssrLoadingBoundary `errorOutcome`): what the
    // nearest `<Errored>` renders for the failed fragment.
    fn error_outcome(&self, s: &mut Server, err: &Thrown) -> Res<Option<FragmentOutcome>> {
        let rendered = match &self.parent_handler {
            Some(h) => h(s, err.clone(), Outcome::Id(self.id.clone()))?,
            None => JsVal::Undefined,
        };
        match rendered {
            JsVal::Str(v) => Ok(Some(FragmentOutcome {
                value: Some(v.to_string()),
            })),
            JsVal::Fn(_) => {
                throw("an <Errored> outcome that suspends (an async fallback) is not ported")
            }
            _ => Ok(None),
        }
    }

    // Solid: hydration.ts (ssrLoadingBoundary `failFragment`): settle the
    // fragment with the outcome, or hand the failure to an enclosing open
    // fragment.
    fn fail_fragment(self: &Rc<Self>, s: &mut Server, err: &Thrown) -> Res<bool> {
        let outcome = self.error_outcome(s, err)?;
        self.discarded.set(true);
        if outcome.is_none() {
            if let Some(ph) = self.parent_handler.clone() {
                if fragment_container(s, self.parent, true).is_some() {
                    self.done(s, None, Some(err.0.clone()));
                    ph(s, err.clone(), Outcome::Escalate)?;
                    return Ok(true);
                }
            }
        }
        // `reportServerError` (handling "client") records the error for a
        // hook; with none it writes nothing.
        Ok(self.done(s, outcome.and_then(|o| o.value), Some(err.0.clone())))
    }

    // Solid: hydration.ts (ssrLoadingBoundary `runLoadingPhase`)
    fn run_loading_phase(
        self: &Rc<Self>,
        s: &mut Server,
        render: impl FnOnce(&mut Server) -> Res<JsVal>,
    ) -> Res<JsVal> {
        *self.handled_render_error.borrow_mut() = None;
        let me = self.clone();
        let on_error: OnBoundaryError = Rc::new(move |s, err, handler, outcome| {
            match outcome {
                Outcome::Escalate => {
                    if me.container.open.get() {
                        return me.fail_open(s, &err);
                    }
                    if me.discarded.get() {
                        return Ok(JsVal::Bool(true));
                    }
                    return match handler {
                        Some(h) => h(s, err, Outcome::Escalate),
                        None => Ok(JsVal::Undefined),
                    };
                }
                Outcome::Id(id) => {
                    return match handler {
                        Some(h) => h(s, err, Outcome::Id(id)),
                        None => Ok(JsVal::Undefined),
                    };
                }
                Outcome::None => {}
            }
            *me.handled_render_error.borrow_mut() = Some(err.clone());
            if me.done.borrow().is_some() {
                let streamed = me.fail_fragment(s, &err)?;
                me.streamed_on_error.set(streamed);
                return Err(err);
            }
            if let Some(ph) = me.parent_handler.clone() {
                ph(s, err, Outcome::None)?;
                return Ok(JsVal::Undefined);
            }
            Err(err)
        });
        let ctx = self.buffered.clone();
        run_with_boundary_error_context(s, self.o, render, on_error, Some(ctx))
    }

    // Solid: hydration.ts (ssrLoadingBoundary `failOpen`)
    fn fail_open(self: &Rc<Self>, s: &mut Server, err: &Thrown) -> Res<JsVal> {
        self.container.open.set(false);
        self.discarded.set(true);
        self.fail_fragment(s, err)?;
        Ok(JsVal::Bool(true))
    }

    // Solid: hydration.ts (ssrLoadingBoundary `finalizeError`)
    fn finalize_error(self: &Rc<Self>, s: &mut Server, err: Thrown) -> Res<()> {
        let handled = self.handled_render_error.borrow().clone();
        if handled.is_some_and(|h| h.same(&err)) {
            *self.handled_render_error.borrow_mut() = None;
            return Ok(());
        }
        if self.done.borrow().is_some() {
            // `streamed` (`ctx.flushed()`) only decides whether the failure is
            // reported to a server error hook; there is none.
            if self.fail_fragment(s, &err)? {
                return Ok(());
            }
        }
        match self.parent_handler.clone() {
            None => {
                if let Some(st) = self.ctx.stream() {
                    st.fail_render(s, err);
                    return Ok(());
                }
                Err(err)
            }
            Some(ph) => {
                let r = s.run_with_owner(self.parent, |s| ph(s, err.clone(), Outcome::None));
                if let Err(caught) = r {
                    if !caught.same(&err) {
                        if let Some(st) = self.ctx.stream() {
                            st.fail_render(s, caught);
                        }
                    }
                }
                Ok(())
            }
        }
    }

    // Solid: hydration.ts (ssrLoadingBoundary `resolveIn`): the content
    // resolves under the flatten id with its own counter.
    fn resolve_in(
        &self,
        s: &mut Server,
        run: impl FnOnce(&mut Server) -> Res<JsVal>,
    ) -> Res<JsVal> {
        let prev_count = s.owner(self.o).child_count;
        s.owner_mut(self.o).id = Some(self.flatten_id.clone());
        s.owner_mut(self.o).child_count = self.resolve_count.get();
        let r = run(s);
        self.resolve_count.set(s.owner(self.o).child_count);
        let o = s.owner_mut(self.o);
        o.id = Some(self.content_id.clone());
        o.child_count = prev_count;
        r
    }

    // Solid: hydration.ts (ssrLoadingBoundary `runDiscovery`)
    fn run_discovery(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        s.dispose_owner(self.o, false)?;
        self.buffer.buffer.borrow_mut().clear();
        *self.retry_promise.borrow_mut() = None;
        self.resolve_count.set(0);
        self.passes.set(self.passes.get() + 1);
        let me = self.clone();
        self.run_loading_phase(s, move |s| {
            let value = call(s, &me.children, &[]);
            let r = value.and_then(|value| {
                me.resolve_in(s, |s| Ok(JsVal::Res(resolve_fresh(s, &escape(&value))?)))
            });
            match r {
                Ok(v) => Ok(v),
                Err(err) => {
                    if let Some(e) = err.not_ready() {
                        *me.retry_promise.borrow_mut() = Some(e.source.borrow().clone());
                        return Ok(JsVal::Undefined);
                    }
                    if me
                        .handled_render_error
                        .borrow()
                        .as_ref()
                        .is_some_and(|h| h.same(&err))
                    {
                        return Err(err);
                    }
                    ssr_handle_error(s, err, false)?;
                    Ok(JsVal::Undefined)
                }
            }
        })
    }

    // Solid: hydration.ts (ssrLoadingBoundary `abandon`): a disposed pass
    // settles its fragment empty unless a newer pass took its id.
    fn abandon(self: &Rc<Self>, s: &mut Server) {
        let st = self.ctx.stream().expect("a streaming boundary");
        let mine = st
            .fragment_owner(&self.id)
            .is_some_and(|d| d == Rc::as_ptr(self) as usize);
        if !mine {
            self.superseded.set(true);
            return;
        }
        st.remove_fragment_owner(&self.id);
        self.done(s, None, None);
    }

    fn check_budget(&self) -> Res<()> {
        if self.passes.get() <= MAX_RESUME_PASSES {
            return Ok(());
        }
        throw(format!("<Loading> boundary discovery did not converge after {} passes — an async source produces a new pending answer on every retry. Ensure repeated reads settle (e.g. return a stable promise or value for the same question).", self.passes.get()))
    }

    // Solid: hydration.ts (ssrLoadingBoundary's async IIFE): the discovery
    // retries (`while (retryPromise)`), the commit, the re-pull loop over
    // the suspended holes (`while (ret.p.length)`, each pass after `await
    // Promise.all(pending.p).catch(() => {})`), and the settle; a thrown
    // error goes to `finalizeError`. Written as continuations: each `await`
    // is `await_value`.
    fn run(self: &Rc<Self>, s: &mut Server) {
        self.retry_loop(s);
    }

    fn fail(self: &Rc<Self>, s: &mut Server, err: Thrown) {
        if let Err(e) = self.finalize_error(s, err) {
            // An error with no boundary and no stream to fail: the render's.
            s.failures.push(format!("a <Loading> boundary failed: {e}"));
        }
    }

    fn retry_loop(self: &Rc<Self>, s: &mut Server) {
        let retry = self.retry_promise.borrow().clone();
        let Some(retry) = retry else {
            if let Err(e) = self.commit_boundary_state(s) {
                return self.fail(s, e);
            }
            return self.pending_loop(s);
        };
        if let Err(e) = self.check_budget() {
            return self.fail(s, e);
        }
        let JsVal::Promise(p) = retry else {
            return self.fail(
                s,
                Thrown::msg("a retry source that is not a promise is not ported"),
            );
        };
        let waited = catch(s, &p, noop());
        let (a, b) = (self.clone(), self.clone());
        await_value(
            s,
            JsVal::Promise(waited),
            move |s, _| {
                if a.disposed.get() {
                    return a.abandon(s);
                }
                if a.discarded.get() {
                    return;
                }
                match a.run_discovery(s) {
                    Ok(v) => *a.ret.borrow_mut() = Some(v),
                    Err(e) => return a.fail(s, e),
                }
                a.retry_loop(s);
            },
            move |s, e| b.fail(s, Thrown(e)),
        );
    }

    fn pending_loop(self: &Rc<Self>, s: &mut Server) {
        let ret = self.ret.borrow().clone();
        let pending = match &ret {
            Some(JsVal::Res(r)) if !r.p.borrow().is_empty() => r.clone(),
            _ => return self.finish(s, ret),
        };
        if let Err(e) = self.check_budget() {
            return self.fail(s, e);
        }
        let ps = pending.p.borrow().clone();
        let all = promise_all(s, ps);
        let waited = catch(s, &all, noop());
        let (a, b) = (self.clone(), self.clone());
        await_value(
            s,
            JsVal::Promise(waited),
            move |s, _| {
                if a.disposed.get() {
                    return a.abandon(s);
                }
                if a.discarded.get() {
                    return;
                }
                a.passes.set(a.passes.get() + 1);
                let (t, h) = (pending.t.borrow().clone(), pending.h.borrow().clone());
                let me = a.clone();
                let r = a.run_loading_phase(s, move |s| me.resolve_in(s, |s| ssr(s, &t, &h)));
                match r {
                    Ok(v) => *a.ret.borrow_mut() = Some(v),
                    Err(e) => return a.fail(s, e),
                }
                a.pending_loop(s);
            },
            move |s, e| b.fail(s, Thrown(e)),
        );
    }

    fn finish(self: &Rc<Self>, s: &mut Server, ret: Option<JsVal>) {
        if let Err(e) = self.flush_serialize_buffer(s) {
            return self.fail(s, e);
        }
        let value = match &ret {
            Some(JsVal::Res(r)) => Some(r.t.borrow()[0].clone()),
            Some(JsVal::Tmpl(t)) => Some(t.to_string()),
            Some(JsVal::Undefined) | None => None,
            Some(other) => {
                return self.fail(s, Thrown::msg(format!("a Loading content of {other:?}")))
            }
        };
        // `regions` (drawn fallbacks of inner `<Errored>`s) are refused where
        // they are pushed.
        self.done(s, value, None);
    }
}

/// `skipLive(f)`: the accessor a Loading boundary returns, branded
/// `$lhSkip`.
fn skip_live(f: impl Fn(&mut Server) -> Res<JsVal> + 'static) -> JsVal {
    JsVal::Fn(Rc::new(JsFn {
        arity: 0,
        esc: false,
        rw: false,
        lh_skip: Cell::new(true),
        body: Box::new(move |s, _| f(s)),
    }))
}

// Solid: hydration.ts:127-877 (`ssrLoadingBoundary`)
fn ssr_loading_boundary(
    s: &mut Server,
    ctx: Rc<RenderCtx>,
    children: JsVal,
    fallback: JsVal,
) -> Res<JsVal> {
    let parent = s.get_owner();
    let parent_handler = match parent {
        Some(p) => s.error_context(Some(p))?,
        None => None,
    };
    // `RevealGroupContext` is null: no `<Reveal>` in a plan app.
    let o = s.create_owner(None, false)?;
    let id = s.owner(o).id.clone().unwrap_or_default();
    let content_id = format!("{id}00");
    let flatten_id = format!("{id}01");
    s.owner_mut(o).id = Some(content_id.clone());
    let buffer = Rc::new(SerializeBuffer {
        ctx: ctx.clone(),
        buffer: RefCell::new(vec![]),
        flushed: Cell::new(false),
    });
    let buffered = RenderCtx::new(CtxKind::Buffered(buffer.clone()), Some(ctx.clone()));
    let b = Rc::new(LoadingBoundary {
        ctx: ctx.clone(),
        buffered,
        buffer,
        parent,
        parent_handler,
        o,
        id: id.clone(),
        content_id,
        flatten_id,
        children,
        container: Rc::new(Container {
            open: Cell::new(false),
        }),
        done: RefCell::new(None),
        discarded: Cell::new(false),
        handled_render_error: RefCell::new(None),
        retry_promise: RefCell::new(None),
        passes: Cell::new(0),
        streamed_on_error: Cell::new(false),
        resolve_count: Cell::new(0),
        ret: RefCell::new(None),
        disposed: Cell::new(false),
        superseded: Cell::new(false),
    });
    let ret = b.run_discovery(s)?;
    *b.ret.borrow_mut() = Some(ret.clone());
    let suspended = matches!(&ret, JsVal::Res(r) if !r.p.borrow().is_empty());
    if b.retry_promise.borrow().is_none() && !suspended {
        b.commit_boundary_state(s)?;
        return Ok(skip_live(move |_| Ok(ret.clone())));
    }
    // `finalAtDiscovery` (a client hole) is false; no collapsed fallback.
    let fallback_owner = s.create_owner(Some(id.clone()), false)?;
    let is_async = ctx.is_async();
    let tpl = [
        format!("<template id=\"pl-{id}\"></template>"),
        format!("<!--pl-{id}-->"),
    ];
    let fallback_result = s.run_with_owner(Some(fallback_owner), |s| {
        let f = call(s, &fallback, &[])?;
        if !is_async {
            return Ok(f);
        }
        ssr(s, &tpl, &[escape(&f)])
    })?;
    if is_async {
        let st = ctx.stream().expect("an async context is a stream's");
        let settle = st.register_fragment(s, id.clone());
        *b.done.borrow_mut() = Some(settle);
        b.container.open.set(true);
        set_fragment_container(s, o, Some(b.container.clone()));
        st.set_fragment_owner(&id, Rc::as_ptr(&b) as usize);
        let me = b.clone();
        s.on_cleanup(Rc::new(move |s| {
            me.disposed.set(true);
            me.container.open.set(false);
            set_fragment_container(s, me.o, None);
        }));
        b.run(s);
        return Ok(skip_live(move |_| Ok(fallback_result.clone())));
    }
    b.commit_boundary_state(s)?;
    ctx.serialize(s, id, JsVal::str("$$f"), false)?;
    Ok(skip_live(move |_| Ok(fallback_result.clone())))
}

// Solid: hydration.ts:71-94 (`createLoadingBoundary`) under a render
// context (`<Loading on>` is not ported).
pub fn create_loading_boundary(s: &mut Server, children: JsVal, fallback: JsVal) -> Res<JsVal> {
    let Some(ctx) = s.ctx.clone() else {
        return throw("a <Loading> outside a render context is not ported");
    };
    ssr_loading_boundary(s, ctx, children, fallback)
}

/// `<Loading>`'s props: getters for `fallback` and `children`.
pub struct LoadingProps {
    pub fallback: JsVal,
    pub children: JsVal,
}

// Solid: flow.ts:297-308 (`Loading`): `createLoadingBoundary(() =>
// props.children, () => props.fallback)`.
pub fn loading(s: &mut Server, props: LoadingProps) -> Res<JsVal> {
    let LoadingProps { fallback, children } = props;
    let c = JsVal::func(0, move |s, _| call(s, &children, &[]));
    let f = JsVal::func(0, move |s, _| call(s, &fallback, &[]));
    create_loading_boundary(s, c, f)
}
