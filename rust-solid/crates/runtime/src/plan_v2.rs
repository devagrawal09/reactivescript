//! Plan schema v2 (`frontend/plan/docs/PLAN-V2.md`): a data-only
//! component, built with the ported Solid 2 primitives and rendered by the
//! port of `@solidjs/universal`, as `frontend/plan/solid-plan.ts`
//! builds it with Solid's own. Sources are `createSignal`/`createStore`/
//! `createOptimistic(fn)`, memos `createMemo`, actions `action(function*)`,
//! the view `createElement`/`createTextNode`/`insertNode`/`insert` with
//! `<Show>` and `<For>`. The evaluator never schedules anything itself: the
//! ported runtime (`slice1`) decides what each frame shows.
//!
//! Host functions are registry entries keyed by name: a call records a new
//! pending request (one-based per host, per mount) and yields its flight.
//! Every op outside the schema and every value outside its types is an
//! explicit error; [`validate`] refuses a malformed plan before anything is
//! built.
use crate::renderer::TreeRenderer;
use crate::slice1::{
    user_error, ActionBody, ActionId, ActionStep, BodyFn, Builtin, Disposer, Error, ErroredProps,
    ForProps, Getter, InsertOptions, JsObj, Key, LoadingProps, Marker, NodeId, Out, Resume,
    Runtime, ShowProps, Universal, Value,
};
use serde::Deserialize;
use serde_json::Value as J;
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap, HashSet},
    rc::Rc,
};

// ---- the schema ----

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Expr {
    Literal {
        value: J,
    },
    Array {
        items: Vec<Expr>,
    },
    Object {
        fields: Vec<Field>,
    },
    Read {
        source: String,
    },
    Local {
        name: String,
    },
    Get {
        object: Box<Expr>,
        key: String,
    },
    Length {
        array: Box<Expr>,
    },
    Filter {
        array: Box<Expr>,
        param: String,
        body: Box<Expr>,
    },
    Map {
        array: Box<Expr>,
        param: String,
        body: Box<Expr>,
    },
    FindIndex {
        array: Box<Expr>,
        param: String,
        body: Box<Expr>,
    },
    Add {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Eq {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Ne {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Lt {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Le {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Gt {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Ge {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    And {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Or {
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Not {
        value: Box<Expr>,
    },
    Cond {
        test: Box<Expr>,
        then: Box<Expr>,
        #[serde(rename = "else")]
        otherwise: Box<Expr>,
    },
    /// v2.1 (PLAN-V2.md, "v2.1: async data", Expressions): `isPending(() =>
    /// value)`, a reactive context only.
    Pending {
        value: Box<Expr>,
    },
    /// v2.1: `latest(() => value)`, a reactive context only.
    Latest {
        value: Box<Expr>,
    },
    /// A value eval (frontend `docs/EVAL.md`): the whole value of a memo.
    /// The code is a reactive string; the host's table gives its plan, one
    /// expression over the bindings, of the declared scalar type.
    Eval {
        code: Box<Expr>,
        bindings: Vec<EvalBinding>,
        interface: String,
        syntax: String,
        check: String,
        #[serde(rename = "type")]
        ty: String,
    },
}

/// An eval site's binding: the evaluated code's name for an outer source,
/// memo, action or host.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalBinding {
    pub name: String,
    pub target: String,
}

/// An evaluated plan's binding (frontend `docs/EVAL.md`): a name it reads
/// (`read`, `store`) or calls (`action`) but never writes.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InnerBinding {
    pub name: String,
    pub kind: String,
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
    #[serde(default)]
    pub params: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub key: String,
    pub value: Expr,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lambda {
    pub param: String,
    pub body: Expr,
}

/// A store path segment: exactly one of `key` (a record field) and `index`
/// (an array element).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub index: Option<Expr>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Step {
    Write {
        source: String,
        #[serde(default)]
        path: Option<Vec<Segment>>,
        value: Expr,
    },
    Optimistic {
        source: String,
        #[serde(default)]
        value: Option<Expr>,
        #[serde(default)]
        updater: Option<Lambda>,
    },
    Await {
        host: String,
        args: Vec<Expr>,
        bind: String,
    },
    Try {
        body: Vec<Step>,
        catch: Vec<Step>,
    },
    Call {
        action: String,
        args: Vec<Expr>,
    },
    /// v2.1: `refresh(source)` of an async memo, in an action or a plain
    /// handler.
    Refresh {
        source: String,
    },
    /// v2.1: `affects(source)` of an async memo, in an action only.
    Affects {
        source: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub name: String,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum View {
    Element {
        tag: String,
        events: Vec<Event>,
        children: Vec<View>,
    },
    Text {
        value: Expr,
    },
    Show {
        when: Expr,
        children: Vec<View>,
        fallback: Vec<View>,
    },
    For {
        each: Expr,
        item: String,
        key: String,
        children: Vec<View>,
    },
    /// A markup eval (frontend `docs/EVAL.md`): an element child, inserted as
    /// the compiler inserts `{createEval(() => code, …)}`.
    Eval {
        code: Expr,
        bindings: Vec<EvalBinding>,
        interface: String,
        syntax: String,
        check: String,
    },
    /// v2.1: `createComponent(Loading, { get fallback(), get children() })`.
    Loading {
        fallback: Vec<View>,
        children: Vec<View>,
    },
    /// v2.1: `createComponent(Errored, { fallback: (err) => …, get
    /// children() })`; the error is not bound.
    Errored {
        fallback: Vec<View>,
        children: Vec<View>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostSig {
    pub name: String,
    pub params: Vec<String>,
    /// A scalar type name, or (v2.1) a structured type in the eval
    /// interface grammar, printed canonically (`HostType::print`).
    pub returns: String,
    /// v2.1: `true` for an `export pure fn` host; absent otherwise.
    #[serde(default)]
    pub pure: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Signal,
    Store,
    Optimistic,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub name: String,
    pub kind: SourceKind,
    pub seed: Expr,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Memo {
    pub name: String,
    /// A memo's value; absent on an async memo.
    #[serde(default)]
    pub value: Option<Expr>,
    /// v2.1: an async memo, `createMemo(() => host(…args))`.
    #[serde(default, rename = "await")]
    pub call: Option<AsyncCall>,
}

/// v2.1: an async memo's one host call.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AsyncCall {
    pub host: String,
    pub args: Vec<Expr>,
}

/// A plan's `version`: 2, or 2.1 (a JSON number) when a v2.1 form occurs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlanVersion(pub f64);

impl<'de> Deserialize<'de> for PlanVersion {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let n = serde_json::Number::deserialize(d)?;
        n.as_f64()
            .map(PlanVersion)
            .ok_or_else(|| serde::de::Error::custom(format!("plan version {n}")))
    }
}

impl PlanVersion {
    pub fn is_v21(&self) -> bool {
        self.0 == 2.1
    }
}

impl std::fmt::Display for PlanVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl PartialEq<u32> for PlanVersion {
    fn eq(&self, o: &u32) -> bool {
        self.0 == *o as f64
    }
}

/// A host result type (frontend `eval/interface.ts` `parseType`, `plan/types.ts`
/// `printType` and `conforms`): a scalar, an array, or a record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostType {
    Number,
    Str,
    Boolean,
    Array(Box<HostType>),
    Record(Vec<(String, HostType)>),
}

impl HostType {
    /// `parseType`: `number`, `string`, `boolean`, `T[]`, `(T)`, `{ k: T, … }`
    /// (`,` or `;` between fields), whitespace anywhere.
    pub fn parse(text: &str) -> Result<HostType, String> {
        let s: Vec<char> = text.trim().chars().collect();
        let mut i = 0;
        let t = Self::one(&s, &mut i, text)?;
        Self::ws(&s, &mut i);
        if i != s.len() {
            return Err(format!("type: unexpected input in {text:?}"));
        }
        Ok(t)
    }
    fn ws(s: &[char], i: &mut usize) {
        while *i < s.len() && s[*i].is_whitespace() {
            *i += 1;
        }
    }
    fn one(s: &[char], i: &mut usize, text: &str) -> Result<HostType, String> {
        Self::ws(s, i);
        let mut t = if s.get(*i) == Some(&'{') {
            *i += 1;
            let mut fields: Vec<(String, HostType)> = vec![];
            Self::ws(s, i);
            while s.get(*i) != Some(&'}') {
                let start = *i;
                if !s
                    .get(*i)
                    .is_some_and(|c| c.is_ascii_alphabetic() || *c == '_' || *c == '$')
                {
                    return Err(format!("type: field name expected in {text:?}"));
                }
                while s
                    .get(*i)
                    .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
                {
                    *i += 1;
                }
                let k: String = s[start..*i].iter().collect();
                Self::ws(s, i);
                if s.get(*i) != Some(&':') {
                    return Err(format!("type: `:` expected in {text:?}"));
                }
                *i += 1;
                if fields.iter().any(|(n, _)| *n == k) {
                    return Err(format!("type: field {k} twice"));
                }
                let ft = Self::one(s, i, text)?;
                fields.push((k, ft));
                Self::ws(s, i);
                match s.get(*i) {
                    Some(',') | Some(';') => {
                        *i += 1;
                        Self::ws(s, i);
                    }
                    Some('}') => {}
                    _ => return Err(format!("type: `,` or `}}` expected in {text:?}")),
                }
            }
            *i += 1;
            HostType::Record(fields)
        } else if s.get(*i) == Some(&'(') {
            *i += 1;
            let t = Self::one(s, i, text)?;
            Self::ws(s, i);
            if s.get(*i) != Some(&')') {
                return Err(format!("type: `)` expected in {text:?}"));
            }
            *i += 1;
            t
        } else {
            let rest: String = s[*i..].iter().collect();
            let word = ["number", "string", "boolean"].into_iter().find(|w| {
                rest.starts_with(w)
                    && !rest[w.len()..]
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
            });
            let Some(w) = word else {
                return Err(format!(
                    "type: number, string, boolean, T[] or {{ … }} expected in {text:?}"
                ));
            };
            *i += w.len();
            match w {
                "number" => HostType::Number,
                "string" => HostType::Str,
                _ => HostType::Boolean,
            }
        };
        Self::ws(s, i);
        while s.get(*i) == Some(&'[') && s.get(*i + 1) == Some(&']') {
            *i += 2;
            t = HostType::Array(Box::new(t));
            Self::ws(s, i);
        }
        Ok(t)
    }
    /// `printType`: `{ a: T, b: U }`, `T[]`, an array item that is an array
    /// parenthesized.
    pub fn print(&self) -> String {
        match self {
            HostType::Number => "number".into(),
            HostType::Str => "string".into(),
            HostType::Boolean => "boolean".into(),
            HostType::Array(t) => match **t {
                HostType::Array(_) => format!("({})[]", t.print()),
                _ => format!("{}[]", t.print()),
            },
            HostType::Record(fs) => format!(
                "{{ {} }}",
                fs.iter()
                    .map(|(k, t)| format!("{k}: {}", t.print()))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
    pub fn is_scalar(&self) -> bool {
        matches!(self, HostType::Number | HostType::Str | HostType::Boolean)
    }
    /// `conforms`: integers for `number`, arrays, records with exactly the
    /// type's keys.
    pub fn conforms_json(&self, v: &J) -> bool {
        match (self, v) {
            (HostType::Number, J::Number(n)) => n
                .as_i64()
                .is_some_and(|i| (-MAX_SAFE..=MAX_SAFE).contains(&i)),
            (HostType::Str, J::String(_)) | (HostType::Boolean, J::Bool(_)) => true,
            (HostType::Array(t), J::Array(xs)) => xs.iter().all(|x| t.conforms_json(x)),
            (HostType::Record(fs), J::Object(o)) => {
                o.len() == fs.len()
                    && fs
                        .iter()
                        .all(|(k, t)| o.get(k).is_some_and(|x| t.conforms_json(x)))
            }
            _ => false,
        }
    }
    /// A conforming JSON value as a fresh runtime value: arrays and records
    /// are new plain objects (a host's JSON, `structuredClone`d per
    /// resolution), with JSON's key order.
    pub fn value_of(&self, v: &J) -> Result<Value, String> {
        if !self.conforms_json(v) {
            return Err(format!("{v} does not conform to {}", self.print()));
        }
        Ok(json_value(v))
    }
    /// A runtime value of this type (an awaited host result in an action).
    pub fn conforms(&self, v: &Value) -> bool {
        matches!(
            (self, v),
            (HostType::Number, Value::Int(_))
                | (HostType::Str, Value::Str(_))
                | (HostType::Boolean, Value::Bool(_))
                | (HostType::Array(_) | HostType::Record(_), Value::Obj(_))
        )
    }
}

/// A JSON value (already checked against its type) as fresh plain objects.
fn json_value(v: &J) -> Value {
    match v {
        J::Number(n) => Value::Int(n.as_i64().expect("an integer")),
        J::String(s) => Value::str(s),
        J::Bool(b) => Value::Bool(*b),
        J::Array(xs) => Value::Obj(JsObj::new_array(xs.iter().map(json_value).collect())),
        J::Object(o) => Value::Obj(JsObj::new_object(
            o.iter()
                .map(|(k, x)| (Rc::from(k.as_str()), json_value(x)))
                .collect(),
        )),
        J::Null => unreachable!("no host type admits null"),
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub name: String,
    pub params: Vec<String>,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub version: PlanVersion,
    pub component: String,
    pub hosts: Vec<HostSig>,
    /// Evaluated code only (frontend `docs/EVAL.md`).
    #[serde(default)]
    pub bindings: Option<Vec<InnerBinding>>,
    pub sources: Vec<Source>,
    pub memos: Vec<Memo>,
    pub actions: Vec<Action>,
    pub markup: Vec<View>,
    /// A value eval's one expression (frontend `docs/EVAL.md`).
    #[serde(default)]
    pub value: Option<Expr>,
}

/// The host's eval table (frontend `docs/EVAL.md`, "Rust"): for each eval
/// request (code, interface, syntax, check, and a value eval's type), the
/// frontend's compiled plan or its refusal. The Rust consumer has no
/// frontend: an eval site looks its code up here, and a code with no entry
/// fails the run.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalTable {
    pub version: u32,
    pub evals: Vec<EvalEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalEntry {
    pub code: String,
    pub interface: String,
    pub syntax: String,
    pub check: String,
    #[serde(default, rename = "type")]
    pub ty: Option<String>,
    #[serde(default)]
    pub plan: Option<Plan>,
    #[serde(default)]
    pub refused: Option<Vec<EvalDiagnostic>>,
}

/// A typed refusal (frontend `eval/compile.ts`).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalDiagnostic {
    pub code: String,
    #[serde(default)]
    pub rule: Option<String>,
    #[serde(default)]
    pub line: Option<u64>,
    pub message: String,
}

impl EvalEntry {
    /// `EvalRefused`'s message (frontend `eval/compile.ts`).
    fn refusal(&self) -> Option<String> {
        self.refused.as_ref().map(|ds| {
            let parts: Vec<String> = ds
                .iter()
                .map(|d| match d.line {
                    Some(l) => format!("{} (line {l}): {}", d.code, d.message),
                    None => format!("{}: {}", d.code, d.message),
                })
                .collect();
            format!("eval refused: {}", parts.join("; "))
        })
    }
}

/// Refuses a table entry outside the schema: exactly one of plan and refusal,
/// a value plan exactly for a typed request, and every plan valid.
pub fn validate_table(table: &EvalTable) -> Result<(), String> {
    if table.version != 1 {
        return Err(format!("eval table version {} is not 1", table.version));
    }
    for e in &table.evals {
        match (&e.plan, &e.refused) {
            (Some(p), None) => {
                if p.value.is_some() != e.ty.is_some() {
                    return Err(format!(
                        "eval table: {:?} is not a {} plan",
                        e.code,
                        if e.ty.is_some() { "value" } else { "view" }
                    ));
                }
                validate(p).map_err(|m| format!("eval table: {:?}: {m}", e.code))?;
            }
            (None, Some(_)) => {}
            _ => {
                return Err(format!(
                    "eval table: {:?} has one of plan and refused",
                    e.code
                ))
            }
        }
        if let Some(t) = &e.ty {
            if !SCALARS.contains(&t.as_str()) {
                return Err(format!("eval table: type {t}"));
            }
        }
    }
    Ok(())
}

// ---- static checks (refusals before anything is built) ----

const SCALARS: [&str; 3] = ["number", "string", "boolean"];
/// `Number.MAX_SAFE_INTEGER`: integers beyond it are not exact JS numbers.
const MAX_SAFE: i64 = (1 << 53) - 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum NameKind {
    Signal,
    Store,
    Optimistic,
    Memo,
    /// v2.1: an async memo (`createMemo(() => host(…))`).
    Async,
    Action,
    /// An evaluated plan's bindings: read, never written.
    BoundRead,
    BoundStore,
    BoundAction,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StepContext {
    Action,
    Handler,
}

struct Check<'a> {
    names: HashMap<&'a str, NameKind>,
    hosts: HashMap<&'a str, &'a HostSig>,
    actions: HashMap<&'a str, &'a Action>,
    /// Bound actions' arities.
    bound: HashMap<&'a str, usize>,
    /// Set while a handler's or an action's steps are checked: their
    /// expressions are imperative (untracked snapshots).
    imperative: std::cell::Cell<bool>,
    /// A v2.1 form occurs (PLAN-V2.md, "v2.1: async data").
    v21: std::cell::Cell<bool>,
}

fn identifier(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some(f) if f.is_ascii_alphabetic() || f == '_' || f == '$')
        && c.all(|x| x.is_ascii_alphanumeric() || x == '_' || x == '$')
}

/// A literal is a scalar: an integer within the safe range, a string or a
/// boolean.
fn literal(value: &J) -> Result<Value, String> {
    match value {
        J::String(s) => Ok(Value::str(s)),
        J::Bool(b) => Ok(Value::Bool(*b)),
        J::Number(n) => match n.as_i64() {
            Some(i) if (-MAX_SAFE..=MAX_SAFE).contains(&i) => Ok(Value::Int(i)),
            _ => Err(format!("literal {n} is not a safe integer")),
        },
        other => Err(format!("literal {other} is not a scalar")),
    }
}

impl<'a> Check<'a> {
    fn expr(&self, e: &Expr, scope: &mut Vec<String>, reads: bool) -> Result<(), String> {
        match e {
            Expr::Literal { value } => literal(value).map(|_| ()),
            Expr::Array { items } => items.iter().try_for_each(|x| self.expr(x, scope, reads)),
            Expr::Object { fields } => {
                let mut seen = HashSet::new();
                for f in fields {
                    if !seen.insert(f.key.as_str()) {
                        return Err(format!("object key {} repeated", f.key));
                    }
                    self.expr(&f.value, scope, reads)?;
                }
                Ok(())
            }
            Expr::Read { source } => {
                if !reads {
                    return Err(format!("a constant expression reads {source}"));
                }
                match self.names.get(source.as_str()) {
                    None => Err(format!("read of unknown source {source}")),
                    Some(NameKind::Action | NameKind::BoundAction) => {
                        Err(format!("read of action {source}"))
                    }
                    // PLAN-V2.md, "Async memo" 6: reactive reads only.
                    Some(NameKind::Async) if self.imperative.get() => Err(format!(
                        "an async memo is read only in reactive contexts: {source}"
                    )),
                    Some(_) => Ok(()),
                }
            }
            Expr::Pending { value } | Expr::Latest { value } => {
                self.v21.set(true);
                if !reads || self.imperative.get() {
                    return Err(format!(
                        "{} occurs only in a reactive context",
                        if matches!(e, Expr::Pending { .. }) {
                            "pending"
                        } else {
                            "latest"
                        }
                    ));
                }
                self.expr(value, scope, reads)
            }
            Expr::Local { name } => {
                if scope.iter().any(|s| s == name) {
                    Ok(())
                } else {
                    Err(format!("unbound local {name}"))
                }
            }
            Expr::Get { object, .. } => self.expr(object, scope, reads),
            Expr::Length { array } => self.expr(array, scope, reads),
            Expr::Filter { array, param, body }
            | Expr::Map { array, param, body }
            | Expr::FindIndex { array, param, body } => {
                self.expr(array, scope, reads)?;
                self.lambda(param, body, scope, reads)
            }
            Expr::Add { left, right }
            | Expr::Eq { left, right }
            | Expr::Ne { left, right }
            | Expr::Lt { left, right }
            | Expr::Le { left, right }
            | Expr::Gt { left, right }
            | Expr::Ge { left, right }
            | Expr::And { left, right }
            | Expr::Or { left, right } => {
                self.expr(left, scope, reads)?;
                self.expr(right, scope, reads)
            }
            Expr::Not { value } => self.expr(value, scope, reads),
            Expr::Cond {
                test,
                then,
                otherwise,
            } => {
                self.expr(test, scope, reads)?;
                self.expr(then, scope, reads)?;
                self.expr(otherwise, scope, reads)
            }
            Expr::Eval {
                code,
                bindings,
                syntax,
                check,
                ty,
                ..
            } => {
                if !reads {
                    return Err("a constant expression evaluates code".into());
                }
                if !SCALARS.contains(&ty.as_str()) {
                    return Err(format!("a value eval's type {ty:?}"));
                }
                self.eval_site(bindings, syntax, check)?;
                self.expr(code, scope, reads)
            }
        }
    }

    /// An eval site: unique binding names, each an outer name or host.
    fn eval_site(&self, bindings: &[EvalBinding], syntax: &str, check: &str) -> Result<(), String> {
        if syntax != "rx" && syntax != "tsx" {
            return Err(format!("eval syntax {syntax:?}"));
        }
        if check != "strict" && check != "lenient" {
            return Err(format!("eval check {check:?}"));
        }
        let mut seen = HashSet::new();
        for b in bindings {
            if !identifier(&b.name) || !seen.insert(b.name.as_str()) {
                return Err(format!("eval binding {:?} is not a unique name", b.name));
            }
            if !self.names.contains_key(b.target.as_str())
                && !self.hosts.contains_key(b.target.as_str())
            {
                return Err(format!(
                    "eval binding {} names unknown {}",
                    b.name, b.target
                ));
            }
        }
        Ok(())
    }

    fn lambda(
        &self,
        param: &str,
        body: &Expr,
        scope: &mut Vec<String>,
        reads: bool,
    ) -> Result<(), String> {
        if !identifier(param) {
            return Err(format!("lambda parameter {param:?}"));
        }
        scope.push(param.into());
        let r = self.expr(body, scope, reads);
        scope.pop();
        r
    }

    fn kind(&self, source: &str) -> Option<NameKind> {
        self.names.get(source).copied()
    }

    fn steps(
        &self,
        steps: &[Step],
        scope: &mut Vec<String>,
        at: StepContext,
    ) -> Result<(), String> {
        let prev = self.imperative.replace(true);
        let r = self.steps_in(steps, scope, at);
        self.imperative.set(prev);
        r
    }

    fn steps_in(
        &self,
        steps: &[Step],
        scope: &mut Vec<String>,
        at: StepContext,
    ) -> Result<(), String> {
        for s in steps {
            match s {
                Step::Write {
                    source,
                    path,
                    value,
                } => {
                    match (path, self.kind(source)) {
                        (None, Some(NameKind::Signal)) => {}
                        (Some(p), Some(NameKind::Store)) => {
                            if p.is_empty() {
                                return Err(format!("empty store path in a write of {source}"));
                            }
                            for seg in p {
                                match (&seg.key, &seg.index) {
                                    (Some(_), None) => {}
                                    (None, Some(i)) => self.expr(i, scope, true)?,
                                    _ => {
                                        return Err(
                                            "a path segment has exactly one of key and index"
                                                .into(),
                                        )
                                    }
                                }
                            }
                        }
                        (None, _) => {
                            return Err(format!("a plain write targets {source}, not a signal"))
                        }
                        (Some(_), _) => {
                            return Err(format!("a path write targets {source}, not a store"))
                        }
                    }
                    self.expr(value, scope, true)?;
                }
                Step::Optimistic {
                    source,
                    value,
                    updater,
                } => {
                    if at == StepContext::Handler {
                        return Err("a guess in a plain handler".into());
                    }
                    if self.kind(source) != Some(NameKind::Optimistic) {
                        return Err(format!(
                            "a guess targets {source}, not an optimistic source"
                        ));
                    }
                    match (value, updater) {
                        (Some(v), None) => self.expr(v, scope, true)?,
                        (None, Some(u)) => self.lambda(&u.param, &u.body, scope, true)?,
                        _ => return Err("a guess has exactly one of value and updater".into()),
                    }
                }
                Step::Await { host, args, bind } => {
                    if at == StepContext::Handler {
                        return Err("an await in a plain handler".into());
                    }
                    let h = self
                        .hosts
                        .get(host.as_str())
                        .ok_or_else(|| format!("await of unknown host {host}"))?;
                    if h.params.len() != args.len() {
                        return Err(format!("{host} takes {} arguments", h.params.len()));
                    }
                    for a in args {
                        self.expr(a, scope, true)?;
                    }
                    if !identifier(bind) {
                        return Err(format!("await binding {bind:?}"));
                    }
                    scope.push(bind.clone());
                }
                Step::Try { body, catch } => {
                    if at == StepContext::Handler {
                        return Err("a try in a plain handler".into());
                    }
                    self.steps(body, &mut scope.clone(), at)?;
                    self.steps(catch, &mut scope.clone(), at)?;
                }
                Step::Call { action, args } => {
                    if at == StepContext::Action {
                        return Err(format!("an action calls the action {action}"));
                    }
                    let arity = match (
                        self.actions.get(action.as_str()),
                        self.bound.get(action.as_str()),
                    ) {
                        (Some(a), _) => a.params.len(),
                        (None, Some(n)) => *n,
                        (None, None) => return Err(format!("call of unknown action {action}")),
                    };
                    if arity != args.len() {
                        return Err(format!("{action} takes {arity} arguments"));
                    }
                    for x in args {
                        self.expr(x, scope, true)?;
                    }
                }
                Step::Refresh { source } | Step::Affects { source } => {
                    self.v21.set(true);
                    let affects = matches!(s, Step::Affects { .. });
                    if self.kind(source) != Some(NameKind::Async) {
                        return Err(format!(
                            "{} targets {source}, not an async memo",
                            if affects { "affects" } else { "refresh" }
                        ));
                    }
                    if affects && at == StepContext::Handler {
                        return Err("affects in a plain handler".into());
                    }
                }
            }
        }
        Ok(())
    }

    /// `component`: the views of a component position (the markup, a Show
    /// branch, a For row), where Solid's compiler lowers text to a string or
    /// a memo, not a text node: text there is refused. An element's children
    /// may be anything; dynamic ones take the compiler's markers.
    fn views(
        &self,
        views: &[View],
        scope: &mut Vec<String>,
        component: bool,
    ) -> Result<(), String> {
        for v in views {
            match v {
                View::Element {
                    tag,
                    events,
                    children,
                } => {
                    let mut c = tag.chars();
                    if !(c.next().is_some_and(|f| f.is_ascii_lowercase())
                        && c.all(|x| x.is_ascii_lowercase() || x.is_ascii_digit()))
                    {
                        return Err(format!("element tag {tag:?} is not a lowercase host tag"));
                    }
                    let mut seen = HashSet::new();
                    for e in events {
                        let event = e.name.strip_prefix("on");
                        if !event.is_some_and(|n| n.starts_with(|f: char| f.is_ascii_uppercase()))
                            || !identifier(&e.name)
                        {
                            return Err(format!("event name {:?}", e.name));
                        }
                        if !seen.insert(e.name.as_str()) {
                            return Err(format!("event {} repeated", e.name));
                        }
                        self.steps(&e.steps, &mut scope.clone(), StepContext::Handler)?;
                    }
                    self.views(children, scope, false)?;
                }
                View::Text { .. } if component => {
                    return Err(
                        "text directly in a component position (the markup, a Show branch, a For row)"
                            .into(),
                    );
                }
                View::Text { value } => self.expr(value, scope, true)?,
                View::Show {
                    when,
                    children,
                    fallback,
                } => {
                    self.expr(when, scope, true)?;
                    self.views(children, scope, true)?;
                    self.views(fallback, scope, true)?;
                }
                View::For {
                    each,
                    item,
                    key,
                    children,
                } => {
                    if key != "identity" {
                        return Err(format!("For key {key:?}: rows are keyed by identity"));
                    }
                    if !identifier(item) {
                        return Err(format!("For item {item:?}"));
                    }
                    self.expr(each, scope, true)?;
                    scope.push(item.clone());
                    let r = self.views(children, scope, true);
                    scope.pop();
                    r?;
                }
                View::Eval { .. } if component => {
                    return Err("an eval site directly in a component position".into());
                }
                View::Eval {
                    code,
                    bindings,
                    syntax,
                    check,
                    ..
                } => {
                    self.eval_site(bindings, syntax, check)?;
                    self.expr(code, scope, true)?;
                }
                // v2.1: a boundary's children and fallback are component
                // positions.
                View::Loading { fallback, children } | View::Errored { fallback, children } => {
                    self.v21.set(true);
                    self.views(fallback, scope, true)?;
                    self.views(children, scope, true)?;
                }
            }
        }
        Ok(())
    }
}

/// A static text view: a literal, appended as a text node.
fn literal_text(v: &View) -> Option<&J> {
    match v {
        View::Text {
            value: Expr::Literal { value },
        } => Some(value),
        _ => None,
    }
}

/// Refuses a plan outside schema v2 before anything is built.
pub fn validate(plan: &Plan) -> Result<(), String> {
    if plan.version != 2 && !plan.version.is_v21() {
        return Err(format!("plan version {} is not 2", plan.version));
    }
    if plan.component.is_empty() {
        return Err("plan component name is empty".into());
    }
    let mut check = Check {
        names: HashMap::new(),
        hosts: HashMap::new(),
        actions: HashMap::new(),
        bound: HashMap::new(),
        imperative: std::cell::Cell::new(false),
        v21: std::cell::Cell::new(false),
    };
    for h in &plan.hosts {
        if !identifier(&h.name) || check.hosts.insert(&h.name, h).is_some() {
            return Err(format!("host {:?} is not a unique name", h.name));
        }
        if h.params.iter().any(|p| !SCALARS.contains(&p.as_str())) {
            return Err(format!("host {} has a non-scalar signature", h.name));
        }
        // v2.1: a structured result, printed canonically; `pure` is true or
        // absent.
        let ty = HostType::parse(&h.returns).map_err(|e| format!("host {}: {e}", h.name))?;
        if ty.print() != h.returns {
            return Err(format!(
                "host {} result {:?} is not printed canonically",
                h.name, h.returns
            ));
        }
        match h.pure {
            None => {}
            Some(true) => check.v21.set(true),
            Some(false) => return Err(format!("host {}: pure is true or absent", h.name)),
        }
        if !ty.is_scalar() {
            check.v21.set(true);
        }
    }
    let kinds = plan
        .sources
        .iter()
        .map(|s| {
            (
                s.name.as_str(),
                match s.kind {
                    SourceKind::Signal => NameKind::Signal,
                    SourceKind::Store => NameKind::Store,
                    SourceKind::Optimistic => NameKind::Optimistic,
                },
            )
        })
        .chain(plan.memos.iter().map(|m| {
            (
                m.name.as_str(),
                if m.call.is_some() {
                    NameKind::Async
                } else {
                    NameKind::Memo
                },
            )
        }))
        .chain(
            plan.actions
                .iter()
                .map(|a| (a.name.as_str(), NameKind::Action)),
        );
    for (name, kind) in kinds {
        if !identifier(name) || check.names.insert(name, kind).is_some() {
            return Err(format!("name {name:?} is not unique"));
        }
    }
    for b in plan.bindings.iter().flatten() {
        let kind = match (b.kind.as_str(), &b.ty, &b.params) {
            ("read", Some(_), None) => NameKind::BoundRead,
            ("store", Some(_), None) => NameKind::BoundStore,
            ("action", None, Some(ps)) => {
                if ps.iter().any(|p| !SCALARS.contains(&p.as_str())) {
                    return Err(format!("binding {} has a non-scalar parameter", b.name));
                }
                check.bound.insert(&b.name, ps.len());
                NameKind::BoundAction
            }
            _ => return Err(format!("binding {:?} of kind {:?}", b.name, b.kind)),
        };
        if !identifier(&b.name) || check.names.insert(&b.name, kind).is_some() {
            return Err(format!("name {:?} is not unique", b.name));
        }
    }
    if let Some(v) = &plan.value {
        if !plan.sources.is_empty()
            || !plan.memos.is_empty()
            || !plan.actions.is_empty()
            || !plan.markup.is_empty()
        {
            return Err("a value plan is one expression".into());
        }
        check.expr(v, &mut vec![], true)?;
    }
    for a in &plan.actions {
        check.actions.insert(&a.name, a);
    }
    for s in &plan.sources {
        let constant = s.kind != SourceKind::Optimistic;
        check.expr(&s.seed, &mut vec![], !constant)?;
        if s.kind == SourceKind::Store
            && !matches!(s.seed, Expr::Object { .. } | Expr::Array { .. })
        {
            return Err(format!(
                "store {} is not seeded with a record or an array",
                s.name
            ));
        }
    }
    for m in &plan.memos {
        match (&m.value, &m.call) {
            (Some(v), None) => check.expr(v, &mut vec![], true)?,
            // v2.1: an async memo over one host call; its arguments are a
            // reactive context.
            (None, Some(call)) => {
                check.v21.set(true);
                let h = check.hosts.get(call.host.as_str()).ok_or_else(|| {
                    format!("async memo {} awaits unknown host {}", m.name, call.host)
                })?;
                if h.params.len() != call.args.len() {
                    return Err(format!("{} takes {} arguments", call.host, h.params.len()));
                }
                for a in &call.args {
                    check.expr(a, &mut vec![], true)?;
                }
            }
            _ => {
                return Err(format!(
                    "memo {} has exactly one of value and await",
                    m.name
                ))
            }
        }
    }
    for a in &plan.actions {
        let mut seen = HashSet::new();
        for p in &a.params {
            if !identifier(p) || !seen.insert(p.as_str()) {
                return Err(format!("action {} parameter {p:?}", a.name));
            }
        }
        check.steps(&a.steps, &mut a.params.clone(), StepContext::Action)?;
    }
    check.views(&plan.markup, &mut vec![], true)?;
    // `"version": 2.1` exactly when a v2.1 form occurs (PLAN-V2.md, "Top
    // level and hosts"): a v2 consumer refuses the rest by the version.
    match (plan.version.is_v21(), check.v21.get()) {
        (true, false) => Err("plan version 2.1 uses no v2.1 form".into()),
        (false, true) => Err("plan version 2 uses a v2.1 form".into()),
        _ => Ok(()),
    }
}

// ---- the evaluator ----

type Env = BTreeMap<String, Value>;

#[derive(Clone)]
enum Binding {
    Signal(NodeId),
    /// The store's root proxy.
    Store(Value),
    Optimistic(NodeId),
    Memo(NodeId),
    /// v2.1: an async memo.
    Async(NodeId),
}

/// One host invocation: a pending request until the scenario settles it.
#[derive(Clone, Debug)]
pub struct Request {
    pub host: String,
    /// One-based per host, per mount.
    pub number: usize,
    pub args: Vec<Value>,
    pub pending: bool,
    pub flight: String,
}

struct Ctx {
    u: Universal<TreeRenderer>,
    hosts: Vec<HostSig>,
    actions: HashMap<String, Action>,
    names: RefCell<HashMap<String, Binding>>,
    /// Shared by an app and every plan evaluated in it: one request
    /// numbering per host, per mount.
    requests: Rc<RefCell<Vec<Request>>>,
    /// The first evaluator failure (a value outside its types, an unbound
    /// name). It fails the run even where Solid would route the thrown
    /// error elsewhere.
    fatal: Rc<RefCell<Option<String>>>,
    /// Every action call, by the runtime's id.
    started: Rc<RefCell<Vec<(ActionId, String)>>>,
    /// The host's eval table (frontend `docs/EVAL.md`).
    evals: Rc<Vec<EvalEntry>>,
    /// An evaluated plan's bound actions: the enclosing plan and its name.
    bound: HashMap<String, (C, String)>,
    /// An evaluated plan's hosts: the enclosing app's host each name binds.
    host_alias: HashMap<String, String>,
}
type C = Rc<Ctx>;

fn fail(c: &Ctx, message: String) -> Error {
    c.fatal.borrow_mut().get_or_insert_with(|| message.clone());
    user_error(message)
}

/// Truthiness (JS): booleans, integers, strings, arrays, records and store
/// nodes; anything else is outside the schema.
fn truthy(c: &Ctx, v: &Value) -> Result<bool, Error> {
    match v {
        Value::Bool(_) | Value::Int(_) | Value::Str(_) | Value::Obj(_) | Value::Proxy(_) => {
            Ok(v.truthy())
        }
        other => Err(fail(c, format!("truthiness of {other:?}"))),
    }
}

fn integer(c: &Ctx, v: &Value) -> Result<i64, Error> {
    v.as_int()
        .ok_or_else(|| fail(c, format!("expected an integer, got {v:?}")))
}

/// ToString for text and concatenation: a string is itself, an integer is
/// base ten.
fn text(c: &Ctx, v: &Value) -> Result<String, Error> {
    match v {
        Value::Str(s) => Ok(s.to_string()),
        Value::Int(i) => Ok(i.to_string()),
        other => Err(fail(c, format!("ToString of {other:?}"))),
    }
}

fn record_like(v: &Value) -> bool {
    matches!(v, Value::Obj(_) | Value::Proxy(_))
}

fn read(rt: &mut Runtime, c: &Ctx, name: &str) -> Result<Value, Error> {
    let b = c.names.borrow().get(name).cloned();
    match b {
        None => Err(fail(c, format!("read of {name} before it exists"))),
        Some(Binding::Store(p)) => Ok(p),
        Some(
            Binding::Signal(n) | Binding::Optimistic(n) | Binding::Memo(n) | Binding::Async(n),
        ) => rt.read_value(n),
    }
}

fn binding(c: &Ctx, name: &str) -> Result<Binding, Error> {
    let b = c.names.borrow().get(name).cloned();
    b.ok_or_else(|| fail(c, format!("unknown source {name}")))
}

/// `a[method]` must be `Array.prototype[method]`: a native array method's
/// call reads the method from its receiver first (through a store's trap).
fn method(rt: &mut Runtime, c: &Ctx, a: &Value, name: &'static str) -> Result<(), Error> {
    match rt.js_get(a, &Key::name(name))? {
        Value::Func(Builtin::ArrayMethod(m)) if m == name => Ok(()),
        other => Err(fail(c, format!("{name} of an array is {other:?}"))),
    }
}

/// `ArraySpeciesCreate(O, n)`: `IsArray(O)`, then `Get(O, "constructor")`.
fn species(rt: &mut Runtime, c: &Ctx, a: &Value) -> Result<(), Error> {
    match rt.js_get(a, &Key::name("constructor"))? {
        Value::Func(Builtin::ArrayCtor) => Ok(()),
        other => Err(fail(c, format!("an array's constructor is {other:?}"))),
    }
}

fn length(rt: &mut Runtime, c: &Ctx, a: &Value) -> Result<u32, Error> {
    let n = rt.js_get(a, &Key::name("length"))?;
    let n = integer(c, &n)?;
    u32::try_from(n).map_err(|_| fail(c, format!("array length {n}")))
}

#[derive(Clone, Copy)]
enum ArrayOp {
    Filter,
    Map,
    FindIndex,
}

/// `Array.prototype.filter`/`map`/`findIndex` over a plain array or a store
/// array, step by step as ECMA-262 runs them on a proxy receiver (method
/// read, `length`, species, `HasProperty`/`Get` per index), so a store read
/// inside a reactive context tracks what JS tracks.
fn array_op(
    rt: &mut Runtime,
    c: &C,
    op: ArrayOp,
    array: &Expr,
    param: &str,
    body: &Expr,
    env: &Env,
) -> Result<Value, Error> {
    let a = eval(rt, c, array, env)?;
    if !rt.is_array(&a) {
        return Err(fail(c, format!("array method on {a:?}")));
    }
    let name = match op {
        ArrayOp::Filter => "filter",
        ArrayOp::Map => "map",
        ArrayOp::FindIndex => "findIndex",
    };
    method(rt, c, &a, name)?;
    let n = length(rt, c, &a)?;
    let f = |rt: &mut Runtime, x: Value| -> Result<Value, Error> {
        let mut env = env.clone();
        env.insert(param.into(), x);
        eval(rt, c, body, &env)
    };
    match op {
        ArrayOp::FindIndex => {
            for i in 0..n {
                let x = rt.js_get(&a, &Key::Idx(i))?;
                let r = f(rt, x)?;
                if truthy(c, &r)? {
                    return Ok(Value::Int(i as i64));
                }
            }
            Ok(Value::Int(-1))
        }
        ArrayOp::Filter => {
            species(rt, c, &a)?;
            let mut out = vec![];
            for i in 0..n {
                if rt.js_has(&a, &Key::Idx(i))? {
                    let x = rt.js_get(&a, &Key::Idx(i))?;
                    let r = f(rt, x.clone())?;
                    if truthy(c, &r)? {
                        out.push(x);
                    }
                }
            }
            Ok(Value::Obj(JsObj::new_array(out)))
        }
        ArrayOp::Map => {
            species(rt, c, &a)?;
            let out = JsObj::new_array(vec![]);
            out.set(&Key::name("length"), Value::Int(n as i64));
            for i in 0..n {
                if rt.js_has(&a, &Key::Idx(i))? {
                    let x = rt.js_get(&a, &Key::Idx(i))?;
                    let r = f(rt, x)?;
                    out.set(&Key::Idx(i), r);
                }
            }
            Ok(Value::Obj(out))
        }
    }
}

fn eval(rt: &mut Runtime, c: &C, e: &Expr, env: &Env) -> Result<Value, Error> {
    let bin = |rt: &mut Runtime, l: &Expr, r: &Expr| -> Result<(Value, Value), Error> {
        let l = eval(rt, c, l, env)?;
        let r = eval(rt, c, r, env)?;
        Ok((l, r))
    };
    match e {
        Expr::Literal { value } => literal(value).map_err(|m| fail(c, m)),
        Expr::Array { items } => {
            let mut out = vec![];
            for x in items {
                out.push(eval(rt, c, x, env)?);
            }
            Ok(Value::Obj(JsObj::new_array(out)))
        }
        Expr::Object { fields } => {
            let mut out = vec![];
            for f in fields {
                out.push((Rc::from(f.key.as_str()), eval(rt, c, &f.value, env)?));
            }
            Ok(Value::Obj(JsObj::new_object(out)))
        }
        Expr::Read { source } => read(rt, c, source),
        Expr::Local { name } => env
            .get(name)
            .cloned()
            .ok_or_else(|| fail(c, format!("unbound local {name}"))),
        Expr::Get { object, key } => {
            let o = eval(rt, c, object, env)?;
            if !record_like(&o) || rt.is_array(&o) {
                return Err(fail(c, format!("get {key} of {o:?}, not a record")));
            }
            // `o.key` alone, as the TSX twin reads it: one Get (a store's `get`
            // trap), no HasProperty. No plan value is `undefined`, so an
            // `undefined` result is a missing field.
            let v = rt.js_get(&o, &Key::name(key))?;
            if matches!(v, Value::Undef) {
                return Err(fail(c, format!("get {key}: no such field")));
            }
            Ok(v)
        }
        Expr::Length { array } => {
            let a = eval(rt, c, array, env)?;
            if !rt.is_array(&a) {
                return Err(fail(c, format!("length of {a:?}, not an array")));
            }
            Ok(Value::Int(length(rt, c, &a)? as i64))
        }
        Expr::Filter { array, param, body } => {
            array_op(rt, c, ArrayOp::Filter, array, param, body, env)
        }
        Expr::Map { array, param, body } => array_op(rt, c, ArrayOp::Map, array, param, body, env),
        Expr::FindIndex { array, param, body } => {
            array_op(rt, c, ArrayOp::FindIndex, array, param, body, env)
        }
        Expr::Add { left, right } => {
            let (l, r) = bin(rt, left, right)?;
            if matches!(l, Value::Str(_)) || matches!(r, Value::Str(_)) {
                let mut s = text(c, &l)?;
                s.push_str(&text(c, &r)?);
                return Ok(Value::str(&s));
            }
            let sum = integer(c, &l)?.checked_add(integer(c, &r)?);
            match sum {
                Some(s) if (-MAX_SAFE..=MAX_SAFE).contains(&s) => Ok(Value::Int(s)),
                _ => Err(fail(c, "integer sum outside the safe range".into())),
            }
        }
        Expr::Eq { left, right } => {
            let (l, r) = bin(rt, left, right)?;
            Ok(Value::Bool(l == r))
        }
        Expr::Ne { left, right } => {
            let (l, r) = bin(rt, left, right)?;
            Ok(Value::Bool(l != r))
        }
        Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right } => {
            let (l, r) = bin(rt, left, right)?;
            let (l, r) = (integer(c, &l)?, integer(c, &r)?);
            Ok(Value::Bool(match e {
                Expr::Lt { .. } => l < r,
                Expr::Le { .. } => l <= r,
                Expr::Gt { .. } => l > r,
                _ => l >= r,
            }))
        }
        Expr::And { left, right } => {
            let l = eval(rt, c, left, env)?;
            if truthy(c, &l)? {
                eval(rt, c, right, env)
            } else {
                Ok(l)
            }
        }
        Expr::Or { left, right } => {
            let l = eval(rt, c, left, env)?;
            if truthy(c, &l)? {
                Ok(l)
            } else {
                eval(rt, c, right, env)
            }
        }
        Expr::Not { value } => {
            let v = eval(rt, c, value, env)?;
            Ok(Value::Bool(!truthy(c, &v)?))
        }
        Expr::Cond {
            test,
            then,
            otherwise,
        } => {
            let t = eval(rt, c, test, env)?;
            if truthy(c, &t)? {
                eval(rt, c, then, env)
            } else {
                eval(rt, c, otherwise, env)
            }
        }
        // v2.1: the probes, evaluated inside Solid's own windows
        // (solid-plan.ts `isPending(() => …)`, `latest(() => …)`).
        Expr::Pending { value } => {
            let found = rt.is_pending_of(|rt| eval(rt, c, value, env).map(|_| ()))?;
            Ok(Value::Bool(found))
        }
        Expr::Latest { value } => rt.latest_of(|rt| eval(rt, c, value, env)),
        Expr::Eval {
            code,
            bindings,
            interface,
            syntax,
            check,
            ty,
        } => {
            // The code, then its plan's expression over the bindings, in this
            // reactive context (solid-plan.ts, op `eval`).
            let code = eval(rt, c, code, env)?;
            let Value::Str(code) = code else {
                return Err(fail(c, "eval code is a string".into()));
            };
            let plan = lookup(c, &code, interface, syntax, check, Some(ty))?;
            let inner = linked(c, &plan, bindings)?;
            let value = plan.value.as_ref().expect("a value plan (validated)");
            let v = eval(rt, &inner, value, &Env::new())?;
            if scalar_type(&v) != Some(ty.as_str()) {
                return Err(fail(c, format!("eval value {v:?} is not a {ty}")));
            }
            Ok(v)
        }
    }
}

/// The table's plan for an eval request, or its refusal as the run's error.
fn lookup(
    c: &C,
    code: &str,
    interface: &str,
    syntax: &str,
    check: &str,
    ty: Option<&String>,
) -> Result<Rc<Plan>, Error> {
    let entry = c.evals.iter().find(|e| {
        e.code == code
            && e.interface == interface
            && e.syntax == syntax
            && e.check == check
            && e.ty.as_ref() == ty
    });
    let Some(entry) = entry else {
        return Err(fail(
            c,
            format!("no plan in the host's eval table for {code:?}"),
        ));
    };
    if let Some(m) = entry.refusal() {
        return Err(fail(c, m));
    }
    Ok(Rc::new(entry.plan.clone().expect("validated")))
}

/// An evaluated plan's context: its own names, with each binding linked to
/// the enclosing plan's source, memo, action or host (solid-plan.ts
/// `linked`).
fn linked(c: &C, plan: &Plan, bindings: &[EvalBinding]) -> Result<C, Error> {
    let mut names = HashMap::new();
    let mut bound = HashMap::new();
    let mut host_alias = HashMap::new();
    for b in bindings {
        if c.hosts.iter().any(|h| h.name == b.target) {
            let outer = c
                .host_alias
                .get(&b.target)
                .cloned()
                .unwrap_or(b.target.clone());
            host_alias.insert(b.name.clone(), outer);
        } else if c.actions.contains_key(&b.target) || c.bound.contains_key(&b.target) {
            bound.insert(b.name.clone(), (c.clone(), b.target.clone()));
        } else {
            names.insert(b.name.clone(), binding(c, &b.target)?);
        }
    }
    // The plan's declared bindings are exactly the ones given (solid-plan.ts
    // `check`), and its hosts are bound.
    let declared = plan.bindings.as_deref().unwrap_or(&[]);
    let given = names.len() + bound.len();
    let fits = declared.len() == given
        && declared.iter().all(|d| match d.kind.as_str() {
            "action" => bound.contains_key(&d.name),
            "store" => matches!(names.get(&d.name), Some(Binding::Store(_))),
            _ => matches!(names.get(&d.name), Some(b) if !matches!(b, Binding::Store(_))),
        });
    if !fits {
        return Err(fail(
            c,
            "the bindings given are not the evaluated plan's".into(),
        ));
    }
    for h in &plan.hosts {
        if !host_alias.contains_key(&h.name) {
            return Err(fail(c, format!("missing host {}", h.name)));
        }
    }
    Ok(Rc::new(Ctx {
        u: c.u.clone(),
        hosts: plan.hosts.clone(),
        actions: plan
            .actions
            .iter()
            .map(|a| (a.name.clone(), a.clone()))
            .collect(),
        names: RefCell::new(names),
        requests: c.requests.clone(),
        fatal: c.fatal.clone(),
        started: c.started.clone(),
        evals: c.evals.clone(),
        bound,
        host_alias,
    }))
}

fn scalar_type(v: &Value) -> Option<&'static str> {
    match v {
        Value::Int(_) => Some("number"),
        Value::Str(_) => Some("string"),
        Value::Bool(_) => Some("boolean"),
        _ => None,
    }
}

// ---- steps ----

fn write(
    rt: &mut Runtime,
    c: &C,
    source: &str,
    path: Option<&[Segment]>,
    value: &Expr,
    env: &Env,
) -> Result<(), Error> {
    match (binding(c, source)?, path) {
        (Binding::Signal(n), None) => {
            let v = eval(rt, c, value, env)?;
            // `setSignal(() => value)`, as solid-plan.ts writes.
            rt.write_with(n, &mut |_, _| Ok(v.clone()))
        }
        (Binding::Store(proxy), Some(path)) => {
            // `setStore(draft => { draft.k1…[kn] = value })`, evaluated inside
            // the setter as the TSX twin evaluates it: each segment in turn (an
            // index when it is reached), then the value, then the set. A node a
            // pending transaction holds reads there as that transaction has it.
            rt.store_set(&proxy, &mut |rt: &mut Runtime, draft: Value| {
                let mut o = draft;
                for (i, seg) in path.iter().enumerate() {
                    if !o.is_object() {
                        return Err(fail(c, "store path does not exist".into()));
                    }
                    let (k, index) = match (&seg.key, &seg.index) {
                        (Some(k), None) => (Key::name(k), false),
                        (None, Some(e)) => {
                            let n = eval(rt, c, e, env)?;
                            let n = integer(c, &n)?;
                            let n = u32::try_from(n)
                                .map_err(|_| fail(c, format!("store path index {n}")))?;
                            (Key::Idx(n), true)
                        }
                        _ => return Err(fail(c, "a path segment has one of key and index".into())),
                    };
                    let array = rt.is_array(&o);
                    if index != array {
                        return Err(fail(c, format!("store path segment {} on {o:?}", k.text())));
                    }
                    if let Key::Idx(n) = k {
                        if n >= length(rt, c, &o)? {
                            return Err(fail(c, format!("store path index {n} out of range")));
                        }
                    }
                    if i + 1 == path.len() {
                        let v = eval(rt, c, value, env)?;
                        rt.js_set(&o, &k, v)?;
                    } else {
                        o = rt.js_get(&o, &k)?;
                    }
                }
                Ok(Value::Undef)
            })
        }
        (_, None) => Err(fail(
            c,
            format!("a plain write targets {source}, not a signal"),
        )),
        (_, Some(_)) => Err(fail(
            c,
            format!("a path write targets {source}, not a store"),
        )),
    }
}

fn guess(
    rt: &mut Runtime,
    c: &C,
    source: &str,
    value: Option<&Expr>,
    updater: Option<&Lambda>,
    env: &Env,
) -> Result<(), Error> {
    let Binding::Optimistic(n) = binding(c, source)? else {
        return Err(fail(c, format!("a guess targets {source}")));
    };
    match (value, updater) {
        (Some(value), None) => {
            let v = eval(rt, c, value, env)?;
            rt.optimistic_write_with(n, &mut |_, _| Ok(v.clone()))
        }
        // `setShown(param => body)`: `optimisticWrite` composes on the shown
        // value (lanes.ts:186).
        (None, Some(u)) => rt.optimistic_write_with(n, &mut |rt: &mut Runtime, shown: Value| {
            let mut env = env.clone();
            env.insert(u.param.clone(), shown);
            eval(rt, c, &u.body, &env)
        }),
        _ => Err(fail(c, "a guess has one of value and updater".into())),
    }
}

/// A host call: a new pending request, never answered synchronously.
fn request(c: &Ctx, host: &str, args: Vec<Value>) -> Result<(String, String), Error> {
    let sig = c
        .hosts
        .iter()
        .find(|h| h.name == host)
        .ok_or_else(|| fail(c, format!("unknown host {host}")))?;
    if sig.params.len() != args.len()
        || sig
            .params
            .iter()
            .zip(&args)
            .any(|(p, a)| scalar_type(a) != Some(p.as_str()))
    {
        return Err(fail(c, format!("{host} called with {args:?}")));
    }
    let returns = sig.returns.clone();
    // An evaluated plan's host is the enclosing app's: its requests are that
    // host's.
    let host = c.host_alias.get(host).map_or(host, |h| h.as_str());
    let mut requests = c.requests.borrow_mut();
    let number = requests.iter().filter(|r| r.host == host).count() + 1;
    let flight = format!("{host}#{number}");
    {
        let h = c.u.host().borrow();
        let logged: Vec<J> = args.iter().map(|a| h.enc(a)).collect();
        h.push_log(serde_json::json!(["request", host, number, logged]));
    }
    requests.push(Request {
        host: host.into(),
        number,
        args,
        pending: true,
        flight: flight.clone(),
    });
    Ok((flight, returns))
}

struct Frame {
    steps: Vec<Step>,
    index: usize,
    env: Env,
    /// A `try` body's catch and the scope it runs in.
    catch: Option<(Vec<Step>, Env)>,
}

/// An action's generator body: each `await` yields a host flight, a
/// rejection is thrown in at that point and unwinds to the nearest `try`.
struct Execution {
    c: C,
    frames: Vec<Frame>,
    /// The pending await's binding and the host's result type.
    bind: Option<(String, String)>,
}

impl Execution {
    fn run(&mut self, rt: &mut Runtime) -> Result<ActionStep, Error> {
        let c = self.c.clone();
        loop {
            let Some(f) = self.frames.last_mut() else {
                return Ok(ActionStep::Return);
            };
            if f.index == f.steps.len() {
                self.frames.pop();
                continue;
            }
            let step = f.steps[f.index].clone();
            f.index += 1;
            let env = f.env.clone();
            match step {
                Step::Write {
                    source,
                    path,
                    value,
                } => write(rt, &c, &source, path.as_deref(), &value, &env)?,
                Step::Optimistic {
                    source,
                    value,
                    updater,
                } => guess(rt, &c, &source, value.as_ref(), updater.as_ref(), &env)?,
                Step::Try { body, catch } => self.frames.push(Frame {
                    steps: body,
                    index: 0,
                    env: env.clone(),
                    catch: Some((catch, env)),
                }),
                Step::Await { host, args, bind } => {
                    let mut values = vec![];
                    for a in &args {
                        values.push(eval(rt, &c, a, &env)?);
                    }
                    let (flight, returns) = request(&c, &host, values)?;
                    self.bind = Some((bind, returns));
                    return Ok(ActionStep::Yield(flight));
                }
                Step::Call { action, .. } => {
                    return Err(fail(&c, format!("an action calls the action {action}")))
                }
                Step::Refresh { source } => refresh(rt, &c, &source)?,
                Step::Affects { source } => {
                    let Binding::Async(n) = binding(&c, &source)? else {
                        return Err(fail(
                            &c,
                            format!("affects targets {source}, not an async memo"),
                        ));
                    };
                    rt.affects(n);
                }
            }
        }
    }
}

impl ActionBody for Execution {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
        match input {
            Resume::Start => {}
            Resume::Value(v) => {
                let (bind, returns) = self.bind.take().expect("resumed at an await");
                if !HostType::parse(&returns).is_ok_and(|t| t.conforms(&v)) {
                    let e = fail(&self.c, format!("a host result {v:?} is not a {returns}"));
                    return ActionStep::Throw(e.message());
                }
                self.frames
                    .last_mut()
                    .expect("an await runs in a frame")
                    .env
                    .insert(bind, v);
            }
            Resume::Error(error) => {
                self.bind = None;
                loop {
                    let Some(f) = self.frames.pop() else {
                        return ActionStep::Throw(error);
                    };
                    if let Some((steps, env)) = f.catch {
                        self.frames.push(Frame {
                            steps,
                            index: 0,
                            env,
                            catch: None,
                        });
                        break;
                    }
                }
            }
        }
        match self.run(rt) {
            Ok(step) => step,
            Err(e) => {
                // A runtime error is never caught by the plan's `try`: it
                // fails the run (PLAN-V2.md, Transactions 6).
                let m = e.message();
                self.c.fatal.borrow_mut().get_or_insert_with(|| m.clone());
                ActionStep::Throw(m)
            }
        }
    }
}

/// `actions.get(name)(...args)`: `action(function*)` invoked, not awaited.
fn call_action(rt: &mut Runtime, c: &C, name: &str, args: Vec<Value>) -> Result<(), Error> {
    if let Some((outer, target)) = c.bound.get(name) {
        // A bound action runs, and reports its call, as the enclosing plan's.
        return call_action(rt, outer, target, args);
    }
    let a = c
        .actions
        .get(name)
        .ok_or_else(|| fail(c, format!("unknown action {name}")))?;
    if a.params.len() != args.len() {
        return Err(fail(c, format!("{name} arity")));
    }
    let env: Env = a.params.iter().cloned().zip(args).collect();
    let body = Execution {
        c: c.clone(),
        frames: vec![Frame {
            steps: a.steps.clone(),
            index: 0,
            env,
            catch: None,
        }],
        bind: None,
    };
    let id = rt.action(Box::new(body));
    c.started.borrow_mut().push((id, name.into()));
    Ok(())
}

/// v2.1: `refresh(accessor)` of an async memo (solid-plan.ts).
fn refresh(rt: &mut Runtime, c: &C, source: &str) -> Result<(), Error> {
    let Binding::Async(n) = binding(c, source)? else {
        return Err(fail(
            c,
            format!("refresh targets {source}, not an async memo"),
        ));
    };
    rt.refresh(n);
    Ok(())
}

/// A plain handler: its steps run synchronously, outside any transaction.
fn handler(rt: &mut Runtime, c: &C, steps: &[Step], env: &Env) -> Value {
    let (c, steps, env) = (c.clone(), steps.to_vec(), env.clone());
    rt.function(
        0,
        Rc::new(move |rt: &mut Runtime, _args: &[Value]| {
            for s in &steps {
                match s {
                    Step::Write {
                        source,
                        path,
                        value,
                    } => write(rt, &c, source, path.as_deref(), value, &env)?,
                    Step::Call { action, args } => {
                        let mut values = vec![];
                        for a in args {
                            values.push(eval(rt, &c, a, &env)?);
                        }
                        call_action(rt, &c, action, values)?
                    }
                    // v2.1: a plain re-ask.
                    Step::Refresh { source } => refresh(rt, &c, source)?,
                    _ => {
                        return Err(fail(
                            &c,
                            "a plain handler awaits, tries, guesses or declares affects".into(),
                        ))
                    }
                }
            }
            Ok(Value::Undef)
        }),
    )
}

// ---- markup ----
//
// An element tree is one template, lowered as Solid's universal compiler
// lowers JSX (solid-next packages/compiler src/universal/transform.rs,
// `lower_native_element` and `lower_universal_children`): `declare` creates
// the elements (events as static props: `createElement(tag, { onClick })`,
// which the recording host applies through `setProperty`) and, when an
// element has more than one child, its static texts, in pre-order; `exprs`
// then appends each element's static children in order (a lone static text
// is created at its append), and runs its children's own `exprs` and its
// dynamic children's inserts in child order. A dynamic child of a
// multi-child element is inserted before its next static sibling (`null` if
// none follows); a lone dynamic child has no marker.

/// One element of a template, with the nodes `declare` created.
struct Template<'v> {
    tag: &'v str,
    events: &'v [Event],
    children: &'v [View],
    node: usize,
    texts: Vec<Option<usize>>,
    kids: Vec<Option<Template<'v>>>,
}

fn lower(v: &View) -> Template<'_> {
    let View::Element {
        tag,
        events,
        children,
    } = v
    else {
        unreachable!("a template is an element")
    };
    Template {
        tag,
        events,
        children,
        node: 0,
        texts: vec![None; children.len()],
        kids: children
            .iter()
            .map(|k| matches!(k, View::Element { .. }).then(|| lower(k)))
            .collect(),
    }
}

fn static_text(c: &C, value: &J) -> Result<Value, Error> {
    let s = literal(value).map_err(|m| fail(c, m))?;
    Ok(Value::str(&text(c, &s)?))
}

fn declare(rt: &mut Runtime, c: &C, t: &mut Template, env: &Env) -> Result<(), Error> {
    t.node = c.u.create_element(t.tag);
    for e in t.events {
        let f = handler(rt, c, &e.steps, env);
        c.u.set_prop(t.node, &e.name, &f, &Value::Undef);
    }
    let multi = t.children.len() > 1;
    for (i, child) in t.children.iter().enumerate() {
        if let Some(value) = literal_text(child) {
            if multi {
                t.texts[i] = Some(c.u.create_text(&static_text(c, value)?));
            }
        } else if let Some(kid) = t.kids[i].as_mut() {
            declare(rt, c, kid, env)?;
        }
    }
    Ok(())
}

fn exprs(rt: &mut Runtime, c: &C, t: &Template, env: &Env) -> Result<(), Error> {
    let multi = t.children.len() > 1;
    for (i, child) in t.children.iter().enumerate() {
        if let Some(value) = literal_text(child) {
            let n = match t.texts[i] {
                Some(n) => n,
                None => c.u.create_text(&static_text(c, value)?),
            };
            c.u.append(t.node, n, None);
        } else if let Some(kid) = &t.kids[i] {
            c.u.append(t.node, kid.node, None);
        }
    }
    for (i, child) in t.children.iter().enumerate() {
        if let Some(kid) = &t.kids[i] {
            exprs(rt, c, kid, env)?;
            continue;
        }
        if literal_text(child).is_some() {
            continue;
        }
        let value = dynamic(rt, c, child, env)?;
        let marker = if multi {
            (i + 1..t.children.len())
                .find_map(|j| t.texts[j].or(t.kids[j].as_ref().map(|k| k.node)))
                .map_or(Marker::Null, Marker::Node)
        } else {
            Marker::Undefined
        };
        c.u.insert(rt, t.node, value, marker, None, InsertOptions::default())?;
    }
    Ok(())
}

/// An element view, built as its template: the root node.
fn element(rt: &mut Runtime, c: &C, v: &View, env: &Env) -> Result<usize, Error> {
    let mut t = lower(v);
    declare(rt, c, &mut t, env)?;
    exprs(rt, c, &t, env)?;
    Ok(t.node)
}

fn getter(c: &C, f: impl Fn(&mut Runtime, &C) -> Result<Value, Error> + 'static) -> Getter {
    let c = c.clone();
    Rc::new(move |rt: &mut Runtime| f(rt, &c))
}

/// Dynamic in the compiler's sense (`is_dynamic`): the TSX twin has a call
/// or a member access. A read of a signal, memo or optimistic source is a
/// call (`x()`), a get or length a member access, the array methods calls; a
/// literal, a local and a store root are not.
fn dynamic_expr(c: &C, e: &Expr) -> bool {
    match e {
        Expr::Literal { .. } | Expr::Local { .. } => false,
        Expr::Read { source } => !matches!(binding(c, source), Ok(Binding::Store(_))),
        Expr::Get { .. }
        | Expr::Length { .. }
        | Expr::Filter { .. }
        | Expr::Map { .. }
        | Expr::FindIndex { .. }
        | Expr::Eval { .. }
        | Expr::Pending { .. }
        | Expr::Latest { .. } => true,
        Expr::Array { items } => items.iter().any(|x| dynamic_expr(c, x)),
        Expr::Object { fields } => fields.iter().any(|f| dynamic_expr(c, &f.value)),
        Expr::Not { value } => dynamic_expr(c, value),
        Expr::Cond {
            test,
            then,
            otherwise,
        } => dynamic_expr(c, test) || dynamic_expr(c, then) || dynamic_expr(c, otherwise),
        Expr::Add { left, right }
        | Expr::Eq { left, right }
        | Expr::Ne { left, right }
        | Expr::Lt { left, right }
        | Expr::Le { left, right }
        | Expr::Gt { left, right }
        | Expr::Ge { left, right }
        | Expr::And { left, right }
        | Expr::Or { left, right } => dynamic_expr(c, left) || dynamic_expr(c, right),
    }
}

/// A comparison or `!`: statically boolean, so the compiler memoizes it as is
/// (`is_boolean_expression`) instead of as `!!test`.
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

/// `memo(() => test)()` in the getter: the renderer's memo, called once.
fn memoized(rt: &mut Runtime, c: &C, e: &Expr, env: &Env) -> Result<Value, Error> {
    let (e, env, c2) = (e.clone(), env.clone(), c.clone());
    let boolean = boolean_expr(&e);
    let m = c.u.memo(
        rt,
        Rc::new(move |rt: &mut Runtime| {
            let v = eval(rt, &c2, &e, &env)?;
            if boolean {
                Ok(v)
            } else {
                Ok(Value::Bool(truthy(&c2, &v)?))
            }
        }),
    );
    rt.call(&m, &[])
}

/// A component prop the compiler gives a getter (Show's `when`, For's
/// `each`): a conditional or logical expression is rewritten by its
/// `transformCondition(…, inline)` (compiler src/shared/condition.rs). The
/// test of a conditional with a dynamic branch, or the left of `&&` with both
/// sides dynamic, is read through a memo created in the getter; `||` walks its
/// left spine to such an `&&`.
fn condition(rt: &mut Runtime, c: &C, e: &Expr, env: &Env) -> Result<Value, Error> {
    match e {
        Expr::Cond {
            test,
            then,
            otherwise,
        } if (dynamic_expr(c, then) || dynamic_expr(c, otherwise)) && dynamic_expr(c, test) => {
            let t = memoized(rt, c, test, env)?;
            let branch = if truthy(c, &t)? { then } else { otherwise };
            match **branch {
                Expr::Cond { .. } | Expr::And { .. } | Expr::Or { .. } => {
                    condition(rt, c, branch, env)
                }
                _ => eval(rt, c, branch, env),
            }
        }
        Expr::And { left, right } if dynamic_expr(c, left) && dynamic_expr(c, right) => {
            let t = memoized(rt, c, left, env)?;
            if boolean_expr(left) {
                if truthy(c, &t)? {
                    eval(rt, c, right, env)
                } else {
                    Ok(t)
                }
            } else if truthy(c, &t)? {
                eval(rt, c, right, env)
            } else {
                eval(rt, c, left, env)
            }
        }
        Expr::Or { left, right } if matches!(**left, Expr::And { .. } | Expr::Or { .. }) => {
            let l = condition(rt, c, left, env)?;
            if truthy(c, &l)? {
                Ok(l)
            } else {
                eval(rt, c, right, env)
            }
        }
        _ => eval(rt, c, e, env),
    }
}

/// A dynamic child: a text accessor, or a control-flow component with the
/// props the compiler passes (getters; no fallback when the plan has none).
fn dynamic(rt: &mut Runtime, c: &C, v: &View, env: &Env) -> Result<Value, Error> {
    match v {
        View::Element { .. } => unreachable!("an element is a template"),
        View::Text { value } => {
            let (value, env) = (value.clone(), env.clone());
            let c2 = c.clone();
            Ok(rt.function(
                0,
                Rc::new(move |rt: &mut Runtime, _| {
                    let v = eval(rt, &c2, &value, &env)?;
                    Ok(Value::str(&text(&c2, &v)?))
                }),
            ))
        }
        View::Show {
            when,
            children: kids,
            fallback,
        } => {
            let (when, kids) = (when.clone(), kids.clone());
            let (e1, e2, e3) = (env.clone(), env.clone(), env.clone());
            let fallback = (!fallback.is_empty()).then(|| {
                let fallback = fallback.clone();
                getter(c, move |rt, c| fragment(rt, c, &fallback, &e3))
            });
            let props = ShowProps {
                when: getter(c, move |rt, c| condition(rt, c, &when, &e1)),
                keyed: Value::Undef,
                children: getter(c, move |rt, c| fragment(rt, c, &kids, &e2)),
                fallback,
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                Ok(rt.show_component(props.clone()))
            }))
        }
        View::For {
            each,
            item,
            children: kids,
            ..
        } => {
            let (each, e1) = (each.clone(), env.clone());
            let (item, kids, e2, c2) = (item.clone(), kids.clone(), env.clone(), c.clone());
            // `children: (item) => fragment(children, {...env, item})`: the
            // row item itself (identity keying passes a raw value).
            let mapper = rt.function(
                1,
                Rc::new(move |rt: &mut Runtime, args: &[Value]| {
                    let mut env = e2.clone();
                    env.insert(item.clone(), args.first().cloned().unwrap_or(Value::Undef));
                    fragment(rt, &c2, &kids, &env)
                }),
            );
            let props = ForProps {
                each: getter(c, move |rt, c| {
                    let xs = condition(rt, c, &each, &e1)?;
                    if !rt.is_array(&xs) {
                        return Err(fail(c, format!("For of {xs:?}, not an array")));
                    }
                    Ok(xs)
                }),
                keyed: Value::Undef,
                children: Rc::new(move |_| Ok(mapper.clone())),
                fallback: None,
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                Ok(rt.for_component(props.clone()))
            }))
        }
        // v2.1: the compiler passes Loading's fallback as a getter and
        // Errored's as a function of the error (solid-plan.ts).
        View::Loading { fallback, children } => {
            let (fb, kids, e1, e2) = (fallback.clone(), children.clone(), env.clone(), env.clone());
            let props = LoadingProps {
                fallback: Some(getter(c, move |rt, c| fragment(rt, c, &fb, &e1))),
                children: getter(c, move |rt, c| fragment(rt, c, &kids, &e2)),
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                rt.loading_component(props.clone())
            }))
        }
        View::Errored { fallback, children } => {
            let (fb, kids, e1, e2) = (fallback.clone(), children.clone(), env.clone(), env.clone());
            let c2 = c.clone();
            // `(_error) => fragment(fallback)`: one parameter, the error
            // accessor, which the plan does not read.
            let f = rt.function(
                1,
                Rc::new(move |rt: &mut Runtime, _args: &[Value]| fragment(rt, &c2, &fb, &e1)),
            );
            let props = ErroredProps {
                fallback: f,
                children: getter(c, move |rt, c| fragment(rt, c, &kids, &e2)),
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                rt.errored_component(props.clone())
            }))
        }
        View::Eval {
            code,
            bindings,
            interface,
            syntax,
            check,
        } => {
            // `() => createEval(() => code, …)`, as the compiler inserts the
            // TSX twin; createEval is `createComponent(Show, { get when(),
            // keyed: true, children: (code) => createComponent(Compiled, {}) })`
            // (solid-plan.ts `evalView`).
            let (code, env, c2) = (code.clone(), env.clone(), c.clone());
            let site = Rc::new((
                bindings.clone(),
                interface.clone(),
                syntax.clone(),
                check.clone(),
            ));
            Ok(rt.function(
                0,
                Rc::new(move |rt: &mut Runtime, _| {
                    let (code, env) = (code.clone(), env.clone());
                    let when = getter(&c2, move |rt, c| {
                        let v = eval(rt, c, &code, &env)?;
                        if !matches!(v, Value::Str(_)) {
                            return Err(fail(c, "eval code is a string".into()));
                        }
                        Ok(v)
                    });
                    let (c3, site) = (c2.clone(), site.clone());
                    let child = rt.function(
                        1,
                        Rc::new(move |rt: &mut Runtime, args: &[Value]| {
                            let Some(Value::Str(src)) = args.first() else {
                                return Err(fail(&c3, "eval code is a string".into()));
                            };
                            let (bindings, interface, syntax, check) = &*site;
                            let plan = lookup(&c3, src, interface, syntax, check, None)?;
                            if plan.value.is_some() {
                                return Err(fail(&c3, "a value plan at a markup eval".into()));
                            }
                            let inner = linked(&c3, &plan, bindings)?;
                            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                                build(rt, &inner, &plan)
                            }))
                        }),
                    );
                    let props = ShowProps {
                        when,
                        keyed: Value::Bool(true),
                        children: Rc::new(move |_| Ok(child.clone())),
                        fallback: None,
                    };
                    rt.create_component(Rc::new(move |rt: &mut Runtime| {
                        Ok(rt.show_component(props.clone()))
                    }))
                }),
            ))
        }
    }
}

/// The views of a component position (the markup, a Show branch, a For
/// row): each element is its own template, a Show or For its component; a
/// lone view is itself, more are an array.
fn fragment(rt: &mut Runtime, c: &C, views: &[View], env: &Env) -> Result<Value, Error> {
    let mut parts = vec![];
    for v in views {
        parts.push(match v {
            View::Element { .. } => Value::Node(element(rt, c, v, env)?),
            View::Text { .. } => {
                return Err(fail(
                    c,
                    "text directly in a component position (the markup, a Show branch, a For row)"
                        .into(),
                ));
            }
            View::Eval { .. } => {
                return Err(fail(
                    c,
                    "an eval site directly in a component position".into(),
                ));
            }
            _ => dynamic(rt, c, v, env)?,
        });
    }
    Ok(if parts.len() == 1 {
        parts.pop().unwrap()
    } else {
        Value::Obj(JsObj::new_array(parts))
    })
}

/// The component body: sources, then memos, then the view.
fn build(rt: &mut Runtime, c: &C, plan: &Plan) -> Result<Value, Error> {
    let empty = Env::new();
    for s in &plan.sources {
        let b = match s.kind {
            SourceKind::Signal => {
                let v = eval(rt, c, &s.seed, &empty)?;
                Binding::Signal(rt.signal_value(v))
            }
            SourceKind::Store => {
                let v = eval(rt, c, &s.seed, &empty)?;
                Binding::Store(rt.create_store(v, false))
            }
            SourceKind::Optimistic => {
                let (seed, c2) = (s.seed.clone(), c.clone());
                let body: BodyFn = Rc::new(move |rt: &mut Runtime, _| {
                    eval(rt, &c2, &seed, &Env::new()).map(Out::Value)
                });
                Binding::Optimistic(rt.optimistic_memo(body, None))
            }
        };
        c.names.borrow_mut().insert(s.name.clone(), b);
    }
    for m in &plan.memos {
        if let Some(call) = &m.call {
            // v2.1: `createMemo(() => host(...args))`: each computation
            // evaluates the arguments (tracked) and issues one new request,
            // whose promise is the memo's flight (`handleAsync`).
            let (call, c2) = (call.clone(), c.clone());
            let body: BodyFn = Rc::new(move |rt: &mut Runtime, _| {
                let mut values = vec![];
                for a in &call.args {
                    values.push(eval(rt, &c2, a, &Env::new())?);
                }
                let (flight, _) = request(&c2, &call.host, values)?;
                Ok(Out::Flight(flight))
            });
            let n = rt.memo_with(body, None, false);
            c.names
                .borrow_mut()
                .insert(m.name.clone(), Binding::Async(n));
            continue;
        }
        let (value, c2) = (m.value.clone().expect("validated"), c.clone());
        let body: BodyFn =
            Rc::new(move |rt: &mut Runtime, _| eval(rt, &c2, &value, &Env::new()).map(Out::Value));
        let n = rt.memo_with(body, None, false);
        c.names
            .borrow_mut()
            .insert(m.name.clone(), Binding::Memo(n));
    }
    fragment(rt, c, &plan.markup, &empty)
}

/// A mounted v2 plan: the runtime, the recording host and the mount.
pub struct App {
    pub runtime: Runtime,
    pub host: Rc<RefCell<TreeRenderer>>,
    c: C,
    disposer: Option<Disposer<TreeRenderer>>,
    rejected: Rc<RefCell<Vec<String>>>,
}

impl App {
    /// Validates the plan and mounts it (`render(() => Component(), root)`).
    /// The caller settles before the first frame.
    pub fn mount(plan: Plan) -> Result<Self, String> {
        Self::mount_with(plan, EvalTable::default())
    }

    /// `mount` with the host's eval table (frontend `docs/EVAL.md`): the
    /// plans an eval site's code compiles to.
    pub fn mount_with(plan: Plan, evals: EvalTable) -> Result<Self, String> {
        validate(&plan)?;
        if !evals.evals.is_empty() {
            validate_table(&evals)?;
        }
        if plan.bindings.is_some() || plan.value.is_some() {
            return Err("an evaluated plan is mounted by an eval site".into());
        }
        let mut runtime = Runtime::default();
        let host = Rc::new(RefCell::new(TreeRenderer::new()));
        let root = host.borrow().root();
        host.borrow_mut().register_delegated_root(root);
        let c: C = Rc::new(Ctx {
            u: Universal::new(host.clone()),
            hosts: plan.hosts.clone(),
            actions: plan
                .actions
                .iter()
                .map(|a| (a.name.clone(), a.clone()))
                .collect(),
            names: RefCell::new(HashMap::new()),
            requests: Rc::new(RefCell::new(vec![])),
            fatal: Rc::new(RefCell::new(None)),
            started: Rc::new(RefCell::new(vec![])),
            evals: Rc::new(evals.evals),
            bound: HashMap::new(),
            host_alias: HashMap::new(),
        });
        let plan = Rc::new(plan);
        let code: Getter = {
            let c = c.clone();
            Rc::new(move |rt: &mut Runtime| build(rt, &c, &plan))
        };
        let u = c.u.clone();
        let mounted = u.render(&mut runtime, code, root);
        let mut app = App {
            runtime,
            host,
            c,
            disposer: None,
            rejected: Rc::new(RefCell::new(vec![])),
        };
        match mounted {
            Ok(d) => app.disposer = Some(d),
            Err(e) => {
                app.check()?;
                return Err(format!("mount failed: {}", e.message()));
            }
        }
        app.check()?;
        Ok(app)
    }

    /// Fails on the first evaluator error, runtime error record or
    /// uncaught action failure.
    pub fn check(&mut self) -> Result<(), String> {
        if let Some(e) = self.c.fatal.borrow_mut().take() {
            return Err(e);
        }
        let errors = self.runtime.take_errors();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        if let Some(e) = self.rejected.borrow().first() {
            return Err(e.clone());
        }
        Ok(())
    }

    /// One host turn: the queued microtasks in order, then `flush()`.
    pub fn turn(&mut self) {
        let (rejected, c) = (self.rejected.clone(), self.c.clone());
        self.runtime.run_microtasks(&mut |a, r| {
            let name = c
                .started
                .borrow()
                .iter()
                .find(|(id, _)| *id == a)
                .map(|(_, n)| n.clone())
                .unwrap_or_default();
            let outcome = match &r {
                Ok(()) => J::Null,
                Err(e) => J::from(e.as_str()),
            };
            c.u.host()
                .borrow()
                .push_log(serde_json::json!(["action", name, outcome]));
            if let Err(e) = r {
                rejected
                    .borrow_mut()
                    .push(format!("uncaught failure in action {name}: {e}"));
            }
        });
        self.runtime.flush();
    }

    pub fn frame(&self) -> String {
        let root = self.host.borrow().root();
        self.host.borrow().frame(root)
    }

    /// The live clickables (elements handling `click`), depth-first, each
    /// with its parent element (the mount root counts as one).
    pub fn clickables(&self) -> Vec<(usize, Option<usize>)> {
        let h = self.host.borrow();
        h.handlers_of(h.root(), "click")
            .into_iter()
            .map(|n| (n, h.parent_of(n)))
            .collect()
    }

    /// A click as the host dispatches it: through `@solidjs/web`'s
    /// delegated handler on the root.
    pub fn click(&mut self, node: usize) -> Result<(), String> {
        TreeRenderer::dispatch(&mut self.runtime, &self.host, node, "click")
            .map_err(|e| format!("click handler failed: {}", e.message()))?;
        self.check()
    }

    pub fn requests(&self) -> Vec<Request> {
        self.c.requests.borrow().clone()
    }

    /// Settles request `number` of `host`; it must exist and be pending.
    pub fn settle(
        &mut self,
        host: &str,
        number: usize,
        result: Result<Value, String>,
    ) -> Result<(), String> {
        let flight = {
            let mut requests = self.c.requests.borrow_mut();
            let r = requests
                .iter_mut()
                .find(|r| r.host == host && r.number == number)
                .ok_or_else(|| format!("{host} call #{number} was not issued"))?;
            if !r.pending {
                return Err(format!("{host} call #{number} is already settled"));
            }
            r.pending = false;
            r.flight.clone()
        };
        self.runtime.settle_flight_value(&flight, result);
        self.check()
    }

    pub fn pending(&self) -> usize {
        self.c
            .requests
            .borrow()
            .iter()
            .filter(|r| r.pending)
            .count()
    }

    pub fn dispose(&mut self) {
        if let Some(mut d) = self.disposer.take() {
            d.dispose(&mut self.runtime);
        }
    }
}
