//! The JS values Solid's server build passes around while it renders: plain
//! data (the server keeps signals and stores as plain values, never proxies),
//! the `{ t }` template objects `ssr()` returns and the `{ t, h, p }` results
//! of a render that suspended, functions (accessors, memo reads, hole thunks,
//! row mappers), and, for async data (plan v2.1), promises and error objects
//! (`Error`, Solid's `NotReadyError`).
//!
//! Numbers are integers: plans have no others, and every integer is in the
//! safe range (`plan_v2::validate` and the evaluator's checked sums), so
//! `i64::to_string` is JS's `String(n)`.
use super::js::{Deferred, JsPromise};
use super::Server;
use std::{
    cell::{Cell, RefCell},
    fmt,
    rc::Rc,
};

/// A thrown JS value. Solid's `ssrHandleError` rethrows any error that is not
/// a `NotReadyError` when no `<Errored>` boundary is above it
/// (solid/src/server/hydration.ts:54-69), `renderToString` rethrows it to
/// its caller (web/src/server.ts:1936-1946), and an `<Errored>` boundary
/// catches it (signals.ts:4167-4558).
#[derive(Clone)]
pub struct Thrown(pub JsVal);

impl Thrown {
    /// `throw new Error(message)`.
    pub fn msg(message: impl Into<String>) -> Thrown {
        Thrown(JsVal::Error(JsError::new(ErrClass::Error, message)))
    }

    /// The thrown value's `NotReadyError`, if it is one.
    pub fn not_ready(&self) -> Option<&Rc<JsError>> {
        match &self.0 {
            JsVal::Error(e) if e.class == ErrClass::NotReady => Some(e),
            _ => None,
        }
    }

    pub fn same(&self, other: &Thrown) -> bool {
        self.0.strict_eq(&other.0)
    }
}

impl fmt::Display for Thrown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            JsVal::Error(e) => match e.class {
                ErrClass::NotReady => f.write_str("NotReadyError (a pending async read)"),
                _ => f.write_str(&e.message),
            },
            other => write!(f, "{other:?}"),
        }
    }
}

impl fmt::Debug for Thrown {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Thrown({self})")
    }
}

pub type Res<T> = Result<T, Thrown>;

pub fn throw<T>(message: impl Into<String>) -> Res<T> {
    Err(Thrown::msg(message))
}

/// An error object's class: the constructor seroval and `instanceof` see.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrClass {
    Error,
    TypeError,
    /// `NotReadyError` (@solidjs/signals `core/error.ts:25-46`): a thrown
    /// pending read, carrying the promise (`source`) the read waits on.
    NotReady,
}

pub struct JsError {
    pub class: ErrClass,
    pub message: String,
    /// `NotReadyError.source`.
    pub source: RefCell<JsVal>,
}

impl JsError {
    pub fn new(class: ErrClass, message: impl Into<String>) -> Rc<JsError> {
        Rc::new(JsError {
            class,
            message: message.into(),
            source: RefCell::new(JsVal::Undefined),
        })
    }

    // Solid: signals core/error.ts:25-46 (`new NotReadyError(source)`)
    pub fn not_ready(source: JsVal) -> Rc<JsError> {
        Rc::new(JsError {
            class: ErrClass::NotReady,
            message: String::new(),
            source: RefCell::new(source),
        })
    }
}

/// `ssr()`'s and `resolveSSRNode`'s `{ t: string[], h: fn[], p: promise[] }`:
/// the template parts around the holes that suspended, the holes, and the
/// promises each waits on (web/src/server.ts:4742-5005, 6285-6362).
pub struct SsrRes {
    pub t: RefCell<Vec<String>>,
    pub h: RefCell<Vec<JsVal>>,
    pub p: RefCell<Vec<JsVal>>,
}

impl SsrRes {
    pub fn new(first: String) -> Rc<SsrRes> {
        Rc::new(SsrRes {
            t: RefCell::new(vec![first]),
            h: RefCell::new(vec![]),
            p: RefCell::new(vec![]),
        })
    }
}

pub type Body = dyn Fn(&mut Server, &[JsVal]) -> Res<JsVal>;

/// A JS function: its declared arity (`fn.length`, which `Show` and
/// `mapArray` read) and its body, plus the expando brands the server reads:
/// `esc` is web/src/server.ts's `$esc` on an `escapeLate` wrapper, `rw` the
/// `$rw` of a `buildAsyncWrap` re-owned hole, `lh_skip` `$lhSkip`, `inner` the
/// `$fn` of an `escapeLate` wrapper (the function it escapes, which a live hole
/// reads, frames only).
pub struct JsFn {
    pub arity: usize,
    pub esc: bool,
    pub rw: bool,
    pub lh_skip: Cell<bool>,
    pub inner: Option<JsVal>,
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
    /// `ssr()`'s synchronous result `{ t: string }`.
    Tmpl(Rc<str>),
    /// A suspended `{ t, h, p }` result.
    Res(Rc<SsrRes>),
    Fn(Rc<JsFn>),
    Promise(Rc<JsPromise>),
    Error(Rc<JsError>),
    /// An object only the runtime reads (a deferred's record, seroval's
    /// resolver `{}`); compared by identity.
    Deferred(Rc<Deferred>),
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
            JsVal::Res(r) => write!(
                f,
                "{{ t: {:?}, h: {} hole(s) }}",
                r.t.borrow(),
                r.h.borrow().len()
            ),
            JsVal::Fn(func) => write!(f, "[function/{}]", func.arity),
            JsVal::Promise(_) => write!(f, "[promise]"),
            JsVal::Error(e) => match e.class {
                ErrClass::NotReady => write!(f, "[NotReadyError]"),
                _ => write!(f, "[Error {:?}]", e.message),
            },
            JsVal::Deferred(_) => write!(f, "[deferred]"),
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
            rw: false,
            lh_skip: Cell::new(false),
            inner: None,
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
            JsVal::Arr(_)
            | JsVal::Rec(_)
            | JsVal::Tmpl(_)
            | JsVal::Res(_)
            | JsVal::Fn(_)
            | JsVal::Promise(_)
            | JsVal::Error(_)
            | JsVal::Deferred(_) => true,
        }
    }

    /// `value == null`.
    pub fn nullish(&self) -> bool {
        matches!(self, JsVal::Undefined | JsVal::Null)
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
            (JsVal::Res(a), JsVal::Res(b)) => Rc::ptr_eq(a, b),
            (JsVal::Fn(a), JsVal::Fn(b)) => Rc::ptr_eq(a, b),
            (JsVal::Promise(a), JsVal::Promise(b)) => Rc::ptr_eq(a, b),
            (JsVal::Error(a), JsVal::Error(b)) => Rc::ptr_eq(a, b),
            (JsVal::Deferred(a), JsVal::Deferred(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// An object (not a primitive): its identity, for the maps JS keys by
    /// object (seroval's `refs`, the error verdicts, `guardedChannels`).
    pub fn identity(&self) -> Option<usize> {
        Some(match self {
            JsVal::Arr(a) => Rc::as_ptr(a) as *const () as usize,
            JsVal::Rec(r) => Rc::as_ptr(r) as *const () as usize,
            JsVal::Tmpl(t) => Rc::as_ptr(t) as *const () as usize,
            JsVal::Res(r) => Rc::as_ptr(r) as *const () as usize,
            JsVal::Fn(f) => Rc::as_ptr(f) as *const () as usize,
            JsVal::Promise(p) => Rc::as_ptr(p) as *const () as usize,
            JsVal::Error(e) => Rc::as_ptr(e) as *const () as usize,
            JsVal::Deferred(d) => Rc::as_ptr(d) as *const () as usize,
            _ => return None,
        })
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
        other => Err(Thrown(JsVal::Error(JsError::new(
            ErrClass::TypeError,
            format!("{other:?} is not a function"),
        )))),
    }
}
