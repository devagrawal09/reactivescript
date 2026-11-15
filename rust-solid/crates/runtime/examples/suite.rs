// The benchmark suite's Rust driver: runs one workload file (bench/workloads.mjs) on rust-solid.
//   cargo run --release --example suite -- WORKLOAD.json [wall|ir]
// wall: 7 samples, prints median and min µs per op. ir: one sample of `reps` ops, for callgrind with
//   --collect-atstart=no --toggle-collect='*timed_ops*' (instructions inside the timed region only).
// Every run prints the final frame's hash, which the Solid JS driver must match.
use rust_solid::plan_v2::{App, HostType, Plan};
use rust_solid::slice1::{from_json, JsObj, Key, Runtime, Value};
use serde_json::Value as J;
use std::rc::Rc;
use std::time::Instant;

struct W {
    plan: Plan,
    reps: usize,
    fresh: bool,
    manual: bool,
    init: Vec<J>,
    op: Vec<J>,
    returns: Vec<(String, HostType)>,
}

/// jfb's buildData labels: a hash of the id, so both runtimes build the same table.
fn label(id: u64) -> String {
    const ADJ: [&str; 25] = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
        "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important",
        "inexpensive", "cheap", "expensive", "fancy"];
    const COLOUR: [&str; 11] = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
    const NOUN: [&str; 13] = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger",
        "pizza", "mouse", "keyboard"];
    let h = id.wrapping_mul(2654435761) & 0xffff_ffff;
    format!("{} {} {}", ADJ[(h % 25) as usize], COLOUR[((h / 25) % 11) as usize], NOUN[((h / 275) % 13) as usize])
}

struct Run {
    app: Option<App>,
    next: u64,
    /// trace mode: the host log on, three turns per step (as the plan oracle settles), step entries logged.
    trace: bool,
    index: usize,
    log: Vec<J>,
}

fn rows(next: &mut u64, n: usize) -> Value {
    Value::Obj(JsObj::new_array((0..n).map(|_| {
        let id = *next;
        *next += 1;
        Value::Obj(JsObj::new_object(vec![(Rc::from("id"), Value::Int(id as i64)), (Rc::from("label"), Value::str(&label(id)))]))
    }).collect()))
}
fn int(v: Value) -> i64 {
    match v { Value::Int(n) => n, o => panic!("not an int: {o:?}") }
}

impl Run {
    fn app(&mut self) -> &mut App { self.app.as_mut().expect("mounted") }
    fn step(&mut self, w: &W, s: &J) {
        match s["t"].as_str().unwrap() {
            "mount" => { self.app = Some(self.mount(w)); }
            "dispose" => { self.app().dispose(); self.take_log(); self.app = None; return; }
            "click" => {
                let i = s["i"].as_u64().unwrap() as usize;
                let node = { let h = self.app().host.borrow(); h.nth_handler(h.root(), "click", i) }.expect("no such clickable");
                if let Err(e) = self.app().click(node) { panic!("click {i}: {e}") }
            }
            "resolve" => {
                let host = s["host"].as_str().unwrap();
                let r = self.app().requests().into_iter().find(|r| r.pending && r.host == host).expect("a pending request");
                let ty = &w.returns.iter().find(|(h, _)| h == host).unwrap().1;
                let v = ty.value_of(&s["value"]).unwrap_or_else(|_| from_json(&s["value"]));
                self.app().settle(host, r.number, Ok(v)).unwrap();
            }
            "jfb" => {
                let op = s["op"].as_str().unwrap();
                let mut next = self.next;
                let app = self.app();
                let mut f: Box<dyn FnMut(&mut Runtime, Value) -> Result<(), rust_solid::slice1::Error>> = match op {
                    "run" | "runlots" => {
                        let list = rows(&mut next, if op == "run" { 1000 } else { 10_000 });
                        Box::new(move |rt, d| rt.js_set(&d, &Key::name("list"), list.clone()))
                    }
                    "add" => {
                        let more = rows(&mut next, 1000);
                        Box::new(move |rt, d| {
                            let list = rt.js_get(&d, &Key::name("list"))?;
                            let len = int(rt.js_get(&list, &Key::name("length"))?) as u32;
                            let more = more.clone();
                            for i in 0..1000u32 {
                                let r = rt.js_get(&more, &Key::Idx(i))?;
                                rt.js_set(&list, &Key::Idx(len + i), r)?;
                            }
                            Ok(())
                        })
                    }
                    "update" => Box::new(|rt, d| {
                        let list = rt.js_get(&d, &Key::name("list"))?;
                        let len = int(rt.js_get(&list, &Key::name("length"))?) as u32;
                        for i in (0..len).step_by(10) {
                            let r = rt.js_get(&list, &Key::Idx(i))?;
                            let l = rt.js_get(&r, &Key::name("label"))?.to_js_string().unwrap_or_default();
                            rt.js_set(&r, &Key::name("label"), Value::str(&(l + " !!!")))?;
                        }
                        Ok(())
                    }),
                    "clear" => Box::new(|rt, d| rt.js_set(&d, &Key::name("list"), Value::Obj(JsObj::new_array(vec![])))),
                    "swap" => Box::new(|rt, d| {
                        let list = rt.js_get(&d, &Key::name("list"))?;
                        if int(rt.js_get(&list, &Key::name("length"))?) > 998 {
                            let a = rt.js_get(&list, &Key::Idx(1))?;
                            let b = rt.js_get(&list, &Key::Idx(998))?;
                            rt.js_set(&list, &Key::Idx(1), b)?;
                            rt.js_set(&list, &Key::Idx(998), a)?;
                        }
                        Ok(())
                    }),
                    o => panic!("unknown jfb op {o}"),
                };
                app.store_set("rows", &mut *f).unwrap();
                self.next = next;
            }
            t => panic!("unknown step {t}"),
        }
        let trace = self.trace;
        let index = self.index;
        let app = self.app();
        for _ in 0..if trace { 3 } else { 1 } { app.turn(); }
        app.check().unwrap();
        if trace {
            let h = app.host.borrow();
            h.push_log(serde_json::json!(["step", index, s["t"]]));
            h.push_log(serde_json::json!(["tree", h.tree(h.root())]));
            h.push_log(serde_json::json!(["frame", app.frame()]));
            drop(h);
            self.index += 1;
        }
    }
    fn mount(&self, w: &W) -> App {
        if self.trace { App::mount(w.plan.clone()).unwrap() } else { App::mount_unlogged(w.plan.clone()).unwrap() }
    }
    fn take_log(&mut self) {
        if self.trace { let l = self.app().host.borrow_mut().take_log(); self.log = l; }
    }
}

#[inline(never)]
fn timed_ops(r: &mut Run, w: &W, n: usize) {
    for _ in 0..n {
        for s in &w.op {
            r.step(w, s);
        }
    }
}

/// One sample: µs per op, and the final frame.
fn sample(w: &W, trace: bool) -> (f64, String, Vec<J>) {
    let fresh_run = || Run { app: None, next: 1, trace, index: 0, log: vec![] };
    let mut r = fresh_run();
    let start = |r: &mut Run| {
        if !w.manual {
            r.app = Some(r.mount(w));
            for _ in 0..if trace { 3 } else { 1 } { r.app().turn(); }
        }
        for s in &w.init { r.step(w, s); }
    };
    if w.fresh {
        let mut total = 0.0;
        let mut frame = String::new();
        for _ in 0..w.reps {
            r = fresh_run();
            start(&mut r);
            let t = Instant::now();
            timed_ops(&mut r, w, 1);
            total += t.elapsed().as_secs_f64();
            if r.app.is_some() { frame = r.app().frame(); r.app().dispose(); r.take_log(); }
        }
        return (total * 1e6 / w.reps as f64, frame, r.log);
    }
    start(&mut r);
    let t = Instant::now();
    timed_ops(&mut r, w, w.reps);
    let us = t.elapsed().as_secs_f64() * 1e6 / w.reps as f64;
    let frame = r.app().frame();
    r.app().dispose();
    r.take_log();
    (us, frame, r.log)
}

fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let j: J = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let plan: Plan = serde_json::from_value(j["plan"].clone()).unwrap();
    let returns = j["plan"]["hosts"].as_array().unwrap().iter()
        .map(|h| (h["name"].as_str().unwrap().to_string(), HostType::parse(h["returns"].as_str().unwrap()).unwrap())).collect();
    let mut w = W {
        plan,
        reps: j["reps"].as_u64().unwrap() as usize,
        fresh: j["fresh"].as_bool().unwrap_or(false),
        manual: j["mount"].as_str() == Some("manual"),
        init: j["init"].as_array().cloned().unwrap_or_default(),
        op: j["op"].as_array().unwrap().clone(),
        returns,
    };
    if let Some(r) = std::env::var("REPS").ok().and_then(|v| v.parse().ok()) { w.reps = r; }
    let name = j["name"].as_str().unwrap();
    let mode = args.get(2).map(|s| s.as_str()).unwrap_or("wall");
    if mode == "trace" {
        let (_, frame, log) = sample(&w, true);
        println!("{}", serde_json::json!({"frame": format!("{:016x}", fnv(&frame)), "log": log}));
        return;
    }
    if mode == "ir" {
        let (_, frame, _) = sample(&w, false);
        println!("{{\"name\":\"{name}\",\"reps\":{},\"frame\":\"{:016x}\"}}", w.reps, fnv(&frame));
        return;
    }
    let mut us = vec![];
    let mut frame = String::new();
    for _ in 0..7 { let (u, f, _) = sample(&w, false); us.push(u); frame = f; }
    us.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{{\"name\":\"{name}\",\"runtime\":\"rust-solid\",\"med\":{:.3},\"min\":{:.3},\"frame\":\"{:016x}\",\"len\":{}}}", us[3], us[0], fnv(&frame), frame.len());
}
