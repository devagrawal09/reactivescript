//! The JS values Solid's server build passes around while it renders: plain
//! data (the server keeps signals and stores as plain values, never proxies),
//! the `{ t }` template objects `ssr()` returns, and functions (accessors,
//! memo reads, hole thunks, row mappers).
//!
//! Numbers are integers: plan v2 has no others, and every integer is in the
//! safe range (`plan_v2::validate` and the evaluator's checked sums), so
//! `i64::to_string` is JS's `String(n)`.
use super::Server;
use std::{cell::RefCell, fmt, rc::Rc};

/// A thrown JS value, carried as its message. Nothing on the server path of
/// a plan app catches one: Solid's `ssrHandleError` rethrows any error that
/// is not a `NotReadyError` when no `<Errored>` boundary is above it
/// (solid/src/server/hydration.ts:54-69), and `renderToString` rethrows it
/// to its caller (web/src/server.ts:1936-1946).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Thrown(pub String);

impl fmt::Display for Thrown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

pub type Res<T> = Result<T, Thrown>;

pub fn throw<T>(message: impl Into<String>) -> Res<T> {
    Err(Thrown(message.into()))
}

pub type Body = dyn Fn(&mut Server, &[JsVal]) -> Res<JsVal>;

/// A JS function: its declared arity (`fn.length`, which `Show` and
/// `mapArray` read) and its body. `esc` is web/src/server.ts's `$esc` brand
/// on an `escapeLate` wrapper.
pub struct JsFn {
    pub arity: usize,
    pub esc: bool,
    pub body: Box<Body>,
}

#[derive(Clone)]
pub enum JsVal {
    Undefined,
    Null,
    Bool(bool),
    Num(i64),
    Str(Rc<str>),
    Arr(Rc<RefCell<Vec<JsVal>>>),
    /// A plain record, keys in insertion order.
    Rec(Rc<RefCell<Vec<(String, JsVal)>>>),
    /// `ssr()`'s synchronous result `{ t: string }` (no `h`: nothing on a
    /// plan app's server path suspends).
    Tmpl(Rc<str>),
    Fn(Rc<JsFn>),
}

impl fmt::Debug for JsVal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JsVal::Undefined => write!(f, "undefined"),
            JsVal::Null => write!(f, "null"),
            JsVal::Bool(b) => write!(f, "{b}"),
            JsVal::Num(n) => write!(f, "{n}"),
            JsVal::Str(s) => write!(f, "{s:?}"),
            JsVal::Arr(a) => f.debug_list().entries(a.borrow().iter()).finish(),
            JsVal::Rec(r) => {
                let r = r.borrow();
                let mut m = f.debug_map();
                for (k, v) in r.iter() {
                    m.entry(k, v);
                }
                m.finish()
            }
            JsVal::Tmpl(t) => write!(f, "{{ t: {t:?} }}"),
            JsVal::Fn(func) => write!(f, "[function/{}]", func.arity),
        }
    }
}

impl JsVal {
    pub fn str(s: &str) -> JsVal {
        JsVal::Str(Rc::from(s))
    }

    pub fn array(items: Vec<JsVal>) -> JsVal {
        JsVal::Arr(Rc::new(RefCell::new(items)))
    }

    pub fn func(
        arity: usize,
        body: impl Fn(&mut Server, &[JsVal]) -> Res<JsVal> + 'static,
    ) -> JsVal {
        JsVal::Fn(Rc::new(JsFn {
            arity,
            esc: false,
            body: Box::new(body),
        }))
    }

    /// JS truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            JsVal::Undefined | JsVal::Null => false,
            JsVal::Bool(b) => *b,
            JsVal::Num(n) => *n != 0,
            JsVal::Str(s) => !s.is_empty(),
            JsVal::Arr(_) | JsVal::Rec(_) | JsVal::Tmpl(_) | JsVal::Fn(_) => true,
        }
    }

    /// `===`: scalars by type and value, objects and functions by identity.
    pub fn strict_eq(&self, other: &JsVal) -> bool {
        match (self, other) {
            (JsVal::Undefined, JsVal::Undefined) | (JsVal::Null, JsVal::Null) => true,
            (JsVal::Bool(a), JsVal::Bool(b)) => a == b,
            (JsVal::Num(a), JsVal::Num(b)) => a == b,
            (JsVal::Str(a), JsVal::Str(b)) => a == b,
            (JsVal::Arr(a), JsVal::Arr(b)) => Rc::ptr_eq(a, b),
            (JsVal::Rec(a), JsVal::Rec(b)) => Rc::ptr_eq(a, b),
            (JsVal::Tmpl(a), JsVal::Tmpl(b)) => Rc::ptr_eq(a, b),
            (JsVal::Fn(a), JsVal::Fn(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
}

/// Calls a JS function value with `args`; calling anything else throws, as
/// JS does.
pub fn call(s: &mut Server, f: &JsVal, args: &[JsVal]) -> Res<JsVal> {
    match f {
        JsVal::Fn(func) => {
            let func = func.clone();
            (func.body)(s, args)
        }
        other => throw(format!("TypeError: {other:?} is not a function")),
    }
}
