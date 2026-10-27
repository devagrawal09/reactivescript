//! The lowering's output before it crosses the seam (spec/11 CP-1a): a JavaScript module with JSX views, as a tree.
//! `emit.rs` builds it; `oxc.rs` turns it into an `oxc_ast::Program` for Solid's compiler (CP-1c). It holds exactly the
//! JavaScript `ref/compile/emit.ts` writes as text, node for node, so that both reach Solid's back ends as the same
//! program. Nothing here is ever printed as source.

#[derive(Debug, Clone)]
pub enum E {
    Id(String),
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
    /// `f(args)`; an argument may be `E::Spread`
    Call(Box<E>, Vec<E>),
    /// `o.p`, `o?.p`
    Member(Box<E>, String, bool),
    /// `o[i]`, `o?.[i]`
    Index(Box<E>, Box<E>, bool),
    Arrow { params: Vec<P>, body: Body, is_async: bool },
    Func(Box<Func>),
    /// a binary or logical operator, spelled as in JS
    Bin(&'static str, Box<E>, Box<E>),
    Un(&'static str, Box<E>),
    Cond(Box<E>, Box<E>, Box<E>),
    Arr(Vec<E>),
    Obj(Vec<Prop>),
    Spread(Box<E>),
    Yield(Box<E>),
    Await(Box<E>),
    /// `target op value`: `=` or `??=` on a name or a member
    Assign(&'static str, Box<E>, Box<E>),
    Jsx(Box<Jsx>),
}

#[derive(Debug, Clone)]
pub enum Body {
    Expr(Box<E>),
    Block(Vec<S>),
}

#[derive(Debug, Clone)]
pub enum P {
    Id(String),
    Rest(String),
}

#[derive(Debug, Clone)]
pub enum Key {
    Ident(String),
    Str(String),
}

#[derive(Debug, Clone)]
pub enum Prop {
    Kv(Key, E),
    Spread(E),
}

#[derive(Debug, Clone)]
pub struct Func {
    pub name: Option<String>,
    pub params: Vec<P>,
    pub directives: Vec<String>,
    pub body: Vec<S>,
    pub is_async: bool,
    pub generator: bool,
}

#[derive(Debug, Clone)]
pub enum Pat {
    Id(String),
    Arr(Vec<String>),
}

#[derive(Debug, Clone)]
pub enum S {
    Const(Pat, E),
    Let(String, Option<E>),
    Expr(E),
    Return(Option<E>),
    Throw(E),
    If(E, Vec<S>, Option<Vec<S>>),
    /// `if (c) s;` — no block
    IfThen(E, Box<S>),
    Block(Vec<S>),
    Try { block: Vec<S>, param: Option<String>, handler: Option<Vec<S>>, fin: Option<Vec<S>> },
    Func(Func),
    /// `import local from "src"`
    ImportDefault(String, String),
    /// `import { name as local, … } from "src"`
    ImportNamed(Vec<(String, String)>, String),
    ExportDefault(Func),
    /// `s`, lowered from `.rx` line `line` (1-based): no JavaScript of its own, only the position its spans map to (CP-1c)
    At(usize, Box<S>),
}

#[derive(Debug, Clone)]
pub enum JsxName {
    Ident(String),
    /// `obj.prop`
    Member(String, String),
}

#[derive(Debug, Clone)]
pub enum AttrValue {
    Expr(E),
    Str(String),
}

#[derive(Debug, Clone)]
pub enum Child {
    Expr(E),
    /// raw JSX text (an empty fragment child is written `null`)
    Text(String),
    Jsx(Jsx),
}

#[derive(Debug, Clone)]
/// `line`: the `.rx` line of the markup it is lowered from, `None` for a generated one (a view's fragment)
pub enum Jsx {
    El { name: JsxName, attrs: Vec<(String, AttrValue)>, children: Vec<Child>, self_closing: bool, line: Option<usize> },
    Frag(Vec<Child>, Option<usize>),
}

// ---------------------------------------------------------------- constructors, so emit.rs reads like the reference

pub fn id(n: impl Into<String>) -> E {
    E::Id(n.into())
}
pub fn str(s: impl Into<String>) -> E {
    E::Str(s.into())
}
pub fn undef() -> E {
    id("undefined")
}
pub fn call(f: E, args: Vec<E>) -> E {
    E::Call(Box::new(f), args)
}
/// `o.p`
pub fn dot(o: E, p: &str) -> E {
    E::Member(Box::new(o), p.to_string(), false)
}
/// `__rt.name`
pub fn rt(name: &str) -> E {
    dot(id("__rt"), name)
}
/// `__rt.name(args)`
pub fn rtc(name: &str, args: Vec<E>) -> E {
    call(rt(name), args)
}
pub fn arrow(params: &[&str], body: E) -> E {
    E::Arrow { params: params.iter().map(|p| P::Id(p.to_string())).collect(), body: Body::Expr(Box::new(body)), is_async: false }
}
/// `() => e`
pub fn thunk(body: E) -> E {
    arrow(&[], body)
}
pub fn arrow_block(params: Vec<P>, body: Vec<S>, is_async: bool) -> E {
    E::Arrow { params, body: Body::Block(body), is_async }
}
pub fn bin(op: &'static str, l: E, r: E) -> E {
    E::Bin(op, Box::new(l), Box::new(r))
}
pub fn not(e: E) -> E {
    E::Un("!", Box::new(e))
}
pub fn obj(kvs: Vec<(&str, E)>) -> E {
    E::Obj(kvs.into_iter().map(|(k, v)| Prop::Kv(Key::Ident(k.to_string()), v)).collect())
}
pub fn konst(name: impl Into<String>, e: E) -> S {
    S::Const(Pat::Id(name.into()), e)
}
pub fn sexpr(e: E) -> S {
    S::Expr(e)
}
/// JSON.stringify of a literal value, as the reference writes it into its JavaScript
pub fn lit(l: &crate::ast::Lit) -> E {
    use crate::ast::Lit;
    match l {
        Lit::Undefined => undef(),
        Lit::Null => E::Null,
        Lit::Bool(b) => E::Bool(*b),
        Lit::Num(n) if n.is_finite() => E::Num(*n),
        Lit::Num(_) => E::Null,
        Lit::Str(s) => str(s.clone()),
    }
}
pub fn strs(xs: &[String]) -> E {
    E::Arr(xs.iter().map(|x| str(x.clone())).collect())
}
