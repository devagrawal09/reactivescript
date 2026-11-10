//! The JS values the store tier observes (not a Solid file). Solid's stores
//! work on raw JS objects and arrays by identity (`===`, WeakMap lookups,
//! CoW clones stamped with `$OWNER`) and hand out one proxy per target, so a
//! value here is an `Rc` object compared by pointer, a store proxy compared
//! by its target, or a primitive. Property order follows JS
//! (`[[OwnPropertyKeys]]`): integer keys ascending, then string keys in
//! insertion order (an array's `length` first among them), then the
//! `$OWNER` symbol, which is kept apart (`owner`).
use std::{cell::RefCell, collections::BTreeMap, fmt, rc::Rc};

/// A store target (`StoreTarget`, store/target.ts), by arena index.
pub type TargetId = usize;
/// A projection family (`StoreFamily`), by arena index.
pub type FamId = usize;

thread_local! {
    static NEXT_OBJECT: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
}

fn next_id() -> u64 {
    NEXT_OBJECT.with(|c| {
        let id = c.get();
        c.set(id + 1);
        id
    })
}

/// A property key. Integer-like string keys are canonical integers, as JS
/// property access converts them (`a["0"]` is `a[0]`).
#[derive(Clone, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Key {
    Idx(u32),
    Name(Rc<str>),
    /// A well-known symbol (`Symbol.asyncIterator`, …).
    Sym(&'static str),
}

impl Key {
    pub fn name(s: &str) -> Key {
        match s.parse::<u32>() {
            Ok(i) if i.to_string() == s => Key::Idx(i),
            _ => Key::Name(s.into()),
        }
    }
    pub fn is(&self, s: &str) -> bool {
        matches!(self, Key::Name(n) if &**n == s)
    }
    pub fn text(&self) -> String {
        match self {
            Key::Idx(i) => i.to_string(),
            Key::Name(n) => n.to_string(),
            Key::Sym(s) => format!("Symbol({s})"),
        }
    }
}

/// A JS function value the ops can reach through a get: a prototype method
/// or `constructor` (store.ts's get trap answers them from the prototype).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Builtin {
    ArrayCtor,
    ObjectCtor,
    ArrayMethod(&'static str),
    /// A host function value (not a Solid value): an accessor the host
    /// hands Solid as a computed's value (a `<For>` accessor), compared by
    /// identity.
    Host(u64),
}

/// A fresh identity for a host function value.
pub fn new_host_fn() -> Builtin {
    Builtin::Host(next_id())
}

/// A JS value.
#[derive(Clone)]
pub enum Value {
    Undef,
    Bool(bool),
    Int(i64),
    /// A raw object or array (identity: the `Rc`).
    Obj(Obj),
    /// A store proxy (`t.px`), identified by its target.
    Proxy(TargetId),
    /// A projection draft wrapper (projection.ts `wrapDraft`).
    Draft(Rc<DraftProxy>),
    /// An arrangement guess (`LaneView`, store.ts).
    View(View),
    Func(Builtin),
    /// Solid's `NOT_PENDING` sentinel (`{}`, constants.ts:267) where JS
    /// assigns it as a value (`el._value = display(el)` of a node with
    /// nothing on screen, lanes.ts:433).
    NotPending,
    /// A JS string, compared by content (`===`). JS strings are UTF-16;
    /// equality, concatenation and `ToString` do not depend on the
    /// encoding, so the content is kept as UTF-8. `length` and indexing
    /// count UTF-16 code units (`Value::str_get`).
    Str(Rc<str>),
    /// A renderer host node (`NodeType` of `@solidjs/universal`'s
    /// `createRenderer`, a `renderer::Node`): an object compared by
    /// identity. It has no properties the runtime reads (no `then`, no
    /// `Symbol.asyncIterator`).
    Node(usize),
    /// A thrown object held as a value: an error boundary's `_error`
    /// signal (boundaries.ts:735, `setSignal(b._error, caught)`), compared
    /// by identity. No op reads its properties.
    Error(super::Error),
}

impl Value {
    pub fn is_undef(&self) -> bool {
        matches!(self, Value::Undef)
    }
    /// `v !== null && typeof v === "object"` (`undefined`, numbers, booleans
    /// and functions are not).
    pub fn is_object(&self) -> bool {
        matches!(
            self,
            Value::Obj(_)
                | Value::Proxy(_)
                | Value::Draft(_)
                | Value::View(_)
                | Value::NotPending
                | Value::Node(_)
                | Value::Error(_)
        )
    }
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            _ => None,
        }
    }
    pub fn obj(&self) -> Option<&Obj> {
        match self {
            Value::Obj(o) => Some(o),
            _ => None,
        }
    }
    /// JS truthiness (`ToBoolean`): `undefined`, `false`, `0` and `""` are
    /// falsy.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Undef => false,
            Value::Bool(b) => *b,
            Value::Int(i) => *i != 0,
            Value::Str(s) => !s.is_empty(),
            _ => true,
        }
    }
    /// A string value.
    pub fn str(s: &str) -> Value {
        Value::Str(Rc::from(s))
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    /// `typeof v` (a host node and every object kind are `"object"`; a
    /// `Func` is `"function"`).
    pub fn type_of(&self) -> &'static str {
        match self {
            Value::Undef => "undefined",
            Value::Bool(_) => "boolean",
            Value::Int(_) => "number",
            Value::Str(_) => "string",
            Value::Func(_) => "function",
            _ => "object",
        }
    }
    /// ECMA-262 `ToString` of a primitive: a string is itself, an integer
    /// is its shortest decimal form (no grouping, a leading `-`), a boolean
    /// is `"true"`/`"false"`, `undefined` is `"undefined"`. An object's
    /// `ToString` runs `ToPrimitive` (user-visible `toString`/`valueOf`
    /// lookups): `None`, the caller refuses it.
    pub fn to_js_string(&self) -> Option<String> {
        match self {
            Value::Str(s) => Some(s.to_string()),
            Value::Int(i) => Some(i.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            Value::Undef => Some("undefined".into()),
            _ => None,
        }
    }
    /// The binary `+` (ECMA-262 `ApplyStringOrNumericBinaryOperator`) on
    /// primitives: if either operand is a string, the concatenation of both
    /// operands' `ToString`; otherwise numeric addition of `ToNumber`
    /// (`true` is 1, `false` 0). `None` where the result leaves the value
    /// domain (an object operand needs `ToPrimitive`; `undefined` gives
    /// `NaN`; a sum beyond 2^53 - 1 is not an exact JS number).
    pub fn js_add(&self, other: &Value) -> Option<Value> {
        if matches!(self, Value::Str(_)) || matches!(other, Value::Str(_)) {
            let mut s = self.to_js_string()?;
            s.push_str(&other.to_js_string()?);
            return Some(Value::Str(Rc::from(s)));
        }
        let num = |v: &Value| match v {
            Value::Int(i) => Some(*i),
            Value::Bool(b) => Some(*b as i64),
            _ => None,
        };
        let sum = num(self)?.checked_add(num(other)?)?;
        const MAX_SAFE: i64 = (1 << 53) - 1;
        (-MAX_SAFE..=MAX_SAFE)
            .contains(&sum)
            .then_some(Value::Int(sum))
    }
    /// `s.length` and `s[i]` of a string (UTF-16 code units, as JS).
    /// `None` for an index past the end (`undefined`). A lone surrogate
    /// is not a Rust string: an index that splits a pair panics (outside
    /// the value domain).
    pub fn str_get(s: &str, k: &Key) -> Option<Value> {
        let units: Vec<u16> = s.encode_utf16().collect();
        match k {
            Key::Name(n) if &**n == "length" => Some(Value::Int(units.len() as i64)),
            Key::Idx(i) => units.get(*i as usize).map(|u| {
                Value::Str(Rc::from(
                    String::from_utf16(&[*u])
                        .expect("a lone surrogate is outside the value domain")
                        .as_str(),
                ))
            }),
            _ => None,
        }
    }
}

/// `===`.
impl PartialEq for Value {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Undef, Value::Undef) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Int(a), Value::Int(b)) => a == b,
            (Value::Obj(a), Value::Obj(b)) => Rc::ptr_eq(a, b),
            (Value::Proxy(a), Value::Proxy(b)) => a == b,
            (Value::Draft(a), Value::Draft(b)) => Rc::ptr_eq(a, b),
            (Value::View(a), Value::View(b)) => Rc::ptr_eq(a, b),
            (Value::Func(a), Value::Func(b)) => a == b,
            (Value::NotPending, Value::NotPending) => true,
            (Value::Str(a), Value::Str(b)) => a == b,
            (Value::Node(a), Value::Node(b)) => a == b,
            (Value::Error(a), Value::Error(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Undef => write!(f, "undefined"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Int(i) => write!(f, "{i}"),
            Value::Obj(o) => write!(f, "obj#{}", o.id),
            Value::Proxy(t) => write!(f, "proxy@{t}"),
            Value::Draft(d) => write!(f, "draft@{:?}", d.inner),
            Value::View(_) => write!(f, "LaneView"),
            Value::Func(b) => write!(f, "{b:?}"),
            Value::NotPending => write!(f, "NOT_PENDING"),
            Value::Str(s) => write!(f, "{s:?}"),
            Value::Node(n) => write!(f, "node#{n}"),
            Value::Error(e) => write!(f, "error({:?})", e.message()),
        }
    }
}

/// `Some(n)` is the integer `n`, `None` is `undefined` (the slice-1 API).
impl PartialEq<Option<i64>> for Value {
    fn eq(&self, other: &Option<i64>) -> bool {
        match (self, other) {
            (Value::Undef, None) => true,
            (Value::Int(a), Some(b)) => a == b,
            _ => false,
        }
    }
}

impl From<i64> for Value {
    fn from(i: i64) -> Value {
        Value::Int(i)
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Value {
        Value::Str(Rc::from(s))
    }
}

/// A raw JS object or array.
pub struct JsObj {
    pub id: u64,
    pub array: bool,
    pub props: RefCell<Props>,
}
pub type Obj = Rc<JsObj>;

/// Own properties. An array's elements are its integer keys (holes are
/// absent keys) and `len` its `length`.
#[derive(Clone, Default)]
pub struct Props {
    pub idx: BTreeMap<u32, Value>,
    pub len: u32,
    pub names: Vec<(Rc<str>, Value)>,
    /// The `$OWNER` stamp (store/target.ts): the owning target.
    pub owner: Option<TargetId>,
}

impl JsObj {
    fn make(array: bool, props: Props) -> Obj {
        Rc::new(JsObj {
            id: next_id(),
            array,
            props: RefCell::new(props),
        })
    }
    pub fn new_array(items: Vec<Value>) -> Obj {
        let mut p = Props::default();
        for (i, v) in items.into_iter().enumerate() {
            p.idx.insert(i as u32, v);
        }
        p.len = p.idx.len() as u32;
        JsObj::make(true, p)
    }
    pub fn new_object(fields: Vec<(Rc<str>, Value)>) -> Obj {
        let o = JsObj::make(false, Props::default());
        for (k, v) in fields {
            o.set(&Key::name(&k), v);
        }
        o
    }
    /// A shallow copy of the own properties (`{...o}` / `slice()`), owner
    /// stamp included.
    pub fn shallow_clone(&self) -> Obj {
        JsObj::make(self.array, self.props.borrow().clone())
    }
    /// `[[Get]]` of an own data property.
    pub fn get_own(&self, k: &Key) -> Option<Value> {
        let p = self.props.borrow();
        match k {
            Key::Idx(i) => p.idx.get(i).cloned(),
            Key::Name(n) if self.array && &**n == "length" => Some(Value::Int(p.len as i64)),
            Key::Name(n) => p.names.iter().find(|(m, _)| m == n).map(|(_, v)| v.clone()),
            Key::Sym(_) => None,
        }
    }
    /// `o[k]`: own data, else the prototype's answer (`Array.prototype` /
    /// `Object.prototype`).
    pub fn get(&self, k: &Key) -> Value {
        self.get_own(k).unwrap_or_else(|| proto_get(self.array, k))
    }
    pub fn has_own(&self, k: &Key) -> bool {
        let p = self.props.borrow();
        match k {
            Key::Idx(i) => p.idx.contains_key(i),
            Key::Name(n) if self.array && &**n == "length" => true,
            Key::Name(n) => p.names.iter().any(|(m, _)| m == n),
            Key::Sym(_) => false,
        }
    }
    /// `k in o`.
    pub fn has(&self, k: &Key) -> bool {
        self.has_own(k) || !proto_get(self.array, k).is_undef()
    }
    /// `o[k] = v` (an array's index grows its length; `length` truncates).
    pub fn set(&self, k: &Key, v: Value) {
        let mut p = self.props.borrow_mut();
        match k {
            Key::Idx(i) => {
                p.idx.insert(*i, v);
                if self.array && *i >= p.len {
                    p.len = *i + 1;
                }
            }
            Key::Name(n) if self.array && &**n == "length" => {
                let Value::Int(l) = v else {
                    panic!("an array length that is not an integer is outside the op language")
                };
                let l = l as u32;
                p.idx.retain(|i, _| *i < l);
                p.len = l;
            }
            Key::Name(n) => match p.names.iter_mut().find(|(m, _)| m == n) {
                Some(slot) => slot.1 = v,
                None => p.names.push((n.clone(), v)),
            },
            Key::Sym(s) => panic!("a write of Symbol({s}) is outside the op language"),
        }
    }
    /// `delete o[k]`.
    pub fn delete(&self, k: &Key) -> bool {
        let mut p = self.props.borrow_mut();
        match k {
            Key::Idx(i) => {
                p.idx.remove(i);
            }
            Key::Name(n) if self.array && &**n == "length" => return false,
            Key::Name(n) => p.names.retain(|(m, _)| m != n),
            Key::Sym(_) => {}
        }
        true
    }
    /// `Reflect.ownKeys(o)` without the `$OWNER` symbol.
    pub fn own_keys(&self) -> Vec<Key> {
        let p = self.props.borrow();
        let mut keys: Vec<Key> = p.idx.keys().map(|i| Key::Idx(*i)).collect();
        if self.array {
            keys.push(Key::Name("length".into()));
        }
        keys.extend(p.names.iter().map(|(n, _)| Key::Name(n.clone())));
        keys
    }
    /// `Reflect.ownKeys(o).length`, the `$OWNER` symbol included.
    pub fn own_key_count(&self) -> usize {
        self.own_keys().len() + usize::from(self.props.borrow().owner.is_some())
    }
    /// `Object.keys(o)` (enumerable own string keys: an array's `length`
    /// is not enumerable).
    pub fn keys(&self) -> Vec<Key> {
        let mut k = self.own_keys();
        if self.array {
            k.retain(|k| !k.is("length"));
        }
        k
    }
    pub fn len(&self) -> u32 {
        self.props.borrow().len
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn owner(&self) -> Option<TargetId> {
        self.props.borrow().owner
    }
    pub fn set_owner(&self, t: Option<TargetId>) {
        self.props.borrow_mut().owner = t;
    }
    /// The elements `0..length` (`undefined` for holes).
    pub fn elements(&self) -> Vec<Value> {
        let p = self.props.borrow();
        (0..p.len)
            .map(|i| p.idx.get(&i).cloned().unwrap_or(Value::Undef))
            .collect()
    }
}

/// The prototype's answer for `k`: methods and `constructor` (functions),
/// else `undefined`.
pub fn proto_get(array: bool, k: &Key) -> Value {
    match k {
        Key::Name(n) => match (&**n, array) {
            ("constructor", true) => Value::Func(Builtin::ArrayCtor),
            ("constructor", false) => Value::Func(Builtin::ObjectCtor),
            ("filter", true) => Value::Func(Builtin::ArrayMethod("filter")),
            ("map", true) => Value::Func(Builtin::ArrayMethod("map")),
            ("findIndex", true) => Value::Func(Builtin::ArrayMethod("findIndex")),
            ("splice", true) => Value::Func(Builtin::ArrayMethod("splice")),
            ("slice", true) => Value::Func(Builtin::ArrayMethod("slice")),
            _ => Value::Undef,
        },
        Key::Idx(_) | Key::Sym(_) => Value::Undef,
    }
}

/// `LaneView` (store.ts:272-282): the container node's arrangement guess.
pub struct LaneView {
    /// The rows the setter wrote (an array of raw rows, or a record of the
    /// keys), recomposed by a re-base.
    pub rows: Obj,
    /// The backing the guess is shown over.
    pub base: Obj,
    /// `removed`: the keys (`null` when not keyed).
    pub removed: Option<Vec<Value>>,
    /// `g`: `undefined` (None), `null` (Some(None)) or the guessed rows.
    pub g: Option<Option<Obj>>,
}
pub type View = Rc<RefCell<LaneView>>;

/// projection.ts `wrapDraft`'s proxy: every operation carries the write
/// override. The ops never write through it (the derive returns its answer).
pub struct DraftProxy {
    pub inner: Value,
    pub id: u64,
    pub shallow: bool,
}

impl DraftProxy {
    pub fn new(inner: Value, shallow: bool) -> Rc<DraftProxy> {
        Rc::new(DraftProxy {
            inner,
            id: next_id(),
            shallow,
        })
    }
}

/// `structuredClone` of a JSON value: fresh objects all the way down.
pub fn from_json(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Number(n) => Value::Int(
            n.as_i64()
                .expect("a non-integer number is outside the op language"),
        ),
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Array(a) => {
            Value::Obj(JsObj::new_array(a.iter().map(from_json).collect()))
        }
        serde_json::Value::Object(o) => Value::Obj(JsObj::new_object(
            o.iter()
                .map(|(k, v)| (Rc::from(k.as_str()), from_json(v)))
                .collect(),
        )),
        serde_json::Value::Null => panic!("null is outside the op language"),
        serde_json::Value::String(s) => Value::Str(Rc::from(s.as_str())),
    }
}
