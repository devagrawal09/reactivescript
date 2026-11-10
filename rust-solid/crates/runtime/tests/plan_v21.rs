//! Plan v2.1, async data (frontend `plan/docs/PLAN-V2.md`, "v2.1: async
//! data"; docs/PLAN-V2-CONSUMER.md, "Plan v2.1"): async memos over host
//! flights, `loading`/`errored` views on the ported boundaries, the
//! `pending`/`latest` probes (tracked verdict readers), `refresh` and
//! `affects`, and structured, pure hosts, against format-2.1 scenarios.
//!
//! - The tracker-async slice: the 18 recorded frames, and native Solid's
//!   399-entry host log (`fixtures/tracker-async.oracle.json`, from
//!   `fuzz/plan-oracle.mjs`; the frontend gate compares the same log with
//!   native Solid running the TSX twin).
//! - The plan v2.1 fuzz: programs of the frontend's async plan fuzz
//!   (`fixtures/plan-fuzz-async/`, chosen to cover every node kind and a
//!   spread of scenario features) and of its async eval fuzz
//!   (`fixtures/eval-async/`), each with native Solid's full trace.
//! - The static refusals, the scenario's format-2.1 rules and the binaries.
use rust_solid::plan_v2::{validate, HostType, Plan};
use rust_solid::scenario::{run_v2, trace_v2, trace_v2_with};
use serde_json::{json, Value as J};
use std::collections::BTreeSet;

fn fixture(name: &str) -> J {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn corpus(dir: &str) -> Vec<(String, J)> {
    let dir = format!("{}/tests/fixtures/{dir}", env!("CARGO_MANIFEST_DIR"));
    let mut out: Vec<(String, J)> = std::fs::read_dir(dir)
        .unwrap()
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

fn frames_of(scenario: &J) -> Vec<String> {
    scenario["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["frame"].as_str().unwrap().to_owned())
        .collect()
}

fn same_log(name: &str, log: &[J], expected: &J) {
    let expected = expected.as_array().unwrap();
    for (i, (a, b)) in log.iter().zip(expected).enumerate() {
        assert_eq!(a, b, "{name}: log entry {i}");
    }
    assert_eq!(log.len(), expected.len(), "{name}: log length");
}

#[test]
fn tracker_async_gives_the_recorded_frames() {
    let scenario = fixture("tracker-async.scenario.json");
    let frames = run_v2(
        serde_json::from_value(fixture("tracker-async.plan.json")).unwrap(),
        serde_json::from_value(scenario.clone()).unwrap(),
    )
    .unwrap();
    assert_eq!(frames.len(), 18);
    assert_eq!(frames, frames_of(&scenario));
}

#[test]
fn tracker_async_host_log_is_solids() {
    let oracle = fixture("tracker-async.oracle.json");
    let (r, log) = trace_v2(
        serde_json::from_value(fixture("tracker-async.plan.json")).unwrap(),
        serde_json::from_value(fixture("tracker-async.scenario.json")).unwrap(),
    );
    assert_eq!(json!({ "frames": r.unwrap() }), oracle["result"]);
    assert_eq!(log.len(), 399);
    same_log("tracker-async", &log, &oracle["log"]);
}

#[test]
fn generated_async_programs_give_native_solids_host_log() {
    let corpus = corpus("plan-fuzz-async");
    assert!(corpus.len() >= 8, "corpus of {} programs", corpus.len());
    for (name, f) in corpus {
        assert_eq!(f["plan"]["version"], json!(2.1), "{name}");
        let (r, log) = trace_v2(
            serde_json::from_value(f["plan"].clone()).unwrap(),
            serde_json::from_value(f["scenario"].clone()).unwrap(),
        );
        let result = match &r {
            Ok(frames) => json!({ "frames": frames }),
            Err(e) => json!({ "error": e }),
        };
        assert_eq!(result, f["native"]["result"], "{name}: result");
        same_log(&name, &log, &f["native"]["log"]);
    }
}

#[test]
fn async_eval_programs_give_the_static_twins_host_log() {
    let corpus = corpus("eval-async");
    assert!(corpus.len() >= 2);
    for (name, f) in corpus {
        let (r, log) = trace_v2_with(
            serde_json::from_value(f["plan"].clone()).unwrap(),
            serde_json::from_value(f["scenario"].clone()).unwrap(),
            serde_json::from_value(f["evals"].clone()).unwrap(),
        );
        let result = match &r {
            Ok(frames) => json!({ "frames": frames }),
            Err(e) => json!({ "error": e }),
        };
        assert_eq!(result, f["static"]["result"], "{name}: result");
        same_log(&name, &log, &f["static"]["log"]);
    }
}

/// Every v2.1 form occurs in the async corpus (and every v2 kind the async
/// generator produces).
#[test]
fn the_async_corpus_covers_every_v21_form() {
    let mut seen = BTreeSet::new();
    fn walk(v: &J, seen: &mut BTreeSet<String>) {
        match v {
            J::Array(xs) => xs.iter().for_each(|x| walk(x, seen)),
            J::Object(o) => {
                if let Some(k) = o.get("kind").and_then(J::as_str) {
                    seen.insert(format!("view:{k}"));
                }
                if let Some(op) = o.get("op").and_then(J::as_str) {
                    seen.insert(format!("op:{op}"));
                }
                if o.contains_key("await") {
                    seen.insert("memo:async".into());
                }
                if o.get("pure") == Some(&json!(true)) {
                    seen.insert("host:pure".into());
                }
                if let Some(r) = o.get("returns").and_then(J::as_str) {
                    if !["number", "string", "boolean"].contains(&r) {
                        seen.insert("host:structured".into());
                    }
                }
                o.values().for_each(|x| walk(x, seen));
            }
            _ => {}
        }
    }
    for (_, f) in corpus("plan-fuzz-async") {
        walk(&f["plan"], &mut seen);
    }
    for k in [
        "view:loading",
        "view:errored",
        "view:show",
        "view:for",
        "op:pending",
        "op:latest",
        "op:refresh",
        "op:affects",
        "op:await",
        "op:try",
        "memo:async",
        "host:pure",
        "host:structured",
    ] {
        assert!(seen.contains(k), "the async corpus lacks {k}: {seen:?}");
    }
}

#[test]
fn the_scenario_binary_runs_plan_v21() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_scenario"))
        .arg(format!("{dir}/tracker-async.plan.json"))
        .arg(format!("{dir}/tracker-async.scenario.json"))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let frames: Vec<String> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(frames, frames_of(&fixture("tracker-async.scenario.json")));
    // `plan-trace` prints the same log.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_plan-trace"))
        .arg(format!("{dir}/tracker-async.plan.json"))
        .arg(format!("{dir}/tracker-async.scenario.json"))
        .output()
        .unwrap();
    assert!(out.status.success());
    let trace: J = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(trace, fixture("tracker-async.oracle.json"));
}

fn refused(p: J) -> String {
    let plan: Plan = serde_json::from_value(p).unwrap();
    validate(&plan).unwrap_err()
}

#[test]
fn v21_static_refusals() {
    let base = fixture("tracker-async.plan.json");
    validate(&serde_json::from_value(base.clone()).unwrap()).unwrap();
    // The version says whether a v2.1 form occurs.
    let mut p = base.clone();
    p["version"] = json!(2);
    assert_eq!(refused(p), "plan version 2 uses a v2.1 form");
    let v2: J = fixture("tracker.plan.json");
    let mut p = v2.clone();
    p["version"] = json!(2.1);
    assert_eq!(refused(p), "plan version 2.1 uses no v2.1 form");
    let mut p = base.clone();
    p["version"] = json!(2.2);
    assert_eq!(refused(p), "plan version 2.2 is not 2");
    // `affects` in a plain handler; `refresh` of a source; a probe in a handler.
    let mut p = base.clone();
    p["markup"][0]["children"][0]["fallback"][0]["children"][1]["events"][0]["steps"][0] =
        json!({"op": "affects", "source": "issues"});
    assert_eq!(refused(p), "affects in a plain handler");
    let mut p = base.clone();
    p["actions"][0]["steps"][0] = json!({"op": "refresh", "source": "status"});
    assert_eq!(refused(p), "refresh targets status, not an async memo");
    let mut p = base.clone();
    p["actions"][0]["steps"][1]["catch"][0]["value"] =
        json!({"op": "pending", "value": {"op": "read", "source": "status"}});
    assert_eq!(refused(p), "pending occurs only in a reactive context");
    // A read of an async memo in an action.
    let mut p = base.clone();
    p["actions"][0]["steps"][1]["catch"][0]["value"] =
        json!({"op": "length", "array": {"op": "read", "source": "issues"}});
    assert_eq!(
        refused(p),
        "an async memo is read only in reactive contexts: issues"
    );
    // Hosts: a structured result printed canonically; `pure` true or absent.
    let mut p = base.clone();
    p["hosts"][1]["returns"] = json!("{id: number, title: string, assignee: string}[]");
    assert!(refused(p).contains("is not printed canonically"));
    let mut p = base.clone();
    p["hosts"][1]["pure"] = json!(false);
    assert_eq!(refused(p), "host loadIssues: pure is true or absent");
    // An async memo has exactly one of value and await, over a known host.
    let mut p = base.clone();
    p["memos"][0]["await"]["host"] = json!("nope");
    assert_eq!(refused(p), "async memo issues awaits unknown host nope");
    let mut p = base.clone();
    p["memos"][0]["value"] = json!({"op": "literal", "value": 1});
    assert_eq!(refused(p), "memo issues has exactly one of value and await");
    // Text directly in a boundary's fallback (a component position).
    let mut p = base.clone();
    p["markup"][0]["children"][0]["fallback"] =
        json!([{"kind": "text", "value": {"op": "literal", "value": "x"}}]);
    assert!(refused(p).starts_with("text directly in a component position"));
}

#[test]
fn format_21_scenario_rules() {
    let plan = fixture("tracker-async.plan.json");
    let scenario = fixture("tracker-async.scenario.json");
    let run = |p: &J, s: &J| {
        run_v2(
            serde_json::from_value(p.clone()).unwrap(),
            serde_json::from_value(s.clone()).unwrap(),
        )
    };
    // A structured result is version 2.1 only.
    let mut s = scenario.clone();
    s["version"] = json!(2);
    let e = run(&plan, &s).unwrap_err();
    assert!(
        e.contains("host results are scalars before version 2.1"),
        "{e}"
    );
    // A resolved value conforms exactly: records with exactly the type's keys.
    let mut s = scenario.clone();
    s["steps"][1]["value"][0]["extra"] = json!(1);
    assert_eq!(
        run(&plan, &s).unwrap_err(),
        "step 1: loadIssues returns a { id: number, title: string, assignee: string }[]"
    );
    let mut s = scenario.clone();
    s["steps"][1]["value"][0]["id"] = json!(1.5);
    assert!(run(&plan, &s).is_err());
    // The plan's hosts are the scenario's.
    let mut p = plan.clone();
    p["hosts"][0]["returns"] = json!("number");
    assert_eq!(
        run(&p, &scenario).unwrap_err(),
        "the plan's hosts are not the scenario's"
    );
}

#[test]
fn host_types_parse_print_and_conform() {
    let t = HostType::parse("{ id: number; title: string, tags: (number[])[] }[]").unwrap();
    assert_eq!(
        t.print(),
        "{ id: number, title: string, tags: (number[])[] }[]"
    );
    assert!(t.conforms_json(&json!([{"id": 1, "title": "a", "tags": [[1], []]}])));
    assert!(!t.conforms_json(&json!([{"id": 1, "title": "a"}])));
    assert!(!t.conforms_json(&json!([{"id": 1.5, "title": "a", "tags": []}])));
    assert!(HostType::parse("numbers").is_err());
    assert!(HostType::parse("{ a: number, a: string }").is_err());
    // A resolution is a fresh value, its records' keys in the JSON's order.
    let v = t
        .value_of(&json!([{"title": "a", "id": 1, "tags": []}]))
        .unwrap();
    let w = t
        .value_of(&json!([{"title": "a", "id": 1, "tags": []}]))
        .unwrap();
    assert_ne!(v, w);
}

#[test]
fn the_server_renderer_renders_plan_v21_to_a_string() {
    // Plan v2.1 used to be refused by the server renderer; it now renders
    // (docs/SSR.md, "Async data and streaming"). `renderToString` does not wait
    // for async data: the Loading boundary renders its fallback and
    // serializes "$$f" under its id, as Solid's own renderToString does
    // (`tests/ssr_async.rs` checks the streams).
    let plan: Plan = serde_json::from_value(fixture("tracker-async.plan.json")).unwrap();
    let html = rust_solid::ssr::plan::render(&plan).unwrap();
    assert_eq!(
        html,
        "<section _hk=1><!--$--><i _hk=2000>Loading issues&#8230;</i><!--/--><em></em></section><script>(self.$R=self.$R||{})[\"\"]=[];_$HY.r[\"200\"]=\"$$f\";</script>"
    );
}
