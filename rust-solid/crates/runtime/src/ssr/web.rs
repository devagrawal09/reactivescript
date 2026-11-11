//! `@solidjs/web`'s server runtime (web/src/server.ts) as a render of a plan
//! app runs it: `ssr()` template assembly, `escape`, the hole and tree
//! resolvers (with the `{ t, h, p }` results of holes that suspended and
//! their async wraps), hydration keys, the render context
//! (`sharedConfig.context`), `renderToString`, and the hydration script.
//! `renderToStream` is `stream.rs`.
//!
//! Not ported, because a plan app never reaches them: live holes
//! (`sharedConfig.context.liveHoles` is only set by frame renders, so every
//! `live` branch of `ssr()` is dead), group holes (`$g`, emitted only for
//! attribute groups; plans have no attributes), attribute escaping,
//! `ssrElement`/`ssrAttribute`/class and style serializers, link claims (no
//! anchor has an `href`), `<select>` value resolution (never activated:
//! plans have no `value` attributes), head and asset tracking (nothing
//! registers a head tag or an asset: `registerEntryAssets` without a
//! manifest, `renderShellHead` and `flushHeadFragment` over an empty
//! registry, `serializeFragmentAssets` with no boundary modules all write
//! nothing), and the trace context (`traceFor`, whose meta tag only reaches
//! a document with a `</head>`, which a plan app never renders: `head` is
//! refused).
use super::boundary::ssr_handle_error;
use super::js::Deferred;
use super::owner::OwnerId;
use super::stream::{HydrationSerializer, StreamRender};
use super::value::{call, throw, JsFn, JsVal, Res, SsrRes, Thrown};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

/// A settled-slot record (signals.ts:1150-1166): an async memo's state by
/// owner id, which a later pass over the same id adopts.
pub struct Slot {
    pub s: u8,
    pub v: JsVal,
    pub d: Option<Rc<Deferred>>,
}

pub type SlotStore = Rc<RefCell<Vec<(String, Rc<RefCell<Slot>>)>>>;

/// The render context's own behaviour: `renderToString`'s, `renderToStream`'s,
/// or a Loading boundary's `bufferedCtx` (`Object.create(ctx)` with its own
/// `serialize`, solid/src/server/hydration.ts:351-355).
pub enum CtxKind {
    String(Rc<StringRender>),
    Stream(Rc<StreamRender>),
    Buffered(Rc<SerializeBuffer>),
    /// `Object.create(page)` with a `frameId` (frames
    /// `frameTransformDirectResult`, frame-sink.ts:2395-2405): every field
    /// and method reads through to the page's context. Frames only.
    Derived(String),
}

/// `sharedConfig.context`: a render's context object. `proto` is the
/// prototype of a `bufferedCtx`; `slots` is the object's own `[SLOTS]`.
pub struct RenderCtx {
    pub proto: Option<Rc<RenderCtx>>,
    pub kind: CtxKind,
    slots: RefCell<Option<SlotStore>>,
    /// `ctx.liveHoles` (frames' live-hole engine, server.ts:3981): 0 unset,
    /// 1 the document face's (scope-gated to server-component interiors), 2
    /// a frame render's (every hole). Read through the prototype chain.
    pub live: Cell<u8>,
}

/// A Loading boundary's serialize buffer (solid/src/server/hydration.ts:343-381): writes made
/// while the boundary discovers its content wait until it commits.
pub struct SerializeBuffer {
    pub ctx: Rc<RenderCtx>,
    pub buffer: RefCell<Vec<(String, JsVal, bool)>>,
    pub flushed: Cell<bool>,
}

impl RenderCtx {
    pub fn new(kind: CtxKind, proto: Option<Rc<RenderCtx>>) -> Rc<RenderCtx> {
        Rc::new(RenderCtx {
            proto,
            kind,
            slots: RefCell::new(None),
            live: Cell::new(0),
        })
    }

    /// `ctx.liveHoles`, through the prototype chain.
    pub fn live_holes(&self) -> u8 {
        match self.live.get() {
            0 => self.proto.as_ref().map_or(0, |p| p.live_holes()),
            n => n,
        }
    }

    /// `ctx.async`: true for `renderToStream`'s context.
    pub fn is_async(&self) -> bool {
        match &self.kind {
            CtxKind::String(_) => false,
            CtxKind::Stream(_) => true,
            CtxKind::Buffered(b) => b.ctx.is_async(),
            CtxKind::Derived(_) => self.proto.as_ref().is_some_and(|p| p.is_async()),
        }
    }

    /// The stream render, through the prototype chain.
    pub fn stream(&self) -> Option<Rc<StreamRender>> {
        match &self.kind {
            CtxKind::Stream(st) => Some(st.clone()),
            CtxKind::String(_) => None,
            CtxKind::Buffered(b) => b.ctx.stream(),
            CtxKind::Derived(_) => self.proto.as_ref().and_then(|p| p.stream()),
        }
    }

    /// `ctx.serialize(id, value, deferStream)`.
    pub fn serialize(&self, s: &mut Server, id: String, value: JsVal, defer: bool) -> Res<()> {
        match &self.kind {
            CtxKind::String(r) => r.serialize(s, id, value),
            CtxKind::Stream(st) => st.serialize(s, id, value, defer),
            // Solid: solid/src/server/hydration.ts:352-355 (`bufferedCtx.serialize`)
            CtxKind::Buffered(b) => {
                if b.flushed.get() {
                    b.ctx.serialize(s, id, value, defer)
                } else {
                    b.buffer.borrow_mut().push((id, value, defer));
                    Ok(())
                }
            }
            CtxKind::Derived(_) => match &self.proto {
                Some(p) => p.serialize(s, id, value, defer),
                None => throw("a derived context without its page"),
            },
        }
    }

    /// `ctx[SLOTS]`, through the prototype chain.
    fn slots(&self) -> Option<SlotStore> {
        if let Some(st) = self.slots.borrow().as_ref() {
            return Some(st.clone());
        }
        self.proto.as_ref().and_then(|p| p.slots())
    }

    /// `ctx[SLOTS]?.[id]`.
    pub fn slot(&self, id: &str) -> Option<Rc<RefCell<Slot>>> {
        let store = self.slots()?;
        let found = store
            .borrow()
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, v)| v.clone());
        found
    }

    /// `ctx[SLOTS] ||= Object.create(null)`: an inherited store is used; a
    /// missing one is created on this object.
    pub fn slots_or_create(&self) -> SlotStore {
        if let Some(st) = self.slots() {
            return st;
        }
        let st: SlotStore = Rc::new(RefCell::new(vec![]));
        *self.slots.borrow_mut() = Some(st.clone());
        st
    }
}

/// `renderToString`'s context state (server.ts:1791-1846).
pub struct StringRender {
    pub serializer: Rc<HydrationSerializer>,
    pub closed: Cell<bool>,
}

impl StringRender {
    // Solid: server.ts:1828-1840 (`serialize`): an async value is an error.
    fn serialize(&self, s: &mut Server, id: String, p: JsVal) -> Res<()> {
        if self.closed.get() {
            return Ok(());
        }
        if matches!(p, JsVal::Promise(_)) {
            return throw(format!("Cannot serialize async value in renderToString (id: {id}). Use renderToStream for async data."));
        }
        self.serializer.write(s, id, p)
    }
}

// Solid: server.ts:5645-5681 (`escape`, content position: `attr` false).
pub fn escape(v: &JsVal) -> JsVal {
    match v {
        JsVal::Str(s) => {
            let e = escape_str(s);
            if e.as_str() == &**s {
                v.clone()
            } else {
                JsVal::str(&e)
            }
        }
        JsVal::Arr(a) => {
            if let Some(joined) = try_join_plain_ssr_array(&a.borrow()) {
                return JsVal::str(&joined);
            }
            // `s.slice()` and escape each item (no double escaping of the
            // original).
            let copy: Vec<JsVal> = a.borrow().iter().map(escape).collect();
            JsVal::array(copy)
        }
        JsVal::Fn(f) => escape_late(f),
        other => other.clone(),
    }
}

/// `escape`'s string paths (`ESCAPE_CONTENT = /[&<]/`, `escapeSlow`): `&` to
/// `&amp;` and `<` to `&lt;`, one left-to-right pass.
// Solid: server.ts:5664-5681, 5730-5769 (`escape`'s fast path and `escapeSlow`)
pub fn escape_str(s: &str) -> String {
    if !s.contains(['&', '<']) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '&' => out.push_str("&amp;"),
            c => out.push(c),
        }
    }
    out
}

// Solid: server.ts:5704-5718 (`escapeLate`): a function at a content hole is
// escaped when the resolver calls it; the wrapper keeps the `$lhSkip` brand.
fn escape_late(f: &Rc<JsFn>) -> JsVal {
    if f.esc {
        return JsVal::Fn(f.clone());
    }
    let inner = JsVal::Fn(f.clone());
    let fn_ = inner.clone();
    JsVal::Fn(Rc::new(JsFn {
        arity: 0,
        esc: true,
        rw: false,
        lh_skip: Cell::new(f.lh_skip.get()),
        inner: Some(fn_),
        body: Box::new(move |s, _| Ok(escape(&call(s, &inner, &[])?))),
    }))
}

// Solid: server.ts:5810-5821 (`tryJoinPlainSSRArray`)
fn try_join_plain_ssr_array(nodes: &[JsVal]) -> Option<String> {
    if nodes.is_empty() {
        return None;
    }
    let mut out = String::new();
    for node in nodes {
        match node {
            JsVal::Tmpl(t) => out.push_str(t),
            _ => return None,
        }
    }
    Some(out)
}

/// A hole's resolution: a string, or what `appendResolvedNode` takes (an
/// async wrap `{ fn, p }`, a template to merge, a node to resolve).
enum Resolved {
    Str(String),
    Wrap(JsVal, JsVal),
    Merge(Rc<SsrRes>),
    Bail(JsVal),
}

// Solid: server.ts:3755-3796 (`buildAsyncWrap`): a `NotReadyError` becomes a
// hole that waits on its source, re-run under the owner of the moment
// (`$rw`); any other error goes to the boundary's handler (which throws it
// on) or is rethrown.
fn build_async_wrap(s: &mut Server, err: Thrown, node: &JsVal) -> Res<Option<(JsVal, JsVal)>> {
    let p = ssr_handle_error(s, err, false)?;
    let Some(p) = p else {
        return Ok(None);
    };
    let JsVal::Fn(f) = node else {
        return throw("buildAsyncWrap: a hole that is not a function");
    };
    if f.rw {
        return Ok(Some((node.clone(), p)));
    }
    let Some(owner) = s.get_owner() else {
        return Ok(Some((node.clone(), p)));
    };
    let inner = node.clone();
    let wrapped = JsVal::Fn(Rc::new(JsFn {
        arity: 0,
        esc: false,
        rw: true,
        lh_skip: Cell::new(f.lh_skip.get()),
        inner: None,
        body: Box::new(move |s, _| s.run_with_owner(Some(owner), |s| call(s, &inner, &[]))),
    }));
    Ok(Some((wrapped, p)))
}

// Solid: server.ts:3805-3817 (`tryResolveFunctionHole`)
fn try_resolve_function_hole(s: &mut Server, hole: &JsVal) -> Res<Resolved> {
    let value = match call(s, hole, &[]) {
        Ok(v) => v,
        Err(err) => {
            return Ok(match build_async_wrap(s, err, hole)? {
                Some((f, p)) => Resolved::Wrap(f, p),
                None => Resolved::Str(String::new()),
            })
        }
    };
    Ok(match value {
        JsVal::Str(v) => Resolved::Str(v.to_string()),
        JsVal::Num(n) => Resolved::Str(n.to_string()),
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => Resolved::Str(String::new()),
        other => try_resolve_string(s, &other, false)?,
    })
}

const TEXT_SEPARATOR: &str = "<!--!$-->";

// Solid: server.ts:6231-6280 (`tryResolveString`). Adjacent text values are
// separated by `<!--!$-->` (`ssrTextTail`), which the client's hydration
// walk counts as a text boundary. A list with an item that does not resolve
// to a string bails (its items are resolved again by `resolveSSRNode`); a
// suspended template is merged; a function that suspends is wrapped.
fn try_resolve_string(s: &mut Server, node: &JsVal, nested: bool) -> Res<Resolved> {
    if !nested {
        s.ssr_text_tail = false;
    }
    Ok(match node {
        JsVal::Str(_) | JsVal::Num(_) => {
            let text = match node {
                JsVal::Str(v) => v.to_string(),
                JsVal::Num(n) => n.to_string(),
                _ => unreachable!(),
            };
            let out = if s.ssr_text_tail {
                format!("{TEXT_SEPARATOR}{text}")
            } else {
                text
            };
            s.ssr_text_tail = true;
            Resolved::Str(out)
        }
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => Resolved::Str(String::new()),
        JsVal::Arr(a) => {
            let items = a.borrow().clone();
            if let Some(joined) = try_join_plain_ssr_array(&items) {
                s.ssr_text_tail = false;
                return Ok(Resolved::Str(joined));
            }
            let mut out = String::new();
            for item in &items {
                match try_resolve_string(s, item, true)? {
                    Resolved::Str(r) => out.push_str(&r),
                    _ => return Ok(Resolved::Bail(node.clone())),
                }
            }
            Resolved::Str(out)
        }
        JsVal::Res(r) => {
            if !r.h.borrow().is_empty() {
                return Ok(Resolved::Merge(r.clone()));
            }
            s.ssr_text_tail = false;
            Resolved::Str(r.t.borrow()[0].clone())
        }
        JsVal::Tmpl(t) => {
            s.ssr_text_tail = false;
            Resolved::Str(t.to_string())
        }
        JsVal::Fn(_) => match call(s, node, &[]) {
            Ok(v) => try_resolve_string(s, &v, true)?,
            Err(err) => match build_async_wrap(s, err, node)? {
                Some((f, p)) => {
                    s.ssr_text_tail = true;
                    Resolved::Wrap(f, p)
                }
                None => Resolved::Str(String::new()),
            },
        },
        // An object that is not a template (`node.t === undefined`).
        JsVal::Rec(_) | JsVal::Promise(_) | JsVal::Error(_) | JsVal::Deferred(_) => {
            Resolved::Str(String::new())
        }
    })
}

// Solid: server.ts:3822-3829 (`mergeTemplateInto`)
fn merge_template_into(result: &Rc<SsrRes>, node: &Rc<SsrRes>) {
    let nt = node.t.borrow().clone();
    result
        .t
        .borrow_mut()
        .last_mut()
        .expect("a part")
        .push_str(&nt[0]);
    if nt.len() > 1 {
        result.t.borrow_mut().extend(nt[1..].iter().cloned());
        result
            .h
            .borrow_mut()
            .extend(node.h.borrow().iter().cloned());
        result
            .p
            .borrow_mut()
            .extend(node.p.borrow().iter().cloned());
    }
}

// Solid: server.ts:3831-3840 (`appendResolvedNode`)
fn append_resolved_node(s: &mut Server, result: &Rc<SsrRes>, node: Resolved) -> Res<()> {
    match node {
        Resolved::Wrap(f, p) => {
            result.h.borrow_mut().push(f);
            result.p.borrow_mut().push(p);
            result.t.borrow_mut().push(String::new());
        }
        Resolved::Merge(m) => merge_template_into(result, &m),
        Resolved::Bail(b) => resolve_ssr_node(s, &b, result, false, false)?,
        Resolved::Str(_) => unreachable!("a string is appended by the caller"),
    }
    Ok(())
}

fn push_text(result: &Rc<SsrRes>, text: &str) {
    result
        .t
        .borrow_mut()
        .last_mut()
        .expect("a part")
        .push_str(text);
}

// Solid: server.ts:4742-5005 (`ssr`), the path with no live holes and no
// groups: strings and numbers are appended, nullish and booleans skipped,
// functions resolved through `tryResolveFunctionHole`, anything else through
// `tryResolveString`; once a hole suspends, the rest resolve into the
// `{ t, h, p }` result.
pub fn ssr(s: &mut Server, template: &[String], holes: &[JsVal]) -> Res<JsVal> {
    if holes.is_empty() {
        // `if (len === 1) return { t }`: `t` is the template itself; the
        // resolvers read `t[0]` of an array template.
        return Ok(JsVal::Tmpl(Rc::from(template[0].as_str())));
    }
    if template.len() != holes.len() + 1 {
        return throw("ssr: a template has one more part than it has holes");
    }
    let mut out = template[0].clone();
    let mut result: Option<Rc<SsrRes>> = None;
    let live = s.ctx.as_ref().map_or(0, |c| c.live_holes()) != 0;
    let positions = if live {
        content_positions(template)
    } else {
        vec![]
    };
    for (i, hole) in holes.iter().enumerate() {
        // Live frame renders route thunk content holes through the engine
        // (server.ts:4893-4910).
        if live && matches!(hole, JsVal::Fn(_)) && positions[i] {
            if let Some(node) = live_content(s, hole) {
                match node? {
                    LiveNode::Str(text) => match &result {
                        None => out.push_str(&text),
                        Some(r) => push_text(r, &text),
                    },
                    LiveNode::Tmpl(t) => {
                        let r = match &result {
                            Some(r) => r.clone(),
                            None => {
                                let r = SsrRes::new(std::mem::take(&mut out));
                                result = Some(r.clone());
                                r
                            }
                        };
                        resolve_ssr_node(s, &JsVal::Res(t), &r, false, false)?;
                    }
                }
                match &result {
                    None => out.push_str(&template[i + 1]),
                    Some(r) => push_text(r, &template[i + 1]),
                }
                continue;
            }
        }
        match hole {
            JsVal::Str(v) => match &result {
                None => out.push_str(v),
                Some(r) => push_text(r, v),
            },
            JsVal::Num(n) => match &result {
                None => out.push_str(&n.to_string()),
                Some(r) => push_text(r, &n.to_string()),
            },
            JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => {}
            JsVal::Fn(_) => match &result {
                Some(r) => resolve_ssr_node(s, hole, r, false, false)?,
                None => match try_resolve_function_hole(s, hole)? {
                    Resolved::Str(v) => out.push_str(&v),
                    other => {
                        let r = SsrRes::new(std::mem::take(&mut out));
                        append_resolved_node(s, &r, other)?;
                        result = Some(r);
                    }
                },
            },
            other => match &result {
                Some(r) => resolve_ssr_node(s, other, r, false, false)?,
                None => match try_resolve_string(s, other, false)? {
                    Resolved::Str(v) => out.push_str(&v),
                    resolved => {
                        let r = SsrRes::new(std::mem::take(&mut out));
                        append_resolved_node(s, &r, resolved)?;
                        result = Some(r);
                    }
                },
            },
        }
        match &result {
            None => out.push_str(&template[i + 1]),
            Some(r) => push_text(r, &template[i + 1]),
        }
    }
    Ok(match result {
        None => JsVal::Tmpl(Rc::from(out.as_str())),
        Some(r) => JsVal::Res(r),
    })
}

// Solid: server.ts:6285-6362 (`resolveSSRNode`): resolves a node into
// `result`, a function's suspension becoming one of its holes
// (`pushSSRAsyncHole`).
pub fn resolve_ssr_node(
    s: &mut Server,
    node: &JsVal,
    result: &Rc<SsrRes>,
    top: bool,
    nested: bool,
) -> Res<()> {
    if !nested {
        s.ssr_text_tail = false;
    }
    match node {
        JsVal::Str(_) | JsVal::Num(_) => {
            let text = match node {
                JsVal::Str(v) => v.to_string(),
                JsVal::Num(n) => n.to_string(),
                _ => unreachable!(),
            };
            if s.ssr_text_tail {
                push_text(result, TEXT_SEPARATOR);
            }
            push_text(result, &text);
            s.ssr_text_tail = true;
        }
        JsVal::Undefined | JsVal::Null | JsVal::Bool(_) => {}
        JsVal::Arr(a) => {
            let items = a.borrow().clone();
            // A slot range resolves mint-suppressed (server.ts:6301-6318).
            let slot =
                s.ctx.as_ref().is_some_and(|c| c.live_holes() != 0) && s.brands.is_slot(node);
            if slot {
                s.live_suppressed += 1;
            }
            let mut r = Ok(());
            for item in &items {
                if top {
                    s.ssr_text_tail = false;
                }
                r = resolve_ssr_node(s, item, result, false, true);
                if r.is_err() {
                    break;
                }
            }
            if slot {
                s.live_suppressed -= 1;
            }
            r?;
        }
        JsVal::Res(r) => {
            merge_template_into(result, r);
            s.ssr_text_tail = false;
        }
        JsVal::Tmpl(t) => {
            push_text(result, t);
            s.ssr_text_tail = false;
        }
        // An object that is not a template: the dev build warns.
        JsVal::Rec(_) | JsVal::Promise(_) | JsVal::Error(_) | JsVal::Deferred(_) => {}
        JsVal::Fn(_) => {
            // A live render routes function nodes through the engine
            // (server.ts:6332-6352): its text counts as text.
            if let Some(node) = live_content(s, node) {
                match node? {
                    LiveNode::Str(text) => {
                        if s.ssr_text_tail {
                            push_text(result, TEXT_SEPARATOR);
                        }
                        push_text(result, &text);
                        s.ssr_text_tail = true;
                    }
                    LiveNode::Tmpl(t) => resolve_ssr_node(s, &JsVal::Res(t), result, false, true)?,
                }
                return Ok(());
            }
            match call(s, node, &[]) {
                Ok(v) => {
                    if let Err(err) = resolve_ssr_node(s, &v, result, false, true) {
                        push_ssr_async_hole(s, result, err, node)?;
                    }
                }
                Err(err) => push_ssr_async_hole(s, result, err, node)?,
            }
        }
    }
    Ok(())
}

/// `resolveSSRNode(node)` into a fresh result.
pub fn resolve_fresh(s: &mut Server, node: &JsVal) -> Res<Rc<SsrRes>> {
    let r = SsrRes::new(String::new());
    resolve_ssr_node(s, node, &r, false, false)?;
    Ok(r)
}

// Solid: server.ts:6365-6374 (`pushSSRAsyncHole`)
fn push_ssr_async_hole(s: &mut Server, result: &Rc<SsrRes>, err: Thrown, node: &JsVal) -> Res<()> {
    if let Some((f, p)) = build_async_wrap(s, err, node)? {
        if s.ssr_text_tail {
            push_text(result, TEXT_SEPARATOR);
        }
        result.h.borrow_mut().push(f);
        result.p.borrow_mut().push(p);
        result.t.borrow_mut().push(String::new());
        s.ssr_text_tail = true;
    }
    Ok(())
}

// ---- the live-hole engine's content path (frames only) ----

/// What `live.content(hole)` returned: rendered text, or a template.
enum LiveNode {
    Str(String),
    Tmpl(Rc<SsrRes>),
}

/// Whether a value is slot-tagged (`$slot`) or a `$lhSkip` function.
fn slot_tagged(s: &Server, v: &JsVal) -> bool {
    match v {
        JsVal::Fn(f) => f.lh_skip.get(),
        other => s.brands.is_slot(other),
    }
}

// Solid: server.ts:4093-4111 (`resolveValue`): a `For`'s rows (`$rows`) each
// behind `<!--lr-->`; anything else resolved into `res`.
fn resolve_live_value(s: &mut Server, value: &JsVal, res: &Rc<SsrRes>) -> Res<()> {
    let rows = matches!(value, JsVal::Arr(_)) && s.brands.is_rows(value);
    if !rows {
        return resolve_ssr_node(s, value, res, false, false);
    }
    let JsVal::Arr(items) = value else {
        unreachable!("an array")
    };
    let items = items.borrow().clone();
    for row in &items {
        let r = resolve_fresh(s, &escape(row))?;
        let first = r.t.borrow()[0].clone();
        res.t
            .borrow_mut()
            .last_mut()
            .expect("a part")
            .push_str(&format!("<!--lr-->{first}"));
        if !r.h.borrow().is_empty() {
            res.t.borrow_mut().extend(r.t.borrow()[1..].iter().cloned());
            res.h.borrow_mut().extend(r.h.borrow().iter().cloned());
            res.p.borrow_mut().extend(r.p.borrow().iter().cloned());
        }
    }
    Ok(())
}

// Solid: server.ts:4285-4524 (the live-hole engine's `content`), for the
// frames subset: every hole there reads final values (`settled`), so a hole
// that resolves synchronously ships unmarked and unbound; only a `For`'s
// rows are marked (`<!--lr-->`). Returns None where the engine defers to the
// normal path: no engine, a suppressed window, a `$lhSkip` hole, or (the
// document face) a hole outside every server component.
fn live_content(s: &mut Server, hole: &JsVal) -> Option<Res<LiveNode>> {
    let mode = s.ctx.as_ref().map_or(0, |c| c.live_holes());
    if mode == 0 || s.live_suppressed > 0 {
        return None;
    }
    let JsVal::Fn(f) = hole else { return None };
    if f.lh_skip.get() || (mode == 1 && !s.in_server_component_scope()) {
        return None;
    }
    let f = f.clone();
    Some((|| {
        // `holeValue`: an escape wrapper's own function, its rows kept.
        let value = match &f.inner {
            Some(inner) => match call(s, inner, &[]) {
                Ok(v) => {
                    let rows = matches!(v, JsVal::Arr(_)) && s.brands.is_rows(&v);
                    Ok(if rows { v } else { escape(&v) })
                }
                Err(e) => Err(e),
            },
            None => call(s, hole, &[]),
        };
        let value = match value {
            Ok(v) => v,
            Err(err) => {
                return match build_async_wrap(s, err, hole)? {
                    // A suspended hole inside a server component: its
                    // escalated mint is outside the frames subset.
                    Some(_) => throw("a suspended live hole inside a server component is outside the frames subset"),
                    // A real error contributes nothing.
                    None => Ok(LiveNode::Str(String::new())),
                };
            }
        };
        if slot_tagged(s, &value) {
            s.live_suppressed += 1;
            let r = resolve_fresh(s, &value);
            s.live_suppressed -= 1;
            let r = r?;
            return Ok(if r.h.borrow().is_empty() {
                LiveNode::Str(r.t.borrow()[0].clone())
            } else {
                LiveNode::Tmpl(r)
            });
        }
        let res = SsrRes::new(String::new());
        resolve_live_value(s, &value, &res)?;
        Ok(if res.h.borrow().is_empty() {
            LiveNode::Str(res.t.borrow()[0].clone())
        } else {
            LiveNode::Tmpl(res)
        })
    })())
}

/// `holeContentPositions` (server.ts:3920-3965), for the templates a plan
/// lowers to (no attribute values): whether hole `i` sits outside a tag.
fn content_positions(template: &[String]) -> Vec<bool> {
    let mut in_tag = false;
    let mut out = vec![];
    for (i, seg) in template.iter().enumerate() {
        for c in seg.chars() {
            if in_tag {
                if c == '>' {
                    in_tag = false;
                }
            } else if c == '<' {
                in_tag = true;
            }
        }
        if i < template.len() - 1 {
            out.push(!in_tag);
        }
    }
    out
}

// Solid: server.ts:6376-6380 (`resolveSSRSync`)
pub fn resolve_ssr_sync(s: &mut Server, node: &JsVal) -> Res<String> {
    let res = resolve_fresh(s, node)?;
    if !res.h.borrow().is_empty() {
        return throw("This value cannot be rendered synchronously. Are you missing a boundary?");
    }
    let t = res.t.borrow()[0].clone();
    Ok(t)
}

impl Server {
    // Solid: solid/src/server/shared.ts:207-213 (`getNextContextId`)
    pub fn get_next_context_id(&mut self) -> Res<Option<String>> {
        let Some(o) = self.get_owner() else {
            return throw("getNextContextId cannot be used under non-hydrating context");
        };
        if self.no_hydrate(o) {
            return Ok(None);
        }
        self.get_next_child_id(o).map(Some)
    }
}

// Solid: server.ts:5822-5827 (`getHydrationKey`)
pub fn get_hydration_key(s: &mut Server) -> Res<Option<String>> {
    if s.ctx.is_none() {
        return Ok(None);
    }
    s.get_next_context_id()
}

// Solid: server.ts:5394-5397 (`ssrHydrationKey`)
pub fn ssr_hydration_key(s: &mut Server) -> Res<JsVal> {
    Ok(JsVal::str(&match get_hydration_key(s)? {
        Some(hk) if !hk.is_empty() => format!(" _hk={hk}"),
        _ => String::new(),
    }))
}

/// `getLocalHeaderScript(renderId)` (server.ts:598-600).
pub fn local_header_script(render_id: &str) -> String {
    super::seroval::cross_reference_header(Some(render_id)) + ";"
}

/// `assembleDocument` and `withShellEnd` for a body-only render with nothing
/// registered for the head (server.ts:5900-5906, 5931-6007): the scripts go
/// at the `<!--xs-->` marker, or after the HTML. A render whose HTML has a
/// `</head>` or the marker is refused: those splices are not ported.
pub fn assemble_document(html: &str, scripts: &str) -> Res<String> {
    if html.contains("</head>") || html.contains("<!--xs-->") {
        return throw("a document shell (</head>, <!--xs-->) is not ported");
    }
    Ok(if scripts.is_empty() {
        html.to_string()
    } else {
        format!("{html}<script>{scripts}</script>")
    })
}

/// What `renderToString` returns, and the host requests it made.
pub struct StringOutput {
    pub html: String,
}

// Solid: server.ts:1791-1957 (`renderToString`), for a render with no
// request event, no nonce, no manifest and no `onHead`: a hydration
// serializer whose data becomes the document's one script, the context, the
// root owner (`renderId` as its id), the code's result escaped and resolved
// synchronously, the serializer closed, and the document assembled. The
// root is disposed before returning.
pub fn render_to_string(
    s: &mut Server,
    render_id: &str,
    code: impl FnOnce(&mut Server) -> Res<JsVal>,
) -> Res<String> {
    let scripts = Rc::new(RefCell::new(String::new()));
    let sc = scripts.clone();
    let rid = render_id.to_string();
    let serializer = HydrationSerializer::new(
        Some(render_id.to_string()),
        Rc::new(move |_, script: String| {
            let mut sc = sc.borrow_mut();
            if sc.is_empty() {
                *sc = local_header_script(&rid);
            }
            sc.push_str(&script);
            sc.push(';');
        }),
        None,
        false,
    );
    let render = Rc::new(StringRender {
        serializer: serializer.clone(),
        closed: Cell::new(false),
    });
    s.ctx = Some(RenderCtx::new(CtxKind::String(render.clone()), None));
    let mut root: Option<OwnerId> = None;
    let html = s.create_root(Some(render_id.to_string()), |s, owner| {
        root = Some(owner);
        // `claimRenderRoot`: files the root for request-scoped lookups and
        // drops it on dispose; nothing a plan app reads.
        s.on_cleanup(Rc::new(|_| {}));
        let v = code(s)?;
        let escaped = escape(&v);
        resolve_ssr_sync(s, &escaped)
    });
    let result = html.and_then(|html| {
        render.closed.set(true);
        serializer.close(s);
        let scripts = scripts.borrow().clone();
        assemble_document(&html, &scripts)
    });
    if let Some(root) = root {
        let disposed = s.dispose_owner(root, true);
        if result.is_ok() {
            disposed?;
        }
    }
    if let Some(f) = s.failures.first() {
        return throw(f.clone());
    }
    result
}

// Solid: server.ts:5846-5848, 5855-5861 (`generateHydrationScript`, `hydrationBootstrap`
// with no nonce and no ledger)
pub fn generate_hydration_script(event_names: &[&str]) -> String {
    let names = if event_names.is_empty() {
        vec!["click", "input"]
    } else {
        event_names.to_vec()
    };
    format!(
        "<script>window._$HY||(e=>{{let t=e=>e&&e.hasAttribute&&(e.hasAttribute(\"_hk\")?e:t(e.host&&e.host.nodeType?e.host:e.parentNode));[\"{}\"].forEach((o=>document.addEventListener(o,(o=>{{if(!e.events)return;let s=t(o.composedPath&&o.composedPath()[0]||o.target);s&&!e.completed.has(s)&&e.events.push([s,o])}}))))}})(_$HY={{events:[],completed:new WeakSet,r:new Proxy({{}},{{set:(r,k,v)=>(v instanceof Promise&&v.catch(()=>{{}}),r[k]=v,!0)}}),fe(){{}}}});</script><!--xs-->",
        names.join("\",\"")
    )
}

#[cfg(test)]
mod tests {
    use super::escape_str;

    #[test]
    fn content_escaping_is_solids() {
        assert_eq!(escape_str("a"), "a");
        assert_eq!(escape_str("a<b&c>d\"e"), "a&lt;b&amp;c>d\"e");
        assert_eq!(escape_str("&&<<"), "&amp;&amp;&lt;&lt;");
    }
}
