//! Plan schema v2 (frontend-tracker `plan/docs/PLAN-V2.md`): a data-only
//! component, built with the ported Solid 2 primitives and rendered by the
//! port of `@solidjs/universal`, as `frontend-tracker/plan/solid-plan.ts`
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
    user_error, ActionBody, ActionId, ActionStep, BodyFn, Builtin, Disposer, Error, ForProps,
    Getter, InsertOptions, JsObj, Key, Marker, NodeId, Out, Resume, Runtime, ShowProps, Universal,
    Value,
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
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostSig {
    pub name: String,
    pub params: Vec<String>,
    pub returns: String,
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
    pub value: Expr,
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
    pub version: u32,
    pub component: String,
    pub hosts: Vec<HostSig>,
    pub sources: Vec<Source>,
    pub memos: Vec<Memo>,
    pub actions: Vec<Action>,
    pub markup: Vec<View>,
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
    Action,
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
                    Some(NameKind::Action) => Err(format!("read of action {source}")),
                    Some(_) => Ok(()),
                }
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
        }
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
                    let a = self
                        .actions
                        .get(action.as_str())
                        .ok_or_else(|| format!("call of unknown action {action}"))?;
                    if a.params.len() != args.len() {
                        return Err(format!("{action} takes {} arguments", a.params.len()));
                    }
                    for x in args {
                        self.expr(x, scope, true)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn views(&self, views: &[View], scope: &mut Vec<String>) -> Result<(), String> {
        for (i, v) in views.iter().enumerate() {
            if dynamic(v) && views.get(i + 1).is_some_and(dynamic) {
                return Err(
                    "adjacent dynamic children need a marker the plan does not give".into(),
                );
            }
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
                    self.views(children, scope)?;
                }
                View::Text { value } => self.expr(value, scope, true)?,
                View::Show {
                    when,
                    children,
                    fallback,
                } => {
                    self.expr(when, scope, true)?;
                    self.views(children, scope)?;
                    self.views(fallback, scope)?;
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
                    let r = self.views(children, scope);
                    scope.pop();
                    r?;
                }
            }
        }
        Ok(())
    }
}

/// A view that is inserted (an accessor or a control-flow component) rather
/// than appended as a static node.
fn dynamic(v: &View) -> bool {
    match v {
        View::Element { .. } => false,
        View::Text { value } => !matches!(value, Expr::Literal { .. }),
        View::Show { .. } | View::For { .. } => true,
    }
}

/// Refuses a plan outside schema v2 before anything is built.
pub fn validate(plan: &Plan) -> Result<(), String> {
    if plan.version != 2 {
        return Err(format!("plan version {} is not 2", plan.version));
    }
    if plan.component.is_empty() {
        return Err("plan component name is empty".into());
    }
    let mut check = Check {
        names: HashMap::new(),
        hosts: HashMap::new(),
        actions: HashMap::new(),
    };
    for h in &plan.hosts {
        if !identifier(&h.name) || check.hosts.insert(&h.name, h).is_some() {
            return Err(format!("host {:?} is not a unique name", h.name));
        }
        if !SCALARS.contains(&h.returns.as_str())
            || h.params.iter().any(|p| !SCALARS.contains(&p.as_str()))
        {
            return Err(format!("host {} has a non-scalar signature", h.name));
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
        .chain(plan.memos.iter().map(|m| (m.name.as_str(), NameKind::Memo)))
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
        check.expr(&m.value, &mut vec![], true)?;
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
    check.views(&plan.markup, &mut vec![])
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
    requests: RefCell<Vec<Request>>,
    /// The first evaluator failure (a value outside its types, an unbound
    /// name). It fails the run even where Solid would route the thrown
    /// error elsewhere.
    fatal: RefCell<Option<String>>,
    /// Every action call, by the runtime's id.
    started: RefCell<Vec<(ActionId, String)>>,
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
        Some(Binding::Signal(n) | Binding::Optimistic(n) | Binding::Memo(n)) => rt.read_value(n),
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
            let k = Key::name(key);
            if !rt.js_has(&o, &k)? {
                return Err(fail(c, format!("get {key}: no such field")));
            }
            rt.js_get(&o, &k)
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
    }
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
            // Segments left to right, then the value (PLAN-V2.md, `write`).
            let mut keys = vec![];
            for seg in path {
                keys.push(match (&seg.key, &seg.index) {
                    (Some(k), None) => (Key::name(k), false),
                    (None, Some(i)) => {
                        let i = eval(rt, c, i, env)?;
                        let i = integer(c, &i)?;
                        let i = u32::try_from(i)
                            .map_err(|_| fail(c, format!("store path index {i}")))?;
                        (Key::Idx(i), true)
                    }
                    _ => return Err(fail(c, "a path segment has one of key and index".into())),
                });
            }
            let v = eval(rt, c, value, env)?;
            // `setStore(draft => { draft.k1…[kn] = value })`.
            rt.store_set(&proxy, &mut |rt: &mut Runtime, draft: Value| {
                let mut o = draft;
                for (i, (k, index)) in keys.iter().enumerate() {
                    if !o.is_object() {
                        return Err(fail(c, "store path does not exist".into()));
                    }
                    let array = rt.is_array(&o);
                    if *index != array {
                        return Err(fail(c, format!("store path segment {} on {o:?}", k.text())));
                    }
                    if *index {
                        let Key::Idx(n) = k else { unreachable!() };
                        if *n >= length(rt, c, &o)? {
                            return Err(fail(c, format!("store path index {n} out of range")));
                        }
                    }
                    if i + 1 == keys.len() {
                        rt.js_set(&o, k, v.clone())?;
                    } else {
                        o = rt.js_get(&o, k)?;
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
                if scalar_type(&v) != Some(returns.as_str()) {
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
                    _ => return Err(fail(&c, "a plain handler awaits, tries or guesses".into())),
                }
            }
            Ok(Value::Undef)
        }),
    )
}

// ---- markup ----

enum Part {
    Node(usize),
    Dynamic(Value),
}

fn getter(c: &C, f: impl Fn(&mut Runtime, &C) -> Result<Value, Error> + 'static) -> Getter {
    let c = c.clone();
    Rc::new(move |rt: &mut Runtime| f(rt, &c))
}

fn part(rt: &mut Runtime, c: &C, v: &View, env: &Env) -> Result<Part, Error> {
    match v {
        View::Text {
            value: Expr::Literal { value },
        } => {
            let s = literal(value).map_err(|m| fail(c, m))?;
            let s = text(c, &s)?;
            Ok(Part::Node(c.u.create_text(&Value::str(&s))))
        }
        View::Text { value } => {
            let (value, env) = (value.clone(), env.clone());
            let c2 = c.clone();
            Ok(Part::Dynamic(rt.function(
                0,
                Rc::new(move |rt: &mut Runtime, _| {
                    let v = eval(rt, &c2, &value, &env)?;
                    Ok(Value::str(&text(&c2, &v)?))
                }),
            )))
        }
        View::Element {
            tag,
            events,
            children: kids,
        } => {
            let el = c.u.create_element(tag);
            for e in events {
                let f = handler(rt, c, &e.steps, env);
                c.u.set_prop(el, &e.name, &f, &Value::Undef);
            }
            children(rt, c, el, kids, env)?;
            Ok(Part::Node(el))
        }
        View::Show {
            when,
            children: kids,
            fallback,
        } => {
            let (when, kids, fallback) = (when.clone(), kids.clone(), fallback.clone());
            let (e1, e2, e3) = (env.clone(), env.clone(), env.clone());
            let props = ShowProps {
                when: getter(c, move |rt, c| eval(rt, c, &when, &e1)),
                keyed: Value::Undef,
                children: getter(c, move |rt, c| fragment(rt, c, &kids, &e2)),
                fallback: Some(getter(c, move |rt, c| fragment(rt, c, &fallback, &e3))),
            };
            Ok(Part::Dynamic(rt.create_component(Rc::new(
                move |rt: &mut Runtime| Ok(rt.show_component(props.clone())),
            ))?))
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
                    let xs = eval(rt, c, &each, &e1)?;
                    if !rt.is_array(&xs) {
                        return Err(fail(c, format!("For of {xs:?}, not an array")));
                    }
                    Ok(xs)
                }),
                keyed: Value::Undef,
                children: Rc::new(move |_| Ok(mapper.clone())),
                fallback: None,
            };
            Ok(Part::Dynamic(rt.create_component(Rc::new(
                move |rt: &mut Runtime| Ok(rt.for_component(props.clone())),
            ))?))
        }
    }
}

/// An element's children: static nodes appended in order, then each dynamic
/// part inserted before its next static sibling (`null` if none follows; no
/// marker for a lone child), as Solid's compiler emits.
fn children(
    rt: &mut Runtime,
    c: &C,
    parent: usize,
    views: &[View],
    env: &Env,
) -> Result<(), Error> {
    let mut parts = vec![];
    for v in views {
        parts.push(part(rt, c, v, env)?);
    }
    for p in &parts {
        if let Part::Node(n) = p {
            c.u.append(parent, *n, None);
        }
    }
    for (i, p) in parts.iter().enumerate() {
        let Part::Dynamic(d) = p else { continue };
        if matches!(parts.get(i + 1), Some(Part::Dynamic(_))) {
            return Err(fail(c, "adjacent dynamic children".into()));
        }
        let next = parts[i + 1..].iter().find_map(|q| match q {
            Part::Node(n) => Some(*n),
            Part::Dynamic(_) => None,
        });
        let marker = if parts.len() == 1 {
            Marker::Undefined
        } else {
            next.map_or(Marker::Null, Marker::Node)
        };
        c.u.insert(
            rt,
            parent,
            d.clone(),
            marker,
            None,
            InsertOptions::default(),
        )?;
    }
    Ok(())
}

/// A list of views as one value: a lone part itself, else an array.
fn fragment(rt: &mut Runtime, c: &C, views: &[View], env: &Env) -> Result<Value, Error> {
    let mut parts = vec![];
    for v in views {
        parts.push(match part(rt, c, v, env)? {
            Part::Node(n) => Value::Node(n),
            Part::Dynamic(d) => d,
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
        let (value, c2) = (m.value.clone(), c.clone());
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
        validate(&plan)?;
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
            requests: RefCell::new(vec![]),
            fatal: RefCell::new(None),
            started: RefCell::new(vec![]),
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
