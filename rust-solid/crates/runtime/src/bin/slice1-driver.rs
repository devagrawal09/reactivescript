//! The signals fuzzer protocol on the ported scheduler: the slice-1 and
//! slice-2a operation sets, the slice-2b (tier B) store ops and the
//! slice-2c (tier C) ops: owners, cleanups and disposal, `mapArray`/For
//! lists, Show, and children built inside computations. Mirrors
//! fuzz/solid.mjs operation by operation: the same reads in the same order
//! (store traps included: a native array method's `Get`/`HasProperty`
//! sequence is ECMA-262's), the same log events and the same value
//! encoding (identity tokens numbered in first-logged order). No laziness
//! of memos and no custom equality of the legacy `equals` option.
use rust_solid::slice1::{
    new_host_fn, thrown_string, ActionBody, ActionStep, Builtin, Error, ErrorFn, JsObj, Key, Keyed,
    MapArg, Out, Resume, Runtime, StoreKey, Thrown, Value, ValueEffectFn, EFFECT_RENDER,
    EFFECT_USER,
};
use serde_json::{json, Value as J};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    io::{self, BufRead},
    rc::Rc,
};

/// The dynamic expression context `CX` (null, or the fields set). Tier C
/// adds `row` (the enclosing mapper call's `{item, index, up}`, or null)
/// and `scope` (the nodes local to that row or child pass, a shared `Map`).
#[derive(Clone, Default)]
struct Cx {
    elem: Option<Value>,
    pos: Option<i64>,
    arg: Option<Value>,
    sent: Option<Value>,
    draft: Option<Value>,
    row: Option<Rc<RowCx>>,
    scope: Option<Scope>,
}

/// A JS value a row context holds: a plain value, a node's accessor
/// (`accessor(node)`), or a Show's narrowed accessor (a function child's).
#[derive(Clone)]
enum Arg {
    Value(Value),
    Node(usize),
    Narrow(Rc<Narrow>),
}

/// `{item, index, up}`.
struct RowCx {
    item: Arg,
    index: Arg,
    up: Option<Rc<RowCx>>,
}

/// A row's or child pass's `scope` (`new Map()`), shared by reference.
type Scope = Rc<RefCell<HashMap<String, NodeRef>>>;

/// What `nodes.get(id)` / `scope.get(id)` hold: a node's accessor, or a
/// host function value (a For's `list` accessor).
#[derive(Clone, Copy)]
enum NodeRef {
    Node(usize),
    Host(Builtin),
}

/// A host function value's body (a For's `list` closure).
type HostFn = Rc<dyn Fn(&mut Runtime) -> Result<Value, Error>>;

/// The Show's narrowed accessor of a function child: `() => { (verdict &&
/// shown === run) || condition() || throw "Stale read from <Show>.";
/// return conditionValue() }`.
struct Narrow {
    show: Rc<std::cell::Cell<u64>>,
    run: u64,
    cond: usize,
    cv: usize,
}

#[derive(Clone, Copy)]
enum Setter {
    Signal(usize),
    Optimistic(usize),
}

/// fuzz/solid.mjs's per-program state.
#[derive(Default)]
struct HostState {
    log: RefCell<Vec<J>>,
    nodes: RefCell<BTreeMap<String, NodeRef>>,
    /// `owners`: id → its root.
    owners: RefCell<BTreeMap<String, usize>>,
    /// Host function values by identity, and `fnLabels`.
    fns: RefCell<HashMap<Builtin, HostFn>>,
    labels: RefCell<HashMap<Builtin, String>>,
    setters: RefCell<BTreeMap<String, Setter>>,
    stores: RefCell<BTreeMap<String, Value>>,
    /// `ids` (a WeakMap by identity) and `tokN`.
    tokens: RefCell<HashMap<(u8, u64), i64>>,
    tok_n: RefCell<i64>,
    cx: RefCell<Option<Cx>>,
    trace: bool,
}
type Host = Rc<HostState>;

fn push(h: &HostState, e: J) {
    if h.trace {
        eprintln!("LOG {e}");
    }
    h.log.borrow_mut().push(e);
}
fn text<'a>(v: &'a J, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn has(v: &J, k: &str) -> bool {
    v.get(k).is_some()
}

/// `tok(o)`: the object's identity token, numbered on first log.
fn tok(rt: &Runtime, h: &HostState, v: &Value) -> i64 {
    let key = match v {
        Value::Obj(o) => (0, o.id),
        Value::Proxy(_) => (1, rt.proxy_identity(v)),
        Value::Draft(d) => (2, d.id),
        Value::NotPending => (3, 0),
        _ => unreachable!("tokens are for objects"),
    };
    if let Some(t) = h.tokens.borrow().get(&key) {
        return *t;
    }
    let mut n = h.tok_n.borrow_mut();
    *n += 1;
    h.tokens.borrow_mut().insert(key, *n);
    *n
}

/// `enc(v)`.
fn enc(rt: &Runtime, h: &HostState, v: &Value) -> J {
    match v {
        Value::Undef => J::Null,
        Value::Int(i) => json!(i),
        Value::Bool(b) => json!(b),
        Value::Proxy(_) | Value::Draft(_) => json!({ "p": tok(rt, h, v) }),
        Value::Obj(o) if o.array => J::Array(o.elements().iter().map(|x| enc(rt, h, x)).collect()),
        Value::Obj(o) => {
            // Children first: `{r: tok(v), v: o}` is built after `o`.
            let mut m = serde_json::Map::new();
            for k in o.keys() {
                m.insert(k.text(), enc(rt, h, &o.get(&k)));
            }
            json!({ "r": tok(rt, h, v), "v": J::Object(m) })
        }
        Value::Func(f) => match h.labels.borrow().get(f) {
            Some(l) => json!({ "f": l }),
            None => json!({ "nonscalar": "function" }),
        },
        Value::View(_) => json!({ "nonscalar": "object" }),
        // `{}`: a plain object with no keys.
        Value::NotPending => json!({ "r": tok(rt, h, v), "v": {} }),
        // A string encodes as itself (fuzz/solid.mjs `enc`).
        Value::Str(s) => json!(&**s),
        Value::Node(_) => panic!("a host node value is outside the op language"),
    }
}

/// `out(v)`.
fn out(rt: &Runtime, h: &HostState, v: &Value) -> J {
    enc(rt, h, v)
}

/// `lg(v)`: legacy log sites encode only structured values.
fn lg(rt: &Runtime, h: &HostState, v: &Value) -> J {
    match v {
        Value::Undef => J::Null,
        Value::Int(i) => json!(i),
        Value::Bool(b) => json!(b),
        // A string is logged as itself (`lg` passes primitives through).
        Value::Str(s) => json!(&**s),
        Value::Obj(_) | Value::Proxy(_) | Value::Draft(_) | Value::NotPending => enc(rt, h, v),
        Value::Func(f) if h.labels.borrow().contains_key(f) => enc(rt, h, v),
        other => panic!("a legacy log of {other:?} is outside the op language"),
    }
}

/// `observed(f)`: a value, or `{error: 'pending' | message}`.
fn observed(r: Result<J, Error>) -> J {
    match r {
        Ok(v) => v,
        Err(e) if e.is_not_ready() => json!({"error": "pending"}),
        Err(e) if e.is_str() => {
            panic!("a thrown string's `message` (undefined) is outside the op language")
        }
        Err(e) => json!({ "error": e.message() }),
    }
}

/// `errText(e)`: `e.message` of an Error, `String(e)` of anything else.
fn err_text(e: &Error) -> String {
    e.message()
}

/// `e.message` at a legacy log site.
fn message(e: &Error) -> String {
    if e.is_str() {
        panic!("a thrown string's `message` (undefined) is outside the op language")
    }
    e.message()
}

/// `f()` of a node accessor or a host function value.
fn call_ref(rt: &mut Runtime, h: &Host, r: NodeRef) -> Result<Value, Error> {
    match r {
        NodeRef::Node(n) => rt.read_value(n),
        NodeRef::Host(f) => {
            let body = h.fns.borrow()[&f].clone();
            body(rt)
        }
    }
}

/// A JS value that may be a function: `typeof f === 'function' ? f() : f`.
fn call_arg(rt: &mut Runtime, h: &Host, a: &Arg) -> Result<Value, Error> {
    match a {
        Arg::Value(v) => call_value(rt, h, v.clone()),
        Arg::Node(n) => rt.read_value(*n),
        Arg::Narrow(nw) => {
            if !((rt.verdict_open() && nw.show.get() == nw.run) || rt.read_value(nw.cond)?.truthy())
            {
                return Err(thrown_string("Stale read from <Show>.".into()));
            }
            rt.read_value(nw.cv)
        }
    }
}

/// `typeof f === 'function' ? f() : f` of a value.
fn call_value(rt: &mut Runtime, h: &Host, v: Value) -> Result<Value, Error> {
    match v {
        Value::Func(f @ Builtin::Host(_)) => call_ref(rt, h, NodeRef::Host(f)),
        Value::Func(other) => panic!("a call of {other:?} is outside the op language"),
        v => Ok(v),
    }
}

/// `rowOf(up)`.
fn row_of(h: &HostState, up: u64) -> Rc<RowCx> {
    let cx = h.cx.borrow();
    let mut c = cx
        .as_ref()
        .and_then(|c| c.row.clone())
        .expect("an item/index read outside a row is outside the op language");
    for _ in 0..up {
        c =
            c.up.clone()
                .expect("an `up` past the outermost row is outside the op language");
    }
    c
}

/// `loop(xs, f)`: `get length`, then `get i` per index.
fn loop_items(rt: &mut Runtime, x: &Value) -> Result<Vec<Value>, Error> {
    let n = length(rt, x)?;
    let mut out = vec![];
    for i in 0..n {
        out.push(rt.js_get(x, &Key::Idx(i))?);
    }
    Ok(out)
}

/// `within(cx, f)`.
fn within<T>(h: &HostState, cx: Option<Cx>, f: impl FnOnce() -> T) -> T {
    let saved = h.cx.replace(cx);
    let r = f();
    *h.cx.borrow_mut() = saved;
    r
}
/// `{...CX, field}`.
fn cx_with(h: &HostState, f: impl FnOnce(&mut Cx)) -> Option<Cx> {
    let mut c = h.cx.borrow().clone().unwrap_or_default();
    f(&mut c);
    Some(c)
}
fn cx_field(h: &HostState, f: impl FnOnce(&Cx) -> Option<Value>) -> Value {
    let cx = h.cx.borrow();
    let c = cx
        .as_ref()
        .expect("a context read with CX null is outside the op language");
    f(c).unwrap_or(Value::Undef)
}

fn key_of(k: &J) -> Key {
    match k {
        J::Number(n) => Key::Idx(n.as_u64().expect("an index key") as u32),
        J::String(s) => Key::name(s),
        _ => panic!("a key {k} is outside the op language"),
    }
}
fn key_value(v: &Value) -> Key {
    match v {
        Value::Int(i) if *i >= 0 => Key::Idx(*i as u32),
        other => panic!("a computed key {other:?} is outside the op language"),
    }
}
/// `o.flight + ':' + v`: the memo value's `ToString`, for an integer or a
/// string (any other value is refused).
fn flight_key(v: &Value) -> String {
    match v {
        Value::Int(_) | Value::Str(_) => v.to_js_string().unwrap(),
        other => panic!("a flight key of {other:?} is outside the op language"),
    }
}
fn int(v: Value) -> i64 {
    v.as_int()
        .unwrap_or_else(|| panic!("a non-integer operand ({v:?}) is outside the op language"))
}

/// `x.length` as `LengthOfArrayLike` reads it (`Get(O, "length")`).
fn length(rt: &mut Runtime, x: &Value) -> Result<u32, Error> {
    let l = rt.js_get(x, &Key::name("length"))?;
    Ok(int(l) as u32)
}

/// A native array method's receiver (`x.filter(...)`): the call reads the
/// method first.
fn method(rt: &mut Runtime, x: &Value, name: &'static str) -> Result<(), Error> {
    match rt.js_get(x, &Key::name(name))? {
        Value::Func(Builtin::ArrayMethod(m)) if m == name => Ok(()),
        other => panic!("x.{name} is {other:?}: a TypeError is outside the op language"),
    }
}
/// `ArraySpeciesCreate(O, n)`: `IsArray(O)` (a proxy's shell), then
/// `Get(O, "constructor")`.
fn species(rt: &mut Runtime, x: &Value) -> Result<(), Error> {
    if rt.is_array(x) {
        match rt.js_get(x, &Key::name("constructor"))? {
            Value::Func(Builtin::ArrayCtor) => {}
            other => panic!("an array's constructor is {other:?}"),
        }
    }
    Ok(())
}

/// `sub(e, x, i, prev)`.
fn sub(rt: &mut Runtime, h: &Host, e: &J, x: Value, i: u32, prev: &Value) -> Result<Value, Error> {
    let cx = cx_with(h, |c| {
        c.elem = Some(x);
        c.pos = Some(i as i64);
    });
    within(h, cx, || eval(rt, h, e, prev))
}

/// `plain(v, f)`.
fn plain(rt: &mut Runtime, v: Value, fields: &[J]) -> Result<Value, Error> {
    if !v.is_object() {
        return Ok(v);
    }
    if rt.is_array(&v) {
        let n = length(rt, &v)?;
        let mut r = vec![];
        for i in 0..n {
            let x = rt.js_get(&v, &Key::Idx(i))?;
            r.push(plain(rt, x, fields)?);
        }
        return Ok(Value::Obj(JsObj::new_array(r)));
    }
    let mut out = vec![];
    for f in fields {
        let k = f.as_str().unwrap();
        let x = rt.js_get(&v, &Key::name(k))?;
        out.push((Rc::from(k), plain(rt, x, fields)?));
    }
    Ok(Value::Obj(JsObj::new_object(out)))
}

/// `evalExpr(e, prev)` (with the tier-B cases of `evalExprB`).
fn eval(rt: &mut Runtime, h: &Host, e: &J, prev: &Value) -> Result<Value, Error> {
    if let Some(n) = e.as_i64() {
        return Ok(Value::Int(n));
    }
    match text(e, "op") {
        "read" => {
            let r = h.nodes.borrow()[text(e, "id")];
            call_ref(rt, h, r)
        }
        "add" => {
            let a = eval(rt, h, &e["a"], prev)?;
            let b = eval(rt, h, &e["b"], prev)?;
            // JS `+`: integer addition, or concatenation when either operand
            // is a string (`Value::js_add`). Anything else is refused.
            Ok(match (&a, &b) {
                (Value::Int(x), Value::Int(y)) => Value::Int(x + y),
                _ => a
                    .js_add(&b)
                    .unwrap_or_else(|| panic!("`{a:?} + {b:?}` is outside the op language")),
            })
        }
        // JS `%` on integers: the sign of the dividend, as Rust's.
        "mod" => Ok(Value::Int(
            int(eval(rt, h, &e["a"], prev)?) % e["b"].as_i64().unwrap(),
        )),
        "choose" => {
            if eval(rt, h, &e["test"], prev)?.truthy() {
                eval(rt, h, &e["yes"], prev)
            } else {
                eval(rt, h, &e["no"], prev)
            }
        }
        "untrack" => rt.untrack(|rt| eval(rt, h, &e["expr"], prev)),
        "fail" => Err(rust_solid::slice1::user_error(text(e, "message").into())),
        "prev" => Ok(if prev.is_undef() {
            rust_solid::slice1::from_json(&e["fallback"])
        } else {
            prev.clone()
        }),
        "store" => Ok(h.stores.borrow()[text(e, "id")].clone()),
        "get" => {
            let x = eval(rt, h, &e["of"], prev)?;
            let k = if e["key"].is_object() {
                key_value(&eval(rt, h, &e["key"], prev)?)
            } else {
                key_of(&e["key"])
            };
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            rt.js_get(&x, &k)
        }
        "has" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Int(0));
            }
            assert!(x.is_object(), "`in` on a primitive is a TypeError");
            Ok(Value::Int(rt.js_has(&x, &key_of(&e["key"]))? as i64))
        }
        "len" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            rt.js_get(&x, &Key::name("length"))
        }
        "eq" => {
            let a = eval(rt, h, &e["a"], prev)?;
            let b = eval(rt, h, &e["b"], prev)?;
            Ok(Value::Int((a == b) as i64))
        }
        "not" => Ok(Value::Int(!eval(rt, h, &e["a"], prev)?.truthy() as i64)),
        "elem" => Ok(cx_field(h, |c| c.elem.clone())),
        "pos" => Ok(cx_field(h, |c| c.pos.map(Value::Int))),
        "filter" | "count" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            let mut r = vec![];
            if e["native"] == true {
                method(rt, &x, "filter")?;
                let n = length(rt, &x)?;
                species(rt, &x)?;
                for i in 0..n {
                    if rt.js_has(&x, &Key::Idx(i))? {
                        let y = rt.js_get(&x, &Key::Idx(i))?;
                        if sub(rt, h, &e["where"], y.clone(), i, prev)?.truthy() {
                            r.push(y);
                        }
                    }
                }
            } else {
                let n = length(rt, &x)?;
                for i in 0..n {
                    let y = rt.js_get(&x, &Key::Idx(i))?;
                    if sub(rt, h, &e["where"], y.clone(), i, prev)?.truthy() {
                        r.push(y);
                    }
                }
            }
            Ok(if text(e, "op") == "count" {
                Value::Int(r.len() as i64)
            } else {
                Value::Obj(JsObj::new_array(r))
            })
        }
        "find" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            if e["native"] == true {
                method(rt, &x, "findIndex")?;
            }
            let n = length(rt, &x)?;
            for i in 0..n {
                let y = rt.js_get(&x, &Key::Idx(i))?;
                if sub(rt, h, &e["where"], y, i, prev)?.truthy() {
                    return Ok(Value::Int(i as i64));
                }
            }
            Ok(Value::Int(-1))
        }
        "replace" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            let native = e["native"] == true;
            if native {
                method(rt, &x, "map")?;
            }
            let n = length(rt, &x)?;
            if native {
                species(rt, &x)?;
            }
            let mut r: BTreeMap<u32, Value> = BTreeMap::new();
            for i in 0..n {
                if native && !rt.js_has(&x, &Key::Idx(i))? {
                    continue;
                }
                let y = rt.js_get(&x, &Key::Idx(i))?;
                let v = if sub(rt, h, &e["where"], y.clone(), i, prev)?.truthy() {
                    sub(rt, h, &e["with"], y, i, prev)?
                } else {
                    y
                };
                r.insert(i, v);
            }
            let arr = JsObj::new_array(vec![]);
            for (i, v) in r {
                arr.set(&Key::Idx(i), v);
            }
            if native {
                // `ArraySpeciesCreate(O, len)`: the result has `len` slots.
                arr.set(&Key::name("length"), Value::Int(n as i64));
            }
            Ok(Value::Obj(arr))
        }
        "obj" => {
            let mut fields = vec![];
            for (k, v) in e["fields"].as_object().unwrap() {
                fields.push((Rc::from(k.as_str()), eval(rt, h, v, prev)?));
            }
            Ok(Value::Obj(JsObj::new_object(fields)))
        }
        "arr" => {
            let mut items = vec![];
            for x in e["items"].as_array().unwrap() {
                items.push(eval(rt, h, x, prev)?);
            }
            Ok(Value::Obj(JsObj::new_array(items)))
        }
        "lit" => Ok(rust_solid::slice1::from_json(&e["value"])),
        "plain" => {
            let x = eval(rt, h, &e["of"], prev)?;
            plain(rt, x, e["fields"].as_array().unwrap())
        }
        "arg" => Ok(cx_field(h, |c| c.arg.clone())),
        "sent" => Ok(cx_field(h, |c| c.sent.clone())),
        "draft" => Ok(cx_field(h, |c| c.draft.clone())),
        // Tier C.
        "item" => {
            let row = row_of(h, e["up"].as_u64().unwrap_or(0));
            call_arg(rt, h, &row.item)
        }
        "index" => {
            let row = row_of(h, e["up"].as_u64().unwrap_or(0));
            call_arg(rt, h, &row.index)
        }
        "call" => {
            let f = eval(rt, h, &e["of"], prev)?;
            call_value(rt, h, f)
        }
        "local" => {
            let scope =
                h.cx.borrow()
                    .as_ref()
                    .and_then(|c| c.scope.clone())
                    .expect("a local read outside a pass is outside the op language");
            let r = scope.borrow()[text(e, "id")];
            call_ref(rt, h, r)
        }
        "concat" => {
            let mut r = vec![];
            for it in e["items"].as_array().unwrap() {
                let x = eval(rt, h, it, prev)?;
                if !x.is_undef() {
                    r.extend(loop_items(rt, &x)?);
                }
            }
            Ok(Value::Obj(JsObj::new_array(r)))
        }
        "reverse" => {
            let x = eval(rt, h, &e["of"], prev)?;
            if x.is_undef() {
                return Ok(Value::Undef);
            }
            let n = length(rt, &x)?;
            let mut r = vec![];
            for i in (0..n).rev() {
                r.push(rt.js_get(&x, &Key::Idx(i))?);
            }
            Ok(Value::Obj(JsObj::new_array(r)))
        }
        op => panic!("expression {op} is outside the op language"),
    }
}

/// `val(e, d)`.
fn val(rt: &mut Runtime, h: &Host, e: &J, d: &Value) -> Result<Value, Error> {
    let cx = cx_with(h, |c| c.draft = Some(d.clone()));
    within(h, cx, || eval(rt, h, e, &Value::Undef))
}

/// `findKey(t, s)`.
fn find_key(rt: &mut Runtime, t: &Value, s: &J) -> Result<Option<u32>, Error> {
    let n = length(rt, t)?;
    let key = Key::name(text(s, "key"));
    let is = rust_solid::slice1::from_json(&s["is"]);
    for i in 0..n {
        let r = rt.js_get(t, &Key::Idx(i))?;
        if r.is_object() && rt.js_get(&r, &key)? == is {
            return Ok(Some(i));
        }
    }
    Ok(None)
}
/// `shiftRemove(a, i)`.
fn shift_remove(rt: &mut Runtime, a: &Value, i: u32) -> Result<(), Error> {
    let n = length(rt, a)?;
    let mut k = i;
    while k + 1 < n {
        let x = rt.js_get(a, &Key::Idx(k + 1))?;
        rt.js_set(a, &Key::Idx(k), x)?;
        k += 1;
    }
    rt.js_set(a, &Key::name("length"), Value::Int(n as i64 - 1))
}
/// `shiftInsert(a, i, x)`.
fn shift_insert(rt: &mut Runtime, a: &Value, i: u32, x: Value) -> Result<(), Error> {
    let mut k = length(rt, a)?;
    while k > i {
        let y = rt.js_get(a, &Key::Idx(k - 1))?;
        rt.js_set(a, &Key::Idx(k), y)?;
        k -= 1;
    }
    rt.js_set(a, &Key::Idx(i), x)
}

/// `edit(sid, d, ed)`.
fn edit(rt: &mut Runtime, h: &Host, sid: &str, d: &Value, ed: &J) -> Result<(), Error> {
    let p = ed["path"].as_array().unwrap();
    let is_arr_op = !(has(ed, "set") || ed["del"] == true);
    let mut t = d.clone();
    // `seg(s)`: a `{key, is}` segment that finds no row logs `miss` and
    // ends the edit (MISS).
    let seg = |rt: &mut Runtime, t: &Value, s: &J| -> Result<Option<Key>, Error> {
        if !s.is_object() {
            return Ok(Some(key_of(s)));
        }
        match find_key(rt, t, s)? {
            Some(i) => Ok(Some(Key::Idx(i))),
            None => {
                let is = rust_solid::slice1::from_json(&s["is"]);
                push(h, json!(["miss", sid, out(rt, h, &is)]));
                Ok(None)
            }
        }
    };
    let walk = p.len() - if is_arr_op { 0 } else { 1 };
    for s in &p[..walk] {
        let Some(k) = seg(rt, &t, s)? else {
            return Ok(());
        };
        assert!(t.is_object(), "a path through a primitive is a TypeError");
        t = rt.js_get(&t, &k)?;
    }
    assert!(t.is_object(), "an edit of a primitive is a TypeError");
    if !is_arr_op {
        let Some(k) = seg(rt, &t, p.last().unwrap())? else {
            return Ok(());
        };
        if ed["del"] == true {
            return rt.js_delete(&t, &k);
        }
        let v = val(rt, h, &ed["set"], d)?;
        return rt.js_set(&t, &k, v);
    }
    if has(ed, "push") {
        let n = length(rt, &t)?;
        let v = val(rt, h, &ed["push"], d)?;
        rt.js_set(&t, &Key::Idx(n), v)
    } else if has(ed, "insert") {
        let i = ed["insert"][0].as_u64().unwrap() as u32;
        let v = val(rt, h, &ed["insert"][1], d)?;
        shift_insert(rt, &t, i, v)
    } else if has(ed, "remove") {
        shift_remove(rt, &t, ed["remove"].as_u64().unwrap() as u32)
    } else if has(ed, "removeKey") {
        match find_key(rt, &t, &ed["removeKey"])? {
            None => {
                let is = rust_solid::slice1::from_json(&ed["removeKey"]["is"]);
                push(h, json!(["miss", sid, out(rt, h, &is)]));
                Ok(())
            }
            Some(i) => shift_remove(rt, &t, i),
        }
    } else if has(ed, "move") {
        let i = ed["move"][0].as_u64().unwrap() as u32;
        let j = ed["move"][1].as_u64().unwrap() as u32;
        let x = rt.js_get(&t, &Key::Idx(i))?;
        shift_remove(rt, &t, i)?;
        shift_insert(rt, &t, j, x)
    } else if has(ed, "moveKey") {
        // Tier C: find by key, then shift-remove and shift-insert at the
        // front or the back.
        let m = &ed["moveKey"];
        match find_key(rt, &t, m)? {
            None => {
                let is = rust_solid::slice1::from_json(&m["is"]);
                push(h, json!(["miss", sid, out(rt, h, &is)]));
                Ok(())
            }
            Some(i) => {
                let x = rt.js_get(&t, &Key::Idx(i))?;
                shift_remove(rt, &t, i)?;
                let to = if m["to"] == 0 { 0 } else { length(rt, &t)? };
                shift_insert(rt, &t, to, x)
            }
        }
    } else {
        panic!("edit {ed} is outside the op language")
    }
}

/// `runSet(sid, s)`.
fn run_set(rt: &mut Runtime, h: &Host, sid: &str, s: &J) -> Result<(), Error> {
    let proxy = h.stores.borrow()[sid].clone();
    if has(s, "reconcile") {
        let v = rust_solid::slice1::from_json(&s["reconcile"]);
        let key = match s.get("key") {
            None => StoreKey::Field("id".into()),
            Some(J::Null) => StoreKey::Positional,
            Some(k) => StoreKey::Field(k.as_str().unwrap().into()),
        };
        return rt.store_reconcile(&proxy, v, key);
    }
    let cx = h.cx.borrow().clone();
    let h2 = h.clone();
    let sid = sid.to_owned();
    let s = s.clone();
    rt.store_set(&proxy, &mut |rt: &mut Runtime,
                               d: Value|
     -> Result<Value, Error> {
        within(&h2, cx.clone(), || {
            if has(&s, "returns") {
                return val(rt, &h2, &s["returns"], &d);
            }
            for ed in s["edits"].as_array().unwrap() {
                edit(rt, &h2, &sid, &d, ed)?;
            }
            Ok(Value::Undef)
        })
    })
}

/// `upd(id, e)`.
fn upd(rt: &mut Runtime, h: &Host, id: &str, e: &J) -> Result<(), Error> {
    let cx = h.cx.borrow().clone();
    let setter = h.setters.borrow()[id];
    let h2 = h.clone();
    let e = e.clone();
    let id = id.to_owned();
    let mut f = move |rt: &mut Runtime, prev: Value| -> Result<Value, Error> {
        push(&h2, json!(["update", id, out(rt, &h2, &prev)]));
        let cx = {
            let mut c = cx.clone().unwrap_or_default();
            c.arg = Some(prev);
            Some(c)
        };
        within(&h2, cx, || eval(rt, &h2, &e, &Value::Undef))
    };
    match setter {
        Setter::Signal(n) => rt.write_with(n, &mut f),
        Setter::Optimistic(n) => rt.optimistic_write_with(n, &mut f),
    }
}

fn write(rt: &mut Runtime, h: &Host, id: &str, v: &J) {
    let v = rust_solid::slice1::from_json(v);
    match h.setters.borrow()[id] {
        Setter::Signal(n) => rt.write_value(n, v),
        Setter::Optimistic(n) => rt.optimistic_write(n, v),
    }
}

/// `step(st)` of an extended action.
fn step(rt: &mut Runtime, h: &Host, st: &J) -> Result<(), Error> {
    if has(st, "write") {
        write(rt, h, text(st, "write"), &st["value"]);
        Ok(())
    } else if has(st, "update") {
        upd(rt, h, text(st, "update"), &st["expr"])
    } else if has(st, "store") {
        run_set(rt, h, text(st, "store"), st)
    } else if has(st, "refresh") {
        let NodeRef::Node(id) = h.nodes.borrow()[text(st, "refresh")] else {
            panic!("a refresh of a host function is outside the op language")
        };
        rt.refresh(id);
        Ok(())
    } else if has(st, "refresh_store") {
        let p = h.stores.borrow()[text(st, "refresh_store")].clone();
        rt.refresh_store(&p);
        Ok(())
    } else if has(st, "read") {
        let r = eval(rt, h, &st["read"], &Value::Undef).map(|v| out(rt, h, &v));
        push(h, json!(["read", text(st, "label"), observed(r)]));
        Ok(())
    } else {
        panic!("bad step {st}")
    }
}

/// The generated `function*(){ for (slice of slices) { writes; yield flight } }`.
struct Slices {
    slices: Vec<J>,
    index: usize,
    host: Host,
}
impl ActionBody for Slices {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
        if let Resume::Error(e) = input {
            // `it.throw(e)` at the yield: the body has no try/catch.
            return ActionStep::Throw(e);
        }
        while self.index < self.slices.len() {
            let slice = self.slices[self.index].clone();
            self.index += 1;
            for w in slice["writes"].as_array().into_iter().flatten() {
                write(rt, &self.host, text(w, "id"), &w["value"]);
            }
            if let Some(f) = slice["flight"].as_str() {
                return ActionStep::Yield(f.into());
            }
        }
        ActionStep::Return
    }
}

/// `extendedAction(o)`: slices with steps, the yielded value as `sent`,
/// and a `catch` clause.
struct Extended {
    op: J,
    index: usize,
    sent: Value,
    host: Host,
}
impl Extended {
    /// `run(s)`.
    fn run(&self, rt: &mut Runtime, s: &J) -> Result<(), Error> {
        let h = &self.host;
        let cx = Some(Cx {
            sent: Some(self.sent.clone()),
            ..Cx::default()
        });
        within(h, cx, || {
            for w in s["writes"].as_array().into_iter().flatten() {
                write(rt, h, text(w, "id"), &w["value"]);
            }
            for st in s["steps"].as_array().into_iter().flatten() {
                step(rt, h, st)?;
            }
            Ok(())
        })
    }
    /// `catch (e) { if (!o.catch) throw e; log caught; run(o.catch) }`.
    fn caught(&mut self, rt: &mut Runtime, message: String) -> ActionStep {
        if !has(&self.op, "catch") {
            return ActionStep::Throw(message);
        }
        push(
            &self.host,
            json!(["caught", text(&self.op, "id"), message.clone()]),
        );
        let c = self.op["catch"].clone();
        match self.run(rt, &c) {
            Ok(()) => ActionStep::Return,
            Err(e) => ActionStep::Throw(e.message()),
        }
    }
}
impl ActionBody for Extended {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
        match input {
            Resume::Start => {}
            Resume::Value(v) => self.sent = v,
            Resume::Error(e) => return self.caught(rt, e),
        }
        let slices = self.op["slices"].as_array().unwrap().clone();
        while self.index < slices.len() {
            let s = &slices[self.index];
            self.index += 1;
            if let Err(e) = self.run(rt, s) {
                return self.caught(rt, e.message());
            }
            if let Some(f) = s["flight"].as_str() {
                return ActionStep::Yield(f.into());
            }
        }
        ActionStep::Return
    }
}

/// A memo's or effect's compute body (`memoFn` / the effect's compute).
fn compute_body(h: &Host, op: &J) -> rust_solid::slice1::BodyFn {
    let h = h.clone();
    let id = text(op, "id").to_owned();
    let expr = op["expr"].clone();
    let flight = op["flight"].as_str().map(str::to_owned);
    Rc::new(move |rt: &mut Runtime, p: Value| {
        push(&h, json!(["compute", id, lg(rt, &h, &p)]));
        let v = eval(rt, &h, &expr, &p)?;
        Ok(match &flight {
            Some(prefix) => {
                let fid = format!("{prefix}:{}", flight_key(&v));
                push(&h, json!(["flight", fid]));
                Out::Flight(fid)
            }
            None => Out::Value(v),
        })
    })
}

// ---- Tier C (fuzz/solid.mjs `childC`, `makeList`, `makeShow`, `childPass`,
// `memoC`, `effectC`).

/// The effect callback an effect logs under `id`: `effect` with the value
/// and the previous one, and a cleanup logging `effect_cleanup`.
fn effect_apply(h: &Host, id: String) -> ValueEffectFn {
    let h1 = h.clone();
    Rc::new(
        move |rt: &mut Runtime, v: Value, p: Value| -> Option<rust_solid::slice1::Cleanup> {
            push(&h1, json!(["effect", id, lg(rt, &h1, &v), lg(rt, &h1, &p)]));
            let h = h1.clone();
            let id = id.clone();
            Some(Box::new(move |rt: &mut Runtime| {
                push(&h, json!(["effect_cleanup", id, lg(rt, &h, &v)]))
            }))
        },
    )
}

/// A user effect's error callback logging `errText(e)`.
fn effect_error(h: &Host, id: String) -> ErrorFn {
    let h = h.clone();
    Rc::new(move |_: &mut Runtime, e: &Error| push(&h, json!(["error", id, err_text(e)])))
}

/// A fresh `{row, scope: new Map()}`.
fn pass_cx(row: Option<Rc<RowCx>>) -> Cx {
    Cx {
        row,
        scope: Some(Rc::new(RefCell::new(HashMap::new()))),
        ..Cx::default()
    }
}

fn scope_set(cx: &Cx, name: &str, r: NodeRef) {
    cx.scope
        .as_ref()
        .expect("a child pass has a scope")
        .borrow_mut()
        .insert(name.to_owned(), r);
}

/// `onCleanup(() => log.push(['cleanup', label]))`.
fn log_cleanup(rt: &mut Runtime, h: &Host, label: String) {
    let h = h.clone();
    rt.on_cleanup(Box::new(move |_: &mut Runtime| {
        push(&h, json!(["cleanup", label]))
    }));
}

/// `childC(r, pre, cx)`.
fn child_c(rt: &mut Runtime, h: &Host, r: &J, pre: &str, cx: &Cx) -> Result<(), Error> {
    if has(r, "effect") {
        let id = format!("{pre}.{}", text(r, "effect"));
        let compute: rust_solid::slice1::BodyFn = {
            let (h, cx, expr, id) = (h.clone(), cx.clone(), r["expr"].clone(), id.clone());
            Rc::new(move |rt: &mut Runtime, p: Value| {
                within(&h, Some(cx.clone()), || {
                    push(&h, json!(["compute", id, lg(rt, &h, &p)]));
                    eval(rt, &h, &expr, &p).map(Out::Value)
                })
            })
        };
        let apply = effect_apply(h, id.clone());
        let ty = if r["render"] == true {
            EFFECT_RENDER
        } else {
            EFFECT_USER
        };
        let error = (ty == EFFECT_USER).then(|| effect_error(h, id.clone()));
        rt.effect_with(compute, apply, error, ty, r["defer"] == true);
        return Ok(());
    }
    if has(r, "memo") {
        let name = text(r, "memo");
        let id = format!("{pre}.{name}");
        let body: rust_solid::slice1::BodyFn = {
            let (h, cx, expr) = (h.clone(), cx.clone(), r["expr"].clone());
            Rc::new(move |rt: &mut Runtime, p: Value| {
                within(&h, Some(cx.clone()), || {
                    push(&h, json!(["compute", id, lg(rt, &h, &p)]));
                    eval(rt, &h, &expr, &p).map(Out::Value)
                })
            })
        };
        let n = rt.memo_async(body, None);
        scope_set(cx, name, NodeRef::Node(n));
        return Ok(());
    }
    if has(r, "list") {
        let mut o = r["list"].clone();
        let name = text(&o, "id").to_owned();
        o["id"] = json!(format!("{pre}.{name}"));
        let l = make_list(rt, h, &o, cx);
        scope_set(cx, &name, l);
        return Ok(());
    }
    if has(r, "show") {
        let mut o = r["show"].clone();
        let name = text(&o, "id").to_owned();
        o["id"] = json!(format!("{pre}.{name}"));
        let b = make_show(rt, h, &o, cx);
        scope_set(cx, &name, b);
        return Ok(());
    }
    if has(r, "cleanup") {
        log_cleanup(rt, h, format!("{pre}.{}", text(r, "cleanup")));
        return Ok(());
    }
    if has(r, "read") {
        // A read in the pass body itself: a throw aborts the pass (#2903).
        let v = within(h, Some(cx.clone()), || {
            eval(rt, h, &r["read"], &Value::Undef).map(|v| out(rt, h, &v))
        })?;
        push(h, json!(["read", format!("{pre}.{}", text(r, "label")), v]));
        return Ok(());
    }
    panic!("bad child {r}")
}

/// A mapper argument as the row context holds it.
fn map_arg(a: MapArg) -> Arg {
    match a {
        MapArg::Value(v) => Arg::Value(v),
        MapArg::Accessor(n) => Arg::Node(n),
    }
}

/// `makeList(o, cx)`: `mapArray` (lazy: false) or For (lazy: true).
fn make_list(rt: &mut Runtime, h: &Host, o: &J, cx: &Cx) -> NodeRef {
    let id = text(o, "id").to_owned();
    let n = Rc::new(std::cell::Cell::new(0i64));
    let keyed = match &o["keyed"] {
        J::Bool(false) => Keyed::Index,
        J::String(k) => {
            let k = Key::name(k);
            Keyed::Fn(Rc::new(move |rt: &mut Runtime, x: Value| {
                // `x[k]`: a row read as `undefined` would throw a TypeError
                // (the optimistic-hole Solid bug): fail closed.
                assert!(
                    !x.is_undef(),
                    "a key function over an undefined row (a TypeError) is outside the op language"
                );
                rt.js_get(&x, &k)
            }))
        }
        J::Object(_) => {
            let (h, cx, expr) = (h.clone(), cx.clone(), o["keyed"]["expr"].clone());
            Keyed::Fn(Rc::new(move |rt: &mut Runtime, x: Value| {
                let mut c = cx.clone();
                c.elem = Some(x);
                within(&h, Some(c), || eval(rt, &h, &expr, &Value::Undef))
            }))
        }
        _ => Keyed::Identity,
    };
    let arity = if o["index"] == true { 2 } else { 1 };
    let body: rust_solid::slice1::MapFn = {
        let (h, cx, id, n, rows) = (
            h.clone(),
            cx.clone(),
            id.clone(),
            n.clone(),
            o["row"].as_array().cloned().unwrap_or_default(),
        );
        Rc::new(move |rt: &mut Runtime, item: MapArg, index: MapArg| {
            // `map`: `(item, index) => body(item, index)` or `item => body(item)`.
            let item = map_arg(item);
            let index = if arity > 1 {
                map_arg(index)
            } else {
                Arg::Value(Value::Undef)
            };
            n.set(n.get() + 1);
            let s = n.get();
            let rid = format!("{id}#{s}");
            let item_log = match &item {
                Arg::Value(v) => out(rt, &h, v),
                _ => J::Null,
            };
            let index_log = match &index {
                Arg::Value(Value::Int(i)) => json!(i),
                _ => J::Null,
            };
            push(&h, json!(["row", id, s, item_log, index_log]));
            log_cleanup(rt, &h, rid.clone());
            let rc = pass_cx(Some(Rc::new(RowCx {
                item,
                index,
                up: cx.row.clone(),
            })));
            for r in &rows {
                child_c(rt, &h, r, &rid, &rc)?;
            }
            Ok(Value::Int(s))
        })
    };
    let fallback: Option<rust_solid::slice1::FallbackFn> = match &o["fallback"] {
        J::Bool(true) | J::Array(_) => {
            let (h, cx, id, n, kids) = (
                h.clone(),
                cx.clone(),
                id.clone(),
                n.clone(),
                o["fallback"].as_array().cloned(),
            );
            Some(Rc::new(move |rt: &mut Runtime| {
                n.set(n.get() + 1);
                let s = n.get();
                let fid = format!("{id}#{s}");
                push(&h, json!(["fallback", id, s]));
                log_cleanup(rt, &h, fid.clone());
                if let Some(kids) = &kids {
                    let fc = pass_cx(cx.row.clone());
                    for r in kids {
                        child_c(rt, &h, r, &fid, &fc)?;
                    }
                }
                Ok(Value::Int(-s))
            }))
        }
        _ => None,
    };
    let list: rust_solid::slice1::ListFn = {
        let (h, cx, each) = (h.clone(), cx.clone(), o["each"].clone());
        Rc::new(move |rt: &mut Runtime| {
            within(&h, Some(cx.clone()), || eval(rt, &h, &each, &Value::Undef))
        })
    };
    let make = move |rt: &mut Runtime| {
        rt.map_array(
            list.clone(),
            body.clone(),
            arity,
            keyed.clone(),
            fallback.clone(),
        )
    };
    if o["lazy"] != true {
        return NodeRef::Node(make(rt));
    }
    // For: the owner captured at the "component call"; the mapArray is
    // created on the first read.
    let owner = rt.get_owner();
    let mapped: Rc<std::cell::Cell<Option<usize>>> = Rc::new(std::cell::Cell::new(None));
    let f = new_host_fn();
    h.fns.borrow_mut().insert(
        f,
        Rc::new(move |rt: &mut Runtime| {
            let m = match mapped.get() {
                Some(m) => m,
                None => {
                    let m = rt.with_owner(owner, &make);
                    mapped.set(Some(m));
                    m
                }
            };
            rt.read_value(m)
        }),
    );
    h.labels.borrow_mut().insert(f, id);
    NodeRef::Host(f)
}

/// `makeShow(o, cx)`: `conditionValue`, `condition` and the outer memo.
fn make_show(rt: &mut Runtime, h: &Host, o: &J, cx: &Cx) -> NodeRef {
    let id = text(o, "id").to_owned();
    let pass = Rc::new(std::cell::Cell::new(0i64));
    let shown = Rc::new(std::cell::Cell::new(0u64));
    let cv = {
        let (h, cx, when) = (h.clone(), cx.clone(), o["when"].clone());
        rt.memo_async(
            Rc::new(move |rt: &mut Runtime, _p: Value| {
                within(&h, Some(cx.clone()), || eval(rt, &h, &when, &Value::Undef)).map(Out::Value)
            }),
            None,
        )
    };
    let keyed = o["keyed"] == true;
    let cond = if keyed {
        cv
    } else {
        rt.memo_with(
            Rc::new(move |rt: &mut Runtime, _p: Value| rt.read_value(cv).map(Out::Value)),
            // `(a, b) => !a === !b`
            Some(Rc::new(|a: &Value, b: &Value| a.truthy() == b.truthy())),
            true,
        )
    };
    let build = {
        let (h, cx, id) = (h.clone(), cx.clone(), id.clone());
        move |rt: &mut Runtime, kids: &[J], p: i64, item: Option<Arg>| -> Result<Out, Error> {
            let pre = format!("{id}@{p}");
            let sc = pass_cx(match item {
                None => cx.row.clone(),
                Some(item) => Some(Rc::new(RowCx {
                    item,
                    index: Arg::Value(Value::Undef),
                    up: cx.row.clone(),
                })),
            });
            let mut ret = Value::Int(p);
            for r in kids {
                child_c(rt, &h, r, &pre, &sc)?;
                if has(r, "list") {
                    let l = sc.scope.as_ref().unwrap().borrow()[text(&r["list"], "id")];
                    ret = match l {
                        NodeRef::Host(f) => Value::Func(f),
                        NodeRef::Node(_) => panic!(
                            "an unlabelled list accessor as a Show's value is outside the op language"
                        ),
                    };
                }
            }
            Ok(Out::Value(ret))
        }
    };
    let (h2, yes, no, fn_children) = (
        h.clone(),
        o["yes"].as_array().cloned().unwrap_or_default(),
        o["no"].as_array().cloned().unwrap_or_default(),
        o["fn"] == true,
    );
    let outer = rt.memo_with(
        Rc::new(move |rt: &mut Runtime, _p: Value| {
            let c = rt.read_value(cond)?;
            shown.set(shown.get() + 1);
            let run = shown.get();
            pass.set(pass.get() + 1);
            let p = pass.get();
            push(&h2, json!(["branch", id, p, c.truthy() as i64]));
            if !c.truthy() {
                return build(rt, &no, p, None);
            }
            if !fn_children {
                return build(rt, &yes, p, None);
            }
            let item = if keyed {
                Arg::Value(c)
            } else {
                Arg::Narrow(Rc::new(Narrow {
                    show: shown.clone(),
                    run,
                    cond,
                    cv,
                }))
            };
            rt.untrack(|rt| build(rt, &yes, p, Some(item)))
        }),
        None,
        true,
    );
    NodeRef::Node(outer)
}

/// `childPass(o, pre)`: the children built untracked, then the pass cleanup.
fn child_pass(rt: &mut Runtime, h: &Host, o: &J, pre: &str) -> Result<(), Error> {
    rt.untrack(|rt| {
        let sc = pass_cx(None);
        for r in o["children"].as_array().into_iter().flatten() {
            child_c(rt, h, r, pre, &sc)?;
        }
        Ok::<(), Error>(())
    })?;
    if has(o, "cleanup") {
        log_cleanup(rt, h, pre.to_owned());
    }
    Ok(())
}

/// `memoC(o)`'s and `effectC(o)`'s compute: `compute` log, the child pass,
/// then the expression (a memo's may name a flight).
fn children_body(h: &Host, op: &J) -> rust_solid::slice1::BodyFn {
    let h = h.clone();
    let op = op.clone();
    let id = text(&op, "id").to_owned();
    let k = Rc::new(std::cell::Cell::new(0u64));
    Rc::new(move |rt: &mut Runtime, p: Value| {
        push(&h, json!(["compute", id, lg(rt, &h, &p)]));
        k.set(k.get() + 1);
        child_pass(rt, &h, &op, &format!("{id}@{}", k.get()))?;
        let v = eval(rt, &h, &op["expr"], &p)?;
        Ok(match op["flight"].as_str() {
            Some(prefix) => {
                let fid = format!("{prefix}:{}", flight_key(&v));
                push(&h, json!(["flight", fid]));
                Out::Flight(fid)
            }
            None => Out::Value(v),
        })
    })
}

/// `owned(o.owner, f)`.
fn owner_of(h: &Host, op: &J) -> Option<usize> {
    Some(h.owners.borrow()[op["owner"].as_str().unwrap_or("root")])
}

fn run(ops: Vec<J>, h: Host) -> J {
    let mut rt = Runtime::default();
    // `makeOwner('root')`.
    let root = rt.create_root();
    h.owners.borrow_mut().insert("root".into(), root);
    let mut action_names = BTreeMap::new();
    for (index, op) in ops.into_iter().enumerate() {
        if h.trace {
            eprintln!("OP {index} {}", text(&op, "op"));
        }
        match text(&op, "op") {
            "signal" => {
                assert!(op["equals"].is_null() || op["equals"] == "default");
                let value = rust_solid::slice1::from_json(&op["value"]);
                let opt = op["optimistic"] == true;
                let id = rt.with_owner(Some(root), |rt| rt.signal_value(value));
                let name = text(&op, "id").to_owned();
                h.setters.borrow_mut().insert(
                    name.clone(),
                    if opt {
                        Setter::Optimistic(id)
                    } else {
                        Setter::Signal(id)
                    },
                );
                h.nodes.borrow_mut().insert(name, NodeRef::Node(id));
            }
            "memo" if op.get("children").is_some_and(|c| !c.is_null()) || has(&op, "cleanup") => {
                // `memoC(o)`.
                assert!(op["equals"].is_null() && op["lazy"] != true);
                let id = text(&op, "id").to_owned();
                let compute = children_body(&h, &op);
                let loading = op.get("loading").map(rust_solid::slice1::from_json);
                let owner = owner_of(&h, &op);
                let n = if op["optimistic"] == true {
                    let n = rt.with_owner(owner, |rt| rt.optimistic_memo(compute, loading));
                    h.setters
                        .borrow_mut()
                        .insert(id.clone(), Setter::Optimistic(n));
                    n
                } else {
                    rt.with_owner(owner, |rt| rt.memo_async(compute, loading))
                };
                h.nodes.borrow_mut().insert(id, NodeRef::Node(n));
            }
            "effect" if op.get("children").is_some_and(|c| !c.is_null()) || has(&op, "cleanup") => {
                // `effectC(o)`.
                let id = text(&op, "id").to_owned();
                let compute = children_body(&h, &op);
                let apply = effect_apply(&h, id.clone());
                let ty = if op["render"] == true {
                    EFFECT_RENDER
                } else {
                    EFFECT_USER
                };
                let error = (ty == EFFECT_USER).then(|| effect_error(&h, id));
                let defer = op["defer"] == true;
                let owner = owner_of(&h, &op);
                rt.with_owner(owner, |rt| rt.effect_with(compute, apply, error, ty, defer));
            }
            "memo" => {
                // Default equality, eager; an optional flight prefix and
                // loading value; `optimistic` is `createOptimistic(fn)`.
                assert!(op["equals"].is_null() && op["lazy"] != true);
                let id = text(&op, "id").to_owned();
                let compute = compute_body(&h, &op);
                let loading = op.get("loading").map(rust_solid::slice1::from_json);
                let owner = owner_of(&h, &op);
                let n = if op["optimistic"] == true {
                    let n = rt.with_owner(owner, |rt| rt.optimistic_memo(compute, loading));
                    h.setters
                        .borrow_mut()
                        .insert(id.clone(), Setter::Optimistic(n));
                    n
                } else {
                    rt.with_owner(owner, |rt| rt.memo_async(compute, loading))
                };
                h.nodes.borrow_mut().insert(id, NodeRef::Node(n));
            }
            "effect" => {
                let id = text(&op, "id").to_owned();
                let compute = compute_body(&h, &op);
                let (h1, h2) = (h.clone(), h.clone());
                let eid = id.clone();
                let apply: ValueEffectFn = Rc::new(
                    move |rt: &mut Runtime,
                          v: Value,
                          p: Value|
                          -> Option<rust_solid::slice1::Cleanup> {
                        push(&h1, json!(["effect", id, lg(rt, &h1, &v), lg(rt, &h1, &p)]));
                        let h = h1.clone();
                        let id = id.clone();
                        Some(Box::new(move |rt: &mut Runtime| {
                            push(&h, json!(["effect_cleanup", id, lg(rt, &h, &v)]))
                        }))
                    },
                );
                let ty = if op["render"] == true {
                    EFFECT_RENDER
                } else {
                    EFFECT_USER
                };
                let defer = op["defer"] == true;
                // A user effect installs a logged error callback.
                let error: Option<ErrorFn> = (ty == EFFECT_USER).then(|| {
                    Rc::new(move |_: &mut Runtime, e: &Error| {
                        push(&h2, json!(["error", eid, message(e)]))
                    }) as ErrorFn
                });
                let owner = owner_of(&h, &op);
                rt.with_owner(owner, |rt| rt.effect_with(compute, apply, error, ty, defer));
            }
            "write" => write(&mut rt, &h, text(&op, "id"), &op["value"]),
            "read" | "latest" | "pending" if has(&op, "expr") => {
                let e = op["expr"].clone();
                let kind = text(&op, "op");
                let r = match kind {
                    "read" => eval(&mut rt, &h, &e, &Value::Undef).map(|v| out(&rt, &h, &v)),
                    "latest" => rt
                        .latest_of(|rt| eval(rt, &h, &e, &Value::Undef))
                        .map(|v| out(&rt, &h, &v)),
                    _ => rt
                        .is_pending_of(|rt| eval(rt, &h, &e, &Value::Undef).map(|_| ()))
                        .map(|b| json!(b)),
                };
                push(&h, json!([kind, text(&op, "label"), observed(r)]));
            }
            "read" => {
                let name = text(&op, "id");
                let r = h.nodes.borrow()[name];
                let v = observed(call_ref(&mut rt, &h, r).map(|v| lg(&rt, &h, &v)));
                push(&h, json!(["read", op["label"].as_str().unwrap_or(name), v]));
            }
            "latest" => {
                let name = text(&op, "id");
                let r = h.nodes.borrow()[name];
                let v = observed(
                    rt.latest_of(|rt| call_ref(rt, &h, r))
                        .map(|v| lg(&rt, &h, &v)),
                );
                push(&h, json!(["latest", name, v]));
            }
            "pending" => {
                let name = text(&op, "id");
                let r = h.nodes.borrow()[name];
                let v = observed(
                    rt.is_pending_of(|rt| call_ref(rt, &h, r).map(|_| ()))
                        .map(|b| json!(b)),
                );
                push(&h, json!(["pending", name, v]));
            }
            "refresh" if has(&op, "store") => {
                let p = h.stores.borrow()[text(&op, "store")].clone();
                rt.refresh_store(&p);
            }
            "refresh" => {
                let NodeRef::Node(id) = h.nodes.borrow()[text(&op, "id")] else {
                    panic!("a refresh of a host function is outside the op language")
                };
                rt.refresh(id)
            }
            "flush" => rt.flush(),
            "owner" => {
                // `makeOwner(id, parent)`: a detached root, disposed by a
                // cleanup on its parent.
                let id = text(&op, "id").to_owned();
                let owner = rt.with_owner(None, |rt| rt.create_root());
                h.owners.borrow_mut().insert(id, owner);
                let parent = h.owners.borrow()[op["parent"].as_str().unwrap_or("root")];
                rt.with_owner(Some(parent), |rt| {
                    rt.on_cleanup(Box::new(move |rt: &mut Runtime| rt.dispose_root(owner)))
                });
            }
            "cleanup" => {
                let owner = owner_of(&h, &op);
                let label = text(&op, "label").to_owned();
                rt.with_owner(owner, |rt| log_cleanup(rt, &h, label));
            }
            "dispose" => {
                let owner = h.owners.borrow()[text(&op, "owner")];
                rt.dispose_root(owner);
            }
            "list" => {
                let id = text(&op, "id").to_owned();
                let owner = owner_of(&h, &op);
                let l = rt.with_owner(owner, |rt| make_list(rt, &h, &op, &pass_cx(None)));
                h.nodes.borrow_mut().insert(id, l);
            }
            "show" => {
                let id = text(&op, "id").to_owned();
                let owner = owner_of(&h, &op);
                let b = rt.with_owner(owner, |rt| make_show(rt, &h, &op, &pass_cx(None)));
                h.nodes.borrow_mut().insert(id, b);
            }
            "action" => {
                let extended = has(&op, "catch")
                    || op["slices"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|s| has(s, "steps"));
                let a = if extended {
                    rt.action(Box::new(Extended {
                        op: op.clone(),
                        index: 0,
                        sent: Value::Undef,
                        host: h.clone(),
                    }))
                } else {
                    rt.action(Box::new(Slices {
                        slices: op["slices"].as_array().unwrap().clone(),
                        index: 0,
                        host: h.clone(),
                    }))
                };
                action_names.insert(a, text(&op, "id").to_owned());
            }
            "resolve" | "reject" | "drain" => {
                if text(&op, "op") != "drain" {
                    let flight = text(&op, "flight");
                    let result = if op["op"] == "resolve" {
                        Ok(rust_solid::slice1::from_json(&op["value"]))
                    } else {
                        Err(text(&op, "message").to_owned())
                    };
                    rt.settle_flight_value(flight, result);
                }
                // `await drain()`: the queued microtasks run in order, then `S.flush()`.
                let h2 = h.clone();
                rt.run_microtasks(&mut |a, r| {
                    let message = match r {
                        Ok(()) => J::Null,
                        Err(e) => json!(e),
                    };
                    push(&h2, json!(["action", action_names[&a], message]));
                });
                rt.flush();
            }
            "store" => {
                let id = text(&op, "id").to_owned();
                let proxy = make_store(&mut rt, &h, &op, root);
                h.stores.borrow_mut().insert(id, proxy);
            }
            "store_set" => {
                if let Err(e) = run_set(&mut rt, &h, text(&op, "id"), &op) {
                    panic!(
                        "a store_set that throws ({}) is outside the op language",
                        e.message()
                    );
                }
            }
            "update" => {
                if let Err(e) = upd(&mut rt, &h, text(&op, "id"), &op["expr"]) {
                    panic!(
                        "an update that throws ({}) is outside the op language",
                        e.message()
                    );
                }
            }
            _ => panic!("operation outside the slice-1 driver: {}", op),
        }
    }
    // `owners.get('root').dispose(); S.flush()`; the trace is frozen before
    // any unrequested continuation.
    if h.trace {
        eprintln!("OP teardown teardown");
    }
    rt.dispose_root(root);
    rt.flush();
    let result = h.log.borrow().clone();
    json!(result)
}

/// The `store` op.
fn make_store(rt: &mut Runtime, h: &Host, op: &J, root: usize) -> Value {
    let v = rust_solid::slice1::from_json(if has(op, "value") {
        &op["value"]
    } else {
        &op["seed"]
    });
    let key = |o: &J| match o.get("key") {
        None => StoreKey::Field("id".into()),
        Some(J::Null) => StoreKey::Positional,
        Some(k) => StoreKey::Field(k.as_str().unwrap().into()),
    };
    if has(op, "derive") {
        assert!(
            op["optimistic"] == true,
            "a derived plain store is outside tier B"
        );
        let d = op["derive"].clone();
        let h2 = h.clone();
        let sid = text(op, "id").to_owned();
        let counts: RefCell<BTreeMap<i64, i64>> = RefCell::new(BTreeMap::new());
        let derive: rust_solid::slice1::BodyFn = Rc::new(move |rt: &mut Runtime, _draft: Value| {
            within(&h2, None, || {
                let k = eval(rt, &h2, &d["expr"], &Value::Undef)?;
                let k = int(k);
                let mut name = format!("{}:{k}", text(&d, "flight"));
                if d["fresh"] == true {
                    let mut c = counts.borrow_mut();
                    let n = c.entry(k).or_insert(0);
                    *n += 1;
                    name = format!("{name}#{n}");
                }
                push(&h2, json!(["derive", sid, k]));
                push(&h2, json!(["flight", name]));
                Ok(Out::Flight(name))
            })
        });
        let seed_loading = op["seedLoading"] == true;
        return rt.with_owner(Some(root), |rt| {
            rt.create_optimistic_store_derived(derive, v, key(op), seed_loading)
        });
    }
    if op["optimistic"] == true {
        // `{key: o.key}` only when the op has one: absent is "id".
        return rt.with_owner(Some(root), |rt| rt.create_optimistic_store(v, key(op)));
    }
    let shallow = op["shallow"] == true;
    rt.with_owner(Some(root), |rt| rt.create_store(v, shallow))
}

fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let host: Host = Rc::new(HostState {
            trace: std::env::var_os("SLICE1_TRACE").is_some(),
            ..HostState::default()
        });
        let h = host.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            run(serde_json::from_str(&line).unwrap(), h)
        }))
        .unwrap_or_else(|_| {
            // Debugging aid: the trace up to the panic, on request only.
            if std::env::var_os("SLICE1_DRIVER_PARTIAL").is_some() {
                eprintln!("{}", json!(host.log.borrow().clone()));
            }
            json!({"driver_error":"panic"})
        });
        println!("{}", result);
    }
}

#[allow(dead_code)]
fn _unused(_: Thrown) {}
