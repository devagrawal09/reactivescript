//! Data-only plan evaluator. Host calls are registry entries, never evaluated JS.
use crate::{
    renderer::{Node, Renderer, TextRenderer},
    slice1::{ActionBody, ActionStep, ComputeFn, NodeId, Resume, Runtime},
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};
#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum Expr {
    Literal { value: Value },
    Read { source: String },
    Current { source: String },
    Local { name: String },
    Add { left: Box<Expr>, right: Box<Expr> },
}
#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum Step {
    Write {
        source: String,
        value: Expr,
    },
    Optimistic {
        source: String,
        value: Expr,
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
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub name: String,
    pub kind: String,
    pub seed: Expr,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Equation {
    pub name: String,
    pub value: Expr,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub name: String,
    pub steps: Vec<Step>,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Handler {
    pub name: String,
    pub action: String,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub name: String,
    pub handler: String,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum View {
    Element {
        tag: String,
        events: Vec<Event>,
        children: Vec<View>,
    },
    Text {
        value: Expr,
    },
}
#[derive(Clone, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub version: u32,
    pub sources: Vec<Source>,
    pub equations: Vec<Equation>,
    pub actions: Vec<Action>,
    pub handlers: Vec<Handler>,
    pub markup: Vec<View>,
}
type Bindings = BTreeMap<String, NodeId>;
fn eval(
    rt: &mut Runtime,
    names: &Bindings,
    locals: &BTreeMap<String, i64>,
    e: &Expr,
) -> Result<i64, String> {
    match e {
        Expr::Literal { value } => value
            .as_i64()
            .ok_or_else(|| "slice 1 runtime requires integer expressions".into()),
        Expr::Current { .. } => Err("updater current outside an action".into()),
        Expr::Read { source } => rt.read(
            *names
                .get(source)
                .ok_or_else(|| format!("unknown source {source}"))?,
        ),
        Expr::Local { name } => locals
            .get(name)
            .copied()
            .ok_or_else(|| format!("unbound local {name}")),
        Expr::Add { left, right } => eval(rt, names, locals, left)?
            .checked_add(eval(rt, names, locals, right)?)
            .ok_or_else(|| "integer overflow".into()),
    }
}
fn compute(e: Expr, names: Bindings) -> ComputeFn {
    Rc::new(move |rt, _| eval(rt, &names, &BTreeMap::new(), &e))
}
pub type HostFunction = Box<dyn FnMut(Vec<i64>) -> Result<String, String>>;
#[derive(Default)]
pub struct HostRegistry {
    functions: BTreeMap<String, HostFunction>,
}
impl HostRegistry {
    pub fn register(&mut self, name: String, f: HostFunction) -> Result<(), String> {
        if self.functions.insert(name, f).is_some() {
            Err("duplicate host".into())
        } else {
            Ok(())
        }
    }
    fn call(&mut self, name: &str, args: Vec<i64>) -> Result<String, String> {
        self.functions
            .get_mut(name)
            .ok_or_else(|| format!("unknown host {name}"))?(args)
    }
}
struct Block {
    steps: Vec<Step>,
    index: usize,
    catch: Option<Vec<Step>>,
}
/// Host-side state an action body shares with the app: the registry, the
/// flights issued and not settled, and the first evaluator failure.
#[derive(Default)]
struct Host {
    registry: HostRegistry,
    waiting: BTreeSet<String>,
    fatal: Option<String>,
}
/// An action's instruction stack as a generator body (action.ts): each
/// `await` yields a host flight; a rejection is thrown in at that point.
struct Execution {
    stack: Vec<Block>,
    locals: BTreeMap<String, i64>,
    bind: Option<String>,
    names: Bindings,
    host: Rc<RefCell<Host>>,
}
impl Execution {
    fn eval_action(&self, rt: &mut Runtime, e: &Expr) -> Result<i64, String> {
        match e {
            Expr::Current { source } => {
                rt.current(*self.names.get(source).ok_or("unknown updater source")?)
            }
            Expr::Add { left, right } => self
                .eval_action(rt, left)?
                .checked_add(self.eval_action(rt, right)?)
                .ok_or_else(|| "integer overflow".into()),
            _ => eval(rt, &self.names, &self.locals, e),
        }
    }
    fn target(&self, source: &str, what: &str) -> Result<NodeId, String> {
        self.names
            .get(source)
            .copied()
            .ok_or_else(|| format!("unknown {what} target"))
    }
    fn run(&mut self, rt: &mut Runtime) -> Result<ActionStep, String> {
        loop {
            let Some(block) = self.stack.last_mut() else {
                return Ok(ActionStep::Return);
            };
            if block.index == block.steps.len() {
                self.stack.pop();
                continue;
            }
            let step = block.steps[block.index].clone();
            block.index += 1;
            match step {
                Step::Write { source, value } => {
                    let v = self.eval_action(rt, &value)?;
                    rt.write(self.target(&source, "write")?, v)
                }
                Step::Optimistic { source, value } => {
                    let v = self.eval_action(rt, &value)?;
                    rt.optimistic_write(self.target(&source, "optimistic")?, v)
                }
                Step::Try { body, catch } => self.stack.push(Block {
                    steps: body,
                    index: 0,
                    catch: Some(catch),
                }),
                Step::Await { host, args, bind } => {
                    let values = args
                        .iter()
                        .map(|a| eval(rt, &self.names, &self.locals, a))
                        .collect::<Result<Vec<_>, _>>()?;
                    let mut h = self.host.borrow_mut();
                    let flight = h.registry.call(&host, values)?;
                    if !h.waiting.insert(flight.clone()) {
                        return Err("host reused a flight".into());
                    }
                    self.bind = Some(bind);
                    return Ok(ActionStep::Yield(flight));
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
                let bind = self.bind.take().expect("resumed at an await");
                let Some(v) = v.as_int() else {
                    return ActionStep::Throw("a non-integer flight value".into());
                };
                self.locals.insert(bind, v);
            }
            Resume::Error(error) => loop {
                // The rejection is thrown in at the await: unwind to a catch.
                let Some(block) = self.stack.pop() else {
                    return ActionStep::Throw(error);
                };
                if let Some(catch) = block.catch {
                    self.stack.push(Block {
                        steps: catch,
                        index: 0,
                        catch: None,
                    });
                    break;
                }
            },
        }
        match self.run(rt) {
            Ok(step) => step,
            Err(e) => {
                self.host.borrow_mut().fatal.get_or_insert(e.clone());
                ActionStep::Throw(e)
            }
        }
    }
}
pub struct App {
    pub runtime: Runtime,
    pub renderer: Rc<RefCell<TextRenderer>>,
    pub root: Node,
    owner: NodeId,
    names: Bindings,
    actions: BTreeMap<String, Vec<Step>>,
    handlers: BTreeMap<String, String>,
    host: Rc<RefCell<Host>>,
    rejected: Rc<RefCell<Vec<String>>>,
}
impl App {
    pub fn mount(plan: Plan, hosts: HostRegistry) -> Result<Self, String> {
        if plan.version != 1 {
            return Err("unsupported plan version".into());
        }
        let mut runtime = Runtime::default();
        let owner = runtime.create_root();
        let mut names = BTreeMap::new();
        for source in plan.sources {
            if names.contains_key(&source.name) {
                return Err("duplicate source".into());
            }
            let id = match source.kind.as_str() {
                "source" => {
                    let v = eval(&mut runtime, &names, &BTreeMap::new(), &source.seed)?;
                    runtime.with_owner(Some(owner), |rt| rt.signal(v))
                }
                "optimistic" => {
                    let f = compute(source.seed, names.clone());
                    runtime.with_owner(Some(owner), |rt| rt.optimistic(f))
                }
                _ => return Err("unsupported source kind".into()),
            };
            names.insert(source.name, id);
        }
        for eq in plan.equations {
            if names.contains_key(&eq.name) {
                return Err("duplicate equation".into());
            }
            let f = compute(eq.value, names.clone());
            let id = runtime.with_owner(Some(owner), |rt| rt.memo(f));
            names.insert(eq.name, id);
        }
        let renderer = Rc::new(RefCell::new(TextRenderer::default()));
        let root = renderer.borrow_mut().create_element("#root");
        let mut app = Self {
            runtime,
            renderer,
            root,
            owner,
            names,
            actions: BTreeMap::new(),
            handlers: BTreeMap::new(),
            host: Rc::new(RefCell::new(Host {
                registry: hosts,
                ..Host::default()
            })),
            rejected: Rc::new(RefCell::new(vec![])),
        };
        for a in plan.actions {
            if app.actions.insert(a.name, a.steps).is_some() {
                return Err("duplicate action".into());
            }
        }
        for h in plan.handlers {
            if !app.actions.contains_key(&h.action)
                || app.handlers.insert(h.name, h.action).is_some()
            {
                return Err("invalid handler".into());
            }
        }
        for view in plan.markup {
            app.mount_view(root, view)?;
        }
        app.flush_checked()?;
        Ok(app)
    }
    fn mount_view(&mut self, parent: Node, view: View) -> Result<(), String> {
        match view {
            View::Element {
                tag,
                events,
                children,
            } => {
                let n = self.renderer.borrow_mut().create_element(&tag);
                self.renderer.borrow_mut().insert(parent, n, None);
                for event in events {
                    if !self.handlers.contains_key(&event.handler) {
                        return Err("unknown event handler".into());
                    }
                    self.renderer
                        .borrow_mut()
                        .event(n, &event.name, &event.handler);
                }
                for child in children {
                    self.mount_view(n, child)?
                }
            }
            View::Text { value } => {
                if let Expr::Literal {
                    value: Value::String(s),
                } = &value
                {
                    let n = self.renderer.borrow_mut().create_text(s);
                    self.renderer.borrow_mut().insert(parent, n, None);
                } else {
                    let n = self.renderer.borrow_mut().create_text("");
                    self.renderer.borrow_mut().insert(parent, n, None);
                    let renderer = self.renderer.clone();
                    let f = compute(value, self.names.clone());
                    self.runtime.with_owner(Some(self.owner), |rt| {
                        rt.render_effect(
                            f,
                            Rc::new(move |_, v, _| {
                                renderer.borrow_mut().replace_text(n, &v.to_string());
                                None
                            }),
                        )
                    });
                }
            }
        }
        Ok(())
    }
    /// The host's microtask drain followed by `flush()`; evaluator failures,
    /// render errors and uncaught rejections fail the run.
    fn flush_checked(&mut self) -> Result<(), String> {
        let rejected = self.rejected.clone();
        self.runtime.run_microtasks(&mut |_, r| {
            if let Err(e) = r {
                rejected.borrow_mut().push(e)
            }
        });
        self.runtime.flush();
        if let Some(e) = self.host.borrow_mut().fatal.take() {
            return Err(e);
        }
        let errors = self.runtime.take_errors();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        if let Some(e) = self.rejected.borrow_mut().pop() {
            return Err(e);
        }
        Ok(())
    }
    pub fn frame(&self) -> String {
        self.renderer.borrow().frame(self.root)
    }
    pub fn click(&mut self, index: usize) -> Result<(), String> {
        let node = *self
            .renderer
            .borrow()
            .clickable(self.root)
            .get(index)
            .ok_or("click target missing")?;
        let handler = self
            .renderer
            .borrow()
            .handler(node, "onClick")
            .ok_or("click handler missing")?;
        let steps = self.actions[&self.handlers[&handler]].clone();
        self.runtime.action(Box::new(Execution {
            stack: vec![Block {
                steps,
                index: 0,
                catch: None,
            }],
            locals: BTreeMap::new(),
            bind: None,
            names: self.names.clone(),
            host: self.host.clone(),
        }));
        self.flush_checked()
    }
    pub fn settle(&mut self, flight: &str, result: Result<i64, String>) -> Result<(), String> {
        if !self.host.borrow_mut().waiting.remove(flight) {
            return Err("unknown or already settled flight".into());
        }
        self.runtime.settle_flight(flight, result);
        self.flush_checked()
    }
    pub fn pending(&self) -> usize {
        self.host.borrow().waiting.len()
    }
}
