//! Solid: error.ts — `NotReadyError`, `StatusError` and `unwrapStatusError`.
//!
//! JS error objects are compared by identity in Solid (`_error === error`,
//! async.ts `settleErroredDependents`, `propagateStatus`), so an error here
//! is a reference-counted object compared with `Rc::ptr_eq`.
use super::NodeId;
use std::rc::Rc;

/// A thrown JS value as Solid sees it.
pub type Error = Rc<Thrown>;

#[derive(Debug)]
pub enum Thrown {
    /// error.ts:25-49 `new NotReadyError(source)`; `None` is a null source.
    NotReady(Option<NodeId>),
    /// error.ts:51-62 `new StatusError(source, original)`: its message is the
    /// original's, its `cause` the original.
    Status { source: NodeId, cause: Error },
    /// A user `Error` with its message (a host rejection, a thrown expression).
    User(String),
    /// A thrown non-Error value: a string (`throw "…"`). Its `message` is
    /// `undefined` in JS; `String(e)` is the string.
    Str(String),
}

impl Thrown {
    pub fn is_not_ready(&self) -> bool {
        matches!(self, Thrown::NotReady(_))
    }
    /// `error.message`.
    pub fn message(&self) -> String {
        match self {
            Thrown::NotReady(_) => String::new(),
            Thrown::Status { cause, .. } => cause.message(),
            Thrown::User(m) => m.clone(),
            // `String(e)`: a host that reads `e.message` of a thrown string
            // must test `is_str` (JS gives `undefined`).
            Thrown::Str(m) => m.clone(),
        }
    }
    /// A thrown string (no `message`).
    pub fn is_str(&self) -> bool {
        matches!(self, Thrown::Str(_))
    }
    /// `error.source` for the two Solid errors (`undefined` for a user error).
    pub(super) fn source(&self) -> Option<Option<NodeId>> {
        match self {
            Thrown::NotReady(s) => Some(*s),
            Thrown::Status { source, .. } => Some(Some(*source)),
            Thrown::User(_) | Thrown::Str(_) => None,
        }
    }
}

/// `new Error(message)`.
pub fn user(message: String) -> Error {
    Rc::new(Thrown::User(message))
}

/// `throw "…"` (a thrown string).
pub fn thrown_string(s: String) -> Error {
    Rc::new(Thrown::Str(s))
}

// Solid: error.ts:36-48
pub(super) fn not_ready(source: Option<NodeId>) -> Error {
    Rc::new(Thrown::NotReady(source))
}

// Solid: error.ts:53-62
pub(super) fn status_error(source: NodeId, original: Error) -> Error {
    Rc::new(Thrown::Status {
        source,
        cause: original,
    })
}

// Solid: error.ts:66-68
pub fn unwrap_status_error(e: &Error) -> Error {
    match &**e {
        Thrown::Status { cause, .. } => cause.clone(),
        _ => e.clone(),
    }
}

/// `a === b` for thrown objects.
pub(super) fn same(a: &Option<Error>, b: &Option<Error>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}
