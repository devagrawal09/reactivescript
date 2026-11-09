//! Programs from the frontend's plan fuzz (`frontend/plan/fuzz/`,
//! `docs/plan-fuzz/README.md` here). Each fixture in `fixtures/plan-fuzz/`
//! holds one generated program's v2 plan, the scenario v2 recorded on native
//! Solid, and native Solid's full trace: the compiled TSX on
//! `@solidjs/universal` with the recording host. The Rust consumer must give
//! the same result and the same log, entry for entry. Nothing is filtered or
//! normalized. The fixtures are chosen to cover every plan node kind.
use rust_solid::scenario::trace_v2;
use serde_json::{json, Value as J};
use std::collections::BTreeSet;

fn corpus() -> Vec<(String, J)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/plan-fuzz");
    let mut out: Vec<(String, J)> = std::fs::read_dir(dir)
        .expect("the plan-fuzz corpus")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let text = std::fs::read_to_string(&p).unwrap();
            (
                p.file_name().unwrap().to_string_lossy().into_owned(),
                serde_json::from_str(&text).unwrap(),
            )
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[test]
fn generated_programs_give_native_solids_host_log() {
    let corpus = corpus();
    assert!(corpus.len() >= 8, "corpus of {} programs", corpus.len());
    for (name, f) in corpus {
        let plan = serde_json::from_value(f["plan"].clone()).unwrap();
        let scenario = serde_json::from_value(f["scenario"].clone()).unwrap();
        let (r, log) = trace_v2(plan, scenario);
        let result = match &r {
            Ok(frames) => json!({ "frames": frames }),
            Err(e) => json!({ "error": e }),
        };
        let native = &f["native"];
        assert_eq!(result, native["result"], "{name}: result");
        let expected = native["log"].as_array().unwrap();
        for (i, (a, b)) in log.iter().zip(expected).enumerate() {
            assert_eq!(a, b, "{name}: log entry {i}");
        }
        assert_eq!(log.len(), expected.len(), "{name}: log length");
    }
}

/// Every op, step, view and source kind of the schema occurs in the corpus.
#[test]
fn the_corpus_covers_every_plan_node_kind() {
    let mut seen = BTreeSet::new();
    fn walk(v: &J, ctx: &str, seen: &mut BTreeSet<String>) {
        match v {
            J::Array(xs) => xs.iter().for_each(|x| walk(x, ctx, seen)),
            J::Object(o) => {
                if ctx == "view" {
                    if let Some(k) = o.get("kind").and_then(J::as_str) {
                        let text = match (k, o.get("value").and_then(|v| v.get("op"))) {
                            ("text", Some(op)) if op == "literal" => ":static",
                            ("text", _) => ":dynamic",
                            _ => "",
                        };
                        seen.insert(format!("view:{k}{text}"));
                    }
                } else if let Some(op) = o.get("op").and_then(J::as_str) {
                    let variant = match (ctx, op) {
                        ("step", "write") if o.contains_key("path") => ":path",
                        ("step", "write") => ":signal",
                        ("step", "optimistic") if o.contains_key("updater") => ":updater",
                        ("step", "optimistic") => ":value",
                        _ => "",
                    };
                    seen.insert(format!("{ctx}:{op}{variant}"));
                }
                for (k, x) in o {
                    let next = match (ctx, k.as_str()) {
                        (_, "steps" | "catch") => "step",
                        ("step", "body") => "step",
                        ("view", "children" | "fallback") => "view",
                        ("view", "events") => "view-events",
                        ("view-events", _) => "step",
                        ("view" | "step", _) => "expr",
                        (c, _) => c,
                    };
                    walk(x, next, seen);
                }
            }
            _ => {}
        }
    }
    for (_, f) in corpus() {
        let p = &f["plan"];
        for s in p["sources"].as_array().unwrap() {
            seen.insert(format!("source:{}", s["kind"].as_str().unwrap()));
            walk(&s["seed"], "expr", &mut seen);
        }
        for m in p["memos"].as_array().unwrap() {
            walk(&m["value"], "expr", &mut seen);
        }
        for a in p["actions"].as_array().unwrap() {
            walk(&a["steps"], "step", &mut seen);
        }
        walk(&p["markup"], "view", &mut seen);
    }
    let want = [
        "expr:literal",
        "expr:array",
        "expr:object",
        "expr:read",
        "expr:local",
        "expr:get",
        "expr:length",
        "expr:filter",
        "expr:map",
        "expr:findIndex",
        "expr:add",
        "expr:eq",
        "expr:ne",
        "expr:lt",
        "expr:le",
        "expr:gt",
        "expr:ge",
        "expr:and",
        "expr:or",
        "expr:not",
        "expr:cond",
        "step:write:signal",
        "step:write:path",
        "step:optimistic:updater",
        "step:optimistic:value",
        "step:await",
        "step:try",
        "step:call",
        "view:element",
        "view:text:static",
        "view:text:dynamic",
        "view:show",
        "view:for",
        "source:signal",
        "source:store",
        "source:optimistic",
    ];
    let missing: Vec<_> = want.iter().filter(|k| !seen.contains(**k)).collect();
    assert!(missing.is_empty(), "missing {missing:?} in {seen:?}");
}
