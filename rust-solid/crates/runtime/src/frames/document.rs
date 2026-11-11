//! The t=0 document of a frames app: what Solid's server renders for the
//! canonical split's client module (frontend `plan/split.ts`) under
//! `renderToStream(() => createComponent(App, {}), { plugins:
//! [ServerComponentPlugin] })` with `configureServerFunctionsServer({
//! transformDirectResult: frameTransformDirectResult })`, inside the harness's
//! page (frontend `frames/leg-server.ts`). Ported, each with its `// Solid:`
//! lines:
//!
//! - the in-process call of a server function (`createServerReference`'s
//!   apply, server.ts:1448-1580): the body as an async function, then the
//!   five reactions its promise takes (`reportDirectFailure`,
//!   `provideEventOnce`, `directEnvelopeValue`, `scopeDeferredResult`, the
//!   direct transform), one microtask each;
//! - a server fn body (`let x = await h(…)`… `return e`) as an async function
//!   over the hosts' answers; a server component's body (its question awaited,
//!   its memos as `const`s, the returned component);
//! - `frameTransformDirectResult` (frame-sink.ts:2368-2436): the wrapped
//!   component, its brands, `documentSiteId`, the frame element, `serverOwned`
//!   (`NoHydration`), `armDocumentLiveHoles` (the `sc:live` channel and its
//!   end), the derived context, `serverComponentScope`;
//! - `createDocumentSlotProps` (frame-sink.ts:1561-2039) for scalar slot
//!   arguments: the declared `sc:slot:` record, the fill under `Hydration`
//!   (`sc-<frame>-<occurrence>-` keys), the marker range, the `sc:deps:`
//!   batches;
//! - `dynamicComponent` (solid/src/server/dynamic.ts:48-176): its factory,
//!   value and render memos.
//!
//! Refused (each a diagnostic): a dynamic source that returns a thenable (the
//! split's sources read a memo), structured slot arguments, regions and
//! parked fills (v1: scalar arguments only), a live hole that re-emits.
//! Not ported because nothing in the frames subset reaches it, and its
//! effects are invisible there: the live-hole engine's bindings and sweeps
//! (holes stay settled: every server component's data has landed before it
//! renders, and fills are mint-suppressed), the plain-signal naming of
//! dependency edges (a fill reads only its scalar arguments and its own
//! signals, so every `sc:deps:` batch is `{}`, except `!` for a fill with
//! async holes).
use super::plan::{
    Component, Expr, Plan, PropArg, ServerComponent, ServerFn, ServerStep, SourceKind, View,
};
use super::render::{
    eval, getter, json_to_js, parse_ty, Binding, Env, Inst, Prop, Render, Sites, SlotProxy, Ty,
    Types,
};
use super::server::{FramesServer, Request, Response};
use super::shared::frame_address;
use crate::ssr::js::{
    await_value, promise_reject, promise_resolve, then, with_resolvers, Handler, JsPromise,
    Resolvers,
};
use crate::ssr::signals::{
    action, create_memo, create_optimistic, create_signal, create_store, MemoOptions,
};
use crate::ssr::stream::render_to_stream;
use crate::ssr::value::{call, throw, ErrClass, JsError, JsVal, Res, Thrown};
use crate::ssr::web::{generate_hydration_script, CtxKind, RenderCtx};
use crate::ssr::{LiveChannel, Server};
use serde_json::Value as J;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};

/// `GET /`: the page, as frontend `frames/leg-server.ts` assembles Solid's.
pub fn serve(server: &FramesServer, _req: &Request) -> Result<Response, String> {
    let body = render(server)?;
    let html = format!(
        "<!doctype html><html><head>{}</head><body><div id=\"app\">{body}</div></body></html>",
        generate_hydration_script(&[])
    );
    Ok(Response {
        status: 200,
        headers: vec![("content-type".into(), "text/html; charset=utf-8".into())],
        chunks: vec![html],
    })
}

/// The document's body: the stream's chunks, concatenated.
pub fn render(server: &FramesServer) -> Result<String, String> {
    let mut s = Server::new();
    let doc = Rc::new(Doc {
        plan: server.plan.clone(),
        hosts: server.hosts.clone(),
        components: RefCell::new(HashMap::new()),
        site_counts: RefCell::new(HashMap::new()),
        site_by_owner: RefCell::new(vec![]),
        frames: RefCell::new(vec![]),
        roots: RefCell::new(vec![]),
        calls: server.document_calls.clone(),
    });
    server.document_calls.borrow_mut().clear();
    let d = doc.clone();
    let out = render_to_stream(&mut s, move |s| {
        // `context.edges` (server.ts:2880): the server-component codec is
        // among the render's plugins.
        if let Some(st) = s.ctx.as_ref().and_then(|c| c.stream()) {
            st.edges.set(true);
        }
        d.entry(s)
    })
    .map_err(|e| e.to_string())?;
    // Every host answer is synchronous, so one drain settles the render.
    s.run_until_idle();
    if let Some(f) = s.failures.first() {
        return Err(f.clone());
    }
    if let Some(f) = server.hosts.failure.borrow().clone() {
        return Err(f);
    }
    if !out.borrow().ended {
        return Err("the document render went idle without ending its stream".into());
    }
    if let Some(e) = s.render_errors.first() {
        return Err(format!("the document render reported an error: {e}"));
    }
    let mut body = String::new();
    for e in &out.borrow().events {
        if let crate::ssr::stream::StreamEvent::Chunk(c) = e {
            body.push_str(c);
        }
    }
    Ok(body)
}

/// A server component's answer: its spec and its props (the question's
/// value, the value props' arguments), what the returned component closes
/// over.
struct ScData {
    sc: ServerComponent,
    props: Vec<(String, JsVal)>,
}

struct Doc {
    plan: Rc<Plan>,
    hosts: Rc<super::hosts::Hosts>,
    /// The returned components (by function identity) and what they render.
    components: RefCell<HashMap<usize, Rc<ScData>>>,
    /// `documentSiteId`'s bag (frame-sink.ts:2068-2098): the sites minted per
    /// function id, and per owner.
    site_counts: RefCell<HashMap<String, usize>>,
    site_by_owner: RefCell<Vec<((usize, String), String)>>,
    /// Each server root's dynamic component, by its view's tag.
    frames: RefCell<Vec<(String, JsVal)>>,
    /// The entry's server roots (their calls' arguments, in its scope).
    roots: RefCell<Vec<Root>>,
    /// The client module's server-function calls (not those a server body
    /// makes): `{ id, args }`.
    calls: Rc<RefCell<Vec<J>>>,
}

/// A fulfilled or rejected promise of a host's answer: the host table's
/// `async call()` returns before its caller awaits (frontend
/// `frames/host-table.mjs`).
fn host_promise(s: &mut Server, r: Result<J, String>) -> Res<Rc<JsPromise>> {
    Ok(match r {
        Ok(v) => promise_resolve(s, json_to_js(&v)?),
        Err(e) => promise_reject(s, JsVal::Error(JsError::new(ErrClass::Error, e))),
    })
}

impl Doc {
    // ---- server functions, in process ----

    // Solid: server.ts:1448-1580 (`createServerReference`'s `apply`): the
    // body runs now (an async function: its promise P0), then
    //   P1 = P0.then(undefined, report)              reportDirectFailure (4003-4031)
    //   P2 = P1.then(v => { settle(); return v })    provideEventOnce (868-890)
    //   P3 = P2.then(directEnvelopeValue, rethrow)   (1554-1561)
    //   P4 = P3.then(r => scopeDeferredResult(r))    bindDeferredBody (1141-1149)
    //   P5 = P4.then(v => scopeDeferredResult(transform(v)))   (1570-1575)
    // `transform` is `frameTransformDirectResult`.
    fn direct_call(
        self: &Rc<Self>,
        s: &mut Server,
        id: String,
        args: Vec<JsVal>,
        body: impl FnOnce(&mut Server, Resolvers) -> Res<()>,
    ) -> Res<JsVal> {
        let p0 = with_resolvers();
        body(s, p0.clone())?;
        let identity: Handler = Rc::new(|_, v| Ok(v));
        let rethrow: Handler = Rc::new(|_, e| Err(Thrown(e)));
        let p1 = then(s, &p0.promise, None, Some(rethrow.clone()));
        let p2 = then(s, &p1, Some(identity.clone()), None);
        let p3 = then(s, &p2, Some(identity.clone()), Some(rethrow));
        let p4 = then(s, &p3, Some(identity), None);
        let me = self.clone();
        let args_json: Vec<J> = args
            .iter()
            .map(super::render::js_to_json)
            .collect::<Res<_>>()?;
        let p5 = then(
            s,
            &p4,
            Some(Rc::new(move |s, v| me.transform(s, v, &id, &args_json))),
            None,
        );
        Ok(JsVal::Promise(p5))
    }

    /// A server fn's body as an async function, resolving `p0`.
    fn server_fn_body(
        self: &Rc<Self>,
        s: &mut Server,
        f: &ServerFn,
        args: Vec<JsVal>,
        p0: Resolvers,
    ) -> Res<()> {
        let locals: HashMap<String, JsVal> =
            f.params.iter().map(|p| p.name.clone()).zip(args).collect();
        self.clone()
            .step(s, Rc::new(f.steps.clone()), 0, locals, p0)
    }

    fn step(
        self: Rc<Self>,
        s: &mut Server,
        steps: Rc<Vec<ServerStep>>,
        i: usize,
        mut locals: HashMap<String, JsVal>,
        p0: Resolvers,
    ) -> Res<()> {
        match &steps[i] {
            ServerStep::Return { value } => {
                let v = eval_server(value, &locals)?;
                p0.resolve(s, v);
                Ok(())
            }
            ServerStep::Await {
                server_host,
                server_fn,
                args,
                bind,
            } => {
                let args: Vec<JsVal> = args
                    .iter()
                    .map(|a| eval_server(a, &locals))
                    .collect::<Res<_>>()?;
                let p = match (server_host, server_fn) {
                    (Some(h), _) => {
                        let json: Vec<J> = args
                            .iter()
                            .map(super::render::js_to_json)
                            .collect::<Res<_>>()?;
                        let r = self.hosts.call(h, &json).map_err(Thrown::msg)?;
                        JsVal::Promise(host_promise(s, r)?)
                    }
                    (_, Some(g)) => self.call_server_fn(s, g, args)?,
                    _ => return throw("an await of nothing"),
                };
                let (me, bind, p1, p2) = (self.clone(), bind.clone(), p0.clone(), p0);
                await_value(
                    s,
                    p,
                    move |s, v| {
                        locals.insert(bind, v);
                        if let Err(e) = me.step(s, steps, i + 1, locals, p1.clone()) {
                            p1.reject(s, e.0);
                        }
                    },
                    move |s, e| p2.reject(s, e),
                );
                Ok(())
            }
        }
    }

    /// `f(...args)` on the server, in process.
    fn call_server_fn(self: &Rc<Self>, s: &mut Server, name: &str, args: Vec<JsVal>) -> Res<JsVal> {
        let f = self
            .plan
            .server_fn(name)
            .ok_or_else(|| Thrown::msg(format!("no server fn {name}")))?
            .clone();
        let me = self.clone();
        self.direct_call(s, f.id.clone(), args.clone(), move |s, p0| {
            me.server_fn_body(s, &f, args, p0)
        })
    }

    /// `C$server(...args)` on the server, in process: its question awaited,
    /// then the returned component (closing over the props it renders).
    fn call_server_component(
        self: &Rc<Self>,
        s: &mut Server,
        sc: &ServerComponent,
        args: Vec<JsVal>,
    ) -> Res<JsVal> {
        let me = self.clone();
        let sc2 = sc.clone();
        let a2 = args.clone();
        self.direct_call(s, sc.id.clone(), args, move |s, p0| {
            me.server_component_body(s, &sc2, a2, p0)
        })
    }

    fn server_component_body(
        self: &Rc<Self>,
        s: &mut Server,
        sc: &ServerComponent,
        args: Vec<JsVal>,
        p0: Resolvers,
    ) -> Res<()> {
        // plan/split.ts's parameters: the sunk question's arguments, then the
        // other value props in site order (owned: every value prop).
        let site = site_props(&self.plan, sc).ok_or_else(|| Thrown::msg("no site"))?;
        let comp = self
            .plan
            .component(&sc.component)
            .ok_or_else(|| Thrown::msg("no component"))?
            .clone();
        let mut props: Vec<(String, JsVal)> = vec![];
        let mut k = 0;
        let (call, prop_name) = if sc.question.kind == "sunk" {
            let q = self
                .plan
                .memos
                .iter()
                .find(|m| m.name == sc.question.memo)
                .and_then(|m| m.call.clone())
                .ok_or_else(|| Thrown::msg("no sunk question"))?;
            let sunk = site.iter().find(|a| matches!(&a.value, Some(Expr::Read { source }) if *source == sc.question.memo)).ok_or_else(|| Thrown::msg("no sunk prop"))?.name.clone();
            let qargs = args[..q.args.len()].to_vec();
            k = q.args.len();
            for a in &site {
                if a.value.is_some() && a.name != sunk {
                    props.push((a.name.clone(), args[k].clone()));
                    k += 1;
                }
            }
            ((q.server_fn, qargs), sunk)
        } else {
            for a in &site {
                if a.value.is_some() {
                    props.push((a.name.clone(), args[k].clone()));
                    k += 1;
                }
            }
            let q = comp
                .memos
                .iter()
                .find(|m| m.name == sc.question.memo)
                .and_then(|m| m.call.clone())
                .ok_or_else(|| Thrown::msg("no owned question"))?;
            let env: HashMap<String, JsVal> = props
                .iter()
                .map(|(n, v)| (format!("props.{n}"), v.clone()))
                .collect();
            let qargs = q
                .args
                .iter()
                .map(|a| eval_server(a, &env))
                .collect::<Res<_>>()?;
            ((q.server_fn, qargs), format!("${}", sc.question.memo))
        };
        let p = self.call_server_fn(s, &call.0, call.1)?;
        let (me, sc2) = (self.clone(), sc.clone());
        let (p1, p2) = (p0.clone(), p0);
        await_value(
            s,
            p,
            move |s, v| {
                props.push((prop_name, v));
                // The returned component: a function the transform wraps.
                let component = JsVal::func(1, |_, _| {
                    throw("a server component renders through its frame")
                });
                let key = component.identity().expect("a function");
                me.components
                    .borrow_mut()
                    .insert(key, Rc::new(ScData { sc: sc2, props }));
                p1.resolve(s, component);
            },
            move |s, e| p2.reject(s, e),
        );
        Ok(())
    }

    // Solid: frame-sink.ts:2368-2436 (`frameTransformDirectResult`): a
    // function result becomes the wrapped component, branded with its id and
    // the call's address; data passes through.
    fn transform(
        self: &Rc<Self>,
        s: &mut Server,
        value: JsVal,
        id: &str,
        args: &[J],
    ) -> Res<JsVal> {
        let Some(data) = value
            .identity()
            .and_then(|k| self.components.borrow().get(&k).cloned())
        else {
            if matches!(value, JsVal::Fn(_)) {
                return throw("a function result that is not a server component");
            }
            return Ok(value);
        };
        let address = frame_address(id, args).map_err(Thrown::msg)?;
        let me = self.clone();
        let (id2, address2) = (id.to_string(), address.clone());
        let wrapped = JsVal::func(1, move |s, a| {
            me.frame(
                s,
                &data,
                &id2,
                &address2,
                a.first().cloned().unwrap_or(JsVal::Undefined),
            )
        });
        s.brands.components.insert(
            wrapped.identity().expect("a function"),
            (id.to_string(), address, wrapped.clone()),
        );
        Ok(wrapped)
    }

    // Solid: frame-sink.ts:2083-2098 (`documentSiteId`): per document, the
    // first site of a function keeps its id, later ones `id~n`; keyed by the
    // owner of the call, so a re-render of one mount reuses its scope.
    fn site_id(&self, s: &Server, fn_id: &str) -> String {
        let owner = s.get_owner();
        let mint = || {
            let mut counts = self.site_counts.borrow_mut();
            let n = counts.entry(fn_id.to_string()).or_insert(0);
            let id = if *n == 0 {
                fn_id.to_string()
            } else {
                format!("{fn_id}~{}", *n + 1)
            };
            *n += 1;
            id
        };
        let Some(o) = owner else { return mint() };
        let key = (o, fn_id.to_string());
        if let Some((_, id)) = self.site_by_owner.borrow().iter().find(|(k, _)| *k == key) {
            return id.clone();
        }
        let id = mint();
        self.site_by_owner.borrow_mut().push((key, id.clone()));
        id
    }

    /// The wrapped component's render: `[{ t: <solid-frame …> },
    /// serverOwned(…), { t: </solid-frame> }]`.
    fn frame(
        self: &Rc<Self>,
        s: &mut Server,
        data: &Rc<ScData>,
        fn_id: &str,
        address: &str,
        client_props: JsVal,
    ) -> Res<JsVal> {
        let site = self.site_id(s, fn_id);
        // Solid: frame-sink.ts:2053-2058 (`frameElementOpen`)
        let args = &address[fn_id.len()..];
        let args = args.strip_prefix(':').unwrap_or(args);
        let open = format!(
            "<solid-frame data-fid=\"{}\"{} style=\"display:contents\">",
            escape_attr(&site),
            if args.is_empty() {
                String::new()
            } else {
                format!(" data-fa=\"{args}\"")
            }
        );
        // serverOwned (frame-sink.ts:175-184): NoHydration (solid
        // hydration.ts:886-892): an owner, `NoHydrateContext: true`, the
        // children getter read under it.
        let o = s.create_owner(None, false)?;
        let inner = s.run_with_owner(Some(o), |s| {
            s.set_no_hydrate(o, true);
            let page = s
                .ctx
                .clone()
                .ok_or_else(|| Thrown::msg("a frame outside a render"))?;
            arm_document_live_holes(s, &page)?;
            // `Object.create(page)` with the frame's site id.
            let ctx = RenderCtx::new(CtxKind::Derived(site.clone()), Some(page.clone()));
            s.ctx = Some(ctx.clone());
            let r = (|| {
                let slots: Rc<dyn SlotProxy> = Rc::new(DocSlots::new(
                    s,
                    self.clone(),
                    client_props.clone(),
                    site.clone(),
                    ctx.clone(),
                    data.sc.clone(),
                ));
                // serverComponentScope (runInServerComponentScope,
                // signals.ts:4635-4655): a transparent owner.
                let t = s.create_owner(None, true)?;
                s.set_server_component(t);
                s.run_with_owner(Some(t), |s| {
                    let inst = self.server_instance(s, &data.sc, &data.props, slots)?;
                    let r = Render { sites: None };
                    r.fragment(
                        s,
                        &inst,
                        &inst.comp.markup.clone(),
                        &Env::new(),
                        &Types::new(),
                    )
                })
            })();
            s.ctx = Some(page);
            r
        })?;
        Ok(JsVal::array(vec![
            tmpl(&open),
            inner,
            tmpl("</solid-frame>"),
        ]))
    }

    /// The server component's own instance (server face): the question's
    /// value and the value props as identifiers, the body's memos as
    /// `const`s.
    fn server_instance(
        self: &Rc<Self>,
        s: &mut Server,
        sc: &ServerComponent,
        props: &[(String, JsVal)],
        slots: Rc<dyn SlotProxy>,
    ) -> Res<Rc<Inst>> {
        let comp = self
            .plan
            .component(&sc.component)
            .ok_or_else(|| Thrown::msg("no component"))?
            .clone();
        let mut ps = HashMap::new();
        let mut tys = Types::new();
        let mut names = HashMap::new();
        for p in &comp.props {
            tys.insert(format!("props.{}", p.name), parse_ty(&p.ty));
        }
        for (n, v) in props {
            if let Some(memo) = n.strip_prefix('$') {
                names.insert(memo.to_string(), Binding::Value(v.clone()));
                let f = comp
                    .memos
                    .iter()
                    .find(|m| m.name == memo)
                    .and_then(|m| m.call.as_ref())
                    .and_then(|c| self.plan.server_fn(&c.server_fn));
                tys.insert(
                    memo.to_string(),
                    f.map_or(Ty::Unknown, |f| parse_ty(&f.returns)),
                );
            } else {
                ps.insert(n.clone(), Prop::Value(v.clone()));
            }
        }
        let inst = Rc::new(Inst {
            plan: self.plan.clone(),
            comp: Rc::new(comp.clone()),
            names: RefCell::new(names),
            calls: HashMap::new(),
            props: RefCell::new(ps),
            prop_member: false,
            tys: RefCell::new(tys),
            slots: Some(slots),
            slot_names: sc.slots.iter().map(|x| x.name.clone()).collect(),
        });
        for m in &comp.memos {
            if m.call.is_some() {
                continue;
            }
            let value = m.value.as_ref().expect("validated");
            let t = inst.ty(value, &Types::new());
            let v = eval(s, &inst, value, &Env::new())?;
            inst.tys.borrow_mut().insert(m.name.clone(), t);
            inst.names
                .borrow_mut()
                .insert(m.name.clone(), Binding::Value(v));
        }
        Ok(inst)
    }

    fn note_call(&self, id: &str, args: &[JsVal]) -> Res<()> {
        let args: Vec<J> = args
            .iter()
            .map(super::render::js_to_json)
            .collect::<Res<_>>()?;
        self.calls
            .borrow_mut()
            .push(serde_json::json!({ "id": id, "args": args }));
        Ok(())
    }

    // ---- the client module ----

    /// `App()`: the entry's body and markup.
    fn entry(self: &Rc<Self>, s: &mut Server) -> Res<JsVal> {
        let mut comp = self.plan.entry();
        // Each server root's view carries its index (`server` is
        // `<name>\u{0}<k>`): views are cloned into the render's closures, so a
        // root is known by its tag, not its address.
        let mut k = 0;
        tag_roots(&mut comp.markup, &mut k);
        self.client_component(s, &comp, HashMap::new(), true)
    }

    /// A client component's body, in the canonical split's order (sources,
    /// memos, [the entry's owned-question call memos and its frames], actions),
    /// then its markup.
    fn client_component(
        self: &Rc<Self>,
        s: &mut Server,
        comp: &Component,
        props: HashMap<String, Prop>,
        is_entry: bool,
    ) -> Res<JsVal> {
        let mut calls = HashMap::new();
        let mut tys = Types::new();
        for p in &comp.props {
            tys.insert(format!("props.{}", p.name), parse_ty(&p.ty));
        }
        for src in &comp.sources {
            calls.insert(src.name.clone(), src.kind != SourceKind::Store);
        }
        for m in &comp.memos {
            calls.insert(m.name.clone(), true);
        }
        let inst = Rc::new(Inst {
            plan: self.plan.clone(),
            comp: Rc::new(comp.clone()),
            names: RefCell::new(HashMap::new()),
            calls,
            props: RefCell::new(props),
            prop_member: true,
            tys: RefCell::new(tys),
            slots: None,
            slot_names: vec![],
        });
        let empty = Env::new();
        for src in &comp.sources {
            let t = inst.ty(&src.seed, &Types::new());
            inst.tys.borrow_mut().insert(src.name.clone(), t);
            let b = match src.kind {
                SourceKind::Signal => {
                    Binding::Read(create_signal(eval(s, &inst, &src.seed, &empty)?).0)
                }
                SourceKind::Store => {
                    Binding::Value(create_store(eval(s, &inst, &src.seed, &empty)?).0)
                }
                SourceKind::Optimistic => {
                    let (seed, i2) = (src.seed.clone(), inst.clone());
                    Binding::Read(
                        create_optimistic(
                            s,
                            Rc::new(move |s, _| eval(s, &i2, &seed, &Env::new())),
                        )?
                        .0,
                    )
                }
            };
            inst.names.borrow_mut().insert(src.name.clone(), b);
        }
        let roots = if is_entry {
            roots(&self.plan, &comp.markup)
        } else {
            vec![]
        };
        for m in &comp.memos {
            let t = match (&m.value, &m.call) {
                (Some(v), _) => inst.ty(v, &Types::new()),
                (_, Some(c)) => self
                    .plan
                    .server_fn(&c.server_fn)
                    .map_or(Ty::Unknown, |f| parse_ty(&f.returns)),
                _ => Ty::Unknown,
            };
            inst.tys.borrow_mut().insert(m.name.clone(), t);
            let (me, i2) = (self.clone(), inst.clone());
            let compute: crate::ssr::signals::Compute = match (&m.value, &m.call, &m.sunk) {
                (Some(v), _, _) => {
                    let v = v.clone();
                    Rc::new(move |s, _| eval(s, &i2, &v, &Env::new()))
                }
                (_, Some(c), Some(sunk)) => {
                    // A sunk question: the server component's call
                    // (`createMemo(() => C$server(…))`).
                    let root = roots
                        .iter()
                        .find(|r| r.sc.name == *sunk && r.memo == m.name)
                        .cloned()
                        .ok_or_else(|| Thrown::msg("no root for a sunk memo"))?;
                    let _ = c;
                    Rc::new(move |s, _| {
                        let args = root
                            .args
                            .iter()
                            .map(|a| eval(s, &i2, a, &Env::new()))
                            .collect::<Res<Vec<_>>>()?;
                        me.note_call(&root.sc.id, &args)?;
                        me.call_server_component(s, &root.sc, args)
                    })
                }
                (_, Some(c), None) => {
                    let c = c.clone();
                    Rc::new(move |s, _| {
                        let args = c
                            .args
                            .iter()
                            .map(|a| eval(s, &i2, a, &Env::new()))
                            .collect::<Res<Vec<_>>>()?;
                        me.note_call(
                            &me.plan
                                .server_fn(&c.server_fn)
                                .map(|f| f.id.clone())
                                .unwrap_or_default(),
                            &args,
                        )?;
                        me.call_server_fn(s, &c.server_fn, args)
                    })
                }
                _ => return throw(format!("memo {} has neither value nor await", m.name)),
            };
            let read = create_memo(s, compute, MemoOptions::default())?;
            inst.names
                .borrow_mut()
                .insert(m.name.clone(), Binding::Read(read));
        }
        if is_entry {
            // One dynamicComponent per sunk-question root in site order (an
            // owned-question root is its client stub's, at its site).
            for r in roots.iter().filter(|r| r.sc.question.kind == "sunk") {
                let memo = r.memo.clone();
                let i2 = inst.clone();
                let source = JsVal::func(0, move |s, _| {
                    let b = i2.names.borrow().get(&memo).cloned();
                    match b {
                        Some(Binding::Read(f)) => call(s, &f, &[]),
                        _ => throw("a frame's memo is missing"),
                    }
                });
                let component = dynamic_core(s, source)?;
                self.frames.borrow_mut().push((r.view.clone(), component));
            }
            *self.roots.borrow_mut() = roots;
        }
        for a in &comp.actions {
            let name = a.name.clone();
            let f = action(JsVal::func(a.params.len(), move |_, _| {
                throw(format!("action {name} called during a server render"))
            }));
            inst.names
                .borrow_mut()
                .insert(a.name.clone(), Binding::Value(f));
        }
        let r = Render {
            sites: Some(Rc::new(DocSites { doc: self.clone() })),
        };
        r.fragment(s, &inst, &comp.markup, &empty, &Types::new())
    }
}

fn tag_roots(vs: &mut [View], k: &mut usize) {
    for v in vs {
        match v {
            View::Component {
                place: Some(_),
                server: Some(name),
                ..
            } => {
                *name = format!("{name}\u{0}{k}");
                *k += 1;
            }
            View::Element { children, .. } | View::For { children, .. } => tag_roots(children, k),
            View::Show {
                children, fallback, ..
            }
            | View::Loading { children, fallback }
            | View::Errored { children, fallback } => {
                tag_roots(children, k);
                tag_roots(fallback, k);
            }
            _ => {}
        }
    }
}

/// A root's tag (its index) and its server component's name.
fn untag(server: &str) -> (&str, &str) {
    server.split_once('\u{0}').unwrap_or((server, ""))
}

/// A server root of the entry: its view, server component, the memo the
/// frame reads, and its call's arguments (in the entry's scope).
#[derive(Clone)]
struct Root {
    view: String,
    sc: ServerComponent,
    memo: String,
    args: Vec<Expr>,
}

fn roots(plan: &Plan, markup: &[View]) -> Vec<Root> {
    let mut out = vec![];
    fn walk(plan: &Plan, vs: &[View], out: &mut Vec<Root>) {
        for v in vs {
            match v {
                View::Component {
                    props,
                    place: Some(_),
                    server: Some(tagged),
                    ..
                } => {
                    let sc = plan
                        .server_component(untag(tagged).0)
                        .expect("validated")
                        .clone();
                    let mut args = vec![];
                    let mut sunk_prop = None;
                    if sc.question.kind == "sunk" {
                        if let Some(c) = plan
                            .memos
                            .iter()
                            .find(|m| m.name == sc.question.memo)
                            .and_then(|m| m.call.as_ref())
                        {
                            args.extend(c.args.iter().cloned());
                        }
                        sunk_prop = props.iter().find(|a| matches!(&a.value, Some(Expr::Read { source }) if *source == sc.question.memo)).map(|a| a.name.clone());
                    }
                    for a in props {
                        if let Some(v) = &a.value {
                            if Some(&a.name) != sunk_prop.as_ref() {
                                args.push(v.clone());
                            }
                        }
                    }
                    out.push(Root {
                        view: tagged.clone(),
                        memo: sc.question.memo.clone(),
                        sc,
                        args,
                    });
                }
                View::Element { children, .. } | View::For { children, .. } => {
                    walk(plan, children, out)
                }
                View::Show {
                    children, fallback, ..
                }
                | View::Loading { children, fallback }
                | View::Errored { children, fallback } => {
                    walk(plan, children, out);
                    walk(plan, fallback, out);
                }
                _ => {}
            }
        }
    }
    walk(plan, markup, &mut out);
    out
}

fn site_props(plan: &Plan, sc: &ServerComponent) -> Option<Vec<PropArg>> {
    fn find(vs: &[View], name: &str) -> Option<Vec<PropArg>> {
        for v in vs {
            match v {
                View::Component {
                    props,
                    server: Some(s),
                    ..
                } if s == name => return Some(props.clone()),
                View::Element { children, .. } | View::For { children, .. } => {
                    if let Some(p) = find(children, name) {
                        return Some(p);
                    }
                }
                View::Show {
                    children, fallback, ..
                }
                | View::Loading { children, fallback }
                | View::Errored { children, fallback } => {
                    if let Some(p) = find(children, name).or_else(|| find(fallback, name)) {
                        return Some(p);
                    }
                }
                _ => {}
            }
        }
        None
    }
    find(&plan.markup, &sc.name)
}

/// A server fn body's expression over the server's plain values (its
/// parameters and await bindings; an owned question's arguments read
/// `props.<name>`). Objects keep their identity, as JS's do.
fn eval_server(e: &Expr, locals: &HashMap<String, JsVal>) -> Res<JsVal> {
    use crate::ssr::plan::{add, array_items, integer, literal, truthy};
    let with = |name: &str, v: JsVal| {
        let mut l = locals.clone();
        l.insert(name.to_string(), v);
        l
    };
    Ok(match e {
        Expr::Literal { value } => literal(value)?,
        Expr::Local { name } => locals
            .get(name)
            .cloned()
            .ok_or_else(|| Thrown::msg(format!("unbound local {name}")))?,
        Expr::Prop { name } => locals
            .get(&format!("props.{name}"))
            .cloned()
            .ok_or_else(|| Thrown::msg(format!("unbound prop {name}")))?,
        Expr::Array { items } => JsVal::array(
            items
                .iter()
                .map(|x| eval_server(x, locals))
                .collect::<Res<_>>()?,
        ),
        Expr::Object { fields } => JsVal::Rec(Rc::new(RefCell::new(
            fields
                .iter()
                .map(|f| Ok((f.key.clone(), eval_server(&f.value, locals)?)))
                .collect::<Res<_>>()?,
        ))),
        Expr::Get { object, key } => match eval_server(object, locals)? {
            JsVal::Rec(r) => {
                let v = r
                    .borrow()
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, v)| v.clone());
                v.ok_or_else(|| Thrown::msg(format!("missing field {key}")))?
            }
            other => return throw(format!("get {key} of {other:?}")),
        },
        Expr::Length { array } => {
            JsVal::Num(array_items(&eval_server(array, locals)?, "length")?.len() as i64)
        }
        Expr::Filter { array, param, body } => {
            let mut out = vec![];
            for x in array_items(&eval_server(array, locals)?, "filter")? {
                if truthy(&eval_server(body, &with(param, x.clone()))?)? {
                    out.push(x);
                }
            }
            JsVal::array(out)
        }
        Expr::Map { array, param, body } => {
            let mut out = vec![];
            for x in array_items(&eval_server(array, locals)?, "map")? {
                out.push(eval_server(body, &with(param, x))?);
            }
            JsVal::array(out)
        }
        Expr::FindIndex { array, param, body } => {
            for (k, x) in array_items(&eval_server(array, locals)?, "findIndex")?
                .into_iter()
                .enumerate()
            {
                if truthy(&eval_server(body, &with(param, x))?)? {
                    return Ok(JsVal::Num(k as i64));
                }
            }
            JsVal::Num(-1)
        }
        Expr::Add { left, right } => {
            add(&eval_server(left, locals)?, &eval_server(right, locals)?)?
        }
        Expr::Eq { left, right } => {
            JsVal::Bool(eval_server(left, locals)?.strict_eq(&eval_server(right, locals)?))
        }
        Expr::Ne { left, right } => {
            JsVal::Bool(!eval_server(left, locals)?.strict_eq(&eval_server(right, locals)?))
        }
        Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let (a, b) = (
                integer(&eval_server(left, locals)?)?,
                integer(&eval_server(right, locals)?)?,
            );
            JsVal::Bool(match e {
                Expr::Lt { .. } => a < b,
                Expr::Le { .. } => a <= b,
                Expr::Gt { .. } => a > b,
                _ => a >= b,
            })
        }
        Expr::And { left, right } => {
            let l = eval_server(left, locals)?;
            if truthy(&l)? {
                eval_server(right, locals)?
            } else {
                l
            }
        }
        Expr::Or { left, right } => {
            let l = eval_server(left, locals)?;
            if truthy(&l)? {
                l
            } else {
                eval_server(right, locals)?
            }
        }
        Expr::Not { value } => JsVal::Bool(!truthy(&eval_server(value, locals)?)?),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval_server(test, locals)?)? {
                eval_server(then, locals)?
            } else {
                eval_server(otherwise, locals)?
            }
        }
        Expr::Read { .. } | Expr::Pending { .. } | Expr::Latest { .. } => {
            return throw("a server fn reads no reactive state")
        }
    })
}

/// `{ t: text }`: a pre-rendered SSR value.
fn tmpl(text: &str) -> JsVal {
    JsVal::Tmpl(Rc::from(text))
}

/// The escape of an attribute value (`escape(id, true)`): `&` and `"`.
fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;")
}

// ---- dynamicComponent (solid/src/server/dynamic.ts:48-176) ----

// Solid: dynamic.ts:116-121 (the factory memo), 124-171 (the per-instance
// value and render memos). The split's sources read a memo, so the factory
// never boxes a thenable; a thenable source is refused.
fn dynamic_core(s: &mut Server, source: JsVal) -> Res<JsVal> {
    let cached = create_memo(
        s,
        Rc::new(move |s, _| {
            let next = call(s, &source, &[])?;
            if matches!(next, JsVal::Promise(_)) || crate::ssr::js::thenable_then(&next).is_some() {
                return throw(
                    "a dynamic() source that returns a thenable is outside the frames subset",
                );
            }
            Ok(next)
        }),
        MemoOptions::default(),
    )?;
    Ok(JsVal::func(1, move |s, args| {
        let props = args.first().cloned().unwrap_or(JsVal::Undefined);
        let c2 = cached.clone();
        // `gated = !deferStream || !ctx?.async`: true, no shell block.
        let value = create_memo(
            s,
            Rc::new(move |s, _| call(s, &c2, &[])),
            MemoOptions::default(),
        )?;
        create_memo(
            s,
            Rc::new(move |s, _| {
                let c = call(s, &value, &[])?;
                Ok(match c {
                    JsVal::Fn(_) => call(s, &c, std::slice::from_ref(&props))?,
                    _ => JsVal::Undefined,
                })
            }),
            MemoOptions {
                sync: true,
                ..Default::default()
            },
        )
    }))
}

// ---- the document's client sites ----

struct DocSites {
    doc: Rc<Doc>,
}

impl Sites for DocSites {
    fn site(&self, s: &mut Server, i: &Rc<Inst>, v: &View, env: &Env, _tys: &Types) -> Res<JsVal> {
        let View::Component {
            name, props, place, ..
        } = v
        else {
            return throw("a site that is not a component");
        };
        if place.is_some() {
            // A server root: `<FrameK K={(p) => <K …/>} …/>`.
            let tagged = match v {
                View::Component {
                    server: Some(s), ..
                } => s.clone(),
                _ => unreachable!(),
            };
            let sc = self
                .doc
                .plan
                .server_component(untag(&tagged).0)
                .expect("validated")
                .clone();
            let mut fills = vec![];
            for slot in &sc.slots {
                fills.push((slot.name.clone(), self.fill(s, i, &sc, slot, props, env)?));
            }
            let p = JsVal::Rec(Rc::new(RefCell::new(fills)));
            if sc.question.kind == "owned" {
                // The owned root's client stub, `C$frame(props)` (frontend
                // plan/split.ts): `frame = createMemo(() => C$server(props.…))`,
                // `Frame = dynamicComponent(() => frame())`, `<Frame …fills/>`,
                // all under the site's owner (a server `createComponent` is a
                // plain call). The wire props are getters over the site's
                // arguments, read in the memo.
                let root = self
                    .doc
                    .roots
                    .borrow()
                    .iter()
                    .find(|r| r.view == tagged)
                    .cloned()
                    .ok_or_else(|| Thrown::msg("a root without its call"))?;
                let (doc, i2, env2) = (self.doc.clone(), i.clone(), env.clone());
                let read = create_memo(
                    s,
                    Rc::new(move |s, _| {
                        let args = root
                            .args
                            .iter()
                            .map(|a| eval(s, &i2, a, &env2))
                            .collect::<Res<Vec<_>>>()?;
                        doc.note_call(&root.sc.id, &args)?;
                        doc.call_server_component(s, &root.sc, args)
                    }),
                    MemoOptions::default(),
                )?;
                let frame = dynamic_core(s, JsVal::func(0, move |s, _| call(s, &read, &[])))?;
                return call(s, &frame, &[p]);
            }
            let frame = self
                .doc
                .frames
                .borrow()
                .iter()
                .find(|(k, _)| *k == tagged)
                .map(|(_, f)| f.clone())
                .ok_or_else(|| Thrown::msg("a root without its frame"))?;
            return call(s, &frame, &[p]);
        }
        // A client component: `C(new _P$(…))`.
        let comp = self
            .doc
            .plan
            .component(name)
            .ok_or_else(|| Thrown::msg(format!("no component {name}")))?
            .clone();
        let ps = client_props(s, i, props, env)?;
        self.doc.client_component(s, &comp, ps, false)
    }
}

/// The compiled props object of a client site: a getter for each dynamic
/// value argument, a plain field for a static one, the action or the
/// forwarded prop (`props.t`, a member: a getter).
fn client_props(
    s: &mut Server,
    i: &Rc<Inst>,
    props: &[PropArg],
    env: &Env,
) -> Res<HashMap<String, Prop>> {
    let mut ps = HashMap::new();
    for a in props {
        let p = if let Some(value) = &a.value {
            if i.dynamic(value) {
                let (value, i2, env2) = (value.clone(), i.clone(), env.clone());
                Prop::Getter(getter(move |s| eval(s, &i2, &value, &env2)))
            } else {
                Prop::Value(eval(s, i, value, env)?)
            }
        } else if let Some(act) = &a.action {
            let b = i.names.borrow().get(act).cloned();
            match b {
                Some(Binding::Value(f)) => Prop::Value(f),
                _ => return throw(format!("no action {act}")),
            }
        } else if let Some(fw) = &a.forward {
            let (fw, i2) = (fw.clone(), i.clone());
            Prop::Getter(getter(move |s| {
                let p = i2.props.borrow().get(&fw).cloned();
                match p {
                    Some(Prop::Value(v)) => Ok(v),
                    Some(Prop::Getter(g)) => call(s, &g, &[]),
                    None => throw(format!("no prop {fw}")),
                }
            }))
        } else {
            return throw("a prop with no argument");
        };
        ps.insert(a.name.clone(), p);
    }
    Ok(ps)
}

impl DocSites {
    /// A slot fill, `(p) => <K a={p.a} t={take} />`: the island's arguments
    /// from the record (`p.a`, getters), its through props from the root's
    /// site arguments.
    fn fill(
        &self,
        _s: &mut Server,
        i: &Rc<Inst>,
        sc: &ServerComponent,
        slot: &super::plan::Slot,
        root_props: &[PropArg],
        env: &Env,
    ) -> Res<JsVal> {
        let at = island_site(&self.doc.plan, sc, &slot.component)
            .ok_or_else(|| Thrown::msg("no island site"))?;
        let comp = self
            .doc
            .plan
            .component(&slot.component)
            .ok_or_else(|| Thrown::msg("no island component"))?
            .clone();
        let (doc, i2, env2) = (self.doc.clone(), i.clone(), env.clone());
        let from = slot.from.clone();
        let root_props = root_props.to_vec();
        Ok(JsVal::func(1, move |s, args| {
            let p = args.first().cloned().unwrap_or(JsVal::Undefined);
            let mut ps = HashMap::new();
            for a in &at {
                if a.value.is_some() {
                    let (p2, key) = (p.clone(), a.name.clone());
                    ps.insert(
                        a.name.clone(),
                        Prop::Getter(getter(move |_| match &p2 {
                            JsVal::Rec(r) => Ok(r
                                .borrow()
                                .iter()
                                .find(|(k, _)| *k == key)
                                .map(|(_, v)| v.clone())
                                .unwrap_or(JsVal::Undefined)),
                            _ => Ok(JsVal::Undefined),
                        })),
                    );
                } else {
                    let root = from
                        .get(&a.name)
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| Thrown::msg("an unresolved through prop"))?
                        .to_string();
                    let arg = root_props
                        .iter()
                        .find(|x| x.name == root)
                        .cloned()
                        .ok_or_else(|| Thrown::msg("a through prop the root does not pass"))?;
                    let resolved = client_props(s, &i2, std::slice::from_ref(&arg), &env2)?;
                    ps.insert(a.name.clone(), resolved.into_values().next().expect("one"));
                }
            }
            doc.client_component(s, &comp, ps, false)
        }))
    }
}

/// The island's site (its first occurrence) in the server subtree: its
/// arguments, in attribute order.
fn island_site(plan: &Plan, sc: &ServerComponent, k: &str) -> Option<Vec<PropArg>> {
    fn find(vs: &[View], k: &str) -> Option<Vec<PropArg>> {
        for v in vs {
            match v {
                View::Component { name, props, .. } if name == k => return Some(props.clone()),
                View::Element { children, .. } | View::For { children, .. } => {
                    if let Some(p) = find(children, k) {
                        return Some(p);
                    }
                }
                View::Show {
                    children, fallback, ..
                }
                | View::Loading { children, fallback }
                | View::Errored { children, fallback } => {
                    if let Some(p) = find(children, k).or_else(|| find(fallback, k)) {
                        return Some(p);
                    }
                }
                _ => {}
            }
        }
        None
    }
    std::iter::once(&sc.component)
        .chain(sc.inline.iter())
        .find_map(|c| plan.component(c).and_then(|c| find(&c.markup, k)))
}

// ---- createDocumentSlotProps (frame-sink.ts:1561-2039), scalar arguments ----

struct DocSlots {
    doc: Rc<Doc>,
    client_props: JsVal,
    frame_id: String,
    counts: RefCell<HashMap<String, usize>>,
    /// The zone owner, captured at the proxy's creation (inside serverOwned).
    zone: Option<usize>,
    /// `depsContext`: the context at creation; the deps batch and its count.
    deps_ctx: Rc<RenderCtx>,
    deps: Rc<RefCell<Option<DepsBatch>>>,
    deps_n: Rc<Cell<usize>>,
}

/// A `sc:deps:` batch: each fill's id and the ids it depends on.
type DepsBatch = Vec<(String, Vec<String>)>;

impl DocSlots {
    fn new(
        s: &Server,
        doc: Rc<Doc>,
        client_props: JsVal,
        frame_id: String,
        ctx: Rc<RenderCtx>,
        _sc: ServerComponent,
    ) -> DocSlots {
        DocSlots {
            doc,
            client_props,
            frame_id,
            counts: RefCell::new(HashMap::new()),
            zone: s.get_owner(),
            deps_ctx: ctx,
            deps: Rc::new(RefCell::new(None)),
            deps_n: Rc::new(Cell::new(0)),
        }
    }

    // Solid: frame-sink.ts:1576-1602 (`noteDeps`): a batch per synchronous
    // span of fills, serialized in the microtask after it; the first always.
    // The fills of the frames subset read no plain signal they did not
    // create, so a batch names only `!` (a fill left async holes).
    fn note_deps(&self, s: &mut Server, occurrence: &str, untracked: bool) {
        let edges = self.deps_ctx.stream().is_some_and(|st| st.edges.get());
        if !edges {
            return;
        }
        if self.deps.borrow().is_none() {
            *self.deps.borrow_mut() = Some(vec![]);
            let (deps, n, ctx, frame) = (
                self.deps.clone(),
                self.deps_n.clone(),
                self.deps_ctx.clone(),
                self.frame_id.clone(),
            );
            s.queue_microtask(Box::new(move |s| {
                let batch = deps.borrow_mut().take().unwrap_or_default();
                let mut b = vec![];
                for (sid, occs) in batch {
                    b.push((sid, JsVal::str(&pack_occurrences(&occs))));
                }
                if n.get() == 0 || !b.is_empty() {
                    let key = format!("sc:deps:{frame}:{}", n.get());
                    n.set(n.get() + 1);
                    if let Err(e) =
                        ctx.serialize(s, key, JsVal::Rec(Rc::new(RefCell::new(b))), false)
                    {
                        s.failures.push(format!("sc:deps: {e}"));
                    }
                }
            }));
        }
        if untracked {
            let mut d = self.deps.borrow_mut();
            let batch = d.as_mut().expect("open");
            match batch.iter_mut().find(|(k, _)| k == "!") {
                Some((_, v)) => v.push(occurrence.to_string()),
                None => batch.push(("!".into(), vec![occurrence.to_string()])),
            }
        }
    }
}

// Solid: frame-sink.ts:1455-1476 (`packOccurrences`)
fn pack_occurrences(occs: &[String]) -> String {
    let mut out: Vec<String> = vec![];
    let (mut prop, mut a, mut b) = (String::new(), -1i64, -1i64);
    let flush = |out: &mut Vec<String>, prop: &str, a: i64, b: i64| {
        if a >= 0 {
            out.push(format!(
                "{prop}#{}",
                if a == b {
                    a.to_string()
                } else {
                    format!("{a}-{b}")
                }
            ));
        }
    };
    for o in occs {
        let m = o.rsplit_once('#').and_then(|(p, n)| {
            n.parse::<i64>()
                .ok()
                .filter(|_| n.chars().all(|c| c.is_ascii_digit()))
                .map(|n| (p.to_string(), n))
        });
        if let Some((p, n)) = &m {
            if *p == prop && *n == b + 1 && a >= 0 {
                b += 1;
                continue;
            }
        }
        flush(&mut out, &prop, a, b);
        a = -1;
        b = -1;
        match m {
            Some((p, n)) => {
                prop = p;
                a = n;
                b = n;
            }
            None => out.push(o.clone()),
        }
    }
    flush(&mut out, &prop, a, b);
    out.join(" ")
}

/// `hasAsyncHoles` (frame-sink.ts:1479-1487).
fn has_async_holes(node: &JsVal, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    match node {
        JsVal::Arr(a) => a.borrow().iter().any(|n| has_async_holes(n, depth + 1)),
        JsVal::Res(r) => !r.h.borrow().is_empty(),
        _ => false,
    }
}

impl SlotProxy for DocSlots {
    fn call(
        &self,
        s: &mut Server,
        k: &str,
        args: Vec<(String, JsVal)>,
        _inst: &Rc<Inst>,
    ) -> Res<JsVal> {
        // `occurrenceId`: positional per prop.
        let n = {
            let mut c = self.counts.borrow_mut();
            let n = c.entry(k.to_string()).or_insert(0);
            let v = *n;
            *n += 1;
            v
        };
        let occurrence = format!("{k}#{n}");
        let slot = match &self.client_props {
            JsVal::Rec(r) => r
                .borrow()
                .iter()
                .find(|(x, _)| x == k)
                .map(|(_, v)| v.clone()),
            _ => None,
        };
        // `range` (frame-sink.ts:1609-1619): a `$slot`-tagged array.
        let range = |s: &mut Server, content: JsVal, tail: JsVal| {
            let a = JsVal::array(vec![
                tmpl(&format!("<!--slot:{occurrence}:start-->")),
                content,
                tail,
                tmpl(&format!("<!--slot:{occurrence}:end-->")),
            ]);
            s.brands.brand_slot(&a);
            a
        };
        let Some(slot @ JsVal::Fn(_)) = slot else {
            return Ok(range(s, JsVal::Undefined, JsVal::Undefined));
        };
        // The record, declared at the marker: a pending value under its key,
        // settled with the args after the fill.
        let context = s.ctx.clone();
        let record_key = format!("sc:slot:{}:{occurrence}", self.frame_id);
        let mut settle: Option<Resolvers> = None;
        if let Some(ctx) = &context {
            if ctx.is_async() {
                let r = with_resolvers();
                ctx.serialize(
                    s,
                    record_key.clone(),
                    JsVal::Promise(r.promise.clone()),
                    false,
                )?;
                settle = Some(r);
            }
        }
        // Every argument is a scalar here (v1); a structured one is refused.
        for (key, v) in &args {
            if !matches!(
                v,
                JsVal::Num(_) | JsVal::Str(_) | JsVal::Bool(_) | JsVal::Null | JsVal::Undefined
            ) {
                return throw(format!("a structured slot argument ({key} of {occurrence}) is outside the frames subset (v1: scalars)"));
            }
        }
        let resolved = JsVal::Rec(Rc::new(RefCell::new(args.clone())));
        // `finish`: the fill under its occurrence's hydration scope (the zone
        // owner, then `Hydration({ id: "sc-<frame>-<occurrence>-" })`), the
        // range, the deps note, the record settled.
        let id = format!("sc-{}-{occurrence}-", self.frame_id);
        let flip = JsVal::func(0, |_, _| Ok(JsVal::Undefined));
        // `suppressedFill` (frame-sink.ts:1489-1498): fill content is
        // client-owned, never minted.
        s.live_suppressed += 1;
        let out = s.run_with_owner(self.zone, |s| {
            // Hydration (solid hydration.ts:923-930) inside the NoHydration zone.
            let o = s.create_owner(Some(id.clone()), false)?;
            s.run_with_owner(Some(o), |s| {
                s.set_no_hydrate(o, false);
                let content = call(s, &slot, std::slice::from_ref(&resolved))?;
                Ok(range(s, content, flip.clone()))
            })
        });
        s.live_suppressed -= 1;
        let out = match out {
            Ok(o) => o,
            Err(e) => {
                if let Some(r) = &settle {
                    r.resolve(s, JsVal::Undefined);
                }
                return Err(e);
            }
        };
        self.note_deps(s, &occurrence, has_async_holes(&out, 0));
        let record = JsVal::Rec(Rc::new(RefCell::new(
            args.into_iter()
                .filter(|(_, v)| !matches!(v, JsVal::Undefined))
                .collect(),
        )));
        match settle {
            Some(r) => r.resolve(s, record),
            None => {
                if let Some(ctx) = &context {
                    ctx.serialize(s, record_key, record, false)?;
                }
            }
        }
        let _ = &self.doc;
        Ok(out)
    }
}

// ---- the document's live channel (frame-sink.ts:2171-2333) ----

/// The `sc:live` stream: nothing is enqueued in the frames subset (holes
/// stay settled), so it only closes, at `live.end` (flushEnd).
struct Channel {
    source: RefCell<Option<Resolvers>>,
    closed: Cell<bool>,
}

impl LiveChannel for Channel {
    // The guard stream (server.ts:2687-2703, `guardStream`) reads the source
    // and closes one reaction after the source does; its reader is what
    // seroval pulls.
    fn read(&self, s: &mut Server) -> Rc<JsPromise> {
        let src = with_resolvers();
        if self.closed.get() {
            src.resolve(s, JsVal::Bool(true));
        } else {
            *self.source.borrow_mut() = Some(src.clone());
        }
        then(s, &src.promise, Some(Rc::new(|_, v| Ok(v))), None)
    }
}

// Solid: frame-sink.ts:2171-2333 (`armDocumentLiveHoles`): once per document,
// the `sc:live` record serialized on the page's context, and `live.end`.
fn arm_document_live_holes(s: &mut Server, page: &Rc<RenderCtx>) -> Res<()> {
    let Some(st) = page.stream() else {
        // A sync render latches at t=0: nothing is armed.
        return Ok(());
    };
    // `ctx.liveHoles`: set on the page's context, armed or adopted (the
    // document's one engine, scope-gated: mode 1).
    page.live.set(1);
    if st.live_armed.get() {
        return Ok(());
    }
    st.live_armed.set(true);
    let channel = Rc::new(Channel {
        source: RefCell::new(None),
        closed: Cell::new(false),
    });
    let token = JsVal::Deferred(crate::ssr::js::Deferred::new(s));
    s.brands.streams.insert(
        token.identity().expect("an object"),
        (channel.clone(), token.clone()),
    );
    page.serialize(s, "sc:live".into(), token, false)?;
    let c2 = channel.clone();
    *st.live_end.borrow_mut() = Some(Rc::new(move |s| {
        // `live.end`: no binding sweeps an emission here; the channel closes.
        if c2.closed.replace(true) {
            return;
        }
        let src = c2.source.borrow_mut().take();
        if let Some(r) = src {
            r.resolve(s, JsVal::Bool(true));
        }
    }));
    Ok(())
}
