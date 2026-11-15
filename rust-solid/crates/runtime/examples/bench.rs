// Scratch benchmark (not part of the repo): the same five workloads as the
// Exact bench, driven through App::mount / click / turn.
use rust_solid::plan_v2::{App, Plan};
use serde_json::{json, Value as J};
use std::time::Instant;

pub fn mount(p: Plan) -> Result<App, String> {
    if std::env::var("RS_LOG").is_ok() { App::mount(p) } else { App::mount_unlogged(p) }
}

const ROWS: usize = 1000;
const FAN: usize = 1000;

fn lit(v: J) -> J { json!({"op":"literal","value":v}) }
fn read(s: &str) -> J { json!({"op":"read","source":s}) }
fn local(s: &str) -> J { json!({"op":"local","name":s}) }
fn get(o: J, k: &str) -> J { json!({"op":"get","object":o,"key":k}) }
fn add(a: J, b: J) -> J { json!({"op":"add","left":a,"right":b}) }
fn text(v: J) -> J { json!({"kind":"text","value":v}) }
fn el(tag: &str, events: J, children: Vec<J>) -> J { json!({"kind":"element","tag":tag,"events":events,"children":children}) }
fn button(steps: J) -> J { el("button", json!([{"name":"onClick","steps":steps}]), vec![text(lit(json!("+")))]) }
fn write(s: &str, v: J) -> J { json!({"op":"write","source":s,"value":v}) }

fn rows_seed() -> J {
    let items: Vec<J> = (0..ROWS).map(|i| json!({"op":"object","fields":[
        {"key":"id","value":lit(json!(i))},
        {"key":"label","value":lit(json!(format!("row {i}")))},
        {"key":"even","value":lit(json!(i % 2 == 0))}]})).collect();
    json!({"op":"object","fields":[{"key":"list","value":{"op":"array","items":items}}]})
}

fn plan(sources: J, memos: J, markup: Vec<J>) -> Plan {
    serde_json::from_value(json!({"version":2,"component":"B","hosts":[],"sources":sources,"memos":memos,"actions":[],"markup":markup})).unwrap()
}

pub fn counter() -> Plan {
    plan(json!([{"name":"n","kind":"signal","seed":lit(json!(0))}]), json!([]),
        vec![el("div", json!([]), vec![button(json!([write("n", add(read("n"), lit(json!(1))))])), el("span", json!([]), vec![text(read("n"))])])])
}

pub fn fanout() -> Plan {
    let memos: Vec<J> = (0..FAN).map(|i| json!({"name":format!("d{i}"),"value":add(read("x"), lit(json!(i)))})).collect();
    let mut kids = vec![button(json!([write("x", add(read("x"), lit(json!(1))))]))];
    for i in 0..FAN { kids.push(el("span", json!([]), vec![text(read(&format!("d{i}")))])); }
    plan(json!([{"name":"x","kind":"signal","seed":lit(json!(0))}]), J::Array(memos), vec![el("div", json!([]), kids)])
}

pub fn select() -> Plan {
    let row = el("p", json!([]), vec![text(add(
        json!({"op":"cond","test":{"op":"eq","left":get(local("r"),"id"),"right":read("sel")},"then":lit(json!("> ")),"else":lit(json!(""))}),
        get(local("r"), "label")))]);
    plan(json!([{"name":"rows","kind":"store","seed":rows_seed()},{"name":"sel","kind":"signal","seed":lit(json!(-1))}]), json!([]),
        vec![el("div", json!([]), vec![button(json!([write("sel", add(read("sel"), lit(json!(1))))])),
            json!({"kind":"for","each":get(read("rows"),"list"),"item":"r","key":"identity","children":[row]})])])
}

pub fn filter() -> Plan {
    let visible = json!({"op":"filter","array":get(read("rows"),"list"),"param":"r","body":
        {"op":"or","left":{"op":"eq","left":read("mode"),"right":lit(json!("all"))},"right":get(local("r"),"even")}});
    let flip = write("mode", json!({"op":"cond","test":{"op":"eq","left":read("mode"),"right":lit(json!("all"))},"then":lit(json!("even")),"else":lit(json!("all"))}));
    plan(json!([{"name":"rows","kind":"store","seed":rows_seed()},{"name":"mode","kind":"signal","seed":lit(json!("all"))}]),
        json!([{"name":"visible","value":visible}]),
        vec![el("div", json!([]), vec![button(json!([flip])),
            json!({"kind":"for","each":read("visible"),"item":"r","key":"identity","children":[el("p", json!([]), vec![text(get(local("r"),"label"))])]})])])
}

fn run(name: &str, make: fn() -> Plan, n: usize, check: impl Fn(&str, usize) -> bool) {
    let mut best = f64::MAX;
    for _rep in 0..5 {
        let mut app = mount(make()).unwrap();
        app.turn();
        let b = app.clickables()[0].0;
        let t = Instant::now();
        for _ in 0..n { app.click(b).unwrap(); app.turn(); }
        let us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
        app.check().unwrap();
        assert!(check(&app.frame(), n), "{name}: wrong frame after {n} clicks");
        app.dispose();
        best = best.min(us);
    }
    println!("rust-solid {name:<10} {best:>10.2} us/click  (n={n}, best of 5)");
}

fn main() {
    run("counter", counter, 100_000, |f, n| f.ends_with(&n.to_string()));
    run("fanout", fanout, 2_000, |f, n| f.contains(&(n + FAN - 1).to_string()));
    run("select", select, 2_000, |f, n| f.contains(&format!("> row {}", (n - 1) % ROWS)) || n > ROWS);
    run("filter", filter, 1_000, |f, _| f.contains("row 1") );
    // mount: build a 1000-row list from nothing, then tear it down
    let mut best = f64::MAX;
    let p = select();
    for _ in 0..5 {
        let t = Instant::now();
        for _ in 0..100 { let mut a = mount(p.clone()).unwrap(); a.turn(); a.dispose(); }
        best = best.min(t.elapsed().as_secs_f64() * 1e6 / 100.0);
    }
    println!("rust-solid {:<10} {best:>10.2} us/mount  (1000 rows, plan prebuilt; mount+first flush+dispose, best of 5)", "mount");
}
