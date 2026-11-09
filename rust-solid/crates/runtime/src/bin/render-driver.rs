//! The renderer differential adapter (`node fuzz/run.mjs --render`): runs a
//! render program (docs/RENDERER.md, "Program language") on the ported
//! `@solidjs/universal` (`slice1::Universal`) over the ported runtime, with
//! the recording host `renderer::TreeRenderer`, and prints the host's log.
//! Mirrors fuzz/universal.mjs expression by expression: the same
//! evaluations in the same places (getters read where Solid reads the
//! prop), so the same host calls in the same order.
use rust_solid::renderer::TreeRenderer;
use rust_solid::slice1::{
    BodyFn, Error, ForProps, Getter, InsertOptions, JsObj, Key, Marker, NodeId, Out, Runtime,
    ShowProps, Universal, Value, ValueEffectFn,
};
use serde_json::{json, Value as J};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    io::{self, BufRead},
    rc::Rc,
};

struct Ctx {
    u: Universal<TreeRenderer>,
    signals: RefCell<HashMap<String, NodeId>>,
    rows: RefCell<BTreeMap<i64, Value>>,
}
type C = Rc<Ctx>;

/// The expression context: a Show function child's argument, a For row's
/// item and index (`{...cx, sarg}` / `{...cx, item, index}`).
#[derive(Clone, Default)]
struct Cx {
    sarg: Option<Value>,
    item: Option<Value>,
    index: Option<Value>,
    /// `let` bindings (`{...cx.vars, [id]: value}`).
    vars: Rc<Vec<(String, Value)>>,
}

fn log(c: &Ctx, e: J) {
    c.u.host().borrow().push_log(e);
}

/// `data(d)`: a JSON datum as a JS value; `{row: k}` is the program's row
/// object `k` (one identity per program).
fn data(c: &Ctx, d: &J) -> Value {
    match d {
        J::Null => Value::Undef,
        J::Bool(b) => Value::Bool(*b),
        J::Number(n) => Value::Int(n.as_i64().expect("an integer datum")),
        J::String(s) => Value::str(s),
        J::Array(a) => Value::Obj(JsObj::new_array(a.iter().map(|x| data(c, x)).collect())),
        J::Object(o) => {
            let k = o["row"].as_i64().expect("a row datum");
            c.rows
                .borrow_mut()
                .entry(k)
                .or_insert_with(|| {
                    Value::Obj(JsObj::new_object(vec![
                        ("id".into(), Value::Int(k)),
                        ("label".into(), Value::str(&format!("r{k}"))),
                    ]))
                })
                .clone()
        }
    }
}

/// `typeof v === "function" ? v() : v`.
fn call(rt: &mut Runtime, v: &Option<Value>) -> Result<Value, Error> {
    match v {
        Some(f @ Value::Func(_)) => rt.call(f, &[]),
        Some(v) => Ok(v.clone()),
        None => Ok(Value::Undef),
    }
}

fn getter(c: &C, x: &J, cx: &Cx) -> Getter {
    let (c, x, cx) = (c.clone(), x.clone(), cx.clone());
    Rc::new(move |rt: &mut Runtime| ev(rt, &c, &x, &cx))
}

fn ev(rt: &mut Runtime, c: &C, x: &J, cx: &Cx) -> Result<Value, Error> {
    let o = match x {
        J::Null => return Ok(Value::Undef),
        J::Object(o) => o,
        J::Array(_) => panic!("a bare array expression"),
        _ => return Ok(data(c, x)),
    };
    match o["x"].as_str().unwrap() {
        "read" => {
            let n = c.signals.borrow()[o["id"].as_str().unwrap()];
            rt.read_value(n)
        }
        "cat" => {
            let a = ev(rt, c, &o["a"], cx)?;
            let b = ev(rt, c, &o["b"], cx)?;
            Ok(a.js_add(&b)
                .unwrap_or_else(|| panic!("`{a:?} + {b:?}` is outside the value domain")))
        }
        "not" => Ok(Value::Bool(!ev(rt, c, &o["a"], cx)?.truthy())),
        "cond" => {
            if ev(rt, c, &o["test"], cx)?.truthy() {
                ev(rt, c, &o["yes"], cx)
            } else {
                ev(rt, c, &o["no"], cx)
            }
        }
        "arr" => {
            let mut items = vec![];
            for i in o["items"].as_array().unwrap() {
                items.push(ev(rt, c, i, cx)?);
            }
            Ok(Value::Obj(JsObj::new_array(items)))
        }
        "fn" => {
            let g = getter(c, &o["body"], cx);
            Ok(rt.function(0, Rc::new(move |rt: &mut Runtime, _| g(rt))))
        }
        "memo" => {
            let g = getter(c, &o["body"], cx);
            Ok(c.u.memo(rt, g))
        }
        "cmemo" => {
            let t = getter(c, &o["test"], cx);
            let m = c.u.memo(
                rt,
                Rc::new(move |rt: &mut Runtime| Ok(Value::Bool(t(rt)?.truthy()))),
            );
            let (yes, no) = (getter(c, &o["yes"], cx), getter(c, &o["no"], cx));
            Ok(rt.function(
                0,
                Rc::new(move |rt: &mut Runtime, _| {
                    if rt.call(&m, &[])?.truthy() {
                        yes(rt)
                    } else {
                        no(rt)
                    }
                }),
            ))
        }
        "el" => element(rt, c, x, cx),
        "comp" => {
            let g = getter(c, &o["body"], cx);
            rt.create_component(g)
        }
        "show" => {
            let children: Getter = if o.get("fn") == Some(&J::Bool(true)) {
                let (c2, kids, cx2) = (c.clone(), o["kids"].clone(), cx.clone());
                Rc::new(move |rt: &mut Runtime| {
                    let (c3, kids, cx3) = (c2.clone(), kids.clone(), cx2.clone());
                    Ok(rt.function(
                        1,
                        Rc::new(move |rt: &mut Runtime, args: &[Value]| {
                            let cx = Cx {
                                sarg: Some(args.first().cloned().unwrap_or(Value::Undef)),
                                ..cx3.clone()
                            };
                            ev(rt, &c3, &kids, &cx)
                        }),
                    ))
                })
            } else {
                getter(c, &o["kids"], cx)
            };
            let props = ShowProps {
                when: getter(c, &o["when"], cx),
                keyed: o.get("keyed").map(|k| data(c, k)).unwrap_or(Value::Undef),
                children,
                fallback: o.get("fallback").map(|f| getter(c, f, cx)),
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                Ok(rt.show_component(props.clone()))
            }))
        }
        "sarg" => call(rt, &cx.sarg),
        "for" => {
            let arity = if o["arity"] == 2 { 2 } else { 1 };
            let (c2, kids, cx2) = (c.clone(), o["kids"].clone(), cx.clone());
            let f = rt.function(
                arity,
                Rc::new(move |rt: &mut Runtime, args: &[Value]| {
                    let cx = Cx {
                        item: Some(args.first().cloned().unwrap_or(Value::Undef)),
                        index: if arity == 2 {
                            Some(args.get(1).cloned().unwrap_or(Value::Undef))
                        } else {
                            cx2.index.clone()
                        },
                        ..cx2.clone()
                    };
                    ev(rt, &c2, &kids, &cx)
                }),
            );
            let keyed = match o.get("keyed") {
                None => Value::Undef,
                Some(J::String(s)) if s == "id" => rt.function(
                    1,
                    Rc::new(|rt: &mut Runtime, args: &[Value]| {
                        rt.js_get(&args[0], &Key::name("id"))
                    }),
                ),
                Some(k) => data(c, k),
            };
            let props = ForProps {
                each: getter(c, &o["each"], cx),
                keyed,
                children: Rc::new(move |_| Ok(f.clone())),
                fallback: o.get("fallback").map(|f| getter(c, f, cx)),
            };
            rt.create_component(Rc::new(move |rt: &mut Runtime| {
                Ok(rt.for_component(props.clone()))
            }))
        }
        "let" => {
            let v = ev(rt, c, &o["v"], cx)?;
            let mut vars = (*cx.vars).clone();
            let id = o["id"].as_str().unwrap().to_owned();
            vars.retain(|(k, _)| *k != id);
            vars.push((id, v));
            let cx = Cx {
                vars: Rc::new(vars),
                ..cx.clone()
            };
            ev(rt, c, &o["body"], &cx)
        }
        "var" => {
            let id = o["id"].as_str().unwrap();
            Ok(cx
                .vars
                .iter()
                .find(|(k, _)| k == id)
                .map(|(_, v)| v.clone())
                .unwrap_or(Value::Undef))
        }
        "item" => call(rt, &cx.item),
        "index" => call(rt, &cx.index),
        "field" => {
            let v = ev(rt, c, &o["of"], cx)?;
            rt.js_get(&v, &Key::name(o["key"].as_str().unwrap()))
        }
        "handler" => {
            let h = x.clone();
            let c2 = c.clone();
            let f = rt.function(
                2,
                Rc::new(move |rt: &mut Runtime, args: &[Value]| {
                    let n = args.len();
                    let e = if n == 2 { &args[1] } else { &args[0] };
                    let ty = rt.js_get(e, &Key::name("type"))?;
                    let ct = rt.js_get(e, &Key::name("currentTarget"))?;
                    let target = rt.js_get(e, &Key::name("target"))?;
                    let id = |v: &Value| match v {
                        Value::Node(n) => json!(n),
                        _ => J::Null,
                    };
                    let host = c2.u.host().clone();
                    let d = if n == 2 {
                        host.borrow().enc(&args[0])
                    } else {
                        J::Null
                    };
                    host.borrow().push_log(json!([
                        "handler",
                        h["id"],
                        n,
                        d,
                        ty.as_str().unwrap(),
                        id(&ct),
                        id(&target)
                    ]));
                    if h["stop"] == true {
                        rt.js_set(e, &Key::name("cancelBubble"), Value::Bool(true))?;
                    }
                    if let Some(w) = h.get("write") {
                        let s = c2.signals.borrow()[w["id"].as_str().unwrap()];
                        let v = data(&c2, &w["value"]);
                        rt.write_value(s, v);
                    }
                    Ok(Value::Undef)
                }),
            );
            Ok(match o.get("data") {
                Some(d) => Value::Obj(JsObj::new_array(vec![f, data(c, d)])),
                None => f,
            })
        }
        other => panic!("bad expression {other}"),
    }
}

/// The compiled-JSX shape of fuzz/universal.mjs `element`.
fn element(rt: &mut Runtime, c: &C, x: &J, cx: &Cx) -> Result<Value, Error> {
    let el = c.u.create_element(x["tag"].as_str().unwrap());
    let empty = vec![];
    let kids = x["kids"].as_array().unwrap_or(&empty);
    let mut st: Vec<Option<usize>> = vec![];
    for k in kids {
        match k["k"].as_str().unwrap() {
            "text" => {
                let t = c.u.create_text(&data(c, &k["v"]));
                c.u.append(el, t, None);
                st.push(Some(t));
            }
            "el" => {
                let n = match ev(rt, c, &k["el"], cx)? {
                    Value::Node(n) => n,
                    other => panic!("a static child {other:?} is not a node"),
                };
                c.u.append(el, n, None);
                st.push(Some(n));
            }
            _ => st.push(None),
        }
    }
    for p in x["props"].as_array().unwrap_or(&empty) {
        let name = p["name"].as_str().unwrap().to_owned();
        if p["dyn"] == true {
            let g = getter(c, &p["v"], cx);
            let compute: BodyFn = Rc::new(move |rt: &mut Runtime, _| g(rt).map(Out::Value));
            let u = c.u.clone();
            let apply: ValueEffectFn = Rc::new(move |_rt: &mut Runtime, v: Value, prev: Value| {
                u.set_prop(el, &name, &v, &prev);
                None
            });
            c.u.effect(rt, compute, apply, false);
        } else {
            let v = ev(rt, c, &p["v"], cx)?;
            c.u.set_prop(el, &name, &v, &Value::Undef);
        }
    }
    for (i, k) in kids.iter().enumerate() {
        if k["k"] != "ins" {
            continue;
        }
        let mut m = Marker::Null;
        if let Some(n) = st.iter().skip(i + 1).flatten().next() {
            m = Marker::Node(*n);
        }
        if kids.len() == 1 {
            m = Marker::Undefined;
        }
        let acc = if k["fn"] == true {
            let g = getter(c, &k["x"], cx);
            rt.function(0, Rc::new(move |rt: &mut Runtime, _| g(rt)))
        } else {
            ev(rt, c, &k["x"], cx)?
        };
        c.u.insert(rt, el, acc, m, None, InsertOptions::default())?;
    }
    Ok(Value::Node(el))
}

fn run(ops: &[J]) -> Vec<J> {
    let mut rt = Runtime::default();
    let host = Rc::new(RefCell::new(TreeRenderer::new()));
    host.borrow_mut().register_delegated_root(0);
    let c: C = Rc::new(Ctx {
        u: Universal::new(host.clone()),
        signals: RefCell::new(HashMap::new()),
        rows: RefCell::new(BTreeMap::new()),
    });
    let mut disposer = None;
    for o in ops {
        let r: Result<(), Error> = (|| {
            match o["op"].as_str().unwrap() {
                "signal" => {
                    let v = data(&c, &o["value"]);
                    let n = rt.signal_value(v);
                    c.signals
                        .borrow_mut()
                        .insert(o["id"].as_str().unwrap().to_owned(), n);
                }
                "render" => {
                    assert!(disposer.is_none(), "render twice");
                    let g = getter(&c, &o["view"], &Cx::default());
                    disposer = Some(c.u.render(&mut rt, g, 0)?);
                }
                "write" => {
                    let n = c.signals.borrow()[o["id"].as_str().unwrap()];
                    rt.write_value(n, data(&c, &o["value"]));
                }
                "flush" => rt.flush(),
                "dispatch" => {
                    let n = o["node"].as_u64().unwrap() as usize;
                    let ty = o["type"].as_str().unwrap();
                    let exists = n < host.borrow().len();
                    log(&c, json!(["dispatch", n, ty, exists as i64]));
                    if exists {
                        TreeRenderer::dispatch(&mut rt, &host, n, ty)?;
                    }
                }
                "dispose" => {
                    if let Some(mut d) = disposer.take() {
                        d.dispose(&mut rt);
                    }
                }
                other => panic!("unknown op {other}"),
            }
            Ok(())
        })();
        if let Err(e) = r {
            log(&c, json!(["error", e.message()]));
            break;
        }
        let errors = rt.take_errors();
        if !errors.is_empty() {
            log(&c, json!(["error", errors]));
            break;
        }
        let t = host.borrow().tree(0);
        log(&c, json!(["tree", t]));
    }
    let log = host.borrow_mut().take_log();
    log
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }
        let ops: Vec<J> = serde_json::from_str(&line).unwrap();
        let out = run(&ops);
        println!("{}", serde_json::to_string(&out).unwrap());
    }
}
