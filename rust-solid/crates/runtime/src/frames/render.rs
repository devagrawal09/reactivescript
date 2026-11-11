//! A plan v2.2 component's markup on the server: the calls Solid's compiler
//! emits for the canonical split (frontend `plan/split.ts`) in
//! `generate: "ssr", hydratable: true` mode (compiler
//! `src/ssr/transform.rs`), made against the server port in [`crate::ssr`].
//! It is `ssr/plan.rs`'s lowering, generalized to components: a component
//! instance has its own names and props, and an application of a component
//! is the compiler's direct call `C(new _P$(…))` (production SSR inlines
//! `createComponent`) with a getter for each dynamic argument and a plain
//! field for each static one, in attribute order.
//!
//! **Faces.** The same view prints differently in the two modules of the
//! split, and the compiler classifies a hole by how it is printed:
//! - in a client component (and an inline server-only component), a prop is
//!   `props.x` (a member access: dynamic), a source or memo `x()` (a call),
//!   a store its root;
//! - in a server component's own body, a prop is a local or a parameter and
//!   a memo a `const`: identifiers, not dynamic, so their holes are values,
//!   not thunks.
//!
//! **Islands.** In a server component, an application of a slot component is
//! `props.K(new _P$(…))`: the slot props proxy (`createSlotProps`, frames
//! `frame-sink.ts:2646-2950`) mints the occurrence, evaluates every argument
//! (`Object.keys` order), sends the `slot:` record and returns the marker
//! range. That proxy is [`Slots`]; the document face's is `document.rs`'s.
use super::plan::{Component, Expr, Plan, PropArg, View};
use crate::ssr::flow::{for_, show, ForProps, ShowProps};
use crate::ssr::plan::{
    add, array_items, ascii_template_part, integer, literal, raw_text, to_text, truthy,
    void_element,
};
use crate::ssr::signals::{memo, ssr_scope};
use crate::ssr::value::{call, throw, JsVal, Res, Thrown};
use crate::ssr::web::{escape, ssr, ssr_hydration_key};
use crate::ssr::Server;
use serde_json::Value as J;
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
};

// ---- static types: the canonical split's hole coercions ----

#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    Int,
    Str,
    Bool,
    Arr(Box<Ty>),
    Rec(Vec<(String, Ty)>),
    Action,
    Unknown,
}

/// A wire type (`plan/types.ts` printType's grammar) as a static type.
pub fn parse_ty(text: &str) -> Ty {
    if text == "action" {
        return Ty::Action;
    }
    match crate::plan_v2::HostType::parse(text) {
        Ok(t) => host_ty(&t),
        Err(_) => Ty::Unknown,
    }
}

fn host_ty(t: &crate::plan_v2::HostType) -> Ty {
    use crate::plan_v2::HostType as H;
    match t {
        H::Number => Ty::Int,
        H::Str => Ty::Str,
        H::Boolean => Ty::Bool,
        H::Array(e) => Ty::Arr(Box::new(host_ty(e))),
        H::Record(fs) => Ty::Rec(fs.iter().map(|(k, t)| (k.clone(), host_ty(t))).collect()),
    }
}

fn join(a: Ty, b: Ty) -> Ty {
    if a == b {
        a
    } else {
        Ty::Unknown
    }
}

pub type Types = HashMap<String, Ty>;

// ---- a component instance ----

/// How a name of the instance reads.
#[derive(Clone)]
pub enum Binding {
    /// A store (its plain object), a `const` of a server body.
    Value(JsVal),
    /// A signal, optimistic source or memo: its read function.
    Read(JsVal),
}

/// A prop of the instance: a getter (a dynamic argument), or a value (a
/// static argument, a server body's local or parameter, an action, a slot
/// accessor).
#[derive(Clone)]
pub enum Prop {
    Getter(JsVal),
    Value(JsVal),
}

pub type Env = BTreeMap<String, JsVal>;

/// One rendered component instance.
pub struct Inst {
    pub plan: Rc<Plan>,
    pub comp: Rc<Component>,
    pub names: RefCell<HashMap<String, Binding>>,
    /// The kind of each name: true when it reads as a call (a signal,
    /// optimistic source or memo of a client component).
    pub calls: HashMap<String, bool>,
    pub props: RefCell<HashMap<String, Prop>>,
    /// Props print as `props.x` (client and inline components) or as
    /// identifiers (a server component's body).
    pub prop_member: bool,
    pub tys: RefCell<Types>,
    /// The slot props proxy of the server component this instance renders
    /// in (its own body, or an inline component's), if any.
    pub slots: Option<Rc<dyn SlotProxy>>,
    /// The slot components of that server component, by name.
    pub slot_names: Vec<String>,
}

/// A slot props proxy (frames `createSlotProps`, or the document face's
/// `createDocumentSlotProps`): calling `props.K(raw)` for an island.
pub trait SlotProxy {
    /// `props.K(raw)`: `args` are the island's arguments, evaluated in
    /// `Object.keys` order (the compiled getters read at the call).
    fn call(
        &self,
        s: &mut Server,
        k: &str,
        args: Vec<(String, JsVal)>,
        inst: &Rc<Inst>,
    ) -> Res<JsVal>;
}

impl Inst {
    fn read(&self, s: &mut Server, name: &str) -> Res<JsVal> {
        let b = self.names.borrow().get(name).cloned();
        match b {
            None => throw(format!("read of {name} before it exists")),
            Some(Binding::Value(v)) => Ok(v),
            Some(Binding::Read(f)) => call(s, &f, &[]),
        }
    }
    fn prop(&self, s: &mut Server, name: &str) -> Res<JsVal> {
        let p = self.props.borrow().get(name).cloned();
        match p {
            None => throw(format!(
                "read of the prop {name}, which {} was not passed",
                self.comp.name
            )),
            Some(Prop::Value(v)) => Ok(v),
            Some(Prop::Getter(f)) => call(s, &f, &[]),
        }
    }

    pub fn ty(&self, e: &Expr, locals: &Types) -> Ty {
        match e {
            Expr::Literal { value } => match value {
                J::String(_) => Ty::Str,
                J::Number(_) => Ty::Int,
                J::Bool(_) => Ty::Bool,
                _ => Ty::Unknown,
            },
            Expr::Array { items } => Ty::Arr(Box::new(
                items
                    .iter()
                    .map(|x| self.ty(x, locals))
                    .reduce(join)
                    .unwrap_or(Ty::Unknown),
            )),
            Expr::Object { fields } => Ty::Rec(
                fields
                    .iter()
                    .map(|f| (f.key.clone(), self.ty(&f.value, locals)))
                    .collect(),
            ),
            Expr::Read { source } => self
                .tys
                .borrow()
                .get(source)
                .cloned()
                .unwrap_or(Ty::Unknown),
            Expr::Prop { name } => self
                .tys
                .borrow()
                .get(&format!("props.{name}"))
                .cloned()
                .unwrap_or(Ty::Unknown),
            Expr::Local { name } => locals.get(name).cloned().unwrap_or(Ty::Unknown),
            Expr::Get { object, key } => match self.ty(object, locals) {
                Ty::Rec(fields) => fields
                    .into_iter()
                    .find(|(k, _)| k == key)
                    .map_or(Ty::Unknown, |(_, t)| t),
                _ => Ty::Unknown,
            },
            Expr::Length { .. } | Expr::FindIndex { .. } => Ty::Int,
            Expr::Filter { array, .. } => self.ty(array, locals),
            Expr::Map { array, param, body } => {
                let mut inner = locals.clone();
                inner.insert(param.clone(), element_ty(self.ty(array, locals)));
                Ty::Arr(Box::new(self.ty(body, &inner)))
            }
            Expr::Add { left, right } => match (self.ty(left, locals), self.ty(right, locals)) {
                (Ty::Int, Ty::Int) => Ty::Int,
                (Ty::Str, Ty::Str | Ty::Int) | (Ty::Int, Ty::Str) => Ty::Str,
                _ => Ty::Unknown,
            },
            Expr::Eq { .. }
            | Expr::Ne { .. }
            | Expr::Lt { .. }
            | Expr::Le { .. }
            | Expr::Gt { .. }
            | Expr::Ge { .. }
            | Expr::Not { .. }
            | Expr::Pending { .. } => Ty::Bool,
            Expr::And { left, right } | Expr::Or { left, right } => {
                join(self.ty(left, locals), self.ty(right, locals))
            }
            Expr::Cond {
                then, otherwise, ..
            } => join(self.ty(then, locals), self.ty(otherwise, locals)),
            Expr::Latest { value } => self.ty(value, locals),
        }
    }

    /// Dynamic in the compiler's sense (`is_dynamic`): the printed form has a
    /// call or a member access.
    pub fn dynamic(&self, e: &Expr) -> bool {
        match e {
            Expr::Literal { .. } | Expr::Local { .. } => false,
            Expr::Read { source } => self.calls.get(source).copied().unwrap_or(false),
            Expr::Prop { .. } => self.prop_member,
            Expr::Get { .. }
            | Expr::Length { .. }
            | Expr::Filter { .. }
            | Expr::Map { .. }
            | Expr::FindIndex { .. }
            | Expr::Pending { .. }
            | Expr::Latest { .. } => true,
            Expr::Array { items } => items.iter().any(|x| self.dynamic(x)),
            Expr::Object { fields } => fields.iter().any(|f| self.dynamic(&f.value)),
            Expr::Not { value } => self.dynamic(value),
            Expr::Cond {
                test,
                then,
                otherwise,
            } => self.dynamic(test) || self.dynamic(then) || self.dynamic(otherwise),
            Expr::Add { left, right }
            | Expr::Eq { left, right }
            | Expr::Ne { left, right }
            | Expr::Lt { left, right }
            | Expr::Le { left, right }
            | Expr::Gt { left, right }
            | Expr::Ge { left, right }
            | Expr::And { left, right }
            | Expr::Or { left, right } => self.dynamic(left) || self.dynamic(right),
        }
    }

    fn hoists(&self, e: &Expr) -> bool {
        match e {
            Expr::Or { left, .. } => {
                matches!(**left, Expr::And { .. } | Expr::Or { .. }) && self.hoists(left)
            }
            Expr::And { left, right } => self.dynamic(left) && self.dynamic(right),
            _ => false,
        }
    }

    fn text_form(&self, e: &Expr, locals: &Types) -> Result<TextForm, String> {
        if confident(e).is_some() {
            return Err("a text hole with a constant value (Solid's compiler folds it to static text) has no SSR twin".into());
        }
        let coerce = match e {
            Expr::Cond { .. } => true,
            _ => match self.ty(e, locals) {
                Ty::Int => true,
                Ty::Unknown | Ty::Action => return Err("a text hole whose type is not known statically: its canonical twin's coercion is undecided".into()),
                _ => false,
            },
        };
        if !coerce && self.hoists(e) {
            return Err("an uncoerced text hole with `&&` on its `||` spine is not ported".into());
        }
        let dynamic = self.dynamic(e);
        let allocates = !coerce && can_return_hydratable_child(e);
        Ok(TextForm {
            coerce,
            dynamic,
            scope: allocates && dynamic,
        })
    }
}

fn element_ty(t: Ty) -> Ty {
    match t {
        Ty::Arr(e) => *e,
        _ => Ty::Unknown,
    }
}

#[derive(Clone, Copy, Debug)]
struct TextForm {
    coerce: bool,
    dynamic: bool,
    scope: bool,
}

/// `expression_can_return_hydratable_child` (compiler shared/utils.rs:660-704).
fn can_return_hydratable_child(e: &Expr) -> bool {
    match e {
        Expr::Cond {
            then, otherwise, ..
        } => can_return_hydratable_child(then) || can_return_hydratable_child(otherwise),
        Expr::And { left, right } | Expr::Or { left, right } => {
            can_return_hydratable_child(left) || can_return_hydratable_child(right)
        }
        Expr::Array { items } => items.iter().any(can_return_hydratable_child),
        Expr::Literal { .. }
        | Expr::Not { .. }
        | Expr::Add { .. }
        | Expr::Eq { .. }
        | Expr::Ne { .. }
        | Expr::Lt { .. }
        | Expr::Le { .. }
        | Expr::Gt { .. }
        | Expr::Ge { .. } => false,
        _ => true,
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Konst {
    Num(i64),
    Str(String),
    Bool(bool),
}
fn konst_truthy(k: &Konst) -> bool {
    match k {
        Konst::Num(n) => *n != 0,
        Konst::Str(s) => !s.is_empty(),
        Konst::Bool(b) => *b,
    }
}
/// Babel's confident evaluation (frontend `plan/resolve-v2.ts` `confident`).
fn confident(e: &Expr) -> Option<Konst> {
    match e {
        Expr::Literal { value } => match value {
            J::String(s) => Some(Konst::Str(s.clone())),
            J::Number(n) => n.as_i64().map(Konst::Num),
            J::Bool(b) => Some(Konst::Bool(*b)),
            _ => None,
        },
        Expr::Not { value } => confident(value).map(|k| Konst::Bool(!konst_truthy(&k))),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            let c = confident(test)?;
            confident(if konst_truthy(&c) { then } else { otherwise })
        }
        Expr::And { left, right } => {
            let l = confident(left)?;
            if !konst_truthy(&l) {
                Some(l)
            } else {
                confident(right)
            }
        }
        Expr::Or { left, right } => {
            let l = confident(left)?;
            if konst_truthy(&l) {
                Some(l)
            } else {
                confident(right)
            }
        }
        Expr::Add { left, right }
        | Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let (a, b) = (confident(left)?, confident(right)?);
            let text = |k: &Konst| match k {
                Konst::Num(n) => n.to_string(),
                Konst::Str(s) => s.clone(),
                Konst::Bool(b) => b.to_string(),
            };
            Some(match e {
                Expr::Add { .. } => match (&a, &b) {
                    (Konst::Num(x), Konst::Num(y)) => Konst::Num(x.checked_add(*y)?),
                    (Konst::Str(_), _) | (_, Konst::Str(_)) => Konst::Str(text(&a) + &text(&b)),
                    _ => return None,
                },
                Expr::Eq { .. } => Konst::Bool(a == b),
                Expr::Ne { .. } => Konst::Bool(a != b),
                _ => {
                    let (Konst::Num(x), Konst::Num(y)) = (&a, &b) else {
                        return None;
                    };
                    Konst::Bool(match e {
                        Expr::Lt { .. } => x < y,
                        Expr::Le { .. } => x <= y,
                        Expr::Gt { .. } => x > y,
                        _ => x >= y,
                    })
                }
            })
        }
        _ => None,
    }
}

// ---- the evaluator over the server's plain values ----

fn with(env: &Env, name: &str, v: JsVal) -> Env {
    let mut env = env.clone();
    env.insert(name.to_string(), v);
    env
}

fn compare(e: &Expr, l: &JsVal, r: &JsVal) -> Res<JsVal> {
    Ok(JsVal::Bool(match e {
        Expr::Eq { .. } => l.strict_eq(r),
        Expr::Ne { .. } => !l.strict_eq(r),
        _ => {
            let (a, b) = (integer(l)?, integer(r)?);
            match e {
                Expr::Lt { .. } => a < b,
                Expr::Le { .. } => a <= b,
                Expr::Gt { .. } => a > b,
                _ => a >= b,
            }
        }
    }))
}

pub fn eval(s: &mut Server, i: &Rc<Inst>, e: &Expr, env: &Env) -> Res<JsVal> {
    match e {
        Expr::Literal { value } => literal(value),
        Expr::Array { items } => {
            let mut out = vec![];
            for x in items {
                out.push(eval(s, i, x, env)?);
            }
            Ok(JsVal::array(out))
        }
        Expr::Object { fields } => {
            let mut out = vec![];
            for f in fields {
                out.push((f.key.clone(), eval(s, i, &f.value, env)?));
            }
            Ok(JsVal::Rec(Rc::new(RefCell::new(out))))
        }
        Expr::Read { source } => i.read(s, source),
        Expr::Prop { name } => i.prop(s, name),
        Expr::Local { name } => match env.get(name) {
            Some(v) => Ok(v.clone()),
            None => throw(format!("unbound local {name}")),
        },
        Expr::Get { object, key } => match eval(s, i, object, env)? {
            JsVal::Rec(r) => {
                let found = r
                    .borrow()
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, v)| v.clone());
                found.map_or_else(|| throw(format!("missing field {key}")), Ok)
            }
            other => throw(format!("get {key} of {other:?}, not a record")),
        },
        Expr::Length { array } => Ok(JsVal::Num(
            array_items(&eval(s, i, array, env)?, "length")?.len() as i64,
        )),
        Expr::Filter { array, param, body } => {
            let xs = array_items(&eval(s, i, array, env)?, "filter")?;
            let mut out = vec![];
            for x in xs {
                if truthy(&eval(s, i, body, &with(env, param, x.clone()))?)? {
                    out.push(x);
                }
            }
            Ok(JsVal::array(out))
        }
        Expr::Map { array, param, body } => {
            let xs = array_items(&eval(s, i, array, env)?, "map")?;
            let mut out = vec![];
            for x in xs {
                out.push(eval(s, i, body, &with(env, param, x))?);
            }
            Ok(JsVal::array(out))
        }
        Expr::FindIndex { array, param, body } => {
            let xs = array_items(&eval(s, i, array, env)?, "findIndex")?;
            for (k, x) in xs.into_iter().enumerate() {
                if truthy(&eval(s, i, body, &with(env, param, x))?)? {
                    return Ok(JsVal::Num(k as i64));
                }
            }
            Ok(JsVal::Num(-1))
        }
        Expr::Add { left, right } => {
            let l = eval(s, i, left, env)?;
            let r = eval(s, i, right, env)?;
            add(&l, &r)
        }
        Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let l = eval(s, i, left, env)?;
            let r = eval(s, i, right, env)?;
            compare(e, &l, &r)
        }
        Expr::And { left, right } => {
            let l = eval(s, i, left, env)?;
            if truthy(&l)? {
                eval(s, i, right, env)
            } else {
                Ok(l)
            }
        }
        Expr::Or { left, right } => {
            let l = eval(s, i, left, env)?;
            if truthy(&l)? {
                Ok(l)
            } else {
                eval(s, i, right, env)
            }
        }
        Expr::Not { value } => Ok(JsVal::Bool(!truthy(&eval(s, i, value, env)?)?)),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval(s, i, test, env)?)? {
                eval(s, i, then, env)
            } else {
                eval(s, i, otherwise, env)
            }
        }
        Expr::Pending { value } | Expr::Latest { value } => {
            let (v, i2, env2) = ((**value).clone(), i.clone(), env.clone());
            let f = JsVal::func(0, move |s, _| eval(s, &i2, &v, &env2));
            match e {
                Expr::Pending { .. } => crate::ssr::signals::is_pending(s, &f),
                _ => crate::ssr::signals::latest(s, &f),
            }
        }
    }
}

// Solid: compiler ssr/transform.rs:3155-3283 (`escape_expression_in_place`).
fn eval_escaped(s: &mut Server, i: &Rc<Inst>, e: &Expr, env: &Env) -> Res<JsVal> {
    match e {
        Expr::Literal { .. } | Expr::Not { .. } => eval(s, i, e, env),
        Expr::Add { left, right } => {
            let l = eval_escaped(s, i, left, env)?;
            let r = eval_escaped(s, i, right, env)?;
            add(&l, &r)
        }
        Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let l = eval_escaped(s, i, left, env)?;
            let r = eval_escaped(s, i, right, env)?;
            compare(e, &l, &r)
        }
        Expr::And { left, right } => {
            let l = eval(s, i, left, env)?;
            if truthy(&l)? {
                eval_escaped(s, i, right, env)
            } else {
                Ok(l)
            }
        }
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval(s, i, test, env)?)? {
                eval_escaped(s, i, then, env)
            } else {
                eval_escaped(s, i, otherwise, env)
            }
        }
        _ => Ok(escape(&eval(s, i, e, env)?)),
    }
}

fn text_value(s: &mut Server, i: &Rc<Inst>, e: &Expr, env: &Env, coerce: bool) -> Res<JsVal> {
    let v = eval_escaped(s, i, e, env)?;
    let v = if coerce { add(&JsVal::str(""), &v)? } else { v };
    to_text(&v)?;
    Ok(v)
}

// ---- views ----

/// What renders a component application of the client face (a client site
/// or a server root): the document face's; the server face has none (its
/// applications are islands and inline components).
pub trait Sites {
    fn site(&self, s: &mut Server, i: &Rc<Inst>, v: &View, env: &Env, tys: &Types) -> Res<JsVal>;
}

/// The renderer of one face.
pub struct Render {
    pub sites: Option<Rc<dyn Sites>>,
}

impl Render {
    /// A component position: an element is its template, a control or a
    /// component its value; more than one view is an array.
    pub fn fragment(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        views: &[View],
        env: &Env,
        tys: &Types,
    ) -> Res<JsVal> {
        let mut parts = vec![];
        for v in views {
            parts.push(match v {
                View::Element { .. } => self.template(s, i, v, env, tys)?,
                View::Text { .. } => return throw("text directly in a component position"),
                _ => self.control(s, i, v, env, tys)?,
            });
        }
        Ok(if parts.len() == 1 {
            parts.pop().expect("one")
        } else {
            JsVal::array(parts)
        })
    }

    // Solid: compiler ssr/transform.rs:2082-2156, 2745-2892 (`ssr_template`,
    // `append_children`).
    fn lower<'v>(
        &self,
        v: &'v View,
        root: bool,
        parts: &mut Vec<String>,
        holes: &mut Vec<Hole<'v>>,
    ) -> Res<()> {
        let View::Element { tag, children, .. } = v else {
            return throw("a template is an element");
        };
        parts
            .last_mut()
            .expect("a part")
            .push_str(&format!("<{tag}"));
        if root {
            holes.push(Hole::Key);
            parts.push(String::new());
        }
        parts.last_mut().expect("a part").push('>');
        if void_element(tag) {
            return Ok(());
        }
        let markers = children.len() > 1;
        for child in children {
            match child {
                View::Text {
                    value: Expr::Literal { value },
                } => {
                    let t = raw_text(value).map_err(Thrown::msg)?;
                    parts.last_mut().expect("a part").push_str(&t);
                }
                View::Element { .. } => self.lower(child, false, parts, holes)?,
                _ => {
                    if markers {
                        parts.last_mut().expect("a part").push_str("<!--$-->");
                    }
                    holes.push(match child {
                        View::Text { value } => Hole::Text(value),
                        _ => Hole::Control(child),
                    });
                    parts.push(if markers {
                        "<!--/-->".into()
                    } else {
                        String::new()
                    });
                }
            }
        }
        parts
            .last_mut()
            .expect("a part")
            .push_str(&format!("</{tag}>"));
        Ok(())
    }

    fn template(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        v: &View,
        env: &Env,
        tys: &Types,
    ) -> Res<JsVal> {
        let mut parts = vec![String::new()];
        let mut holes = vec![];
        self.lower(v, true, &mut parts, &mut holes)?;
        let parts: Vec<String> = parts.iter().map(|p| ascii_template_part(p)).collect();
        let mut values = vec![];
        for hole in holes {
            values.push(match hole {
                Hole::Key => ssr_hydration_key(s)?,
                Hole::Text(e) => self.text_hole(s, i, e, env, tys)?,
                Hole::Control(view) => escape(&self.control(s, i, view, env, tys)?),
            });
        }
        ssr(s, &parts, &values)
    }

    fn text_hole(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        e: &Expr,
        env: &Env,
        tys: &Types,
    ) -> Res<JsVal> {
        let form = i.text_form(e, tys).map_err(Thrown::msg)?;
        if !form.dynamic {
            return text_value(s, i, e, env, form.coerce);
        }
        let (e2, env2, i2) = (e.clone(), env.clone(), i.clone());
        let thunk = JsVal::func(0, move |s, _| text_value(s, &i2, &e2, &env2, form.coerce));
        if form.scope {
            ssr_scope(s, thunk)
        } else {
            Ok(thunk)
        }
    }

    /// `transformCondition(…, inline)` on a `when`/`each` getter.
    fn condition(&self, s: &mut Server, i: &Rc<Inst>, e: &Expr, env: &Env) -> Res<JsVal> {
        match e {
            Expr::Cond {
                test,
                then,
                otherwise,
            } if (i.dynamic(then) || i.dynamic(otherwise)) && i.dynamic(test) => {
                let t = self.memoized(s, i, test, env)?;
                let branch = if truthy(&t)? { then } else { otherwise };
                match **branch {
                    Expr::Cond { .. } | Expr::And { .. } | Expr::Or { .. } => {
                        self.condition(s, i, branch, env)
                    }
                    _ => eval(s, i, branch, env),
                }
            }
            Expr::And { left, right } if i.dynamic(left) && i.dynamic(right) => {
                let t = self.memoized(s, i, left, env)?;
                if boolean_expr(left) {
                    if truthy(&t)? {
                        eval(s, i, right, env)
                    } else {
                        Ok(t)
                    }
                } else if truthy(&t)? {
                    eval(s, i, right, env)
                } else {
                    eval(s, i, left, env)
                }
            }
            Expr::Or { left, right } if matches!(**left, Expr::And { .. } | Expr::Or { .. }) => {
                let l = self.condition(s, i, left, env)?;
                if truthy(&l)? {
                    Ok(l)
                } else {
                    eval(s, i, right, env)
                }
            }
            _ => eval(s, i, e, env),
        }
    }

    fn memoized(&self, s: &mut Server, i: &Rc<Inst>, e: &Expr, env: &Env) -> Res<JsVal> {
        let (e2, env2, i2) = (e.clone(), env.clone(), i.clone());
        let boolean = boolean_expr(e);
        let m = memo(
            s,
            JsVal::func(0, move |s, _| {
                let v = eval(s, &i2, &e2, &env2)?;
                Ok(if boolean { v } else { JsVal::Bool(truthy(&v)?) })
            }),
        )?;
        call(s, &m, &[])
    }

    pub fn control(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        v: &View,
        env: &Env,
        tys: &Types,
    ) -> Res<JsVal> {
        let me = Rc::new(Render {
            sites: self.sites.clone(),
        });
        match v {
            View::Show {
                when,
                children,
                fallback,
            } => {
                let (when, kids) = (when.clone(), children.clone());
                let (e1, e2, e3) = (env.clone(), env.clone(), env.clone());
                let (i1, i2, i3) = (i.clone(), i.clone(), i.clone());
                let (t2, t3) = (tys.clone(), tys.clone());
                let (r1, r2, r3) = (me.clone(), me.clone(), me.clone());
                let fallback = (!fallback.is_empty()).then(|| {
                    let fallback = fallback.clone();
                    getter(move |s| r3.fragment(s, &i3, &fallback, &e3, &t3))
                });
                show(
                    s,
                    ShowProps {
                        when: getter(move |s| r1.condition(s, &i1, &when, &e1)),
                        keyed: false,
                        fallback,
                        children: getter(move |s| r2.fragment(s, &i2, &kids, &e2, &t2)),
                    },
                )
            }
            View::For {
                each,
                item,
                children,
                ..
            } => {
                let mut row_tys = tys.clone();
                row_tys.insert(item.clone(), element_ty(i.ty(each, tys)));
                let (each, e1, i1, r1) = (each.clone(), env.clone(), i.clone(), me.clone());
                let (item, kids, e2, i2, r2) = (
                    item.clone(),
                    children.clone(),
                    env.clone(),
                    i.clone(),
                    me.clone(),
                );
                let each = getter(move |s| {
                    let xs = r1.condition(s, &i1, &each, &e1)?;
                    if !matches!(xs, JsVal::Arr(_)) {
                        return throw(format!("For of {xs:?}, not an array"));
                    }
                    Ok(xs)
                });
                let row = JsVal::func(1, move |s, args| {
                    let env = with(
                        &e2,
                        &item,
                        args.first().cloned().unwrap_or(JsVal::Undefined),
                    );
                    r2.fragment(s, &i2, &kids, &env, &row_tys)
                });
                for_(
                    s,
                    ForProps {
                        each,
                        children: row,
                        fallback: None,
                    },
                )
            }
            View::Loading { fallback, children } => {
                let (fb, kids) = (fallback.clone(), children.clone());
                let (e1, e2, i1, i2, t1, t2, r1, r2) = (
                    env.clone(),
                    env.clone(),
                    i.clone(),
                    i.clone(),
                    tys.clone(),
                    tys.clone(),
                    me.clone(),
                    me.clone(),
                );
                crate::ssr::boundary::loading(
                    s,
                    crate::ssr::boundary::LoadingProps {
                        fallback: getter(move |s| r1.fragment(s, &i1, &fb, &e1, &t1)),
                        children: getter(move |s| r2.fragment(s, &i2, &kids, &e2, &t2)),
                    },
                )
            }
            View::Errored { fallback, children } => {
                let (fb, kids) = (fallback.clone(), children.clone());
                let (e1, e2, i1, i2, t1, t2, r1, r2) = (
                    env.clone(),
                    env.clone(),
                    i.clone(),
                    i.clone(),
                    tys.clone(),
                    tys.clone(),
                    me.clone(),
                    me.clone(),
                );
                crate::ssr::boundary::errored(
                    s,
                    crate::ssr::boundary::ErroredProps {
                        fallback: JsVal::func(1, move |s, _| r1.fragment(s, &i1, &fb, &e1, &t1)),
                        children: getter(move |s| r2.fragment(s, &i2, &kids, &e2, &t2)),
                    },
                )
            }
            View::Component {
                name, props, place, ..
            } => {
                if i.slots.is_some() && place.is_none() {
                    // Inside a server component: an island or an inline component.
                    if i.slot_names.contains(name) {
                        return self.island(s, i, name, props, env);
                    }
                    return self.inline(s, i, name, props, env);
                }
                match &self.sites {
                    Some(sites) => sites.site(s, i, v, env, tys),
                    None => throw(format!("a client site of {name} in a server render")),
                }
            }
            _ => throw("a control-flow view"),
        }
    }

    /// `props.K(new _P$(…))`: the slot props proxy evaluates every argument
    /// (`Object.keys` order: attribute order) and returns the range.
    fn island(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        k: &str,
        props: &[PropArg],
        env: &Env,
    ) -> Res<JsVal> {
        let mut args = vec![];
        for a in props {
            let Some(value) = &a.value else { continue };
            args.push((a.name.clone(), eval(s, i, value, env)?));
        }
        i.slots
            .clone()
            .expect("in a server component")
            .call(s, k, args, i)
    }

    /// An inline server-only component: `K(new _P$(…))` with its value props
    /// and the slot accessors (`ClaimButton={props.ClaimButton}`), rendered
    /// in K's own face (props are members, memos consts).
    fn inline(
        &self,
        s: &mut Server,
        i: &Rc<Inst>,
        name: &str,
        props: &[PropArg],
        env: &Env,
    ) -> Res<JsVal> {
        let comp = i
            .plan
            .component(name)
            .ok_or_else(|| Thrown::msg(format!("no component {name}")))?
            .clone();
        let mut ps = HashMap::new();
        for a in props {
            let Some(value) = &a.value else { continue };
            ps.insert(
                a.name.clone(),
                if i.dynamic(value) {
                    let (value, i2, env2) = (value.clone(), i.clone(), env.clone());
                    Prop::Getter(getter(move |s| eval(s, &i2, &value, &env2)))
                } else {
                    Prop::Value(eval(s, i, value, env)?)
                },
            );
        }
        let mut tys = Types::new();
        for p in &comp.props {
            tys.insert(format!("props.{}", p.name), parse_ty(&p.ty));
        }
        let inst = Rc::new(Inst {
            plan: i.plan.clone(),
            comp: Rc::new(comp.clone()),
            names: RefCell::new(HashMap::new()),
            calls: HashMap::new(),
            props: RefCell::new(ps),
            prop_member: true,
            tys: RefCell::new(tys),
            slots: i.slots.clone(),
            slot_names: i.slot_names.clone(),
        });
        // An inline component's memos are `const`s of its body.
        for m in &comp.memos {
            let Some(value) = &m.value else {
                return throw("an inline component owns no question (PL-6)");
            };
            let t = inst.ty(value, &Types::new());
            let v = eval(s, &inst, value, &Env::new())?;
            inst.tys.borrow_mut().insert(m.name.clone(), t);
            inst.names
                .borrow_mut()
                .insert(m.name.clone(), Binding::Value(v));
        }
        self.fragment(s, &inst, &comp.markup, &Env::new(), &Types::new())
    }
}

enum Hole<'v> {
    Key,
    Text(&'v Expr),
    Control(&'v View),
}

fn boolean_expr(e: &Expr) -> bool {
    matches!(
        e,
        Expr::Eq { .. }
            | Expr::Ne { .. }
            | Expr::Lt { .. }
            | Expr::Le { .. }
            | Expr::Gt { .. }
            | Expr::Ge { .. }
            | Expr::Not { .. }
    )
}

/// A getter (the compiler's `_P$` descriptor): evaluated where it is read.
pub fn getter(f: impl Fn(&mut Server) -> Res<JsVal> + 'static) -> JsVal {
    JsVal::func(0, move |s, _| f(s))
}

/// A JSON wire value as the server's plain values.
pub fn json_to_js(v: &J) -> Res<JsVal> {
    Ok(match v {
        J::Number(n) => JsVal::Num(
            n.as_i64()
                .ok_or_else(|| Thrown::msg(format!("a non-integer {n}")))?,
        ),
        J::String(t) => JsVal::str(t),
        J::Bool(b) => JsVal::Bool(*b),
        J::Array(xs) => JsVal::array(xs.iter().map(json_to_js).collect::<Res<_>>()?),
        J::Object(o) => JsVal::Rec(Rc::new(RefCell::new(
            o.iter()
                .map(|(k, x)| Ok((k.clone(), json_to_js(x)?)))
                .collect::<Res<_>>()?,
        ))),
        J::Null => JsVal::Null,
    })
}

/// A plain value as JSON (records keep their key order).
pub fn js_to_json(v: &JsVal) -> Res<J> {
    Ok(match v {
        JsVal::Num(n) => J::from(*n),
        JsVal::Str(t) => J::String(t.to_string()),
        JsVal::Bool(b) => J::Bool(*b),
        JsVal::Null => J::Null,
        JsVal::Arr(a) => J::Array(a.borrow().iter().map(js_to_json).collect::<Res<_>>()?),
        JsVal::Rec(r) => {
            let mut m = serde_json::Map::new();
            for (k, x) in r.borrow().iter() {
                m.insert(k.clone(), js_to_json(x)?);
            }
            J::Object(m)
        }
        other => return throw(format!("{other:?} is not a wire value")),
    })
}
