use rust_solid::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    io::{self, BufRead},
    rc::Rc,
};
#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum Expr {
    Number(i64),
    Op(ExprOp),
}
#[derive(Clone, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum ExprOp {
    Read {
        id: String,
    },
    Add {
        a: Box<Expr>,
        b: Box<Expr>,
    },
    Mod {
        a: Box<Expr>,
        b: i64,
    },
    Choose {
        test: Box<Expr>,
        yes: Box<Expr>,
        no: Box<Expr>,
    },
    Untrack {
        expr: Box<Expr>,
    },
    Fail {
        message: String,
    },
    Prev {
        fallback: i64,
    },
}
type Nodes = Rc<RefCell<BTreeMap<String, NodeId>>>;
type Log = Rc<RefCell<Vec<Value>>>;
fn eval(rt: &Runtime<i64>, nodes: &Nodes, e: &Expr, prev: Option<i64>) -> ReadResult<i64> {
    match e {
        Expr::Number(n) => Ok(*n),
        Expr::Op(e) => match e {
            ExprOp::Read { id } => rt.read(nodes.borrow()[id]),
            ExprOp::Add { a, b } => Ok(eval(rt, nodes, a, prev)? + eval(rt, nodes, b, prev)?),
            ExprOp::Mod { a, b } => Ok(eval(rt, nodes, a, prev)? % b),
            ExprOp::Choose { test, yes, no } => eval(
                rt,
                nodes,
                if eval(rt, nodes, test, prev)? != 0 {
                    yes
                } else {
                    no
                },
                prev,
            ),
            ExprOp::Untrack { expr } => rt.untrack(|| eval(rt, nodes, expr, prev)),
            ExprOp::Fail { message } => Err(ReadError::Failed(message.clone())),
            ExprOp::Prev { fallback } => Ok(prev.unwrap_or(*fallback)),
        },
    }
}
#[derive(Clone, Deserialize)]
struct Write {
    id: String,
    value: i64,
}
#[derive(Clone, Deserialize)]
struct Slice {
    #[serde(default)]
    writes: Vec<Write>,
    flight: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Op {
    Signal {
        id: String,
        value: i64,
        equals: Option<String>,
        #[serde(default)]
        optimistic: bool,
    },
    Memo {
        id: String,
        expr: Expr,
        #[serde(default)]
        lazy: bool,
        equals: Option<String>,
        flight: Option<String>,
        loading: Option<i64>,
        owner: Option<String>,
    },
    Effect {
        id: String,
        expr: Expr,
        #[serde(default)]
        render: bool,
        #[serde(default)]
        defer: bool,
        owner: Option<String>,
    },
    Write {
        id: String,
        value: i64,
    },
    Read {
        id: String,
        label: Option<String>,
    },
    Latest {
        id: String,
    },
    Pending {
        id: String,
    },
    Flush,
    Owner {
        id: String,
        parent: Option<String>,
    },
    Cleanup {
        owner: String,
        label: String,
    },
    Dispose {
        owner: String,
    },
    Refresh {
        id: String,
    },
    Resolve {
        flight: String,
        value: i64,
    },
    Reject {
        flight: String,
        message: String,
    },
    Action {
        id: String,
        slices: Vec<Slice>,
    },
}
fn equals(s: Option<String>) -> Option<Equals<i64>> {
    match s.as_deref() {
        Some("never") => Some(Rc::new(|_, _| false)),
        Some("parity") => Some(Rc::new(|a, b| a % 2 == b % 2)),
        _ => None,
    }
}
fn observed(v: ReadResult<i64>) -> Value {
    match v {
        Ok(v) => json!(v),
        Err(ReadError::Pending) => json!({"error":"pending"}),
        Err(ReadError::Failed(e)) => json!({"error":e}),
        Err(ReadError::Disposed) => json!({"error":"disposed"}),
    }
}
fn run(ops: Vec<Op>) -> Vec<Value> {
    let rt = Runtime::<i64>::new();
    let root = rt.create_owner(None, None);
    let mut owners = BTreeMap::from([("root".to_owned(), root)]);
    let nodes: Nodes = Rc::new(RefCell::new(BTreeMap::new()));
    let log: Log = Rc::new(RefCell::new(vec![]));
    let mut actions = BTreeMap::new();
    for op in ops {
        match op {
            Op::Signal {
                id,
                value,
                equals: eq,
                optimistic,
            } => {
                let sig = rt.with_owner(root, || rt.signal_with(value, equals(eq), optimistic));
                nodes.borrow_mut().insert(id, sig.id());
            }
            Op::Memo {
                id,
                expr,
                lazy,
                equals: eq,
                flight,
                loading,
                owner,
            } => {
                let ns = nodes.clone();
                let l = log.clone();
                let name = id.clone();
                let compute: Compute<i64> = Rc::new(move |rt, prev| {
                    l.borrow_mut().push(json!(["compute", name, prev]));
                    let v = eval(rt, &ns, &expr, prev)?;
                    if let Some(prefix) = &flight {
                        let f = format!("{prefix}:{v}");
                        l.borrow_mut().push(json!(["flight", f]));
                        Ok(Computation::Await(f))
                    } else {
                        Ok(Computation::Ready(v))
                    }
                });
                let owner = owners[owner.as_deref().unwrap_or("root")];
                let n = rt.with_owner(owner, || {
                    rt.memo(
                        compute,
                        MemoOptions {
                            lazy,
                            equals: equals(eq),
                            loading_value: loading,
                        },
                    )
                });
                nodes.borrow_mut().insert(id, n);
            }
            Op::Effect {
                id,
                expr,
                render,
                defer,
                owner,
            } => {
                let ns = nodes.clone();
                let l = log.clone();
                let name = id.clone();
                let compute: Compute<i64> = Rc::new(move |rt, prev| {
                    l.borrow_mut().push(json!(["compute", name, prev]));
                    eval(rt, &ns, &expr, prev).map(Computation::Ready)
                });
                let l = log.clone();
                let name = id.clone();
                let apply: Apply<i64> = Rc::new(move |v, p| {
                    l.borrow_mut().push(json!(["effect", name, v, p]));
                    let l = l.clone();
                    let name = name.clone();
                    Some(Box::new(move || {
                        l.borrow_mut().push(json!(["effect_cleanup", name, v]))
                    }))
                });
                let l = log.clone();
                let name = id.clone();
                let err: ErrorHandler =
                    Rc::new(move |e| l.borrow_mut().push(json!(["error", name, e])));
                let owner = owners[owner.as_deref().unwrap_or("root")];
                let n = rt.with_owner(owner, || {
                    rt.effect(
                        compute,
                        apply,
                        if render {
                            EffectKind::Render
                        } else {
                            EffectKind::User
                        },
                        Some(err),
                        defer,
                    )
                });
                nodes.borrow_mut().insert(id, n);
            }
            Op::Write { id, value } => rt.write(nodes.borrow()[&id], value),
            Op::Read { id, label } => {
                let value = observed(rt.read(nodes.borrow()[&id]));
                log.borrow_mut()
                    .push(json!(["read", label.unwrap_or(id), value]));
            }
            Op::Latest { id } => {
                let value = observed(rt.latest(nodes.borrow()[&id]));
                log.borrow_mut().push(json!(["latest", id, value]));
            }
            Op::Pending { id } => {
                let value = rt.is_pending(nodes.borrow()[&id]);
                log.borrow_mut().push(json!(["pending", id, value]));
            }
            Op::Flush => rt.flush(),
            Op::Refresh { id } => rt.refresh(nodes.borrow()[&id]),
            Op::Owner { id, parent } => {
                let parent = owners[parent.as_deref().unwrap_or("root")];
                owners.insert(id, rt.create_owner(Some(parent), None));
            }
            Op::Cleanup { owner, label } => {
                let l = log.clone();
                rt.with_owner(owners[&owner], || {
                    rt.on_cleanup(move || l.borrow_mut().push(json!(["cleanup", label])))
                });
            }
            Op::Dispose { owner } => rt.dispose(owners[&owner]),
            Op::Resolve { flight, value } => {
                rt.settle(flight, Ok(value));
                rt.drain()
            }
            Op::Reject { flight, message } => {
                rt.settle(flight, Err(ReadError::Failed(message)));
                rt.drain()
            }
            Op::Action { id, slices } => {
                let mut index = 0;
                let ns = nodes.clone();
                let a = rt.action(Box::new(move |rt, input| {
                    if let Err(e) = input {
                        return ActionStep::Fail(match e {
                            ReadError::Failed(e) => e,
                            _ => "pending".into(),
                        });
                    }
                    if index == slices.len() {
                        return ActionStep::Done;
                    }
                    let slice = &slices[index];
                    index += 1;
                    for w in &slice.writes {
                        rt.write(ns.borrow()[&w.id], w.value)
                    }
                    match &slice.flight {
                        Some(f) => ActionStep::Yield(f.clone()),
                        None => ActionStep::Done,
                    }
                }));
                actions.insert(a, id);
            }
        }
        for (a, r) in rt.take_action_results() {
            log.borrow_mut()
                .push(json!(["action", actions[&a], r.err()]));
        }
        for e in rt.take_errors() {
            log.borrow_mut().push(json!(["unhandled", e]));
        }
    }
    rt.dispose(root);
    let result = log.borrow().clone();
    result
}
fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }
        let result = std::panic::catch_unwind(|| {
            let ops: Vec<Op> = serde_json::from_str(&line).expect("valid op program");
            run(ops)
        });
        match result {
            Ok(log) => println!("{}", serde_json::to_string(&log).unwrap()),
            Err(_) => println!("{}", json!({"driver_error":"panic"})),
        }
    }
}
