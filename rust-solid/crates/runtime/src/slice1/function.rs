//! JS function values the host creates (not a Solid file). Solid's
//! renderer and flow code pass functions around as values: accessors
//! (`accessor(node)`, signals.ts:140-144), component children, `<For>`
//! mappers, event handlers. A function value is `Value::Func(Builtin::Host
//! (f))`, compared by identity like every `Func`, so the `typeof v ===
//! "function"` checks the port already makes see it. `f` holds its body
//! and its `length` (the declared parameter count, which `flatten` and
//! `<Show>`/`mapArray` test).
//!
//! A function value owns its body: it is freed with the last value that
//! holds it, as a JS closure is collected.
use super::*;

/// A function body: the receiver is not passed (no body here reads
/// `this`); `args` are the call's arguments.
pub type FnBody = Rc<dyn Fn(&mut Runtime, &[Value]) -> Result<Value, Error>>;

type Body = dyn Fn(&mut Runtime, &[Value]) -> Result<Value, Error>;

struct Data<F: ?Sized> {
    /// The identity logs and `Debug` show.
    id: u64,
    length: usize,
    /// False for a value made by `new_host_fn`: an identity the host calls
    /// through its own table.
    callable: bool,
    body: F,
}

/// A host function value: compared by identity.
#[derive(Clone)]
pub struct HostFn(Rc<Data<Body>>);

impl HostFn {
    fn new(id: u64, length: usize, callable: bool, body: impl Fn(&mut Runtime, &[Value]) -> Result<Value, Error> + 'static) -> HostFn {
        HostFn(Rc::new(Data {
            id,
            length,
            callable,
            body,
        }))
    }
    /// A function value with no body of its own (`new_host_fn`).
    pub(super) fn bare(id: u64) -> HostFn {
        HostFn::new(id, 0, false, |_: &mut Runtime, _: &[Value]| unreachable!())
    }
    pub fn id(&self) -> u64 {
        self.0.id
    }
}

impl PartialEq for HostFn {
    fn eq(&self, o: &HostFn) -> bool {
        Rc::ptr_eq(&self.0, &o.0)
    }
}
impl Eq for HostFn {}
impl std::hash::Hash for HostFn {
    fn hash<H: std::hash::Hasher>(&self, h: &mut H) {
        self.0.id.hash(h)
    }
}
impl std::fmt::Debug for HostFn {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.0.id)
    }
}

impl Runtime {
    /// A new function value with `length` declared parameters.
    pub fn function(&mut self, length: usize, body: FnBody) -> Value {
        self.function_with(length, move |rt: &mut Runtime, args: &[Value]| body(rt, args))
    }

    /// `function` with the body stored inline (one allocation).
    pub fn function_with(
        &mut self,
        length: usize,
        body: impl Fn(&mut Runtime, &[Value]) -> Result<Value, Error> + 'static,
    ) -> Value {
        Value::Func(Builtin::Host(HostFn::new(value::next_id(), length, true, body)))
    }

    /// `f.length`, for a function value made by `function`.
    pub fn function_length(&self, f: &Value) -> Option<usize> {
        match f {
            Value::Func(Builtin::Host(h)) if h.0.callable => Some(h.0.length),
            _ => None,
        }
    }

    /// `f(...args)`. Calling anything but a function made by `function` is
    /// a `TypeError` outside the value domain: it panics.
    pub fn call(&mut self, f: &Value, args: &[Value]) -> Result<Value, Error> {
        match f {
            Value::Func(Builtin::Host(h)) if h.0.callable => {
                let h = h.0.clone();
                (h.body)(self, args)
            }
            _ => panic!("calling {f:?} is outside the value domain"),
        }
    }

    /// `accessor(node)` (signals.ts:140-144): `read.bind(null, node)`, a
    /// zero-length function reading the node (tracked inside a
    /// computation).
    // Solid: signals.ts:140-144
    pub fn accessor(&mut self, node: NodeId) -> Value {
        self.function_with(0, move |rt: &mut Runtime, _| rt.read_node(node))
    }
}
