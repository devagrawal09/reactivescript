//! The frames server for a plan v2.2: its server functions, server
//! components and the server-function endpoint (`handleServerFunctionRequest`
//! as `configureServerFunctionsServer({ provideEvent, transformResult:
//! frameTransformResult, transformDirectResult: frameTransformDirectResult
//! })` wires it), answering the client's calls byte for byte as Solid's own
//! server does. `server.ts` is `packages/web/server-functions/src/server.ts`,
//! `frame-sink.ts` is `packages/web/frames/src/frame-sink.ts`.
//!
//! Ported paths: a POST to the data address `/_server/data/<id>` with the
//! client runtime's argument formats `1` (one string) and `8` (a JSON list)
//! or no body; the CSRF gate; a result encoded as format `1` (a string) or
//! `8` (JSON-safe data), a server component as a frame stream, a throw as
//! the sanitized generic `Error` (format `0`, one seroval node); the unknown
//! id 404, the 403, the 405 and the transport hygiene every exit takes.
//! Refused, each with a diagnostic (a 500 whose body names it, never a
//! guess): the live address, `?args=`, format `0` and the other argument
//! encodings, flight data, GET-declared reads, a void result.
use super::hosts::Hosts;
use super::plan::{Expr, Plan, ServerComponent, ServerStep, View};
use super::render::{json_to_js, Binding, Env, Inst, Prop, Render, SlotProxy, Types};
use super::shared::{create_chunk, json_stringify, text_digest};
use crate::ssr::value::{throw, JsVal, Res, Thrown};
use crate::ssr::web::{escape, resolve_ssr_sync};
use crate::ssr::Server;
use serde_json::{json, Map, Value as J};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

/// An HTTP request as the frames server receives it.
pub struct Request {
    pub method: String,
    /// The path and query.
    pub target: String,
    /// Header names lowercased, in arrival order.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// The origin the request was made against (`http://host:port`).
    pub origin: String,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// A response as the handler produced it: the status, the headers as a
/// Fetch `Headers` iterates them (lowercase names, sorted), and the body's
/// chunks as they were enqueued.
#[derive(Clone, Debug)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub chunks: Vec<String>,
}

/// A Fetch `Headers`: names lowercased, `set` replaces, iteration sorted.
#[derive(Default)]
struct Headers(Vec<(String, String)>);
impl Headers {
    fn set(&mut self, k: &str, v: &str) {
        let k = k.to_ascii_lowercase();
        self.0.retain(|(x, _)| x != &k);
        self.0.push((k, v.to_string()));
    }
    fn has(&self, k: &str) -> bool {
        let k = k.to_ascii_lowercase();
        self.0.iter().any(|(x, _)| x == &k)
    }
    fn sorted(mut self) -> Vec<(String, String)> {
        self.0.sort_by(|a, b| a.0.cmp(&b.0));
        self.0
    }
}

const BODY_FORMAT_HEADER: &str = "X-Server-Function-Format";
const ERROR_HEADER: &str = "X-Server-Function-Error";
const UNKNOWN_HEADER: &str = "X-Server-Function-Unknown";
const FRAME_STREAM_HEADER: &str = "X-Frame-Stream";
// Solid: server.ts:3883 (`GENERIC_SERVER_ERROR_MESSAGE`)
const GENERIC_SERVER_ERROR_MESSAGE: &str = "Internal Server Error";
const CSRF_VARY: &str = "Sec-Fetch-Site, Origin, Referer";

/// A server function's outcome: a value or a thrown plain `Error`'s message.
/// The outer `Err` of the calls below is the server failing closed (a plan
/// or script error), never a throw.
pub type Outcome<T> = Result<Result<T, String>, String>;

pub struct FramesServer {
    pub plan: Rc<Plan>,
    pub hosts: Rc<Hosts>,
    /// The last document render's outermost server-function calls (the
    /// questions answered at t=0), as frontend `frames/leg-server.ts`
    /// reports Solid's: `{ id, args }`.
    pub document_calls: Rc<RefCell<Vec<J>>>,
}

impl FramesServer {
    pub fn new(plan: Plan, hosts: Hosts) -> FramesServer {
        FramesServer {
            plan: Rc::new(plan),
            hosts: Rc::new(hosts),
            document_calls: Rc::new(RefCell::new(vec![])),
        }
    }

    // ---- server functions (their bodies: `let x = await h(…)`… `return e`) ----

    /// A server function called with `args`: its steps, each await a host
    /// call answered by the script or a nested (in-process) server function.
    pub fn call_server_fn(&self, name: &str, args: &[J]) -> Outcome<J> {
        let f = self
            .plan
            .server_fn(name)
            .ok_or_else(|| format!("no server fn {name}"))?;
        if f.params.len() != args.len() {
            return Err(format!(
                "{name} takes {} arguments, called with {}",
                f.params.len(),
                args.len()
            ));
        }
        let mut locals: HashMap<String, J> = f
            .params
            .iter()
            .map(|p| p.name.clone())
            .zip(args.iter().cloned())
            .collect();
        for st in &f.steps {
            match st {
                ServerStep::Await {
                    server_host,
                    server_fn,
                    args,
                    bind,
                } => {
                    let args: Vec<J> = args
                        .iter()
                        .map(|a| eval_j(a, &locals))
                        .collect::<Result<_, _>>()?;
                    let r = match (server_host, server_fn) {
                        (Some(h), _) => self.hosts.call(h, &args)?,
                        (_, Some(g)) => self.call_server_fn(g, &args)?,
                        _ => return Err("an await of nothing".into()),
                    };
                    match r {
                        Ok(v) => {
                            locals.insert(bind.clone(), v);
                        }
                        Err(e) => return Ok(Err(e)),
                    }
                }
                ServerStep::Return { value } => return Ok(Ok(eval_j(value, &locals)?)),
            }
        }
        Err(format!("server fn {name} ends without a return"))
    }

    /// The client site of a server component: the first application placed
    /// on it (PL-7: the sites a function serves pass props of one shape).
    pub fn site_of(&self, sc: &ServerComponent) -> Result<Vec<super::plan::PropArg>, String> {
        fn find(vs: &[View], name: &str) -> Option<Vec<super::plan::PropArg>> {
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
        find(&self.plan.markup, &sc.name).ok_or_else(|| format!("no site of {}", sc.name))
    }

    /// A server component called with `args` (plan/split.ts's parameters:
    /// the sunk question's arguments, then the other value props in site
    /// order; owned: the value props in site order): its question asked
    /// (a direct call), then its props.
    pub fn call_server_component(&self, name: &str, args: &[J]) -> Outcome<Vec<(String, J)>> {
        let sc = self
            .plan
            .server_component(name)
            .ok_or_else(|| format!("no server component {name}"))?;
        let site = self.site_of(sc)?;
        let comp = self.plan.component(&sc.component).ok_or("no component")?;
        let mut props = vec![];
        let mut k = 0;
        if sc.question.kind == "sunk" {
            let q = self
                .plan
                .memos
                .iter()
                .find(|m| m.name == sc.question.memo)
                .ok_or("no sunk question")?;
            let call = q.call.as_ref().ok_or("a sunk question awaits")?;
            let qargs = args
                .get(..call.args.len())
                .ok_or("too few arguments")?
                .to_vec();
            k = call.args.len();
            let sunk_prop = site
                .iter()
                .find(|a| matches!(&a.value, Some(Expr::Read { source }) if *source == q.name))
                .ok_or("no sunk prop")?;
            match self.call_server_fn(&call.server_fn, &qargs)? {
                Ok(v) => props.push((sunk_prop.name.clone(), v)),
                Err(e) => return Ok(Err(e)),
            }
            for a in &site {
                if a.value.is_some() && a.name != sunk_prop.name {
                    props.push((
                        a.name.clone(),
                        args.get(k).cloned().ok_or("too few arguments")?,
                    ));
                    k += 1;
                }
            }
        } else {
            for a in &site {
                if a.value.is_some() {
                    props.push((
                        a.name.clone(),
                        args.get(k).cloned().ok_or("too few arguments")?,
                    ));
                    k += 1;
                }
            }
            // The owned question, its arguments over those props.
            let q = comp
                .memos
                .iter()
                .find(|m| m.name == sc.question.memo)
                .ok_or("no owned question")?;
            let call = q.call.as_ref().ok_or("an owned question awaits")?;
            let env: HashMap<String, J> = props
                .iter()
                .map(|(n, v)| (format!("props.{n}"), v.clone()))
                .collect();
            let qargs: Vec<J> = call
                .args
                .iter()
                .map(|a| eval_j(a, &env))
                .collect::<Result<_, _>>()?;
            match self.call_server_fn(&call.server_fn, &qargs)? {
                Ok(v) => props.push((format!("${}", q.name), v)),
                Err(e) => return Ok(Err(e)),
            }
        }
        if k != args.len() {
            return Err(format!(
                "{name} takes {k} arguments, called with {}",
                args.len()
            ));
        }
        Ok(Ok(props))
    }

    /// The server component's own render (its body's markup, its islands as
    /// slot occurrences), as the instance the face's renderer draws.
    pub fn server_instance(
        &self,
        s: &mut Server,
        sc: &ServerComponent,
        props: &[(String, J)],
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
            tys.insert(format!("props.{}", p.name), super::render::parse_ty(&p.ty));
        }
        for (n, v) in props {
            if let Some(memo) = n.strip_prefix('$') {
                names.insert(memo.to_string(), Binding::Value(json_to_js(v)?));
                let f = self.plan.server_fn(
                    &comp
                        .memos
                        .iter()
                        .find(|m| m.name == memo)
                        .and_then(|m| m.call.as_ref())
                        .map(|c| c.server_fn.clone())
                        .unwrap_or_default(),
                );
                tys.insert(
                    memo.to_string(),
                    f.map_or(super::render::Ty::Unknown, |f| {
                        super::render::parse_ty(&f.returns)
                    }),
                );
            } else {
                ps.insert(n.clone(), Prop::Value(json_to_js(v)?));
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
        // The body's other memos: `const`s, in order.
        for m in &comp.memos {
            if m.call.is_some() {
                continue;
            }
            let value = m.value.as_ref().expect("validated");
            let t = inst.ty(value, &Types::new());
            let v = super::render::eval(s, &inst, value, &Env::new())?;
            inst.tys.borrow_mut().insert(m.name.clone(), t);
            inst.names
                .borrow_mut()
                .insert(m.name.clone(), Binding::Value(v));
        }
        Ok(inst)
    }

    // ---- the endpoint ----

    // Solid: server.ts:4480-5258 (`handleServerFunctionRequest`), the paths a
    // frames app's client reaches; the rest refused.
    pub fn handle(&self, req: &Request) -> Result<Response, String> {
        let (path, query) = match req.target.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (req.target.as_str(), None),
        };
        let address = parse_address(path);
        let method = req.method.as_str();
        // No function declares GET, so every request is gated
        // (`protectsRequest`, server.ts:4510-4515).
        let verdict = allows(req);
        let finish = |mut h: Headers, status: u16, chunks: Vec<String>, csrf_vary: bool| {
            // Solid: server.ts:5383-5429 (`finalizeTransportResponse`), then
            // `withCSRFVary` (server.ts:4224-4226).
            if !h.has("Cache-Control") && status != 304 {
                h.set("Cache-Control", "no-store");
            }
            if !h.has("X-Content-Type-Options") {
                h.set("X-Content-Type-Options", "nosniff");
            }
            if csrf_vary {
                h.set("Vary", CSRF_VARY);
            }
            Response {
                status,
                headers: h.sorted(),
                chunks,
            }
        };
        let id = address.as_ref().map(|a| a.0.clone());
        if let Some(id) = &id {
            if self
                .plan
                .server_fn(id_name(&self.plan, id).unwrap_or(""))
                .is_none()
                && self.plan.server_components.iter().all(|c| &c.id != id)
            {
                // Labelled unknown id, before the gate's refusal; production
                // sends no body.
                let mut h = Headers::default();
                h.set(UNKNOWN_HEADER, "true");
                return Ok(finish(h, 404, vec![], false));
            }
        }
        if !verdict {
            // Solid: server.ts:4318-4325 (`forbiddenResponse`)
            let mut h = Headers::default();
            h.set("Cache-Control", "no-store");
            return Ok(finish(h, 403, vec![], true));
        }
        let Some((id, data, live)) = address else {
            return Ok(finish(Headers::default(), 404, vec![], true));
        };
        if live {
            return Err("frames-server refuses the live address (`live` server functions are outside the frames subset)".into());
        }
        if method != "POST" {
            let mut h = Headers::default();
            h.set("Allow", "POST");
            return Ok(finish(h, 405, vec![], true));
        }
        if query.is_some_and(|q| {
            q.split('&')
                .any(|kv| kv == "args" || kv.starts_with("args="))
        }) {
            return Err(
                "frames-server refuses `?args=` encodings (a client runtime POST never sends one)"
                    .into(),
            );
        }
        if !data {
            return Err("frames-server refuses the bare address (no-JS forms and direct HTTP are outside the frames subset)".into());
        }
        let args = parse_arguments(req)?;
        let name = id_name(&self.plan, &id)
            .ok_or_else(|| format!("no function at {id}"))?
            .to_string();
        let mut h = Headers::default();
        // The function, then `transformResult` (frameTransformResult): a
        // server component answers as a frame stream.
        if let Some(sc) = self.plan.server_components.iter().find(|c| c.id == id) {
            return match self.call_server_component(&sc.name, &args)? {
                Ok(props) => {
                    let (h2, chunks) = self.frame_response(sc, &props)?;
                    Ok(finish(h2, 200, chunks, true))
                }
                Err(_) => Ok(self.respond_thrown(h, finish)),
            };
        }
        match self.call_server_fn(&name, &args)? {
            Ok(v) => {
                // Solid: server.ts:3767-3869 (`encodeResult`), the string and
                // JSON paths.
                let body = match &v {
                    J::String(text) => {
                        h.set("Content-Type", "text/plain");
                        h.set(BODY_FORMAT_HEADER, "1");
                        text.clone()
                    }
                    _ => {
                        h.set(BODY_FORMAT_HEADER, "8");
                        h.set("Content-Type", "application/json");
                        json_stringify(&v)?
                    }
                };
                Ok(finish(h, 200, vec![body], true))
            }
            Err(_) => Ok(self.respond_thrown(h, finish)),
        }
    }

    // Solid: server.ts:694-717 (`respondThrown`): the sanitized generic
    // `Error`, its message on the error header, encoded through the codec
    // (`serializedResponse`, format 0) at 500.
    fn respond_thrown(
        &self,
        mut h: Headers,
        finish: impl Fn(Headers, u16, Vec<String>, bool) -> Response,
    ) -> Response {
        h.set(ERROR_HEADER, GENERIC_SERVER_ERROR_MESSAGE);
        h.set(BODY_FORMAT_HEADER, "0");
        h.set("Content-Type", "text/plain");
        // seroval's JSON node of `new Error(message)` (serializeJSON's onParse):
        // t 13 (Error), id 0, constructor 0 (Error), the message, and its
        // empty own-property record (stacks are not serialized in production).
        let mut node = String::from("{\"t\":13,\"i\":0,\"s\":0,\"m\":");
        super::shared::json_string(GENERIC_SERVER_ERROR_MESSAGE, &mut node);
        node.push_str(",\"p\":{\"k\":[],\"v\":[]}}");
        finish(h, 500, vec![create_chunk(&node).expect("small")], true)
    }

    // Solid: frame-sink.ts:2976-3097 (`serverComponentResponse`) over
    // `renderServerComponent` (frame-sink.ts:1020-1063) and `frameStream`
    // (1076-1230).
    fn frame_response(
        &self,
        sc: &ServerComponent,
        props: &[(String, J)],
    ) -> Result<(Headers, Vec<String>), String> {
        let mut h = Headers::default();
        h.set(FRAME_STREAM_HEADER, &sc.id);
        h.set("X-Content-Raw", "1");
        h.set("Content-Type", "application/x-frame-stream");
        let messages = self.frame_stream(sc, props).map_err(|e| e.to_string())?;
        let chunks = messages
            .iter()
            .map(|m| create_chunk(m))
            .collect::<Result<_, _>>()?;
        Ok((h, chunks))
    }

    /// The frame stream's messages: `start`; the sync pass's records (its slot
    /// occurrences), flushed at the pass's end; the shell's root record;
    /// `:complete`. A server component's body has settled every await before
    /// it renders (v1: no Loading inside, M8), so the render is synchronous.
    fn frame_stream(&self, sc: &ServerComponent, props: &[(String, J)]) -> Res<Vec<String>> {
        let sink = Rc::new(FrameSink::new(sc.id.clone()));
        sink.send_raw(json!({ "type": "start", "id": sc.id, "version": 1 }));
        let mut s = Server::new();
        let slots: Rc<dyn SlotProxy> = Rc::new(StreamSlots {
            sink: sink.clone(),
            counts: RefCell::new(HashMap::new()),
        });
        // The frame render's context, with its live-hole engine (`ctx.liveHoles`,
        // frame-sink.ts:1052: every hole, mode 2).
        let ctx =
            crate::ssr::web::RenderCtx::new(crate::ssr::web::CtxKind::Derived(String::new()), None);
        ctx.live.set(2);
        s.ctx = Some(ctx);
        let html = s.create_root(Some(String::new()), |s, _| {
            // serverOwned (frame-sink.ts:175-184): NoHydration's owner, its
            // context `NoHydrateContext: true` (solid hydration.ts:886-892).
            let o = s.create_owner(None, false)?;
            s.set_no_hydrate(o, true);
            s.run_with_owner(Some(o), |s| {
                // serverComponentScope (runInServerComponentScope,
                // signals.ts:4635-4655): a transparent owner.
                let t = s.create_owner(None, true)?;
                s.set_server_component(t);
                s.run_with_owner(Some(t), |s| {
                    let inst = self.server_instance(s, sc, props, slots.clone())?;
                    let r = Render { sites: None };
                    let v = r.fragment(
                        s,
                        &inst,
                        &inst.comp.markup.clone(),
                        &Env::new(),
                        &Types::new(),
                    )?;
                    resolve_ssr_sync(s, &escape(&v))
                })
            })
        })?;
        if let Some(f) = s.failures.first() {
            return throw(f.clone());
        }
        // The sync pass is a flush.
        sink.flush();
        // Solid: frame-sink.ts:621-659 (`shell`): the root record, its digest
        // over the skeleton (slot ranges emptied: they already are).
        let digest = text_digest(&frame_skeleton(&html));
        sink.put(
            "",
            json!({ "kind": "html", "value": html, "digest": digest }),
        );
        sink.flush();
        // Solid: frame-sink.ts:800-812 (`end`): `:complete`, flushed. The
        // watched-arg bindings of the slot args sweep once first; every arg
        // here is a settled value, so no sweep re-emits.
        sink.put(":complete", J::Bool(true));
        sink.flush();
        let out = sink.out.borrow().clone();
        Ok(out)
    }
}

/// The function name behind a wire id.
fn id_name<'p>(plan: &'p Plan, id: &str) -> Option<&'p str> {
    plan.server_fns
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.name.as_str())
        .or_else(|| {
            plan.server_components
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.name.as_str())
        })
}

// Solid: shared.ts:632-654 (`parseServerFunctionAddress`) under the default
// endpoint `/_server`: (id, data, live).
fn parse_address(path: &str) -> Option<(String, bool, bool)> {
    let rest = path.strip_prefix("/_server")?;
    let mut segment = rest.strip_prefix('/')?;
    let (mut data, mut live) = (false, false);
    if let Some(x) = segment.strip_prefix("data/") {
        segment = x;
        data = true;
    } else if let Some(x) = segment.strip_prefix("live/") {
        segment = x;
        live = true;
    }
    if segment.is_empty() || segment.contains('/') {
        return None;
    }
    Some((percent_decode(segment)?, data, live))
}

/// `decodeURIComponent`: `%XX` sequences as UTF-8; malformed ones fail.
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

// Solid: server.ts:4144-4192 (`allowsServerFunctionRequest`) with no origin
// allowlist: `Sec-Fetch-Site: same-origin` admits, `none` and the cross-site
// values refuse, else `Origin`, else `Referer` must be the request's origin;
// with none of the three, refuse.
fn allows(req: &Request) -> bool {
    match req.header("sec-fetch-site") {
        Some("same-origin") => return true,
        Some("none") | Some("same-site") | Some("cross-site") => return false,
        _ => {}
    }
    if let Some(origin) = req.header("origin") {
        return origin == req.origin;
    }
    if let Some(referer) = req.header("referer") {
        return url_origin(referer).is_some_and(|o| o == req.origin);
    }
    false
}

fn url_origin(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(format!("{scheme}://{host}"))
}

// Solid: server.ts:2101-2245 (`parseArguments`), the client runtime's
// encodings: format 1 is one string argument, format 8 a JSON argument list,
// an untagged empty body no arguments. Anything else is refused.
fn parse_arguments(req: &Request) -> Result<Vec<J>, String> {
    let format = req.header("x-server-function-format");
    match format {
        Some("1") => Ok(vec![J::String(String::from_utf8(req.body.clone()).map_err(|e| e.to_string())?)]),
        Some("8") => {
            let v: J = serde_json::from_slice(&req.body).map_err(|e| format!("malformed JSON arguments: {e}"))?;
            match v {
                J::Array(xs) => Ok(xs),
                _ => Err("JSON arguments that are not a list".into()),
            }
        }
        None if req.body.is_empty() => Ok(vec![]),
        other => Err(format!("frames-server refuses the argument format {other:?} (the frames subset sends formats 1 and 8)")),
    }
}

/// A server fn body's expression over JSON values (its locals: parameters
/// and await bindings; an owned question's arguments: `props.<name>`).
fn eval_j(e: &Expr, locals: &HashMap<String, J>) -> Result<J, String> {
    let ints = |l: &J, r: &J| -> Result<(i64, i64), String> {
        match (l.as_i64(), r.as_i64()) {
            (Some(a), Some(b)) => Ok((a, b)),
            _ => Err(format!("integer comparison of {l} and {r}")),
        }
    };
    let truthy = |v: &J| match v {
        J::Null => false,
        J::Bool(b) => *b,
        J::Number(n) => n.as_i64() != Some(0),
        J::String(s) => !s.is_empty(),
        _ => true,
    };
    let text = |v: &J| -> Result<String, String> {
        match v {
            J::String(s) => Ok(s.clone()),
            J::Number(n) => Ok(n.to_string()),
            other => Err(format!("ToString of {other}")),
        }
    };
    Ok(match e {
        Expr::Literal { value } => value.clone(),
        Expr::Local { name } => locals
            .get(name)
            .cloned()
            .ok_or_else(|| format!("unbound local {name}"))?,
        Expr::Prop { name } => locals
            .get(&format!("props.{name}"))
            .cloned()
            .ok_or_else(|| format!("unbound prop {name}"))?,
        Expr::Array { items } => J::Array(
            items
                .iter()
                .map(|x| eval_j(x, locals))
                .collect::<Result<_, _>>()?,
        ),
        Expr::Object { fields } => {
            let mut m = Map::new();
            for f in fields {
                m.insert(f.key.clone(), eval_j(&f.value, locals)?);
            }
            J::Object(m)
        }
        Expr::Get { object, key } => match eval_j(object, locals)? {
            J::Object(o) => o
                .get(key)
                .cloned()
                .ok_or_else(|| format!("missing field {key}"))?,
            other => return Err(format!("get {key} of {other}")),
        },
        Expr::Length { array } => match eval_j(array, locals)? {
            J::Array(xs) => J::from(xs.len() as i64),
            other => return Err(format!("length of {other}")),
        },
        Expr::Filter { array, param, body }
        | Expr::Map { array, param, body }
        | Expr::FindIndex { array, param, body } => {
            let J::Array(xs) = eval_j(array, locals)? else {
                return Err("an array method of a non-array".into());
            };
            let mut out = vec![];
            for (k, x) in xs.into_iter().enumerate() {
                let mut inner = locals.clone();
                inner.insert(param.clone(), x.clone());
                let v = eval_j(body, &inner)?;
                match e {
                    Expr::Filter { .. } if truthy(&v) => out.push(x),
                    Expr::Map { .. } => out.push(v),
                    Expr::FindIndex { .. } if truthy(&v) => return Ok(J::from(k as i64)),
                    _ => {}
                }
            }
            if matches!(e, Expr::FindIndex { .. }) {
                J::from(-1)
            } else {
                J::Array(out)
            }
        }
        Expr::Add { left, right } => {
            let (l, r) = (eval_j(left, locals)?, eval_j(right, locals)?);
            if l.is_string() || r.is_string() {
                J::String(text(&l)? + &text(&r)?)
            } else {
                let (a, b) = ints(&l, &r)?;
                J::from(a.checked_add(b).ok_or("integer overflow")?)
            }
        }
        Expr::Eq { left, right } | Expr::Ne { left, right } => {
            let (l, r) = (eval_j(left, locals)?, eval_j(right, locals)?);
            if l.is_object() || l.is_array() || r.is_object() || r.is_array() {
                return Err(
                    "identity comparison of server values is outside the frames subset".into(),
                );
            }
            J::Bool((l == r) == matches!(e, Expr::Eq { .. }))
        }
        Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let (a, b) = ints(&eval_j(left, locals)?, &eval_j(right, locals)?)?;
            J::Bool(match e {
                Expr::Lt { .. } => a < b,
                Expr::Le { .. } => a <= b,
                Expr::Gt { .. } => a > b,
                _ => a >= b,
            })
        }
        Expr::And { left, right } => {
            let l = eval_j(left, locals)?;
            if truthy(&l) {
                eval_j(right, locals)?
            } else {
                l
            }
        }
        Expr::Or { left, right } => {
            let l = eval_j(left, locals)?;
            if truthy(&l) {
                l
            } else {
                eval_j(right, locals)?
            }
        }
        Expr::Not { value } => J::Bool(!truthy(&eval_j(value, locals)?)),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval_j(test, locals)?) {
                eval_j(then, locals)?
            } else {
                eval_j(otherwise, locals)?
            }
        }
        Expr::Read { .. } | Expr::Pending { .. } | Expr::Latest { .. } => {
            return Err("a server fn reads no reactive state (SF-3)".into())
        }
    })
}

// ---- the frame sink (frame-sink.ts:408-958, the paths a render reaches) ----

pub struct FrameSink {
    id: String,
    /// The queued batches: (frame id, records).
    queue: RefCell<Vec<(String, Map<String, J>)>>,
    open: RefCell<bool>,
    pub out: RefCell<Vec<String>>,
}

impl FrameSink {
    pub fn new(id: String) -> FrameSink {
        FrameSink {
            id,
            queue: RefCell::new(vec![]),
            open: RefCell::new(false),
            out: RefCell::new(vec![]),
        }
    }
    fn send_raw(&self, message: J) {
        self.out
            .borrow_mut()
            .push(json_stringify(&message).expect("a message"));
    }
    // Solid: frame-sink.ts:450-468 (`put`): merge into the open batch of the
    // same frame unless a key repeats.
    pub fn put(&self, key: &str, record: J) {
        let mut q = self.queue.borrow_mut();
        let merge = *self.open.borrow()
            && q.last()
                .is_some_and(|(fid, r)| fid == &self.id && !r.contains_key(key));
        if merge {
            q.last_mut()
                .expect("open")
                .1
                .insert(key.to_string(), record);
        } else {
            let mut r = Map::new();
            r.insert(key.to_string(), record);
            q.push((self.id.clone(), r));
            *self.open.borrow_mut() = true;
        }
    }
    // Solid: frame-sink.ts:442-449 (`flush`)
    pub fn flush(&self) {
        *self.open.borrow_mut() = false;
        let q = std::mem::take(&mut *self.queue.borrow_mut());
        for (fid, r) in q {
            self.send_raw(json!({ "id": fid, "version": 1, "r": r }));
        }
    }
}

/// `frameSkeleton` (frame-sink.ts:351-355): live-hole and slot ranges
/// emptied. A synchronous render marks no live holes, and a slot range is
/// empty on the server, so the skeleton is the html itself; a live-hole
/// marker is refused.
fn frame_skeleton(html: &str) -> String {
    assert!(
        !html.contains("<!--lh:"),
        "a live hole in a synchronous frame render"
    );
    html.to_string()
}

/// The slot props proxy of a frame stream (`createSlotProps`,
/// frame-sink.ts:2646-2950): positional occurrences per prop, primitive args
/// inline in the `slot:` record, the marker range returned.
struct StreamSlots {
    sink: Rc<FrameSink>,
    counts: RefCell<HashMap<String, usize>>,
}

impl SlotProxy for StreamSlots {
    fn call(
        &self,
        _s: &mut Server,
        k: &str,
        args: Vec<(String, JsVal)>,
        _inst: &Rc<Inst>,
    ) -> Res<JsVal> {
        // Solid: frame-sink.ts:1295-1302 (`occurrenceId`): `prop#<n>`.
        let n = {
            let mut c = self.counts.borrow_mut();
            let n = c.entry(k.to_string()).or_insert(0);
            let v = *n;
            *n += 1;
            v
        };
        let occurrence = format!("{k}#{n}");
        let mut a = Map::new();
        for (key, v) in args {
            let j = match &v {
                JsVal::Num(_) | JsVal::Str(_) | JsVal::Bool(_) | JsVal::Null => super::render::js_to_json(&v)?,
                JsVal::Undefined => J::Null,
                _ => return throw(format!("a structured slot argument ({key} of {occurrence}) is outside the frames subset (v1: scalars)")),
            };
            a.insert(key, j);
        }
        self.sink.put(
            &format!("slot:{occurrence}"),
            json!({ "kind": "slot", "args": a }),
        );
        let r = slot_range(&occurrence);
        _s.brands.brand_slot(&r);
        Ok(r)
    }
}

// Solid: frame-sink.ts:1232-1237 (`slotRange`)
pub fn slot_range(occurrence: &str) -> JsVal {
    JsVal::Tmpl(Rc::from(
        format!("<!--slot:{occurrence}:start--><!--slot:{occurrence}:end-->").as_str(),
    ))
}
