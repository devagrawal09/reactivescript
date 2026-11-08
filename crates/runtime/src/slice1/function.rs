//! JS function values the host creates (not a Solid file). Solid's
//! renderer and flow code pass functions around as values: accessors
//! (`accessor(node)`, signals.ts:140-144), component children, `<For>`
//! mappers, event handlers. A function value is `Value::Func(Builtin::Host
//! (id))`, compared by identity like every `Func`, so the `typeof v ===
//! "function"` checks the port already makes see it. Its body and its
//! `length` (the declared parameter count, which `flatten` and
//! `<Show>`/`mapArray` test) live in `Runtime::functions`.
//!
//! The table is never pruned: a value has no destructor that could tell
//! the runtime it is unreachable. Programs here are bounded.
use super::*;

/// A function body: the receiver is not passed (no body here reads
/// `this`); `args` are the call's arguments.
pub type FnBody = Rc<dyn Fn(&mut Runtime, &[Value]) -> Result<Value, Error>>;

pub(super) struct JsFunction {
    length: usize,
    body: FnBody,
}

impl Runtime {
    /// A new function value with `length` declared parameters.
    pub fn function(&mut self, length: usize, body: FnBody) -> Value {
        let f = new_host_fn();
        let Builtin::Host(id) = f else { unreachable!() };
        self.functions.insert(id, JsFunction { length, body });
        Value::Func(f)
    }

    /// `f.length`, for a function value made by `function`.
    pub fn function_length(&self, f: &Value) -> Option<usize> {
        match f {
            Value::Func(Builtin::Host(id)) => self.functions.get(id).map(|j| j.length),
            _ => None,
        }
    }

    /// `f(...args)`. Calling anything but a function made by `function` is
    /// a `TypeError` outside the value domain: it panics.
    pub fn call(&mut self, f: &Value, args: &[Value]) -> Result<Value, Error> {
        let body = match f {
            Value::Func(Builtin::Host(id)) => self.functions.get(id).map(|j| j.body.clone()),
            _ => None,
        }
        .unwrap_or_else(|| panic!("calling {f:?} is outside the value domain"));
        body(self, args)
    }

    /// `accessor(node)` (signals.ts:140-144): `read.bind(null, node)`, a
    /// zero-length function reading the node (tracked inside a
    /// computation).
    // Solid: signals.ts:140-144
    pub fn accessor(&mut self, node: NodeId) -> Value {
        self.function(0, Rc::new(move |rt: &mut Runtime, _| rt.read_node(node)))
    }
}
