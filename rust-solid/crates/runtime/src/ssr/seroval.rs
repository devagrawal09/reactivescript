//! The serializer Solid 2's web package uses for hydration data: seroval
//! 1.7.0's `crossSerializeStream` (cross-reference mode, streaming parse),
//! as `createHydrationSerializer` (serializer.ts) drives it. A structural
//! port of the parts a plan app's data reaches, read from seroval's
//! `dist/index.js` (the file Solid loads; `seroval …` line numbers are
//! that file's):
//!
//! - the stream parser (`startStreamParse`, `parseSOS`, `parseObject`,
//!   `parseEvent`, `drainOutput`, `checkStreamParse`, `stopStreamParse`,
//!   the pending-state counter) and its promise watch (`parsePromise`,
//!   `watchPromise`, `handlePromise`, `wrapPromiseResult`);
//! - the nodes of the values a plan app serializes: constants, integers,
//!   strings, arrays, plain records, `Error`s (Solid's sanitized wire
//!   errors), promises, and the special references (the promise
//!   constructor, success and failure functions);
//! - the cross serializer (`serializeTopCross`, `serialize$1` for those
//!   nodes, `assignIndexedValue`, the assignment chains).
//!
//! Not ported (no plan value reaches them; each is refused with an error,
//! which fails the write as seroval's `SerovalUnsupportedTypeError` would):
//! maps, sets, dates, regular expressions, typed arrays and buffers, boxed
//! primitives, symbols, iterables and async iterables, seroval streams,
//! plugins (Solid's web plugins test every object; none matches plain
//! data, so the test is skipped), `-0`, `NaN`, the infinities, bigints and
//! the vanilla (non-cross) mode. The parser's and serializer's `marked`
//! sets are not kept: in cross mode `assignAll` makes every index an
//! assignment, so nothing reads them.
use super::js::{then, Handler};
use super::value::{ErrClass, JsVal, Res, Thrown};
use super::Server;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    rc::Rc,
};

// seroval index.js:672-693 (`PROMISE_CONSTRUCTOR`, `PROMISE_SUCCESS`,
// `PROMISE_FAILURE`): their `toString()`, which the special references
// serialize as.
const SERIALIZED_PROMISE_CONSTRUCTOR: &str = "() => {\n\tconst resolver = {\n\t\tp: 0,\n\t\ts: 0,\n\t\tf: 0\n\t};\n\tresolver.p = new Promise((resolve, reject) => {\n\t\tresolver.s = resolve;\n\t\tresolver.f = reject;\n\t});\n\treturn resolver;\n}";
const SERIALIZED_PROMISE_SUCCESS: &str =
    "(resolver, data) => {\n\tresolver.s(data);\n\tresolver.p.s = 1;\n\tresolver.p.v = data;\n}";
const SERIALIZED_PROMISE_FAILURE: &str =
    "(resolver, data) => {\n\tresolver.f(data);\n\tresolver.p.s = 2;\n\tresolver.p.v = data;\n}";

/// A seroval node (seroval `createSerovalNode`), the kinds a plan app's data
/// produces.
#[derive(Clone, Debug)]
pub enum Node {
    /// t 2: `CONSTANT_STRING[s]`.
    Constant(&'static str),
    /// t 0.
    Number(i64),
    /// t 1: the escaped string.
    Str(String),
    /// t 4: a reference to an indexed value.
    Indexed(usize),
    /// t 9.
    Array { i: usize, items: Vec<Node> },
    /// t 10: a plain object (keys already escaped).
    Object {
        i: usize,
        keys: Vec<String>,
        values: Vec<Node>,
    },
    /// t 13: an error: its constructor's name and escaped message; its
    /// options record (`getErrorOptions`) is empty for the errors here.
    Error {
        i: usize,
        ctor: &'static str,
        message: String,
    },
    /// t 22: `($R[i]=(factory)()).p`.
    PromiseConstructor {
        i: usize,
        resolver: usize,
        factory: Box<Node>,
    },
    /// t 26: a special reference (1 constructor, 2 success, 3 failure).
    Special { i: usize, s: u8 },
    /// t 23 (success) and 24 (failure): `factory(resolver, value)`.
    PromiseResult {
        i: usize,
        factory: Box<Node>,
        value: Box<Node>,
    },
}

impl Node {
    fn id(&self) -> Option<usize> {
        match self {
            Node::Array { i, .. }
            | Node::Object { i, .. }
            | Node::Error { i, .. }
            | Node::PromiseConstructor { i, .. }
            | Node::Special { i, .. }
            | Node::PromiseResult { i, .. }
            | Node::Indexed(i) => Some(*i),
            _ => None,
        }
    }
}

/// The `refs` map a hydration serializer shares between its writes
/// (serializer.ts:334-355), with `rejectUnserializedKey`'s `size` (every
/// index ever taken, serializer.ts:386-395): the next index is `taken`.
#[derive(Default)]
pub struct Refs {
    by_identity: HashMap<usize, (usize, JsVal)>,
    special: [Option<usize>; 6],
    taken: usize,
}

impl Refs {
    // seroval index.js:1208-1212 (`createIndexForValue`)
    fn create_index(&mut self, value: Option<JsVal>) -> usize {
        let id = self.taken;
        self.taken += 1;
        if let Some(v) = value {
            if let Some(k) = v.identity() {
                self.by_identity.insert(k, (id, v));
            }
        }
        id
    }

    // seroval index.js:1213-1226 (`getNodeForIndexedValue`, `getReferenceNode`:
    // no value here has a `createReference` id)
    fn node_for(&mut self, value: &JsVal) -> Result<Node, usize> {
        let k = value.identity().expect("an object");
        if let Some((id, _)) = self.by_identity.get(&k) {
            return Ok(Node::Indexed(*id));
        }
        Err(self.create_index(Some(value.clone())))
    }

    // seroval index.js:1236-1240 (`parseSpecialReference`)
    fn special(&mut self, r: u8) -> Node {
        if let Some(id) = self.special[r as usize] {
            return Node::Indexed(id);
        }
        let id = self.create_index(None);
        self.special[r as usize] = Some(id);
        Node::Special { i: id, s: r }
    }
}

/// seroval index.js:146-188 (`serializeString`): the escapes that keep a
/// string safe in a `<script>` (`"`, `\`, line breaks, `<`, U+2028/9).
pub fn serialize_string(s: &str) -> String {
    let needs = s.chars().any(|c| {
        matches!(
            c,
            '"' | '\\' | '\n' | '\r' | '\u{8}' | '\t' | '\u{c}' | '<' | '\u{2028}' | '\u{2029}'
        )
    });
    if !needs {
        return s.to_string();
    }
    // The JSON.stringify path (64 chars and more, no other control
    // character or lone surrogate) gives the same escapes for the
    // characters above.
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
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

/// A record of the parser's output queue (seroval index.js:3165-3181).
struct Record {
    node: Option<Node>,
    initial: bool,
}

struct ParseState {
    alive: bool,
    pending: i64,
    parsing: i64,
    queue: VecDeque<Record>,
    writing: bool,
}

pub type OnSerialize = Rc<dyn Fn(&mut Server, String, bool)>;
pub type OnDone = Rc<dyn Fn(&mut Server)>;

/// One `crossSerializeStream` session: a stream parser context
/// (`createStreamParserContext`, seroval index.js:3111-3138) and its
/// serializer callback.
pub struct StreamParse {
    refs: Rc<RefCell<Refs>>,
    scope_id: Option<String>,
    state: RefCell<ParseState>,
    on_serialize: RefCell<Option<OnSerialize>>,
    on_done: RefCell<Option<OnDone>>,
}

// seroval index.js:3395-3419 (`crossSerializeStream`): parse the source,
// serialize every record as it is queued, and call `onDone` when nothing is
// pending. Returns the session (its `destroyStreamParse`).
pub fn cross_serialize_stream(
    s: &mut Server,
    source: JsVal,
    refs: Rc<RefCell<Refs>>,
    scope_id: Option<String>,
    on_serialize: OnSerialize,
    on_done: OnDone,
) -> Res<Rc<StreamParse>> {
    let ctx = Rc::new(StreamParse {
        refs,
        scope_id,
        state: RefCell::new(ParseState {
            alive: true,
            pending: 0,
            parsing: 0,
            queue: VecDeque::new(),
            writing: false,
        }),
        on_serialize: RefCell::new(Some(on_serialize)),
        on_done: RefCell::new(Some(on_done)),
    });
    start_stream_parse(s, &ctx, source)?;
    Ok(ctx)
}

// seroval index.js:3244-3268 (`startStreamParse`)
fn start_stream_parse(s: &mut Server, ctx: &Rc<StreamParse>, current: JsVal) -> Res<()> {
    ctx.state.borrow_mut().parsing += 1;
    let parsed = parse_sos(s, ctx, current);
    ctx.state.borrow_mut().parsing -= 1;
    let parsed = parsed?;
    if ctx.state.borrow().alive {
        ctx.state.borrow_mut().queue.push_front(Record {
            node: Some(parsed),
            initial: true,
        });
        drain_output(s, ctx);
    }
    Ok(())
}

// seroval index.js:2893-2911 (`parseSOS`)
fn parse_sos(s: &mut Server, ctx: &Rc<StreamParse>, current: JsVal) -> Res<Node> {
    Ok(match &current {
        JsVal::Bool(true) => Node::Constant("!0"),
        JsVal::Bool(false) => Node::Constant("!1"),
        JsVal::Undefined => Node::Constant("void 0"),
        JsVal::Null => Node::Constant("null"),
        JsVal::Str(v) => Node::Str(serialize_string(v)),
        JsVal::Num(n) => Node::Number(*n),
        JsVal::Arr(_) | JsVal::Rec(_) | JsVal::Promise(_) | JsVal::Error(_) => {
            let id = ctx.refs.borrow_mut().node_for(&current);
            match id {
                Ok(indexed) => indexed,
                Err(id) => parse_object(s, ctx, id, current)?,
            }
        }
        other => {
            return Err(Thrown::msg(format!(
                "Seroval Error (specific: 1): {other:?} is not serializable here"
            )))
        }
    })
}

// seroval index.js:2876-2885 (`parseObject`) and 2855-2875
// (`parseObjectPhase2`), for arrays, plain objects, errors and promises.
fn parse_object(s: &mut Server, ctx: &Rc<StreamParse>, id: usize, current: JsVal) -> Res<Node> {
    match &current {
        // seroval index.js:2744-2753 (`parseItems`, `parseArray`)
        JsVal::Arr(a) => {
            let items = a.borrow().clone();
            let mut nodes = vec![];
            for x in items {
                nodes.push(parse_sos(s, ctx, x)?);
            }
            Ok(Node::Array {
                i: id,
                items: nodes,
            })
        }
        // seroval index.js:2754-2793 (`parseProperties`, `parsePlainObject`)
        JsVal::Rec(r) => {
            let fields = r.borrow().clone();
            let mut keys = vec![];
            let mut values = vec![];
            for (k, v) in fields {
                keys.push(serialize_string(&k));
                values.push(parse_sos(s, ctx, v)?);
            }
            Ok(Node::Object {
                i: id,
                keys,
                values,
            })
        }
        // seroval index.js:2801-2804 (`parseError`): the options record is
        // empty (the name is the constructor's; `stack` is a disabled
        // feature outside development builds; `message` is the node's).
        JsVal::Error(e) => {
            let ctor = match e.class {
                ErrClass::TypeError => "TypeError",
                ErrClass::Error => "Error",
                ErrClass::NotReady => {
                    return Err(Thrown::msg(
                        "serializing a NotReadyError (its name and source) is not ported",
                    ))
                }
            };
            Ok(Node::Error {
                i: id,
                ctor,
                message: serialize_string(&e.message),
            })
        }
        // seroval index.js:2834-2839 (`parsePromise`), 3064-3067
        // (`watchPromise`)
        JsVal::Promise(p) => {
            let resolver = ctx.refs.borrow_mut().create_index(None);
            push_pending_state(ctx);
            let (a, b) = (ctx.clone(), ctx.clone());
            let on_f: Handler = Rc::new(move |s, data| {
                handle_promise(s, &a, true, resolver, data);
                Ok(JsVal::Undefined)
            });
            let on_r: Handler = Rc::new(move |s, data| {
                handle_promise(s, &b, false, resolver, data);
                Ok(JsVal::Undefined)
            });
            then(s, p, Some(on_f), Some(on_r));
            let factory = ctx.refs.borrow_mut().special(1);
            Ok(Node::PromiseConstructor {
                i: id,
                resolver,
                factory: Box::new(factory),
            })
        }
        _ => unreachable!("parse_sos sends objects only"),
    }
}

// seroval index.js:3060-3063 (`handlePromise`)
fn handle_promise(s: &mut Server, ctx: &Rc<StreamParse>, success: bool, id: usize, data: JsVal) {
    if ctx.state.borrow().alive {
        parse_event(s, ctx, data, success, id);
    }
    pop_pending_state(s, ctx);
}

// seroval index.js:3154-3175 (`parseEvent`) with `wrapPromiseResult`
// (3057-3059): the record is queued before the value is parsed, and the
// special reference is taken after it.
fn parse_event(s: &mut Server, ctx: &Rc<StreamParse>, value: JsVal, success: bool, id: usize) {
    let index = {
        let mut st = ctx.state.borrow_mut();
        st.queue.push_back(Record {
            node: None,
            initial: false,
        });
        st.parsing += 1;
        st.queue.len() - 1
    };
    let parsed = parse_sos(s, ctx, value).map(|node| {
        let factory = ctx.refs.borrow_mut().special(if success { 2 } else { 3 });
        Node::PromiseResult {
            i: id,
            factory: Box::new(factory),
            value: Box::new(node),
        }
    });
    ctx.state.borrow_mut().parsing -= 1;
    match parsed {
        Ok(node) => {
            // The queue only grows at its back while this record waits; the
            // record is still at `index` (drainOutput does not run while
            // `parsing > 0`).
            ctx.state.borrow_mut().queue[index].node = Some(node);
            drain_output(s, ctx);
        }
        Err(e) => stop_stream_parse(s, ctx, Some(e)),
    }
}

// seroval index.js:3139-3147 (`pushPendingState`, `popPendingState`)
fn push_pending_state(ctx: &Rc<StreamParse>) {
    let mut st = ctx.state.borrow_mut();
    if st.alive {
        st.pending += 1;
    }
}

fn pop_pending_state(s: &mut Server, ctx: &Rc<StreamParse>) {
    if ctx.state.borrow().alive {
        ctx.state.borrow_mut().pending -= 1;
        check_stream_parse(s, ctx);
    }
}

// seroval index.js:3181-3239 (`drainOutput`): records are emitted one at a
// time; `onSerialize` returns nothing here, so no record waits.
fn drain_output(s: &mut Server, ctx: &Rc<StreamParse>) {
    {
        let st = ctx.state.borrow();
        if st.writing || st.parsing > 0 {
            return;
        }
    }
    loop {
        let record = {
            let mut st = ctx.state.borrow_mut();
            if !st.alive || st.queue.is_empty() {
                break;
            }
            st.queue.pop_front().expect("non-empty")
        };
        let Some(node) = record.node else {
            continue;
        };
        {
            let mut st = ctx.state.borrow_mut();
            st.writing = true;
            st.parsing += 1;
        }
        let on_serialize = ctx.on_serialize.borrow().clone();
        // `onParse` (crossSerializeStream): `serializeTopCross`, then
        // `onSerialize`.
        if let Some(f) = on_serialize {
            let text = serialize_top_cross(&node, ctx.scope_id.as_deref());
            f(s, text, record.initial);
        }
        let mut st = ctx.state.borrow_mut();
        st.parsing -= 1;
        if !st.alive {
            return;
        }
        st.writing = false;
    }
    check_stream_parse(s, ctx);
}

// seroval index.js:3240-3243 (`checkStreamParse`)
fn check_stream_parse(s: &mut Server, ctx: &Rc<StreamParse>) {
    let done = {
        let st = ctx.state.borrow();
        st.alive && st.parsing == 0 && st.pending <= 0 && st.queue.is_empty() && !st.writing
    };
    if done {
        stop_stream_parse(s, ctx, None);
    }
}

// seroval index.js:3300-3333 (`stopStreamParse`): ends the parse once,
// `onDone` on success. A failure has no `onError` to go to here: the
// serializer's failure path (`rejectUnserializedKey`) is not ported, so it
// is reported as a render error by the caller.
fn stop_stream_parse(s: &mut Server, ctx: &Rc<StreamParse>, failure: Option<Thrown>) {
    if !ctx.state.borrow().alive {
        return;
    }
    {
        let mut st = ctx.state.borrow_mut();
        st.alive = false;
        st.writing = false;
        st.queue.clear();
        st.pending = 0;
    }
    ctx.on_serialize.borrow_mut().take();
    let on_done = ctx.on_done.borrow_mut().take();
    match failure {
        None => {
            if let Some(f) = on_done {
                f(s);
            }
        }
        Some(e) => s
            .failures
            .push(format!("a hydration value failed to serialize: {e}")),
    }
}

/// `destroyStreamParse` (seroval index.js:3334-3336): mode 2, no callback.
pub fn destroy_stream_parse(ctx: &Rc<StreamParse>) {
    let mut st = ctx.state.borrow_mut();
    if st.alive {
        st.alive = false;
        st.queue.clear();
        st.pending = 0;
        drop(st);
        ctx.on_serialize.borrow_mut().take();
        ctx.on_done.borrow_mut().take();
    }
}

impl StreamParse {
    pub fn alive(&self) -> bool {
        self.state.borrow().alive
    }
}

// ---- the cross serializer (seroval index.js:2008-2736) ----

struct Ser<'a> {
    stack: Vec<usize>,
    assignments: Vec<(String, String)>,
    _scope: Option<&'a str>,
}

// seroval index.js:2112-2114 (`getCrossRefParam`)
fn ref_param(id: usize) -> String {
    format!("$R[{id}]")
}

// seroval index.js:2248-2261 (`assignIndexedValue`): cross mode assigns every
// index (`assignAll`).
fn assign_indexed_value(index: usize, value: &str) -> String {
    format!("{}={value}", ref_param(index))
}

// seroval index.js:2214-2222 (`getKeyKind`)
fn key_kind(key: &str) -> u8 {
    let first = key.as_bytes().first().copied().unwrap_or(0);
    if first.is_ascii_digit() {
        return match key.parse::<u64>() {
            Ok(n) if n.to_string() == key => 2,
            _ => 0,
        };
    }
    if key == "Infinity" {
        return 2;
    }
    if is_valid_identifier(key) {
        1
    } else {
        0
    }
}

// seroval index.js:1999-2006 (`isValidIdentifier`)
fn is_valid_identifier(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().enumerate().all(|(i, c)| {
            c.is_ascii_lowercase()
                || c.is_ascii_uppercase()
                || (c.is_ascii_digit() && i > 0)
                || c == b'_'
                || c == b'$'
        })
}

impl Ser<'_> {
    // seroval index.js:2223-2225 (`isIndexedValueInStack`)
    fn in_stack(&self, node: &Node) -> bool {
        matches!(node, Node::Indexed(i) if self.stack.contains(i))
    }

    // seroval index.js:2265-2275 (`serializeArrayItem`)
    fn array_item(&mut self, id: usize, item: &Node, index: usize) -> String {
        if self.in_stack(item) {
            let r = ref_param(item.id().expect("indexed"));
            self.assignments
                .push((format!("{}[{index}]", ref_param(id)), r));
            return String::new();
        }
        self.serialize(item)
    }

    // seroval index.js:2276-2294 (`serializeArray`)
    fn array(&mut self, id: usize, items: &[Node]) -> String {
        if items.is_empty() {
            return "[]".into();
        }
        self.stack.push(id);
        let mut values = self.array_item(id, &items[0], 0);
        let mut holey = values.is_empty();
        for (i, item) in items.iter().enumerate().skip(1) {
            let v = self.array_item(id, item, i);
            values.push(',');
            values.push_str(&v);
            holey = v.is_empty();
        }
        self.stack.pop();
        format!("[{values}{}", if holey { ",]" } else { "]" })
    }

    // seroval index.js:2295-2309 (`serializeProperty`)
    fn property(&mut self, source: usize, key: &str, val: &Node) -> String {
        let kind = key_kind(key);
        if self.in_stack(val) {
            let r = ref_param(val.id().expect("indexed"));
            let target = if kind == 1 {
                format!("{}.{key}", ref_param(source))
            } else if kind == 2 {
                format!("{}[{key}]", ref_param(source))
            } else {
                format!("{}[\"{key}\"]", ref_param(source))
            };
            self.assignments.push((target, r));
            return String::new();
        }
        if key != "__proto__" {
            let k = if kind == 0 {
                format!("\"{key}\"")
            } else {
                key.to_string()
            };
            return format!("{k}:{}", self.serialize(val));
        }
        format!("[\"{key}\"]:{}", self.serialize(val))
    }

    // seroval index.js:2310-2325 (`serializeProperties`)
    fn properties(&mut self, source: usize, keys: &[String], values: &[Node]) -> String {
        if keys.is_empty() {
            return "{}".into();
        }
        self.stack.push(source);
        let mut result = self.property(source, &keys[0], &values[0]);
        for i in 1..keys.len() {
            let item = self.property(source, &keys[i], &values[i]);
            if !item.is_empty() && !result.is_empty() {
                result.push(',');
            }
            result.push_str(&item);
        }
        self.stack.pop();
        format!("{{{result}}}")
    }

    // seroval index.js:2539-2542 (`getConstructor`)
    fn constructor(&mut self, node: &Node) -> String {
        let current = self.serialize(node);
        match node {
            Node::Indexed(_) => current,
            _ => format!("({current})"),
        }
    }

    // seroval index.js:2657-2676 (`serialize$1`) and 2630-2656
    // (`serializeAssignable`)
    fn serialize(&mut self, node: &Node) -> String {
        match node {
            Node::Constant(c) => c.to_string(),
            Node::Number(n) => n.to_string(),
            Node::Str(v) => format!("\"{v}\""),
            Node::Indexed(i) => ref_param(*i),
            // seroval index.js:2547-2550 (`serializePromiseResult`)
            Node::PromiseResult { i, factory, value } => {
                let f = self.constructor(factory);
                format!("{f}({},{})", ref_param(*i), self.serialize(value))
            }
            Node::Array { i, items } => {
                let v = self.array(*i, items);
                assign_indexed_value(*i, &v)
            }
            // seroval index.js:2326-2329 (`serializeObject`)
            Node::Object { i, keys, values } => {
                let v = self.properties(*i, keys, values);
                assign_indexed_value(*i, &v)
            }
            // seroval index.js:2516-2518 (`serializeError`) and 2373-2384
            // (`serializeDictionary` with `Object.assign`: no fields).
            Node::Error { i, ctor, message } => {
                assign_indexed_value(*i, &format!("new {ctor}(\"{message}\")"))
            }
            // seroval index.js:2543-2546 (`serializePromiseConstructor`)
            Node::PromiseConstructor {
                i,
                resolver,
                factory,
            } => {
                let inner = assign_indexed_value(*resolver, &(self.constructor(factory) + "()"));
                assign_indexed_value(*i, &format!("({inner}).p"))
            }
            Node::Special { i, s } => {
                let text = match s {
                    1 => SERIALIZED_PROMISE_CONSTRUCTOR,
                    2 => SERIALIZED_PROMISE_SUCCESS,
                    _ => SERIALIZED_PROMISE_FAILURE,
                };
                assign_indexed_value(*i, text)
            }
        }
    }
}

// seroval index.js:2019-2044 (`resolveAssignments`), plain assignments only:
// consecutive ones with the same value chain (`a=b=v`).
fn resolve_assignments(assignments: &[(String, String)]) -> Option<String> {
    let (first, rest) = assignments.split_first()?;
    let mut expression = format!("{}={}", first.0, first.1);
    let mut result = String::new();
    let mut previous = first;
    let mut chain = 1;
    for a in rest {
        if chain == 100 {
            result.push_str(&expression);
            result.push(',');
            expression = format!("{}={}", a.0, a.1);
            chain = 0;
        } else if a.1 == previous.1 {
            expression = format!("{}={expression}", a.0);
        } else {
            result.push_str(&expression);
            result.push(',');
            expression = format!("{}={}", a.0, a.1);
            chain = 0;
        }
        chain += 1;
        previous = a;
    }
    Some(format!("{result}{expression},"))
}

// seroval index.js:2699-2735 (`serializeCross`, `serializeTopCross`)
fn serialize_top_cross(tree: &Node, scope_id: Option<&str>) -> String {
    let mut ctx = Ser {
        stack: vec![],
        assignments: vec![],
        _scope: scope_id,
    };
    let result = ctx.serialize(tree);
    let Some(id) = (match tree {
        Node::Constant(_) | Node::Number(_) | Node::Str(_) => None,
        other => other.id(),
    }) else {
        return result;
    };
    // `resolvePatches`: assignments, then the object flags (none here).
    let patches = resolve_assignments(&ctx.assignments);
    let r = ref_param(id);
    let mut body = result;
    if let Some(p) = &patches {
        body = format!("({body},{p}{r})");
    }
    match scope_id {
        None => {
            if matches!(tree, Node::Object { .. }) && patches.is_none() {
                return format!("({body})");
            }
            body
        }
        Some(scope) => {
            // `createFunction(["$R"], body)` with arrow functions.
            let f = if body.starts_with('{') {
                format!("$R=>({body})")
            } else {
                format!("$R=>{body}")
            };
            format!("({f})($R[\"{}\"])", serialize_string(scope))
        }
    }
}

/// `getCrossReferenceHeader(id)` (seroval index.js:1130-1133).
pub fn cross_reference_header(id: Option<&str>) -> String {
    match id {
        None => "self.$R=self.$R||[]".into(),
        Some(id) => format!("(self.$R=self.$R||{{}})[\"{}\"]=[]", serialize_string(id)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_and_keys_escape_as_serovals() {
        // seroval's serializeString: quotes, backslashes, line breaks and `<`.
        assert_eq!(serialize_string("a<b"), "a\\x3Cb");
        assert_eq!(serialize_string("x & \"y\"\n\\"), "x & \\\"y\\\"\\n\\\\");
        assert_eq!(serialize_string("Loading…"), "Loading…");
        assert_eq!(key_kind("id"), 1);
        assert_eq!(key_kind("0"), 2);
        assert_eq!(key_kind("01"), 0);
        assert_eq!(key_kind("a-b"), 0);
        assert_eq!(
            cross_reference_header(Some("")),
            "(self.$R=self.$R||{})[\"\"]=[]"
        );
        assert_eq!(cross_reference_header(None), "self.$R=self.$R||[]");
    }

    #[test]
    fn values_serialize_with_cross_references() {
        // `$R[0]=[$R[1]={id:1,"a-b":"x"},$R[1]]`: every object takes an index,
        // a second reference reads it.
        let rec = JsVal::Rec(Rc::new(RefCell::new(vec![
            ("id".into(), JsVal::Num(1)),
            ("a-b".into(), JsVal::str("x")),
        ])));
        let arr = JsVal::array(vec![rec.clone(), rec, JsVal::Bool(true), JsVal::Undefined]);
        let mut s = Server::new();
        let out = Rc::new(RefCell::new(vec![]));
        let o = out.clone();
        let done = Rc::new(RefCell::new(false));
        let d = done.clone();
        cross_serialize_stream(
            &mut s,
            arr,
            Rc::new(RefCell::new(Refs::default())),
            None,
            Rc::new(move |_, text, initial| o.borrow_mut().push((text, initial))),
            Rc::new(move |_| *d.borrow_mut() = true),
        )
        .unwrap();
        assert_eq!(
            *out.borrow(),
            [(
                "$R[0]=[$R[1]={id:1,\"a-b\":\"x\"},$R[1],!0,void 0]".to_string(),
                true
            )]
        );
        assert!(*done.borrow());
    }
}
