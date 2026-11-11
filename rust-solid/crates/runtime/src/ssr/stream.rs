//! `renderToStream` (web/src/server.ts:2068-3725, the production build's
//! `dist/server.js:1738-2651`) piped to a sink, and the hydration serializer
//! both renders use (serializer.ts:204-355: `createHydrationSerializer`,
//! `createKeyedSerializer`, and `rejectUnserializedKey`'s index counter).
//!
//! The stream: the root renders synchronously; `pipe` waits for the
//! blocking promises (`allSettled`), then for the fragment registry to stop
//! changing (`scheduleFlush`: eight microtask turns after the last change,
//! then one `setImmediate` of grace while fragments are pending), then
//! writes the shell (the HTML and the hydration data serialized so far, in
//! one `<script>`). Each Loading boundary that settles afterwards writes a
//! `<template id>` with its content and the scripts that swap it in
//! (`$df`), and the serialized data follows as seroval resolves it. Writes
//! are coalesced: one chunk per `setImmediate` (`coalesceWrites`). The
//! stream ends when the registry is empty and every serialized value has
//! settled (`flushEnd`, the serializer's `onDone`).
//!
//! Not ported (no plan app reaches them; refused or inert): root holes (an
//! async read outside every `<Loading>`: refused), `deferStream` reads,
//! `ctx.block`/`ctx.hold`/`ctx.replace`, reveal groups and `$dfj`/`$dflj`,
//! fragment styles and assets (`$dfs`, links, inline styles: none are
//! registered), head updates (`emitHeadOps`: nothing registers a head tag),
//! the stable-order (awaited) form, `pipeTo`/`readable`, custom sinks and
//! serializers, `onCompleteShell`/`onCompleteAll`/`onHead`, the abort
//! signal, client disconnects (a sink that throws), live holes, the server
//! error hook, and the serializer's failure path (`rejectUnserializedKey`'s
//! client-side rejection: a value that fails to serialize fails the render).
use super::boundary::{ssr_sanitize_error, Settle};
use super::js::{
    catch, noop, promise_all_settled, promise_race, queue, then, with_resolvers, Handler,
};
use super::owner::OwnerId;
use super::seroval::{cross_serialize_stream, destroy_stream_parse, Refs, StreamParse};
use super::value::{JsVal, Res, Thrown};
use super::web::{escape, local_header_script, resolve_fresh, CtxKind, RenderCtx};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

// ---- the hydration serializer ----

/// serializer.ts: `serializeKey` (the `KEY_ESCAPES` of a key in `"…"`).
fn serialize_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for c in key.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\u{c}' => out.push_str("\\f"),
            '<' => out.push_str("\\x3C"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c => out.push(c),
        }
    }
    out
}

pub type OnData = Rc<dyn Fn(&mut Server, String)>;
/// A callback of the render (`onDone`, a serialized value's abandon hook).
pub type Callback = Rc<dyn Fn(&mut Server)>;
/// A registry entry's `resolve(err)`.
type FragmentResolve = Rc<dyn Fn(&mut Server, Option<JsVal>)>;

struct Keyed {
    cancels: Vec<Rc<StreamParse>>,
    pending_writes: usize,
    flushed: bool,
    done: bool,
    closed: bool,
}

/// `createHydrationSerializer` over `createKeyedSerializer`: one seroval
/// stream session per keyed write, sharing `refs`; `onDone` once flushed
/// and every write settled.
pub struct HydrationSerializer {
    scope_id: Option<String>,
    refs: Rc<RefCell<Refs>>,
    on_data: OnData,
    on_done: Option<Callback>,
    st: RefCell<Keyed>,
}

impl HydrationSerializer {
    // Solid: serializer.ts:334-355 (`createHydrationSerializer`); `late`
    // (`rejectUnserializedKey`, the stream's) only changes the failure path.
    pub fn new(
        scope_id: Option<String>,
        on_data: OnData,
        on_done: Option<Callback>,
        _late: bool,
    ) -> Rc<HydrationSerializer> {
        Rc::new(HydrationSerializer {
            scope_id,
            refs: Rc::new(RefCell::new(Refs::default())),
            on_data,
            on_done,
            st: RefCell::new(Keyed {
                cancels: vec![],
                pending_writes: 0,
                flushed: false,
                done: false,
                closed: false,
            }),
        })
    }

    // Solid: serializer.ts:231-236 (`maybeDone`)
    fn maybe_done(&self, s: &mut Server) {
        let fire = {
            let mut st = self.st.borrow_mut();
            if st.flushed && st.pending_writes == 0 && !st.done {
                st.done = true;
                true
            } else {
                false
            }
        };
        if fire {
            if let Some(f) = self.on_done.clone() {
                f(s);
            }
        }
    }

    // Solid: serializer.ts:238-290 (`write`)
    pub fn write(self: &Rc<Self>, s: &mut Server, key: String, value: JsVal) -> Res<()> {
        if self.st.borrow().flushed {
            return Ok(());
        }
        self.st.borrow_mut().pending_writes += 1;
        let settled = Rc::new(Cell::new(false));
        let me = self.clone();
        let st2 = settled.clone();
        let settle: Rc<dyn Fn(&mut Server)> = Rc::new(move |s| {
            if st2.replace(true) {
                return;
            }
            me.st.borrow_mut().pending_writes -= 1;
            me.maybe_done(s);
        });
        let me = self.clone();
        let on_serialize = Rc::new(move |s: &mut Server, data: String, initial: bool| {
            if me.st.borrow().closed {
                return;
            }
            let text = if initial {
                format!("_$HY.r[\"{}\"]={data}", serialize_key(&key))
            } else {
                data
            };
            (me.on_data)(s, text);
        });
        let stream = cross_serialize_stream(
            s,
            value,
            self.refs.clone(),
            self.scope_id.clone(),
            on_serialize,
            settle.clone(),
        )?;
        if settled.get() {
            return Ok(());
        }
        if self.st.borrow().closed {
            destroy_stream_parse(&stream);
            settle(s);
            return Ok(());
        }
        self.st.borrow_mut().cancels.push(stream);
        Ok(())
    }

    // Solid: serializer.ts:291-294 (`flush`)
    pub fn flush(&self, s: &mut Server) {
        self.st.borrow_mut().flushed = true;
        self.maybe_done(s);
    }

    // Solid: serializer.ts:295-305 (`close`)
    pub fn close(&self, s: &mut Server) {
        let cancels = {
            let mut st = self.st.borrow_mut();
            st.closed = true;
            st.flushed = true;
            std::mem::take(&mut st.cancels)
        };
        for c in cancels {
            destroy_stream_parse(&c);
        }
        let fire = {
            let mut st = self.st.borrow_mut();
            if !st.done {
                st.done = true;
                true
            } else {
                false
            }
        };
        if fire {
            if let Some(f) = self.on_done.clone() {
                f(s);
            }
        }
    }
}

// ---- renderToStream ----

/// What the sink saw: each chunk, in order, interleaved with the host
/// settlements the driver made, and the end.
#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
    Chunk(String),
    Settle(String),
    End,
}

#[derive(Default)]
pub struct StreamOut {
    pub events: Vec<StreamEvent>,
    pub ended: bool,
}

/// `coalesceWrites(writeRaw, endRaw)` over the piped sink (server.ts:
/// 2342-2369): writes buffer until a `setImmediate` (or 16 KiB of UTF-16).
struct Coalesce {
    buf: RefCell<String>,
    scheduled: Cell<bool>,
    out: Rc<RefCell<StreamOut>>,
}

impl Coalesce {
    fn flush(&self) {
        self.scheduled.set(false);
        let out = std::mem::take(&mut *self.buf.borrow_mut());
        if out.is_empty() {
            return;
        }
        // `guardSink`'s write: the sink never throws here.
        self.out.borrow_mut().events.push(StreamEvent::Chunk(out));
    }

    fn write(self: &Rc<Self>, s: &mut Server, payload: &str) {
        self.buf.borrow_mut().push_str(payload);
        if self.buf.borrow().encode_utf16().count() >= 16384 {
            return self.flush();
        }
        if !self.scheduled.get() {
            self.scheduled.set(true);
            let me = self.clone();
            // `deferFlush` is `setImmediate` on Node.
            s.set_immediate(Box::new(move |_| me.flush()));
        }
    }

    fn end(&self) {
        self.flush();
        let mut o = self.out.borrow_mut();
        o.events.push(StreamEvent::End);
        o.ended = true;
    }
}

struct RegistryEntry {
    key: String,
    resolve: FragmentResolve,
    children: Option<Vec<(String, String)>>,
}

struct St {
    dead: bool,
    completed: bool,
    first_flushed: bool,
    shell_completed: bool,
    script_flushed: bool,
    header_emitted: bool,
    timer: bool,
    tasks: String,
    tmp: String,
    html: String,
    writable: Option<Rc<Coalesce>>,
    stub_batch: Option<Vec<(String, JsVal)>>,
    writing: usize,
    registry: Vec<RegistryEntry>,
    pending_serialized: Vec<(String, Callback)>,
    /// `guardedChannels` (a WeakMap): each source with its guarded channel.
    /// The source is kept too, so its identity cannot be another object's.
    guarded: Vec<(usize, JsVal, JsVal)>,
    last_blocking_size: i64,
    last_registry_size: i64,
    drain_turn: u32,
    graced: bool,
    fragment_owners: Vec<(String, usize)>,
    root: Option<OwnerId>,
    root_disposed: bool,
}

/// `renderToStream`'s state: the render context's stream half.
pub struct StreamRender {
    st: RefCell<St>,
    serializer: RefCell<Option<Rc<HydrationSerializer>>>,
    out: Rc<RefCell<StreamOut>>,
    render_id: String,
    /// The root context's `live` slot (frames' document face): whether a
    /// server component armed the channel, and its end.
    pub live_armed: Cell<bool>,
    pub live_end: RefCell<Option<Callback>>,
    /// `context.edges` (server.ts:2880): a render with the server-component
    /// codec among its plugins names its signals and tracks fill reads.
    pub edges: Cell<bool>,
}

const MIN_DRAIN_TURNS: u32 = 8;
const REPLACE_SCRIPT: &str = r#"function $df(e){return _$HY.f?_$HY.f(e):$dfr(e)}function $dfr(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return(_$HY.dq=_$HY.dq||{})[e]=1,0;for(;o&&(8!==o.nodeType||o.nodeValue!=="pl-"+e);)t=o.nextSibling,o.remove(),o=t;t=o.parentNode,(_$HY.v=_$HY.v||{})[e]=n.hasAttribute("e")?[...n.content.childNodes]:1,o.replaceWith(n.content),n.remove(),_$HY.fe(e,t),_$HY.hp&&_$HY.hp[e]&&($dh(_$HY.hp[e]),delete _$HY.hp[e]),$dfd();return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return(_$HY.dlq=_$HY.dlq||{})[e]=1,0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1,$dfd();return 1}n=n.nextSibling}return 0}function $dflj(e,i){for(i=0;i<e.length;i++)$dfl(e[i])}function $dfd(e,i){if(e=_$HY.dq){_$HY.dq=0;for(i in e)$df(i)}if(e=_$HY.dlq){_$HY.dlq=0;for(i in e)$dfl(i)}}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])}function $dfe(e,t,k){(t=e.target)&&t.getAttribute&&!t._$dc&&(k=t.getAttribute("data-dfc"))&&(t._$dc=1,$dfc(k))}document.addEventListener("load",$dfe,!0);document.addEventListener("error",$dfe,!0)"#;

/// `replacePlaceholder(html, key, value)` (server.ts:6164-6173).
fn replace_placeholder(html: &str, key: &str, value: &str) -> String {
    let marker = format!("<template id=\"pl-{key}\">");
    let close = format!("<!--pl-{key}-->");
    let Some(first) = html.find(&marker) else {
        return html.to_string();
    };
    let from = first + marker.len();
    // `indexOf(close, …)` of -1 slices from `-1 + close.length`.
    let last = html[from..].find(&close).map(|i| i + from);
    let after = match last {
        Some(l) => l + close.len(),
        None => close.len() - 1,
    };
    format!(
        "{}{value}{}",
        &html[..first],
        &html[after.min(html.len())..]
    )
}

impl StreamRender {
    pub fn first_flushed(&self) -> bool {
        self.st.borrow().first_flushed
    }

    fn serializer(&self) -> Rc<HydrationSerializer> {
        self.serializer.borrow().clone().expect("the serializer")
    }

    // Solid: server.ts (renderToStream `pushTask`)
    fn push_task(self: &Rc<Self>, s: &mut Server, task: &str) {
        let schedule = {
            let mut st = self.st.borrow_mut();
            if !st.header_emitted {
                st.header_emitted = true;
                st.tasks.push_str(&local_header_script(&self.render_id));
            }
            st.tasks.push_str(task);
            st.tasks.push(';');
            if !st.timer && st.first_flushed {
                st.timer = true;
                true
            } else {
                false
            }
        };
        if schedule {
            let me = self.clone();
            queue(s, move |s| {
                let me2 = me.clone();
                JsVal::Promise(queue(s, move |s| {
                    me2.write_tasks(s);
                    JsVal::Undefined
                }))
            });
        }
    }

    // Solid: server.ts (renderToStream `emitTask`)
    fn emit_task(self: &Rc<Self>, s: &mut Server, task: &str) {
        let first = !self.st.borrow().script_flushed;
        let t = if first {
            format!("{task};{REPLACE_SCRIPT}")
        } else {
            task.to_string()
        };
        self.push_task(s, &t);
        self.st.borrow_mut().script_flushed = true;
    }

    /// `buffer.write(payload)`: to `tmp` before the shell flush, then to the
    /// coalescing writer.
    fn buffer_write(self: &Rc<Self>, s: &mut Server, payload: &str) {
        let w = {
            let mut st = self.st.borrow_mut();
            if st.dead {
                return;
            }
            match &st.writable {
                Some(w) => w.clone(),
                None => {
                    st.tmp.push_str(payload);
                    return;
                }
            }
        };
        w.write(s, payload);
    }

    // Solid: server.ts (renderToStream `writeTasks`)
    fn write_tasks(self: &Rc<Self>, s: &mut Server) {
        let tasks = {
            let mut st = self.st.borrow_mut();
            let ok = !st.tasks.is_empty() && !st.completed && st.first_flushed;
            let t = if ok {
                Some(std::mem::take(&mut st.tasks))
            } else {
                None
            };
            st.timer = false;
            t
        };
        if let Some(t) = tasks {
            self.buffer_write(s, &format!("<script>{t}</script>"));
        }
    }

    // Solid: server.ts (renderToStream `handOver` and `write`; the stable
    // order is the awaited form's, not the pipe's)
    fn write(self: &Rc<Self>, s: &mut Server, id: String, value: JsVal) {
        self.st.borrow_mut().writing += 1;
        let r = self.serializer().write(s, id, value);
        self.st.borrow_mut().writing -= 1;
        if let Err(e) = r {
            s.failures.push(format!("a hydration write failed: {e}"));
        }
    }

    // Solid: server.ts (renderToStream `flushStubBatch`)
    fn flush_stub_batch(self: &Rc<Self>, s: &mut Server) {
        let entries = self.st.borrow_mut().stub_batch.take();
        if let Some(entries) = entries {
            for (id, p) in entries {
                self.write(s, id, p);
            }
        }
    }

    fn batch_stub(&self, id: String, p: JsVal) {
        let mut st = self.st.borrow_mut();
        let batch = st.stub_batch.get_or_insert_with(Vec::new);
        // A `Map`'s `set`: an existing key keeps its place.
        match batch.iter_mut().find(|(k, _)| *k == id) {
            Some(e) => e.1 = p,
            None => batch.push((id, p)),
        }
    }

    // Solid: server.ts (renderToStream `guardChannel`): a promise crosses as
    // `p.then(borderForm, verdictNow)` (`toBorderForm` keeps plain data as
    // is; a rejection crosses sanitized), once per promise; other values as
    // they are.
    fn guard_channel(self: &Rc<Self>, s: &mut Server, p: JsVal) -> JsVal {
        let JsVal::Promise(pr) = &p else {
            return p;
        };
        let k = p.identity().expect("an object");
        if let Some((_, _, g)) = self.st.borrow().guarded.iter().find(|(i, _, _)| *i == k) {
            return g.clone();
        }
        let border: Handler = Rc::new(|_, v| Ok(v));
        let verdict: Handler = Rc::new(|s, e| Err(Thrown(ssr_sanitize_error(s, &e))));
        let guarded = JsVal::Promise(then(s, pr, Some(border), Some(verdict)));
        self.st
            .borrow_mut()
            .guarded
            .push((k, p.clone(), guarded.clone()));
        guarded
    }

    // Solid: server.ts (renderToStream `trackSerialized`): raced against an
    // abandon hook, observed so a rejection is never unhandled.
    fn track_serialized(self: &Rc<Self>, s: &mut Server, id: String, p: JsVal) -> JsVal {
        let JsVal::Promise(pr) = &p else {
            unreachable!("a promise")
        };
        let hook = with_resolvers();
        let settle_hook = hook.clone();
        let raced = promise_race(s, vec![p.clone(), JsVal::Promise(hook.promise.clone())]);
        catch(s, &raced, noop());
        let settle: Rc<dyn Fn(&mut Server)> =
            Rc::new(move |s| settle_hook.resolve(s, JsVal::Undefined));
        {
            let mut st = self.st.borrow_mut();
            match st.pending_serialized.iter_mut().find(|(k, _)| *k == id) {
                Some(e) => e.1 = settle,
                None => st.pending_serialized.push((id.clone(), settle)),
            }
        }
        let (a, b) = (self.clone(), self.clone());
        let (i1, i2) = (id.clone(), id);
        then(
            s,
            pr,
            Some(Rc::new(move |_, _| Ok(JsVal::Bool(a.drop_pending(&i1))))),
            Some(Rc::new(move |_, _| Ok(JsVal::Bool(b.drop_pending(&i2))))),
        );
        JsVal::Promise(raced)
    }

    fn drop_pending(&self, id: &str) -> bool {
        let mut st = self.st.borrow_mut();
        let before = st.pending_serialized.len();
        st.pending_serialized.retain(|(k, _)| k != id);
        st.pending_serialized.len() != before
    }

    // Solid: server.ts (renderToStream context `serialize`)
    pub fn serialize(
        self: &Rc<Self>,
        s: &mut Server,
        id: String,
        p: JsVal,
        defer: bool,
    ) -> Res<()> {
        let p = self.guard_channel(s, p);
        if matches!(p, JsVal::Promise(_)) {
            if !self.st.borrow().first_flushed && defer {
                return Err(Thrown::msg("a deferStream read is not ported"));
            }
            let p = self.track_serialized(s, id.clone(), p);
            let batch = {
                let st = self.st.borrow();
                !st.first_flushed && !st.shell_completed && !st.dead
            };
            if batch {
                self.batch_stub(id, p);
                return Ok(());
            }
            self.write(s, id, p);
            return Ok(());
        }
        self.write(s, id, p);
        Ok(())
    }

    // Solid: server.ts (renderToStream `abandonSubtree`)
    fn abandon_subtree(self: &Rc<Self>, s: &mut Server, key: &str) {
        let doomed: Vec<RegistryEntry> = {
            let mut st = self.st.borrow_mut();
            let (out, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut st.registry)
                .into_iter()
                .partition(|e| e.key.len() > key.len() && e.key.starts_with(key));
            st.registry = keep;
            out
        };
        for e in doomed {
            (e.resolve)(s, None);
        }
        let settles: Vec<(String, Callback)> = {
            let mut st = self.st.borrow_mut();
            let (out, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut st.pending_serialized)
                .into_iter()
                .partition(|(id, _)| id.starts_with(key));
            st.pending_serialized = keep;
            out
        };
        let mut unregister = vec![];
        for (id, settle) in settles {
            settle(s);
            let in_batch = {
                let mut st = self.st.borrow_mut();
                match &mut st.stub_batch {
                    Some(b) => {
                        let n = b.len();
                        b.retain(|(k, _)| *k != id);
                        b.len() != n
                    }
                    None => false,
                }
            };
            if !in_batch {
                unregister.push(format!(
                    "delete _$HY.r[{}]",
                    serde_json::to_string(&id).expect("a string")
                ));
            }
        }
        if !unregister.is_empty() {
            self.push_task(s, &unregister.join(";"));
        }
    }

    pub fn set_fragment_owner(&self, id: &str, owner: usize) {
        let mut st = self.st.borrow_mut();
        match st.fragment_owners.iter_mut().find(|(k, _)| k == id) {
            Some(e) => e.1 = owner,
            None => st.fragment_owners.push((id.to_string(), owner)),
        }
    }

    pub fn fragment_owner(&self, id: &str) -> Option<usize> {
        self.st
            .borrow()
            .fragment_owners
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, v)| *v)
    }

    pub fn remove_fragment_owner(&self, id: &str) {
        self.st
            .borrow_mut()
            .fragment_owners
            .retain(|(k, _)| k != id);
    }

    // Solid: server.ts (renderToStream context `registerFragment`), without
    // reveal groups: a `<key>_fr` promise the client waits on (batched into
    // the shell before it flushes), and the settle function.
    pub fn register_fragment(self: &Rc<Self>, s: &mut Server, key: String) -> Settle {
        let has = self.st.borrow().registry.iter().any(|e| e.key == key);
        if !has {
            let r = with_resolvers();
            // `defuse(p)`
            then(s, &r.promise, None, Some(noop()));
            let p = JsVal::Promise(r.promise.clone());
            let me = self.clone();
            let resolve: FragmentResolve = Rc::new(move |s, err| {
                let (r, me) = (r.clone(), me.clone());
                queue(s, move |s| {
                    let (r, me) = (r.clone(), me.clone());
                    let err = err.clone();
                    JsVal::Promise(queue(s, move |s| {
                        match &err {
                            Some(e) => {
                                let wire = ssr_sanitize_error(s, e);
                                r.reject(s, wire);
                            }
                            None => r.resolve(s, JsVal::Bool(true)),
                        }
                        let me = me.clone();
                        queue(s, move |s| {
                            me.flush_end(s);
                            JsVal::Undefined
                        });
                        JsVal::Undefined
                    }))
                });
            });
            self.st.borrow_mut().registry.push(RegistryEntry {
                key: key.clone(),
                resolve,
                children: None,
            });
            let batch = {
                let st = self.st.borrow();
                !st.shell_completed && !st.dead
            };
            if batch {
                self.batch_stub(format!("{key}_fr"), p);
            } else {
                self.write(s, format!("{key}_fr"), p);
            }
        }
        let me = self.clone();
        Rc::new(move |s, value, error| me.settle_fragment(s, &key, value, error))
    }

    fn settle_fragment(
        self: &Rc<Self>,
        s: &mut Server,
        key: &str,
        value: Option<String>,
        error: Option<JsVal>,
    ) -> bool {
        let item = {
            let mut st = self.st.borrow_mut();
            match st.registry.iter().position(|e| e.key == key) {
                Some(i) => Some(st.registry.remove(i)),
                None => None,
            }
        };
        let Some(item) = item else {
            return self.st.borrow().first_flushed;
        };
        if error.is_some() {
            self.abandon_subtree(s, key);
        }
        let mut value = value;
        if let (Some(children), None) = (&item.children, &error) {
            for (k, v) in children {
                // `replacePlaceholder(value, k, …)` on `undefined` would throw;
                // a fragment with children always has content.
                if let Some(cur) = &value {
                    value = Some(replace_placeholder(cur, k, v));
                }
            }
        }
        // `waitForFragments`: the newest pending fragment whose key prefixes
        // this one.
        let parent_key = {
            let st = self.st.borrow();
            st.registry
                .iter()
                .rev()
                .find(|e| key.starts_with(&e.key))
                .map(|e| e.key.clone())
        };
        if let Some(pk) = parent_key {
            {
                let mut st = self.st.borrow_mut();
                let parent = st.registry.iter_mut().find(|e| e.key == pk).expect("found");
                let children = parent.children.get_or_insert_with(Vec::new);
                let v = value.clone().unwrap_or_default();
                match children.iter_mut().find(|(k, _)| k == key) {
                    Some(e) => e.1 = v,
                    None => children.push((key.to_string(), v)),
                }
            }
            (item.resolve)(s, None);
            // `return;`: undefined.
            return false;
        }
        let (completed, first_flushed) = {
            let st = self.st.borrow();
            (st.completed, st.first_flushed)
        };
        if !completed {
            if !first_flushed {
                let me = self.clone();
                let k = key.to_string();
                let v = value.clone().unwrap_or_default();
                queue(s, move |_| {
                    // `inlineFragment`: no root holes, so straight into the
                    // HTML.
                    let mut st = me.st.borrow_mut();
                    st.html = replace_placeholder(&st.html, &k, &v);
                    JsVal::Undefined
                });
                (item.resolve)(s, error);
            } else {
                let wire = error.as_ref().map(|e| ssr_sanitize_error(s, e));
                let content = match (&value, &error) {
                    (Some(v), _) => v.clone(),
                    (None, Some(_)) => String::new(),
                    (None, None) => " ".into(),
                };
                // `sink.fragment` with no styles and no reveal group.
                let tpl = format!(
                    "<template id=\"{key}\"{}>{content}</template>",
                    if wire.is_some() { " e" } else { "" }
                );
                self.buffer_write(s, &tpl);
                self.emit_task(s, &format!("$df(\"{key}\")"));
                (item.resolve)(s, error);
            }
        }
        self.st.borrow().first_flushed
    }

    // Solid: server.ts (renderToStream `flushEnd`)
    fn flush_end(self: &Rc<Self>, s: &mut Server) {
        if !self.st.borrow().registry.is_empty() {
            return;
        }
        // `serializeRootAssets()`: no root modules.
        let me = self.clone();
        queue(s, move |s| {
            let me = me.clone();
            JsVal::Promise(queue(s, move |s| {
                // The document face's live-hole latch (frames, server.ts:
                // 2602-2610): the channel closes before the serializer
                // flushes. Unset outside frames documents.
                let end = me.live_end.borrow_mut().take();
                if let Some(end) = end {
                    end(s);
                }
                me.flush_stub_batch(s);
                me.serializer().flush(s);
                JsVal::Undefined
            }))
        });
    }

    // Solid: server.ts (renderToStream `onDone`)
    fn on_done(self: &Rc<Self>, s: &mut Server) {
        if self.st.borrow().dead {
            return;
        }
        self.write_tasks(s);
        self.st.borrow_mut().last_blocking_size = 0;
        self.do_shell(s);
        let w = self.st.borrow().writable.clone();
        if let Some(w) = w {
            w.end();
        }
        let first = {
            let mut st = self.st.borrow_mut();
            st.completed = true;
            st.first_flushed
        };
        if first {
            self.dispose(s);
        }
    }

    fn dispose(self: &Rc<Self>, s: &mut Server) {
        let root = {
            let mut st = self.st.borrow_mut();
            if st.root_disposed {
                return;
            }
            st.root_disposed = true;
            st.root
        };
        if let Some(root) = root {
            if let Err(e) = s.dispose_owner(root, true) {
                s.failures.push(format!("a cleanup threw: {e}"));
            }
        }
    }

    // Solid: server.ts (renderToStream `doShell`), with no root holes and an
    // empty head: the shell is the HTML and the tasks so far in one script.
    fn do_shell(self: &Rc<Self>, s: &mut Server) {
        if self.st.borrow().shell_completed {
            return;
        }
        // `blockingPromises` stays empty (no root holes, no deferStream).
        if self.st.borrow().last_blocking_size != 0 {
            return;
        }
        self.flush_stub_batch(s);
        let shell = {
            let mut st = self.st.borrow_mut();
            let tasks = std::mem::take(&mut st.tasks);
            if tasks.is_empty() {
                st.html.clone()
            } else {
                format!("{}<script>{tasks}</script>", st.html)
            }
        };
        self.buffer_write(s, &shell);
        self.st.borrow_mut().shell_completed = true;
    }

    // Solid: server.ts (renderToStream `failRender` and `abandon`): the
    // render fails, the root is disposed, the serializer closed, and the sink
    // ended (after what it buffered, once the shell went out).
    pub fn fail_render(self: &Rc<Self>, s: &mut Server, err: Thrown) {
        // `reportFailure`: with no hook, `console.error(err)`.
        s.render_errors.push(err.to_string());
        let w = {
            let mut st = self.st.borrow_mut();
            if st.dead {
                return;
            }
            st.dead = true;
            st.completed = true;
            st.writable.take()
        };
        self.dispose(s);
        self.serializer().close(s);
        self.st.borrow_mut().stub_batch = None;
        match w {
            Some(w) => w.end(),
            None => {
                let mut o = self.out.borrow_mut();
                o.events.push(StreamEvent::End);
                o.ended = true;
            }
        }
    }

    // Solid: server.ts (renderToStream `scheduleFlush`)
    fn schedule_flush(self: &Rc<Self>, s: &mut Server, awaited: i64) {
        let progressed = {
            let mut st = self.st.borrow_mut();
            let p = awaited != st.last_blocking_size;
            st.last_blocking_size = awaited;
            st.last_registry_size = -1;
            st.drain_turn = 0;
            st.graced = false;
            p
        };
        if !progressed {
            s.failures
                .push("scheduleFlush's no-progress retry (setTimeout) is not ported".into());
            return;
        }
        let me = self.clone();
        queue(s, move |s| {
            me.attempt(s);
            JsVal::Undefined
        });
    }

    fn attempt(self: &Rc<Self>, s: &mut Server) {
        self.flush_stub_batch(s);
        enum Next {
            Queue,
            Grace,
            Run,
        }
        let next = {
            let mut st = self.st.borrow_mut();
            let size = st.registry.len() as i64;
            let changed = size != st.last_registry_size;
            let turn = if changed {
                true
            } else {
                let t = st.drain_turn;
                st.drain_turn += 1;
                t < MIN_DRAIN_TURNS
            };
            if changed || turn {
                if changed {
                    st.drain_turn = 0;
                }
                st.last_registry_size = size;
                Next::Queue
            } else if !st.graced && size > 0 {
                st.graced = true;
                st.last_registry_size = -1;
                st.drain_turn = 0;
                Next::Grace
            } else {
                Next::Run
            }
        };
        match next {
            Next::Queue => {
                let me = self.clone();
                queue(s, move |s| {
                    me.attempt(s);
                    JsVal::Undefined
                });
            }
            Next::Grace => {
                let me = self.clone();
                s.set_immediate(Box::new(move |s| me.attempt(s)));
            }
            Next::Run => self.pipe_flushed(s),
        }
    }

    // Solid: server.ts (renderToStream `pipe`'s flush continuation)
    fn pipe_flushed(self: &Rc<Self>, s: &mut Server) {
        if self.st.borrow().dead {
            return;
        }
        self.do_shell(s);
        if !self.st.borrow().shell_completed {
            return self.pipe_flush(s);
        }
        let w = Rc::new(Coalesce {
            buf: RefCell::new(String::new()),
            scheduled: Cell::new(false),
            out: self.out.clone(),
        });
        let tmp = {
            let mut st = self.st.borrow_mut();
            st.writable = Some(w.clone());
            std::mem::take(&mut st.tmp)
        };
        w.write(s, &tmp);
        w.flush();
        let completed = {
            let mut st = self.st.borrow_mut();
            st.first_flushed = true;
            st.completed
        };
        if completed {
            self.dispose(s);
            w.end();
        } else {
            self.flush_end(s);
        }
    }

    // Solid: server.ts (renderToStream `pipe`'s `flush`): `allSettled(
    // blockingPromises).then(awaited => scheduleFlush(…, awaited))`.
    fn pipe_flush(self: &Rc<Self>, s: &mut Server) {
        // `allSettled`: `Promise.allSettled(set).then(() => size)` over the
        // (empty) blocking set.
        let all = promise_all_settled(s, vec![]);
        let p = then(s, &all, Some(Rc::new(|_, _| Ok(JsVal::Num(0)))), None);
        let me = self.clone();
        then(
            s,
            &p,
            Some(Rc::new(move |s, awaited| {
                let n = match awaited {
                    JsVal::Num(n) => n,
                    _ => 0,
                };
                me.schedule_flush(s, n);
                Ok(JsVal::Undefined)
            })),
            None,
        );
    }
}

/// The output of a streamed render: the sink's events, and the failures the
/// render met (a render error with no boundary, a value that failed to
/// serialize, a path that is not ported).
pub struct StreamResult {
    pub out: Rc<RefCell<StreamOut>>,
}

// Solid: server.ts:2068-3725 (`renderToStream`) and its `pipe` (for a render
// with no request event, no nonce, no manifest, no options): the context,
// the serializer (whose data become tasks), the root render, then `pipe`
// to a collecting sink. The caller drives the event loop.
pub fn render_to_stream(
    s: &mut Server,
    code: impl FnOnce(&mut Server) -> Res<JsVal>,
) -> Res<Rc<RefCell<StreamOut>>> {
    let out = Rc::new(RefCell::new(StreamOut::default()));
    let render = Rc::new(StreamRender {
        st: RefCell::new(St {
            dead: false,
            completed: false,
            first_flushed: false,
            shell_completed: false,
            script_flushed: false,
            header_emitted: false,
            timer: false,
            tasks: String::new(),
            tmp: String::new(),
            html: String::new(),
            writable: None,
            stub_batch: None,
            writing: 0,
            registry: vec![],
            pending_serialized: vec![],
            guarded: vec![],
            last_blocking_size: -1,
            last_registry_size: -1,
            drain_turn: 0,
            graced: false,
            fragment_owners: vec![],
            root: None,
            root_disposed: false,
        }),
        serializer: RefCell::new(None),
        out: out.clone(),
        render_id: String::new(),
        live_armed: Cell::new(false),
        live_end: RefCell::new(None),
        edges: Cell::new(false),
    });
    let (r1, r2) = (render.clone(), render.clone());
    let serializer = HydrationSerializer::new(
        None,
        Rc::new(move |s, payload| r1.push_task(s, &payload)),
        Some(Rc::new(move |s| r2.on_done(s))),
        true,
    );
    *render.serializer.borrow_mut() = Some(serializer);
    s.ctx = Some(RenderCtx::new(CtxKind::Stream(render.clone()), None));
    let r3 = render.clone();
    let html = s.create_root(Some(String::new()), move |s, owner| {
        r3.st.borrow_mut().root = Some(owner);
        // `claimRenderRoot`
        s.on_cleanup(Rc::new(|_| {}));
        let v = code(s)?;
        let res = resolve_fresh(s, &escape(&v))?;
        if !res.h.borrow().is_empty() {
            return Err(Thrown::msg(
                "an async read outside every <Loading> (a root hole) is not ported",
            ));
        }
        let t = res.t.borrow()[0].clone();
        Ok(JsVal::str(&t))
    })?;
    let JsVal::Str(html) = html else {
        unreachable!("a string")
    };
    if html.contains("</head>") || html.contains("<!--xs-->") {
        return Err(Thrown::msg(
            "a document shell (</head>, <!--xs-->) is not ported",
        ));
    }
    render.st.borrow_mut().html = html.to_string();
    render.pipe_flush(s);
    Ok(out)
}
