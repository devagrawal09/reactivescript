//! Plan schema v2.2 (frontend `plan/docs/PLAN-V2.md`, "v2.2"): server
//! functions over server hosts, components with props, component
//! applications, and the placement annotations (`sunk`, `place`, `server`,
//! `serverComponents`, `placement`). Its own types: plan v2 and v2.1 keep
//! theirs ([`crate::plan_v2`]), and no v2/v2.1 path reads these. Anything
//! outside the schema fails to parse (`deny_unknown_fields`), and
//! [`validate`] refuses what parses but the frames server does not serve.
use serde::Deserialize;
use serde_json::Value as J;
use std::collections::HashSet;

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
    /// A prop read through the props getter.
    Prop {
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
    Pending {
        value: Box<Expr>,
    },
    Latest {
        value: Box<Expr>,
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
    #[serde(rename_all = "camelCase")]
    Await {
        server_fn: String,
        args: Vec<Expr>,
        bind: String,
    },
    Try {
        body: Vec<Step>,
        catch: Vec<Step>,
    },
    Call {
        #[serde(default)]
        action: Option<String>,
        #[serde(default)]
        prop: Option<String>,
        args: Vec<Expr>,
    },
    Refresh {
        source: String,
    },
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

/// A component application's argument: a value, an action of the applying
/// component, or one of its own props forwarded (an action passed down).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropArg {
    pub name: String,
    #[serde(default)]
    pub value: Option<Expr>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub forward: Option<String>,
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
    Loading {
        fallback: Vec<View>,
        children: Vec<View>,
    },
    Errored {
        fallback: Vec<View>,
        children: Vec<View>,
    },
    Component {
        name: String,
        props: Vec<PropArg>,
        #[serde(default)]
        place: Option<String>,
        #[serde(default)]
        server: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ServerCall {
    pub server_fn: String,
    pub args: Vec<Expr>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Memo {
    pub name: String,
    #[serde(default)]
    pub value: Option<Expr>,
    #[serde(default, rename = "await")]
    pub call: Option<ServerCall>,
    /// The server component whose call replaces this question (PL-4).
    #[serde(default)]
    pub sunk: Option<String>,
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
pub struct PropDecl {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Component {
    pub name: String,
    pub props: Vec<PropDecl>,
    pub sources: Vec<Source>,
    pub memos: Vec<Memo>,
    pub actions: Vec<Action>,
    pub markup: Vec<View>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerHost {
    pub name: String,
    pub params: Vec<String>,
    pub returns: String,
    #[serde(default)]
    pub pure: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Param {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum ServerStep {
    #[serde(rename_all = "camelCase")]
    Await {
        #[serde(default)]
        server_host: Option<String>,
        #[serde(default)]
        server_fn: Option<String>,
        args: Vec<Expr>,
        bind: String,
    },
    Return {
        value: Expr,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFn {
    pub name: String,
    pub id: String,
    #[serde(default)]
    pub io: Option<bool>,
    pub params: Vec<Param>,
    pub returns: String,
    pub steps: Vec<ServerStep>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Question {
    pub memo: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub name: String,
    pub component: String,
    pub views: Vec<Vec<usize>>,
    pub args: Vec<String>,
    pub through: Vec<String>,
    pub from: serde_json::Map<String, J>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerComponent {
    pub name: String,
    pub id: String,
    pub component: String,
    pub params: Vec<String>,
    pub question: Question,
    pub slots: Vec<Slot>,
    pub inline: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Plan {
    pub version: f64,
    pub component: String,
    pub hosts: Vec<J>,
    pub server_hosts: Vec<ServerHost>,
    pub server_fns: Vec<ServerFn>,
    pub components: Vec<Component>,
    pub sources: Vec<Source>,
    pub memos: Vec<Memo>,
    pub actions: Vec<Action>,
    pub markup: Vec<View>,
    pub server_components: Vec<ServerComponent>,
    pub placement: J,
}

impl Plan {
    pub fn parse(text: &str) -> Result<Plan, String> {
        let p: Plan = serde_json::from_str(text).map_err(|e| format!("plan v2.2: {e}"))?;
        validate(&p)?;
        Ok(p)
    }
    pub fn server_fn(&self, name: &str) -> Option<&ServerFn> {
        self.server_fns.iter().find(|f| f.name == name)
    }
    pub fn component(&self, name: &str) -> Option<&Component> {
        self.components.iter().find(|c| c.name == name)
    }
    pub fn server_component(&self, name: &str) -> Option<&ServerComponent> {
        self.server_components.iter().find(|c| c.name == name)
    }
    /// The entry as a component (it takes no props).
    pub fn entry(&self) -> Component {
        Component {
            name: self.component.clone(),
            props: vec![],
            sources: self.sources.clone(),
            memos: self.memos.clone(),
            actions: self.actions.clone(),
            markup: self.markup.clone(),
        }
    }
}

/// The checks before anything is served: the version, unique names, every
/// referenced server fn, host, component and server component present, and
/// each wire id unique.
pub fn validate(p: &Plan) -> Result<(), String> {
    if p.version != 2.2 {
        return Err(format!("plan version {} is not 2.2", p.version));
    }
    if !p.hosts.is_empty() {
        return Err("a frames plan has no client hosts".into());
    }
    let mut ids = HashSet::new();
    for f in &p.server_fns {
        if !ids.insert(f.id.clone()) {
            return Err(format!("wire id {} twice", f.id));
        }
        for s in &f.steps {
            if let ServerStep::Await {
                server_host,
                server_fn,
                ..
            } = s
            {
                match (server_host, server_fn) {
                    (Some(h), None) if p.server_hosts.iter().any(|x| &x.name == h) => {}
                    (None, Some(g)) if p.server_fn(g).is_some() => {}
                    _ => {
                        return Err(format!(
                            "server fn {}: an await of neither one server host nor one server fn",
                            f.name
                        ))
                    }
                }
            }
        }
        if !matches!(f.steps.last(), Some(ServerStep::Return { .. })) {
            return Err(format!("server fn {} does not end in return", f.name));
        }
    }
    for c in &p.server_components {
        if !ids.insert(c.id.clone()) {
            return Err(format!("wire id {} twice", c.id));
        }
        if p.component(&c.component).is_none() {
            return Err(format!(
                "server component {} of an unknown component",
                c.name
            ));
        }
        for k in &c.inline {
            if p.component(k).is_none() {
                return Err(format!("inline component {k} is unknown"));
            }
        }
        for s in &c.slots {
            if p.component(&s.component).is_none() {
                return Err(format!("slot component {} is unknown", s.component));
            }
        }
    }
    for c in p.components.iter().chain(std::iter::once(&p.entry())) {
        for m in &c.memos {
            if m.value.is_some() == m.call.is_some() {
                return Err(format!(
                    "memo {} needs exactly one of value and await",
                    m.name
                ));
            }
            if let Some(call) = &m.call {
                if p.server_fn(&call.server_fn).is_none() {
                    return Err(format!("memo {} awaits an unknown server fn", m.name));
                }
            }
            if let Some(s) = &m.sunk {
                if p.server_component(s).is_none() {
                    return Err(format!(
                        "memo {} is sunk into an unknown server component",
                        m.name
                    ));
                }
            }
        }
        check_views(p, &c.markup)?;
    }
    Ok(())
}

fn check_views(p: &Plan, vs: &[View]) -> Result<(), String> {
    for v in vs {
        match v {
            View::Element { children, .. } | View::For { children, .. } => {
                check_views(p, children)?
            }
            View::Show {
                children, fallback, ..
            }
            | View::Loading { children, fallback }
            | View::Errored { children, fallback } => {
                check_views(p, children)?;
                check_views(p, fallback)?;
            }
            View::Text { .. } => {}
            View::Component {
                name,
                props,
                place,
                server,
            } => {
                if p.component(name).is_none() {
                    return Err(format!("unknown component {name}"));
                }
                for a in props {
                    let n = [a.value.is_some(), a.action.is_some(), a.forward.is_some()]
                        .iter()
                        .filter(|x| **x)
                        .count();
                    if n != 1 {
                        return Err(format!(
                            "prop {} of {name} needs exactly one of value, action, forward",
                            a.name
                        ));
                    }
                }
                match (place.as_deref(), server) {
                    (None, None) => {}
                    (Some("server"), Some(s)) if p.server_component(s).is_some() => {}
                    _ => return Err(format!("the placement of {name} is malformed")),
                }
            }
        }
    }
    Ok(())
}
