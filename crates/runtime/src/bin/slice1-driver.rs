//! Existing signals fuzzer protocol, restricted to the slice-1 operation set.
use rust_solid::{slice1::Runtime, Computation, EffectKind, ReadError};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    io::{self, BufRead},
    rc::Rc,
};
type Log = Rc<RefCell<Vec<Value>>>;
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn eval(
    g: &rust_solid::Runtime<i64>,
    names: &BTreeMap<String, usize>,
    e: &Value,
) -> Result<i64, ReadError> {
    if let Some(n) = e.as_i64() {
        return Ok(n);
    }
    match text(e, "op") {
        "read" => g.read(names[text(e, "id")]),
        "add" => Ok(eval(g, names, &e["a"])? + eval(g, names, &e["b"])?),
        _ => panic!("unsupported subset expression"),
    }
}
struct Action {
    tx: usize,
    slices: Vec<Value>,
    index: usize,
    flight: Option<String>,
    done: bool,
}
fn advance(rt: &Runtime, sources: &BTreeMap<String, (usize, bool)>, a: &mut Action) -> bool {
    while a.index < a.slices.len() {
        let slice = &a.slices[a.index];
        a.index += 1;
        for w in slice["writes"].as_array().into_iter().flatten() {
            let (id, opt) = sources[text(w, "id")];
            let v = w["value"].as_i64().unwrap();
            if opt {
                rt.optimistic_write(id, v)
            } else {
                rt.write(id, v)
            }
        }
        if let Some(f) = slice["flight"].as_str() {
            a.flight = Some(f.into());
            return false;
        }
    }
    a.done = true;
    rt.finish_action(a.tx);
    true
}
fn run(ops: Vec<Value>) -> Value {
    let rt = Runtime::default();
    let log: Log = Rc::new(RefCell::new(vec![]));
    let root = rt.graph.create_owner(None, None);
    let mut sources = BTreeMap::new();
    let mut names = BTreeMap::new();
    let mut actions = BTreeMap::<String, Action>::new();
    let mut completions = Vec::new();
    for op in ops {
        match text(&op, "op") {
            "signal" => {
                assert!(op["equals"].is_null() || op["equals"] == "default");
                let value = op["value"].as_i64().unwrap();
                let opt = op["optimistic"].as_bool().unwrap_or(false);
                let id = rt.graph.with_owner(root, || {
                    if opt {
                        rt.optimistic_value(value)
                    } else {
                        rt.signal(value)
                    }
                });
                sources.insert(text(&op, "id").to_owned(), (id, opt));
                names.insert(text(&op, "id").to_owned(), rt.node(id));
            }
            "effect" => {
                let id = text(&op, "id").to_owned();
                let expr = op["expr"].clone();
                let ns = names.clone();
                let compute_log = log.clone();
                let cid = id.clone();
                let compute = Rc::new(move |g: &rust_solid::Runtime<i64>, p: Option<i64>| {
                    compute_log.borrow_mut().push(json!(["compute", cid, p]));
                    eval(g, &ns, &expr).map(Computation::Ready)
                });
                let effect_log = log.clone();
                let apply = Rc::new(
                    move |v: i64, p: Option<i64>| -> Option<rust_solid::Cleanup> {
                        effect_log.borrow_mut().push(json!(["effect", id, v, p]));
                        let l = effect_log.clone();
                        let id = id.clone();
                        Some(Box::new(move || {
                            l.borrow_mut().push(json!(["effect_cleanup", id, v]))
                        }))
                    },
                );
                let kind = if op["render"] == true {
                    EffectKind::Render
                } else {
                    EffectKind::User
                };
                rt.graph.with_owner(root, || {
                    rt.graph
                        .effect(compute, apply, kind, None, op["defer"] == true)
                });
            }
            "write" => {
                let (id, opt) = sources[text(&op, "id")];
                let v = op["value"].as_i64().unwrap();
                if opt {
                    rt.optimistic_write(id, v)
                } else {
                    rt.write(id, v)
                }
            }
            "read" => {
                let name = text(&op, "id");
                let v = rt.read(sources[name].0).unwrap();
                log.borrow_mut()
                    .push(json!(["read", op["label"].as_str().unwrap_or(name), v]));
            }
            "flush" => rt.flush(),
            "action" => {
                let tx = rt.begin_action();
                let id = text(&op, "id").to_owned();
                let mut a = Action {
                    tx,
                    slices: op["slices"].as_array().unwrap().clone(),
                    index: 0,
                    flight: None,
                    done: false,
                };
                if advance(&rt, &sources, &mut a) {
                    completions.push(json!(["action", id, null]))
                }
                actions.insert(id, a);
            }
            "resolve" | "reject" => {
                // Native microtasks flush the starting slice before resuming the generator.
                rt.flush();
                let flight = text(&op, "flight");
                for (id, a) in &mut actions {
                    if !a.done && a.flight.as_deref() == Some(flight) {
                        a.flight = None;
                        rt.join_future(a.tx);
                        if op["op"] == "reject" {
                            a.done = true;
                            rt.finish_action(a.tx);
                            completions.push(json!(["action", id, op["message"]]));
                        } else if advance(&rt, &sources, a) {
                            completions.push(json!(["action", id, null]));
                        }
                        rt.flush();
                    }
                }
                log.borrow_mut().extend(std::mem::take(&mut completions));
                rt.flush();
            }
            _ => panic!("operation outside slice 1: {}", op),
        }
    }
    rt.graph.dispose(root);
    rt.flush();
    let result = log.borrow().clone();
    json!(result)
}
fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let result = std::panic::catch_unwind(|| run(serde_json::from_str(&line).unwrap()))
            .unwrap_or_else(|_| json!({"driver_error":"panic"}));
        println!("{}", result);
    }
}
