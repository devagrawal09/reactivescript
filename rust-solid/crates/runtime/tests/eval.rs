//! The live evaluator (`frontend/docs/EVAL.md`) on the Rust consumer.
//! The Rust side has no frontend: the host gives it a table of compiled
//! plans (or refusals), one per eval request, and an eval site looks its
//! code up there. Each fixture in `fixtures/eval/` holds an enclosing plan
//! with eval sites, a scenario recorded on native Solid running the static
//! twin (every code string written statically as a native component, each
//! site the keyed Show createEval is specified as), the host's eval table
//! and that native trace. The Rust consumer must give the same result and the
//! same log, entry for entry. `slice.json` is the eval slice (code strings
//! that change over time, a value eval, a TSX-syntax site with a renamed
//! binding); `seed-*.json` are eval fuzz programs, one of them refused.
use rust_solid::plan_v2::{validate, validate_table, App, EvalTable, Plan};
use rust_solid::scenario::trace_v2_with;
use serde_json::{json, Value as J};
use std::collections::BTreeSet;

fn fixtures() -> Vec<(String, J)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/eval");
    let mut out: Vec<(String, J)> = std::fs::read_dir(dir)
        .expect("the eval fixtures")
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

fn run(f: &J) -> (J, Vec<J>) {
    let plan = serde_json::from_value(f["plan"].clone()).unwrap();
    let scenario = serde_json::from_value(f["scenario"].clone()).unwrap();
    let evals = serde_json::from_value(f["evals"].clone()).unwrap();
    let (r, log) = trace_v2_with(plan, scenario, evals);
    let result = match &r {
        Ok(frames) => json!({ "frames": frames }),
        Err(e) => json!({ "error": e }),
    };
    (result, log)
}

#[test]
fn evaluated_code_gives_the_static_twins_host_log() {
    let fixtures = fixtures();
    assert!(fixtures.iter().any(|(n, _)| n == "slice.json"));
    assert!(fixtures.len() >= 6, "{} fixtures", fixtures.len());
    for (name, f) in fixtures.iter().filter(|(_, f)| f["status"] != "refused") {
        let (result, log) = run(f);
        let native = &f["trace"];
        assert_eq!(result, native["result"], "{name}: result");
        let expected = native["log"].as_array().unwrap();
        for (i, (a, b)) in log.iter().zip(expected).enumerate() {
            assert_eq!(a, b, "{name}: log entry {i}");
        }
        assert_eq!(log.len(), expected.len(), "{name}: log length");
    }
}

/// Refused code fails the run with the refusal's diagnostics (the frontend's
/// `EvalRefused` message), never with a rendered frame of it.
#[test]
fn refused_code_fails_the_run_with_its_diagnostics() {
    let refused: Vec<_> = fixtures()
        .into_iter()
        .filter(|(_, f)| f["status"] == "refused")
        .collect();
    assert!(!refused.is_empty());
    for (name, f) in refused {
        let (result, _) = run(&f);
        let error = result["error"].as_str().expect("an error");
        let refusal = f["refusal"].as_str().unwrap();
        assert!(error.contains(refusal), "{name}: {error} lacks {refusal}");
    }
}

/// The fixtures exercise what the eval slice and fuzz claim: markup and value
/// eval sites, both code syntaxes, every binding kind, a renamed binding, and
/// a code string that changes while the program runs.
#[test]
fn the_fixtures_cover_the_eval_forms() {
    let mut seen = BTreeSet::new();
    fn walk(v: &J, seen: &mut BTreeSet<String>) {
        match v {
            J::Array(xs) => xs.iter().for_each(|x| walk(x, seen)),
            J::Object(o) => {
                if o.get("kind") == Some(&json!("eval")) {
                    seen.insert("view eval".into());
                }
                if o.get("op") == Some(&json!("eval")) {
                    seen.insert("value eval".into());
                }
                if let Some(J::Array(bs)) = o.get("bindings") {
                    for b in bs {
                        if b["target"].is_string() && b["target"] != b["name"] {
                            seen.insert("renamed binding".into());
                        }
                        if let Some(k) = b["kind"].as_str() {
                            seen.insert(format!("binding {k}"));
                        }
                    }
                }
                o.values().for_each(|x| walk(x, seen));
            }
            _ => {}
        }
    }
    for (_, f) in fixtures() {
        walk(&f["plan"], &mut seen);
        for e in f["evals"]["evals"].as_array().unwrap() {
            seen.insert(format!("syntax {}", e["syntax"].as_str().unwrap()));
            if let Some(p) = e.get("plan") {
                walk(p, &mut seen);
                if !p["hosts"].as_array().unwrap().is_empty() {
                    seen.insert("binding host".into());
                }
            }
        }
        let codes: BTreeSet<_> = f["evals"]["evals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["code"].as_str().unwrap().to_owned())
            .collect();
        if codes.len() > 2 {
            seen.insert("code changes".into());
        }
    }
    for want in [
        "view eval",
        "value eval",
        "syntax rx",
        "syntax tsx",
        "binding read",
        "binding store",
        "binding action",
        "binding host",
        "renamed binding",
        "code changes",
    ] {
        assert!(seen.contains(want), "no fixture has {want}: {seen:?}");
    }
}

fn slice() -> J {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/eval/slice.json"
    ))
    .unwrap();
    serde_json::from_str(&text).unwrap()
}

/// Without the table, an eval site's code has no plan: the run fails
/// explicitly at the first evaluation, naming the code.
#[test]
fn a_code_with_no_table_entry_fails_the_run() {
    let f = slice();
    let plan = serde_json::from_value(f["plan"].clone()).unwrap();
    let scenario = serde_json::from_value(f["scenario"].clone()).unwrap();
    let (r, _) = trace_v2_with(plan, scenario, EvalTable::default());
    let e = r.unwrap_err();
    assert!(e.contains("no plan in the host's eval table for"), "{e}");
}

/// Static refusals: an evaluated plan is mounted only by an eval site; its
/// bindings are never written; an eval site is an element child; a table
/// entry is a plan or a refusal, of the kind its request asks for.
#[test]
fn eval_plans_and_tables_outside_the_schema_are_refused() {
    let f = slice();
    // The first markup code of the table (the first entry may be a value eval's).
    let view = f["evals"]["evals"]
        .as_array()
        .unwrap()
        .iter()
        .position(|e| e.get("type").is_none())
        .unwrap();
    let inner: Plan = serde_json::from_value(f["evals"]["evals"][view]["plan"].clone()).unwrap();
    assert!(validate(&inner).is_ok());
    assert!(App::mount(inner.clone())
        .err()
        .unwrap()
        .contains("mounted by an eval site"));
    // A write to a binding.
    let mut j = f["evals"]["evals"][view]["plan"].clone();
    j["markup"][0]["events"] = json!([]);
    j["markup"][0]["children"] = json!([{ "kind": "element", "tag": "b", "events": [{ "name": "onClick",
        "steps": [{ "op": "write", "source": "count", "value": { "op": "literal", "value": 1 } }] }], "children": [] }]);
    let p: Plan = serde_json::from_value(j).unwrap();
    assert!(validate(&p).unwrap_err().contains("not a signal"));
    // An eval site directly in a component position.
    let mut j = f["plan"].clone();
    let site = j["markup"][0]["children"][6]["children"][0].clone();
    assert_eq!(site["kind"], "eval");
    j["markup"] = json!([site]);
    let p: Plan = serde_json::from_value(j).unwrap();
    assert!(validate(&p).unwrap_err().contains("component position"));
    // Table entries.
    let mut t = f["evals"].clone();
    t["evals"][view]["refused"] = json!([{ "code": "PLAN", "message": "x" }]);
    let table: EvalTable = serde_json::from_value(t).unwrap();
    assert!(validate_table(&table)
        .unwrap_err()
        .contains("one of plan and refused"));
    let mut t = f["evals"].clone();
    t["evals"][view]["type"] = json!("string");
    let table: EvalTable = serde_json::from_value(t).unwrap();
    assert!(validate_table(&table)
        .unwrap_err()
        .contains("is not a value plan"));
}
