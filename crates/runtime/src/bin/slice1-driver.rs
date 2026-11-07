//! Existing signals fuzzer protocol, restricted to the slice-1 operation set.
//! Mirrors fuzz/solid.mjs operation by operation on the ported scheduler.
use rust_solid::slice1::{ActionBody, ActionStep, Resume, Runtime, EFFECT_RENDER, EFFECT_USER};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    io::{self, BufRead},
    rc::Rc,
};
type Log = Rc<RefCell<Vec<Value>>>;
type Names = Rc<BTreeMap<String, usize>>;
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn eval(rt: &mut Runtime, names: &BTreeMap<String, usize>, e: &Value) -> Result<i64, String> {
    if let Some(n) = e.as_i64() {
        return Ok(n);
    }
    match text(e, "op") {
        "read" => rt.read(names[text(e, "id")]),
        "add" => Ok(eval(rt, names, &e["a"])? + eval(rt, names, &e["b"])?),
        _ => panic!("unsupported subset expression"),
    }
}
/// The generated `function*(){ for (slice of slices) { writes; yield flight } }`.
struct Slices {
    slices: Vec<Value>,
    index: usize,
    sources: Rc<BTreeMap<String, (usize, bool)>>,
}
impl ActionBody for Slices {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
        if let Resume::Error(e) = input {
            // `it.throw(e)` at the yield: the body has no try/catch.
            return ActionStep::Throw(e);
        }
        while self.index < self.slices.len() {
            let slice = self.slices[self.index].clone();
            self.index += 1;
            for w in slice["writes"].as_array().into_iter().flatten() {
                let (id, opt) = self.sources[text(w, "id")];
                let v = w["value"].as_i64().unwrap();
                if opt {
                    rt.optimistic_write(id, v)
                } else {
                    rt.write(id, v)
                }
            }
            if let Some(f) = slice["flight"].as_str() {
                return ActionStep::Yield(f.into());
            }
        }
        ActionStep::Return
    }
}
fn observed(r: Result<i64, String>) -> Value {
    match r {
        Ok(v) => json!(v),
        Err(e) if e == "NotReadyError" => json!({"error": "pending"}),
        Err(e) => json!({ "error": e }),
    }
}
fn run(ops: Vec<Value>) -> Value {
    let mut rt = Runtime::default();
    let log: Log = Rc::new(RefCell::new(vec![]));
    let root = rt.create_root();
    let mut sources = BTreeMap::new();
    let mut names = BTreeMap::new();
    let mut action_names = BTreeMap::new();
    for op in ops {
        match text(&op, "op") {
            "signal" => {
                assert!(op["equals"].is_null() || op["equals"] == "default");
                let value = op["value"].as_i64().unwrap();
                let opt = op["optimistic"].as_bool().unwrap_or(false);
                let id = rt.with_owner(Some(root), |rt| {
                    if opt {
                        rt.optimistic_value(value)
                    } else {
                        rt.signal(value)
                    }
                });
                sources.insert(text(&op, "id").to_owned(), (id, opt));
                names.insert(text(&op, "id").to_owned(), id);
            }
            "memo" => {
                // Default equality, eager, no flight or loading value.
                assert!(op["equals"].is_null() && op["flight"].is_null() && op["lazy"] != true);
                let id = text(&op, "id").to_owned();
                let expr = op["expr"].clone();
                let ns: Names = Rc::new(names.clone());
                let compute_log = log.clone();
                let cid = id.clone();
                let compute = Rc::new(move |rt: &mut Runtime, p: Option<i64>| {
                    compute_log.borrow_mut().push(json!(["compute", cid, p]));
                    eval(rt, &ns, &expr)
                });
                let n = rt.with_owner(Some(root), |rt| rt.memo(compute));
                names.insert(id, n);
            }
            "effect" => {
                let id = text(&op, "id").to_owned();
                let expr = op["expr"].clone();
                let ns: Names = Rc::new(names.clone());
                let compute_log = log.clone();
                let cid = id.clone();
                let compute = Rc::new(move |rt: &mut Runtime, p: Option<i64>| {
                    compute_log.borrow_mut().push(json!(["compute", cid, p]));
                    eval(rt, &ns, &expr)
                });
                let effect_log = log.clone();
                let apply = Rc::new(
                    move |_: &mut Runtime,
                          v: i64,
                          p: Option<i64>|
                          -> Option<rust_solid::slice1::Cleanup> {
                        effect_log.borrow_mut().push(json!(["effect", id, v, p]));
                        let l = effect_log.clone();
                        let id = id.clone();
                        Some(Box::new(move |_: &mut Runtime| {
                            l.borrow_mut().push(json!(["effect_cleanup", id, v]))
                        }))
                    },
                );
                let ty = if op["render"] == true {
                    EFFECT_RENDER
                } else {
                    EFFECT_USER
                };
                let defer = op["defer"] == true;
                rt.with_owner(Some(root), |rt| rt.effect(compute, apply, ty, defer));
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
                let v = observed(rt.read(names[name]));
                log.borrow_mut()
                    .push(json!(["read", op["label"].as_str().unwrap_or(name), v]));
            }
            "flush" => rt.flush(),
            "action" => {
                let body = Slices {
                    slices: op["slices"].as_array().unwrap().clone(),
                    index: 0,
                    sources: Rc::new(sources.clone()),
                };
                let a = rt.action(Box::new(body));
                action_names.insert(a, text(&op, "id").to_owned());
            }
            "resolve" | "reject" => {
                let flight = text(&op, "flight");
                let result = if op["op"] == "resolve" {
                    Ok(op["value"].as_i64().unwrap())
                } else {
                    Err(text(&op, "message").to_owned())
                };
                rt.settle_flight(flight, result);
                // `await drain()`: the queued microtasks run in order, then `S.flush()`.
                let log = log.clone();
                rt.run_microtasks(&mut |a, r| {
                    let message = match r {
                        Ok(()) => Value::Null,
                        Err(e) => json!(e),
                    };
                    log.borrow_mut()
                        .push(json!(["action", action_names[&a], message]));
                });
                rt.flush();
            }
            _ => panic!("operation outside slice 1: {}", op),
        }
    }
    // `owners.get('root').dispose(); S.flush()`; the trace is frozen before
    // any unrequested continuation.
    rt.dispose_root(root);
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
