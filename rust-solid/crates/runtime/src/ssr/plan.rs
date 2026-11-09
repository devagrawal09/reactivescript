//! A plan v2 app on the server: the calls Solid's compiler emits for the
//! plan's TSX twin in `generate: "ssr", hydratable: true` mode
//! (solid-next `packages/compiler/src/ssr/transform.rs`), made against the
//! port of the server builds in this module, and evaluated over the server's
//! plain values.
//!
//! **The TSX twin.** A plan does not record whether a TSX text hole was
//! written `{x()}` or `{"" + x()}`; the two are one plan (PLAN-V2.md,
//! fallback 8), but not one SSR output: Solid's compiler scopes a hole that
//! can return hydratable content (`_$scope`, one hydration id slot) and not a
//! provably primitive one, and every id after it shifts. The lowering renders
//! the plan's canonical twin, which is the plan fuzz generator's: a text hole
//! whose value is an integer, or a conditional, is coerced (`{"" + x}`, so
//! that it inserts the string the plan inserts, and so that TSX keeps a
//! conditional a text hole); any other hole is written as is. The integer
//! test is a static type inference over the plan; a hole whose type it cannot
//! decide is refused. docs/SSR.md, "The canonical twin".
//!
//! **Refused** (each an explicit diagnostic, before anything renders): a text
//! hole Solid's compiler folds to static text (`confident`), an uncoerced
//! hole whose `||` spine reaches an `&&` with two dynamic sides (the compiler
//! hoists a condition memo there), a hole of undecidable type, static text
//! that has no raw JSX spelling (`&`, `<`, `>`, `{`, `}`, line breaks, tabs,
//! runs of spaces, empty), adjacent static texts (JSX has one text there),
//! a void element with children, and `script`, `style`, `head`, `html` and
//! `body` (raw-text children and the document shell are not ported). An eval
//! site anywhere in the plan, and an evaluated code's own plan (`bindings`,
//! `value`), are refused too: slice 3's live evaluator (frontend
//! `docs/EVAL.md`) has no server twin here.
use super::flow::{for_, show, ForProps, ShowProps};
use super::signals::{
    action, create_memo, create_optimistic, create_signal, create_store, memo, ssr_scope,
    MemoOptions,
};
use super::value::{call, throw, JsVal, Res, Thrown};
use super::web::{escape, render_to_string, ssr, ssr_hydration_key};
use super::Server;
use crate::plan_v2::{validate, Expr, Plan, SourceKind, Step, View};
use serde_json::Value as J;
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
};

/// Renders a plan v2 app as `renderToString(() => App())` renders its TSX
/// twin: the HTML, or the refusal or thrown error.
pub fn render(plan: &Plan) -> Result<String, String> {
    validate(plan)?;
    refuse_evals(plan)?;
    let c = Rc::new(Ctx::new(plan));
    c.check_views(&plan.markup, &Types::new())?;
    let mut s = Server::new();
    let plan = Rc::new(plan.clone());
    render_to_string(&mut s, "", move |s| component(s, &c, &plan)).map_err(|e| e.0)
}

// ---- eval sites (slice 3) ----

const EVAL_REFUSED: &str =
    "an eval site (frontend docs/EVAL.md) is not ported to the server renderer";

/// Refuses, before anything renders, a plan with an eval site anywhere (a
/// markup eval, a value eval in a memo, seed, action or handler) and an
/// evaluated code's own plan: the live evaluator has no server twin here.
fn refuse_evals(plan: &Plan) -> Result<(), String> {
    if plan.bindings.is_some() || plan.value.is_some() {
        return Err(
            "an evaluated code's plan (frontend docs/EVAL.md) is not a server-rendered app".into(),
        );
    }
    let exprs = plan
        .sources
        .iter()
        .map(|s| &s.seed)
        .chain(plan.memos.iter().map(|m| &m.value));
    let steps = plan.actions.iter().flat_map(|a| &a.steps);
    if exprs.into_iter().any(has_eval)
        || steps.into_iter().any(step_has_eval)
        || plan.markup.iter().any(view_has_eval)
    {
        return Err(EVAL_REFUSED.into());
    }
    Ok(())
}

fn view_has_eval(v: &View) -> bool {
    match v {
        View::Eval { .. } => true,
        View::Element {
            events, children, ..
        } => {
            events.iter().flat_map(|e| &e.steps).any(step_has_eval)
                || children.iter().any(view_has_eval)
        }
        View::Text { value } => has_eval(value),
        View::Show {
            when,
            children,
            fallback,
        } => {
            has_eval(when)
                || children.iter().any(view_has_eval)
                || fallback.iter().any(view_has_eval)
        }
        View::For { each, children, .. } => has_eval(each) || children.iter().any(view_has_eval),
    }
}

fn step_has_eval(s: &Step) -> bool {
    match s {
        Step::Write { path, value, .. } => {
            has_eval(value)
                || path
                    .iter()
                    .flatten()
                    .filter_map(|seg| seg.index.as_ref())
                    .any(has_eval)
        }
        Step::Optimistic { value, updater, .. } => {
            value.as_ref().is_some_and(has_eval)
                || updater.as_ref().is_some_and(|l| has_eval(&l.body))
        }
        Step::Await { args, .. } | Step::Call { args, .. } => args.iter().any(has_eval),
        Step::Try { body, catch } => body.iter().chain(catch).any(step_has_eval),
    }
}

fn has_eval(e: &Expr) -> bool {
    match e {
        Expr::Eval { .. } => true,
        Expr::Literal { .. } | Expr::Read { .. } | Expr::Local { .. } => false,
        Expr::Array { items } => items.iter().any(has_eval),
        Expr::Object { fields } => fields.iter().any(|f| has_eval(&f.value)),
        Expr::Get { object, .. } => has_eval(object),
        Expr::Length { array } => has_eval(array),
        Expr::Filter { array, body, .. }
        | Expr::Map { array, body, .. }
        | Expr::FindIndex { array, body, .. } => has_eval(array) || has_eval(body),
        Expr::Not { value } => has_eval(value),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => has_eval(test) || has_eval(then) || has_eval(otherwise),
        Expr::Add { left, right }
        | Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right }
        | Expr::And { left, right }
        | Expr::Or { left, right } => has_eval(left) || has_eval(right),
    }
}

// ---- static types (the twin's coercions) ----

#[derive(Clone, Debug, PartialEq)]
enum Ty {
    Int,
    Str,
    Bool,
    Arr(Box<Ty>),
    Rec(Vec<(String, Ty)>),
    Unknown,
}

type Types = HashMap<String, Ty>;

fn join(a: Ty, b: Ty) -> Ty {
    if a == b {
        a
    } else {
        Ty::Unknown
    }
}

fn literal_ty(v: &J) -> Ty {
    match v {
        J::String(_) => Ty::Str,
        J::Number(_) => Ty::Int,
        J::Bool(_) => Ty::Bool,
        _ => Ty::Unknown,
    }
}

fn element_ty(t: Ty) -> Ty {
    match t {
        Ty::Arr(e) => *e,
        _ => Ty::Unknown,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Signal,
    Store,
    Optimistic,
    Memo,
}

/// The read bindings of the component body.
#[derive(Clone)]
enum Binding {
    /// A store: its plain object.
    Value(JsVal),
    /// A signal, optimistic source or memo: its read function.
    Read(JsVal),
}

type Env = BTreeMap<String, JsVal>;

struct Ctx {
    kinds: HashMap<String, Kind>,
    types: Types,
    names: RefCell<HashMap<String, Binding>>,
}

/// How the compiler lowers one text hole of the canonical twin.
#[derive(Clone, Copy, Debug)]
struct TextForm {
    /// The twin writes `{"" + x}`.
    coerce: bool,
    /// `is_dynamic`: a call or a member access; else the value is computed
    /// when the template's holes are (no thunk).
    dynamic: bool,
    /// `_$scope(...)`: `child_slot_allocates_ids` and dynamic.
    scope: bool,
}

impl Ctx {
    fn new(plan: &Plan) -> Ctx {
        let mut c = Ctx {
            kinds: HashMap::new(),
            types: Types::new(),
            names: RefCell::new(HashMap::new()),
        };
        for s in &plan.sources {
            let kind = match s.kind {
                SourceKind::Signal => Kind::Signal,
                SourceKind::Store => Kind::Store,
                SourceKind::Optimistic => Kind::Optimistic,
            };
            c.kinds.insert(s.name.clone(), kind);
            let t = c.ty(&s.seed, &Types::new());
            c.types.insert(s.name.clone(), t);
        }
        for m in &plan.memos {
            c.kinds.insert(m.name.clone(), Kind::Memo);
            let t = c.ty(&m.value, &Types::new());
            c.types.insert(m.name.clone(), t);
        }
        c
    }

    fn ty(&self, e: &Expr, locals: &Types) -> Ty {
        match e {
            Expr::Literal { value } => literal_ty(value),
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
            Expr::Read { source } => self.types.get(source).cloned().unwrap_or(Ty::Unknown),
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
            | Expr::Not { .. } => Ty::Bool,
            Expr::And { left, right } | Expr::Or { left, right } => {
                join(self.ty(left, locals), self.ty(right, locals))
            }
            Expr::Cond {
                then, otherwise, ..
            } => join(self.ty(then, locals), self.ty(otherwise, locals)),
            // Refused before typing (`refuse_evals`).
            Expr::Eval { .. } => Ty::Unknown,
        }
    }

    /// Dynamic in the compiler's sense (`is_dynamic`, shared/classify.rs):
    /// the twin has a call or a member access. A read of a signal, memo or
    /// optimistic source is a call, a get or length a member access, the
    /// array methods calls; a literal, a local and a store root are not.
    fn dynamic(&self, e: &Expr) -> bool {
        match e {
            Expr::Literal { .. } | Expr::Local { .. } => false,
            Expr::Read { source } => self.kinds.get(source) != Some(&Kind::Store),
            Expr::Get { .. }
            | Expr::Length { .. }
            | Expr::Filter { .. }
            | Expr::Map { .. }
            | Expr::FindIndex { .. }
            | Expr::Eval { .. } => true,
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

    /// `transform_logical_chain` would hoist a condition memo
    /// (shared/condition.rs): an `&&` with two dynamic sides, at the top or
    /// down the left spine of `||`.
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
                Ty::Unknown => {
                    return Err("a text hole whose type is not known statically: its TSX twin's coercion (an integer hole is {\"\" + x}) is undecided".into());
                }
                _ => false,
            },
        };
        if !coerce && self.hoists(e) {
            return Err("an uncoerced text hole with `&&` on its `||` spine (Solid's compiler hoists a condition memo there) is not ported".into());
        }
        let dynamic = self.dynamic(e);
        // `"" + x` is a binary expression: provably primitive.
        let allocates = !coerce && can_return_hydratable_child(e);
        Ok(TextForm {
            coerce,
            dynamic,
            scope: allocates && dynamic,
        })
    }

    fn check_views(&self, views: &[View], locals: &Types) -> Result<(), String> {
        let mut last_static = false;
        for v in views {
            let is_static = matches!(
                v,
                View::Text {
                    value: Expr::Literal { .. }
                }
            );
            if is_static && last_static {
                return Err("adjacent static texts (the TSX twin has one JSX text there)".into());
            }
            last_static = is_static;
            match v {
                View::Element { tag, children, .. } => {
                    if ["script", "style", "head", "html", "body"].contains(&tag.as_str()) {
                        return Err(format!("<{tag}> is not ported to the server renderer"));
                    }
                    if void_element(tag) && !children.is_empty() {
                        return Err(format!("the void element <{tag}> has children"));
                    }
                    self.check_views(children, locals)?;
                }
                View::Text {
                    value: Expr::Literal { value },
                } => {
                    raw_text(value)?;
                }
                View::Text { value } => {
                    self.text_form(value, locals)?;
                }
                View::Show {
                    children, fallback, ..
                } => {
                    self.check_views(children, locals)?;
                    self.check_views(fallback, locals)?;
                }
                View::For {
                    each,
                    item,
                    children,
                    ..
                } => {
                    let mut inner = locals.clone();
                    inner.insert(item.clone(), element_ty(self.ty(each, locals)));
                    self.check_views(children, &inner)?;
                }
                View::Eval { .. } => return Err(EVAL_REFUSED.into()),
            }
        }
        Ok(())
    }
}

/// `expression_can_return_hydratable_child` (compiler shared/utils.rs:
/// 660-704): a hole is scoped unless its value is provably a primitive.
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

/// Babel's confident evaluation, which Solid's compiler uses to fold a JSX
/// child to static text (frontend `plan/resolve-v2.ts` `confident`).
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

/// Solid: compiler shared/constants.rs:285-302 (`void_elements`)
fn void_element(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

/// A static text's raw JSX spelling. The compiler inlines
/// `trim_jsx_text(raw)` unescaped (ssr/transform.rs:2776-2783); a text the
/// trim would change, or that has no raw spelling, has no unique twin.
fn raw_text(value: &J) -> Result<String, String> {
    let t = match value {
        J::String(s) => s.clone(),
        J::Number(n) => n.to_string(),
        other => return Err(format!("static text {other} is not a string or an integer")),
    };
    if t.is_empty() {
        return Err("an empty static text".into());
    }
    if t.contains(['&', '<', '>', '{', '}'])
        || t.chars().any(|c| c.is_whitespace() && c != ' ')
        || t.contains("  ")
    {
        return Err(format!(
            "static text {t:?} has no raw JSX spelling the compiler keeps as is"
        ));
    }
    Ok(t)
}

// ---- the server-side evaluator: plan expressions over plain values ----

fn fail<T>(message: impl Into<String>) -> Res<T> {
    throw(message)
}

fn literal(value: &J) -> Res<JsVal> {
    match value {
        J::String(s) => Ok(JsVal::str(s)),
        J::Bool(b) => Ok(JsVal::Bool(*b)),
        J::Number(n) => match n.as_i64() {
            Some(i) => Ok(JsVal::Num(i)),
            None => fail(format!("literal {n} is not an integer")),
        },
        other => fail(format!("literal {other} is not a scalar")),
    }
}

fn truthy(v: &JsVal) -> Res<bool> {
    match v {
        JsVal::Bool(_) | JsVal::Num(_) | JsVal::Str(_) | JsVal::Arr(_) | JsVal::Rec(_) => {
            Ok(v.truthy())
        }
        other => fail(format!("truthiness of {other:?}")),
    }
}

fn integer(v: &JsVal) -> Res<i64> {
    match v {
        JsVal::Num(n) => Ok(*n),
        other => fail(format!("expected an integer, got {other:?}")),
    }
}

/// ToString for text and concatenation: a string is itself, an integer is
/// base ten; anything else is outside the plan's types.
fn to_text(v: &JsVal) -> Res<String> {
    match v {
        JsVal::Str(s) => Ok(s.to_string()),
        JsVal::Num(n) => Ok(n.to_string()),
        other => fail(format!("ToString of {other:?}")),
    }
}

/// `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE: i64 = (1 << 53) - 1;

fn add(l: &JsVal, r: &JsVal) -> Res<JsVal> {
    if matches!(l, JsVal::Str(_)) || matches!(r, JsVal::Str(_)) {
        return Ok(JsVal::str(&(to_text(l)? + &to_text(r)?)));
    }
    match integer(l)?.checked_add(integer(r)?) {
        Some(s) if (-MAX_SAFE..=MAX_SAFE).contains(&s) => Ok(JsVal::Num(s)),
        _ => fail("integer sum outside the safe range"),
    }
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

fn array_items(v: &JsVal, what: &str) -> Res<Vec<JsVal>> {
    match v {
        JsVal::Arr(a) => Ok(a.borrow().clone()),
        other => fail(format!("{what} of {other:?}, not an array")),
    }
}

fn read(s: &mut Server, c: &Ctx, name: &str) -> Res<JsVal> {
    let b = c.names.borrow().get(name).cloned();
    match b {
        None => fail(format!("read of {name} before it exists")),
        Some(Binding::Value(v)) => Ok(v),
        Some(Binding::Read(f)) => call(s, &f, &[]),
    }
}

fn with(env: &Env, name: &str, v: JsVal) -> Env {
    let mut env = env.clone();
    env.insert(name.to_string(), v);
    env
}

fn eval(s: &mut Server, c: &Ctx, e: &Expr, env: &Env) -> Res<JsVal> {
    match e {
        Expr::Literal { value } => literal(value),
        Expr::Array { items } => {
            let mut out = vec![];
            for x in items {
                out.push(eval(s, c, x, env)?);
            }
            Ok(JsVal::array(out))
        }
        Expr::Object { fields } => {
            let mut out = vec![];
            for f in fields {
                out.push((f.key.clone(), eval(s, c, &f.value, env)?));
            }
            Ok(JsVal::Rec(Rc::new(RefCell::new(out))))
        }
        Expr::Read { source } => read(s, c, source),
        Expr::Local { name } => match env.get(name) {
            Some(v) => Ok(v.clone()),
            None => fail(format!("unbound local {name}")),
        },
        Expr::Get { object, key } => match eval(s, c, object, env)? {
            JsVal::Rec(r) => {
                let found = r
                    .borrow()
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, v)| v.clone());
                found.map_or_else(|| fail(format!("missing field {key}")), Ok)
            }
            other => fail(format!("get {key} of {other:?}, not a record")),
        },
        Expr::Length { array } => {
            let xs = array_items(&eval(s, c, array, env)?, "length")?;
            Ok(JsVal::Num(xs.len() as i64))
        }
        Expr::Filter { array, param, body } => {
            let xs = array_items(&eval(s, c, array, env)?, "filter")?;
            let mut out = vec![];
            for x in xs {
                if truthy(&eval(s, c, body, &with(env, param, x.clone()))?)? {
                    out.push(x);
                }
            }
            Ok(JsVal::array(out))
        }
        Expr::Map { array, param, body } => {
            let xs = array_items(&eval(s, c, array, env)?, "map")?;
            let mut out = vec![];
            for x in xs {
                out.push(eval(s, c, body, &with(env, param, x))?);
            }
            Ok(JsVal::array(out))
        }
        Expr::FindIndex { array, param, body } => {
            let xs = array_items(&eval(s, c, array, env)?, "findIndex")?;
            for (i, x) in xs.into_iter().enumerate() {
                if truthy(&eval(s, c, body, &with(env, param, x))?)? {
                    return Ok(JsVal::Num(i as i64));
                }
            }
            Ok(JsVal::Num(-1))
        }
        Expr::Add { left, right } => {
            let l = eval(s, c, left, env)?;
            let r = eval(s, c, right, env)?;
            add(&l, &r)
        }
        Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let l = eval(s, c, left, env)?;
            let r = eval(s, c, right, env)?;
            compare(e, &l, &r)
        }
        Expr::And { left, right } => {
            let l = eval(s, c, left, env)?;
            if truthy(&l)? {
                eval(s, c, right, env)
            } else {
                Ok(l)
            }
        }
        Expr::Or { left, right } => {
            let l = eval(s, c, left, env)?;
            if truthy(&l)? {
                Ok(l)
            } else {
                eval(s, c, right, env)
            }
        }
        Expr::Not { value } => Ok(JsVal::Bool(!truthy(&eval(s, c, value, env)?)?)),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval(s, c, test, env)?)? {
                eval(s, c, then, env)
            } else {
                eval(s, c, otherwise, env)
            }
        }
        Expr::Eval { .. } => fail(EVAL_REFUSED),
    }
}

// Solid: compiler ssr/transform.rs:3155-3283 (`escape_expression_in_place`,
// content position, no literal escaping): a binary expression escapes both
// operands, a conditional its branches, `&&` its right side; a literal or
// `!` is left alone; anything else (a call, a member access, `||`, an
// identifier, an array or object literal) is wrapped in `_$escape(...)`.
fn eval_escaped(s: &mut Server, c: &Ctx, e: &Expr, env: &Env) -> Res<JsVal> {
    match e {
        Expr::Literal { .. } | Expr::Not { .. } => eval(s, c, e, env),
        Expr::Add { left, right } => {
            let l = eval_escaped(s, c, left, env)?;
            let r = eval_escaped(s, c, right, env)?;
            add(&l, &r)
        }
        Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let l = eval_escaped(s, c, left, env)?;
            let r = eval_escaped(s, c, right, env)?;
            compare(e, &l, &r)
        }
        Expr::And { left, right } => {
            let l = eval(s, c, left, env)?;
            if truthy(&l)? {
                eval_escaped(s, c, right, env)
            } else {
                Ok(l)
            }
        }
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            if truthy(&eval(s, c, test, env)?)? {
                eval_escaped(s, c, then, env)
            } else {
                eval_escaped(s, c, otherwise, env)
            }
        }
        _ => Ok(escape(&eval(s, c, e, env)?)),
    }
}

/// A text hole's value: `"" + x` or `x`, escaped in place, which must be the
/// string or integer the plan's ToString accepts.
fn text_value(s: &mut Server, c: &Ctx, e: &Expr, env: &Env, coerce: bool) -> Res<JsVal> {
    let v = eval_escaped(s, c, e, env)?;
    let v = if coerce { add(&JsVal::str(""), &v)? } else { v };
    to_text(&v)?;
    Ok(v)
}

// ---- the component ----

/// The component body, in the order the twin declares it: sources, memos,
/// actions, then the returned view (PLAN-V2.md, "Top level").
fn component(s: &mut Server, c: &Rc<Ctx>, plan: &Rc<Plan>) -> Res<JsVal> {
    let empty = Env::new();
    for src in &plan.sources {
        let b = match src.kind {
            SourceKind::Signal => {
                let v = eval(s, c, &src.seed, &empty)?;
                Binding::Read(create_signal(v).0)
            }
            SourceKind::Store => {
                let v = eval(s, c, &src.seed, &empty)?;
                Binding::Value(create_store(v).0)
            }
            SourceKind::Optimistic => {
                let (seed, c2) = (src.seed.clone(), c.clone());
                let (read, _) =
                    create_optimistic(s, Rc::new(move |s, _| eval(s, &c2, &seed, &Env::new())))?;
                Binding::Read(read)
            }
        };
        c.names.borrow_mut().insert(src.name.clone(), b);
    }
    for m in &plan.memos {
        let (value, c2) = (m.value.clone(), c.clone());
        let read = create_memo(
            s,
            Rc::new(move |s, _| eval(s, &c2, &value, &Env::new())),
            MemoOptions::default(),
        )?;
        c.names
            .borrow_mut()
            .insert(m.name.clone(), Binding::Read(read));
    }
    for a in &plan.actions {
        let name = a.name.clone();
        let _ = action(JsVal::func(a.params.len(), move |_, _| {
            throw(format!("action {name} called during a server render"))
        }));
    }
    fragment(s, c, &plan.markup, &empty, &Types::new())
}

/// A component position (the markup, a Show branch, a For row): an element
/// is its template's `ssr()` result, a Show or For its component's memo read,
/// raw (no escape); more than one view is an array.
fn fragment(s: &mut Server, c: &Rc<Ctx>, views: &[View], env: &Env, tys: &Types) -> Res<JsVal> {
    let mut parts = vec![];
    for v in views {
        parts.push(match v {
            View::Element { .. } => template(s, c, v, env, tys)?,
            View::Text { .. } => return fail("text directly in a component position"),
            _ => control(s, c, v, env, tys)?,
        });
    }
    Ok(if parts.len() == 1 {
        parts.pop().expect("one")
    } else {
        JsVal::array(parts)
    })
}

enum Hole<'v> {
    Key,
    Text(&'v Expr),
    Control(&'v View),
}

// Solid: compiler ssr/transform.rs:2082-2156 (`ssr_template`) and 2745-2892
// (`append_children`): `<tag`, the hydration key at a template root, `>`,
// the children (markers around each hole when there is more than one child),
// `</tag>` unless void.
fn lower<'v>(v: &'v View, root: bool, parts: &mut Vec<String>, holes: &mut Vec<Hole<'v>>) {
    let View::Element { tag, children, .. } = v else {
        unreachable!("a template is an element")
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
        return;
    }
    let markers = children.len() > 1;
    for child in children {
        match child {
            View::Text {
                value: Expr::Literal { value },
            } => {
                let t = raw_text(value).expect("checked before rendering");
                parts.last_mut().expect("a part").push_str(&t);
            }
            View::Element { .. } => lower(child, false, parts, holes),
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
}

/// A template root: its hydration key and holes evaluated in document order
/// (the compiler's `var _v$ = …` list), then `_$ssr(_tmpl$, …)`.
fn template(s: &mut Server, c: &Rc<Ctx>, v: &View, env: &Env, tys: &Types) -> Res<JsVal> {
    let mut parts = vec![String::new()];
    let mut holes = vec![];
    lower(v, true, &mut parts, &mut holes);
    let mut values = vec![];
    for hole in holes {
        values.push(match hole {
            Hole::Key => ssr_hydration_key(s)?,
            Hole::Text(e) => text_hole(s, c, e, env, tys)?,
            // A component child is `_$escape(Comp(props))`, never scoped.
            Hole::Control(view) => escape(&control(s, c, view, env, tys)?),
        });
    }
    ssr(s, &parts, &values)
}

// Solid: compiler ssr/transform.rs:2826-2859 (an expression child):
// `dynamic_child_value` (a thunk when dynamic), `escape_expression_in_place`,
// and `_$scope` when the slot can allocate ids.
fn text_hole(s: &mut Server, c: &Rc<Ctx>, e: &Expr, env: &Env, tys: &Types) -> Res<JsVal> {
    let form = c.text_form(e, tys).map_err(Thrown)?;
    if !form.dynamic {
        return text_value(s, c, e, env, form.coerce);
    }
    let (e2, env2, c2) = (e.clone(), env.clone(), c.clone());
    let thunk = JsVal::func(0, move |s, _| text_value(s, &c2, &e2, &env2, form.coerce));
    if form.scope {
        ssr_scope(s, thunk)
    } else {
        Ok(thunk)
    }
}

/// A getter of the compiler's hoisted props (`_P$`): evaluated where the
/// component reads it.
fn getter(f: impl Fn(&mut Server) -> Res<JsVal> + 'static) -> JsVal {
    JsVal::func(0, move |s, _| f(s))
}

/// `transformCondition(…, inline)` on a component prop (compiler
/// shared/condition.rs): the test of a conditional with a dynamic branch and
/// a dynamic test, or the left of `&&` with two dynamic sides, is read
/// through `_$memo(() => test)()` created in the getter; `||` walks its left
/// spine to such an `&&`. A non-boolean test is memoized as `!!test`.
fn condition(s: &mut Server, c: &Rc<Ctx>, e: &Expr, env: &Env) -> Res<JsVal> {
    match e {
        Expr::Cond {
            test,
            then,
            otherwise,
        } if (c.dynamic(then) || c.dynamic(otherwise)) && c.dynamic(test) => {
            let t = memoized(s, c, test, env)?;
            let branch = if truthy(&t)? { then } else { otherwise };
            match **branch {
                Expr::Cond { .. } | Expr::And { .. } | Expr::Or { .. } => {
                    condition(s, c, branch, env)
                }
                _ => eval(s, c, branch, env),
            }
        }
        Expr::And { left, right } if c.dynamic(left) && c.dynamic(right) => {
            let t = memoized(s, c, left, env)?;
            if boolean_expr(left) {
                if truthy(&t)? {
                    eval(s, c, right, env)
                } else {
                    Ok(t)
                }
            } else if truthy(&t)? {
                eval(s, c, right, env)
            } else {
                eval(s, c, left, env)
            }
        }
        Expr::Or { left, right } if matches!(**left, Expr::And { .. } | Expr::Or { .. }) => {
            let l = condition(s, c, left, env)?;
            if truthy(&l)? {
                Ok(l)
            } else {
                eval(s, c, right, env)
            }
        }
        _ => eval(s, c, e, env),
    }
}

/// A comparison or `!`: statically boolean (`is_boolean_expression`).
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

/// `_$memo(() => test)()`: a sync memo (one id) created in the getter, read
/// once.
fn memoized(s: &mut Server, c: &Rc<Ctx>, e: &Expr, env: &Env) -> Res<JsVal> {
    let (e2, env2, c2) = (e.clone(), env.clone(), c.clone());
    let boolean = boolean_expr(e);
    let m = memo(
        s,
        JsVal::func(0, move |s, _| {
            let v = eval(s, &c2, &e2, &env2)?;
            Ok(if boolean { v } else { JsVal::Bool(truthy(&v)?) })
        }),
    )?;
    call(s, &m, &[])
}

/// `Show(new _P$(…))` or `For(new _P$(…, row => …))`.
fn control(s: &mut Server, c: &Rc<Ctx>, v: &View, env: &Env, tys: &Types) -> Res<JsVal> {
    match v {
        View::Show {
            when,
            children,
            fallback,
        } => {
            let (when, kids) = (when.clone(), children.clone());
            let (e1, e2, e3) = (env.clone(), env.clone(), env.clone());
            let (c1, c2, c3) = (c.clone(), c.clone(), c.clone());
            let (t2, t3) = (tys.clone(), tys.clone());
            let fallback = (!fallback.is_empty()).then(|| {
                let fallback = fallback.clone();
                getter(move |s| fragment(s, &c3, &fallback, &e3, &t3))
            });
            show(
                s,
                ShowProps {
                    when: getter(move |s| condition(s, &c1, &when, &e1)),
                    keyed: false,
                    fallback,
                    children: getter(move |s| fragment(s, &c2, &kids, &e2, &t2)),
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
            row_tys.insert(item.clone(), element_ty(c.ty(each, tys)));
            let (each, e1, c1) = (each.clone(), env.clone(), c.clone());
            let (item, kids, e2, c2) = (item.clone(), children.clone(), env.clone(), c.clone());
            let each = getter(move |s| {
                let xs = condition(s, &c1, &each, &e1)?;
                if !matches!(xs, JsVal::Arr(_)) {
                    return fail(format!("For of {xs:?}, not an array"));
                }
                Ok(xs)
            });
            // `children: (item) => …`: identity keying passes the item itself.
            let row = JsVal::func(1, move |s, args| {
                let env = with(
                    &e2,
                    &item,
                    args.first().cloned().unwrap_or(JsVal::Undefined),
                );
                fragment(s, &c2, &kids, &env, &row_tys)
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
        _ => unreachable!("a control-flow view"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(json: &str) -> Plan {
        serde_json::from_str(json).expect("a plan")
    }

    #[test]
    fn a_lone_scoped_hole_and_its_key() {
        let p = plan(
            r#"{"version":2,"component":"A","hosts":[],"sources":[{"name":"n","kind":"signal","seed":{"op":"literal","value":"a<&b"}}],"memos":[],"actions":[],
            "markup":[{"kind":"element","tag":"b","events":[],"children":[{"kind":"text","value":{"op":"read","source":"n"}}]}]}"#,
        );
        assert_eq!(render(&p).unwrap(), "<b _hk=0>a&lt;&amp;b</b>");
    }

    #[test]
    fn static_text_without_a_raw_spelling_is_refused() {
        let p = plan(
            r#"{"version":2,"component":"A","hosts":[],"sources":[],"memos":[],"actions":[],
            "markup":[{"kind":"element","tag":"b","events":[],"children":[{"kind":"text","value":{"op":"literal","value":"a & b"}}]}]}"#,
        );
        assert!(render(&p).unwrap_err().contains("raw JSX spelling"));
    }
}
