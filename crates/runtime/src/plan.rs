//! Data-only plan evaluator. Host calls are registry entries, never evaluated JS.
use crate::{
    renderer::{Node, Renderer, TextRenderer},
    slice1::{Runtime, SourceId, TxId},
    Computation, Compute, EffectKind, MemoOptions, NodeId, ReadError,
};
use serde::Deserialize;
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
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
    graph: &crate::Runtime<i64>,
    names: &Bindings,
    locals: &BTreeMap<String, i64>,
    e: &Expr,
) -> Result<i64, String> {
    match e {
        Expr::Literal { value } => value
            .as_i64()
            .ok_or_else(|| "slice 1 runtime requires integer expressions".into()),
        Expr::Current { .. } => Err("updater current outside an action".into()),
        Expr::Read { source } => graph
            .read(
                *names
                    .get(source)
                    .ok_or_else(|| format!("unknown source {source}"))?,
            )
            .map_err(|e| format!("{e:?}")),
        Expr::Local { name } => locals
            .get(name)
            .copied()
            .ok_or_else(|| format!("unbound local {name}")),
        Expr::Add { left, right } => eval(graph, names, locals, left)?
            .checked_add(eval(graph, names, locals, right)?)
            .ok_or_else(|| "integer overflow".into()),
    }
}
fn compute(e: Expr, names: Bindings) -> Compute<i64> {
    Rc::new(move |g, _| {
        eval(g, &names, &BTreeMap::new(), &e)
            .map(Computation::Ready)
            .map_err(ReadError::Failed)
    })
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
struct Execution {
    tx: TxId,
    stack: Vec<Block>,
    locals: BTreeMap<String, i64>,
}
pub struct App {
    pub runtime: Runtime,
    pub renderer: Rc<RefCell<TextRenderer>>,
    pub root: Node,
    names: Bindings,
    sources: BTreeMap<String, SourceId>,
    actions: BTreeMap<String, Vec<Step>>,
    handlers: BTreeMap<String, String>,
    hosts: HostRegistry,
    waiting: BTreeMap<String, (Execution, String)>,
}
impl App {
    pub fn mount(plan: Plan, hosts: HostRegistry) -> Result<Self, String> {
        if plan.version != 1 {
            return Err("unsupported plan version".into());
        }
        let runtime = Runtime::default();
        let mut names = BTreeMap::new();
        let mut sources = BTreeMap::new();
        for source in plan.sources {
            if names.contains_key(&source.name) {
                return Err("duplicate source".into());
            }
            let id = match source.kind.as_str() {
                "source" => runtime.signal(eval(
                    &runtime.graph,
                    &names,
                    &BTreeMap::new(),
                    &source.seed,
                )?),
                "optimistic" => runtime.optimistic(compute(source.seed, names.clone())),
                _ => return Err("unsupported source kind".into()),
            };
            names.insert(source.name.clone(), runtime.node(id));
            sources.insert(source.name, id);
        }
        for eq in plan.equations {
            if names.contains_key(&eq.name) {
                return Err("duplicate equation".into());
            }
            let id = runtime
                .graph
                .memo(compute(eq.value, names.clone()), MemoOptions::default());
            names.insert(eq.name, id);
        }
        let renderer = Rc::new(RefCell::new(TextRenderer::default()));
        let root = renderer.borrow_mut().create_element("#root");
        let mut app = Self {
            runtime,
            renderer,
            root,
            names,
            sources,
            actions: BTreeMap::new(),
            handlers: BTreeMap::new(),
            hosts,
            waiting: BTreeMap::new(),
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
        app.runtime.flush();
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
                    self.runtime.graph.effect(
                        compute(value, self.names.clone()),
                        Rc::new(move |v, _| {
                            renderer.borrow_mut().replace_text(n, &v.to_string());
                            None
                        }),
                        EffectKind::Render,
                        None,
                        false,
                    );
                }
            }
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
        let tx = self.runtime.begin_action();
        self.run(Execution {
            tx,
            stack: vec![Block {
                steps,
                index: 0,
                catch: None,
            }],
            locals: BTreeMap::new(),
        })?;
        self.runtime.flush();
        Ok(())
    }
    fn eval_action(&self, e: &Expr, locals: &BTreeMap<String, i64>) -> Result<i64, String> {
        match e {
            Expr::Current { source } => self
                .runtime
                .current(*self.sources.get(source).ok_or("unknown updater source")?)
                .map_err(|e| format!("{e:?}")),
            Expr::Add { left, right } => self
                .eval_action(left, locals)?
                .checked_add(self.eval_action(right, locals)?)
                .ok_or_else(|| "integer overflow".into()),
            _ => eval(&self.runtime.graph, &self.names, locals, e),
        }
    }
    fn run(&mut self, mut e: Execution) -> Result<(), String> {
        loop {
            let Some(block) = e.stack.last_mut() else {
                self.runtime.finish_action(e.tx);
                return Ok(());
            };
            if block.index == block.steps.len() {
                e.stack.pop();
                continue;
            }
            let step = block.steps[block.index].clone();
            block.index += 1;
            match step {
                Step::Write { source, value } => {
                    let v = self.eval_action(&value, &e.locals)?;
                    self.runtime
                        .write(*self.sources.get(&source).ok_or("unknown write target")?, v)
                }
                Step::Optimistic { source, value } => {
                    let v = self.eval_action(&value, &e.locals)?;
                    self.runtime.optimistic_write(
                        *self
                            .sources
                            .get(&source)
                            .ok_or("unknown optimistic target")?,
                        v,
                    )
                }
                Step::Try { body, catch } => e.stack.push(Block {
                    steps: body,
                    index: 0,
                    catch: Some(catch),
                }),
                Step::Await { host, args, bind } => {
                    let values = args
                        .iter()
                        .map(|a| eval(&self.runtime.graph, &self.names, &e.locals, a))
                        .collect::<Result<Vec<_>, _>>()?;
                    let flight = self.hosts.call(&host, values)?;
                    if self.waiting.contains_key(&flight) {
                        return Err("host reused a flight".into());
                    }
                    self.waiting.insert(flight, (e, bind));
                    return Ok(());
                }
            }
        }
    }
    pub fn settle(&mut self, flight: &str, result: Result<i64, String>) -> Result<(), String> {
        let (mut e, bind) = self
            .waiting
            .remove(flight)
            .ok_or("unknown or already settled flight")?;
        self.runtime.join_future(e.tx);
        match result {
            Ok(v) => {
                e.locals.insert(bind, v);
            }
            Err(error) => loop {
                let Some(block) = e.stack.pop() else {
                    self.runtime.finish_action(e.tx);
                    self.runtime.flush();
                    return Err(error);
                };
                if let Some(catch) = block.catch {
                    e.stack.push(Block {
                        steps: catch,
                        index: 0,
                        catch: None,
                    });
                    break;
                }
            },
        }
        self.run(e)?;
        self.runtime.flush();
        Ok(())
    }
    pub fn pending(&self) -> usize {
        self.waiting.len()
    }
}
