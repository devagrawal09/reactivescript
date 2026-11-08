//! Plan schema v2 and scenario format version 2 (frontend-tracker
//! `plan/docs/PLAN-V2.md`, `docs/SCENARIO-FORMAT.md`): the tracker plan
//! emitted by the frontends, run through the ported runtime and the
//! universal renderer port, must give the scenario's frames, recorded from
//! native Solid. The fixtures are byte copies of
//! `frontend-tracker/plan/{tracker.plan.json,like.plan-v2.json}` and
//! `slices/tracker/tracker.scenario.json`; the frontend gate runs the
//! `scenario` binary on freshly emitted plans.
use rust_solid::{
    plan_v2::{validate, App, Plan},
    scenario::{run_v2, trace_v2, ScenarioV2},
};
use serde_json::{json, Value as J};
use std::process::Command;

fn plan_json() -> J {
    serde_json::from_str(include_str!("fixtures/tracker.plan.json")).unwrap()
}
fn scenario_json() -> J {
    serde_json::from_str(include_str!("fixtures/tracker.scenario.json")).unwrap()
}
fn run(plan: J, scenario: J) -> Result<Vec<String>, String> {
    let plan: Plan = serde_json::from_value(plan).map_err(|e| e.to_string())?;
    let scenario: ScenarioV2 = serde_json::from_value(scenario).map_err(|e| e.to_string())?;
    run_v2(plan, scenario)
}
fn err(plan: J, scenario: J) -> String {
    run(plan, scenario).expect_err("the run must fail")
}
fn frames(s: &J) -> Vec<String> {
    s["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["frame"].as_str().unwrap().to_owned())
        .collect()
}
/// The first step of the tracker's claim action is its guess; the second its
/// `try`.
fn claim_steps(p: &mut J) -> &mut Vec<J> {
    let a = p["actions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|a| a["name"] == "claim")
        .unwrap();
    a["steps"].as_array_mut().unwrap()
}
/// The view of the row: section > show > for > p.
fn row(p: &mut J) -> &mut J {
    &mut p["markup"][0]["children"][2]["children"][0]["children"][0]
}

#[test]
fn the_tracker_plan_gives_the_native_frames() {
    let s = scenario_json();
    let got = run(plan_json(), s.clone()).unwrap();
    assert_eq!(got.len(), 13);
    assert_eq!(got, frames(&s));
    // The merged transaction: step 3 changes nothing, step 4 lands both.
    assert_eq!(got[2], got[3]);
    assert_eq!(
        got[4],
        "Filter: all1 openCrash on save: nobodytakeSlow search: anatakeTypo in footer: devtakeCould not assign #1"
    );
    assert_eq!(got[8], "Filter: open0 openNothing to triage");
}

#[test]
fn the_like_plan_v2_runs_the_version_1_scenario() {
    let p: J = serde_json::from_str(include_str!("fixtures/like.plan-v2.json")).unwrap();
    let s: J = serde_json::from_str(include_str!("fixtures/like.scenario.json")).unwrap();
    assert_eq!(run(p, s).unwrap(), vec!["0", "1", "0", "1", "1"]);
}

#[test]
fn a_wrong_expected_frame_fails_at_its_step() {
    let mut s = scenario_json();
    // Step 3 is the held resolve: a frame that shows `dev` early is wrong.
    s["steps"][3]["frame"] =
        json!("Filter: all0 openCrash on save: metakeSlow search: anatakeTypo in footer: devtake");
    let e = err(plan_json(), s);
    assert!(e.starts_with("step 3: expected"), "{e}");
}

#[test]
fn a_duplicate_settlement_fails() {
    let mut s = scenario_json();
    let step = s["steps"][3].clone();
    s["steps"].as_array_mut().unwrap().insert(4, step);
    let e = err(plan_json(), s);
    assert!(
        e.contains("step 4: assignIssue call #2 is already settled"),
        "{e}"
    );
}

#[test]
fn an_unknown_row_target_fails() {
    let mut s = scenario_json();
    s["steps"][1]["target"]["parent"] = json!("Lost keys: nobodytake");
    let e = err(plan_json(), s);
    assert!(e.contains("step 1: no clickable \"take\""), "{e}");
}

#[test]
fn a_row_target_is_matched_against_the_live_text() {
    // At step 2 the first row reads `me`: its step-0 text no longer matches.
    let mut s = scenario_json();
    s["steps"][2]["target"]["parent"] = json!("Crash on save: nobodytake");
    let e = err(plan_json(), s);
    assert!(
        e.contains("step 2: no clickable") && e.contains("(0 match)"),
        "{e}"
    );
    // An index past the matches fails too.
    let mut s = scenario_json();
    s["steps"][1]["target"]["index"] = json!(1);
    let e = err(plan_json(), s);
    assert!(
        e.contains("step 1: no clickable") && e.contains("(1 match)"),
        "{e}"
    );
}

#[test]
fn settled_arguments_are_checked() {
    let mut s = scenario_json();
    s["steps"][3]["args"] = json!([1]);
    let e = err(plan_json(), s);
    assert!(
        e.contains("step 3: assignIssue call #2 has arguments"),
        "{e}"
    );
}

#[test]
fn an_unissued_or_unsettled_request_fails() {
    let mut s = scenario_json();
    s["steps"][3]["call"] = json!(9);
    let e = err(plan_json(), s);
    assert!(
        e.contains("step 3: assignIssue call #9 was not issued"),
        "{e}"
    );
    let mut s = scenario_json();
    s["steps"].as_array_mut().unwrap().pop();
    assert_eq!(err(plan_json(), s), "scenario left host calls pending");
}

#[test]
fn version_rules_are_enforced() {
    // Version 1 has no click targets and no args.
    let mut s = scenario_json();
    s["version"] = json!(1);
    let e = err(plan_json(), s);
    assert!(e.contains("click targets are version 2"), "{e}");
    // Version 2 settles with args.
    let mut s = scenario_json();
    s["steps"][3].as_object_mut().unwrap().remove("args");
    let e = err(plan_json(), s);
    assert!(e.contains("step 3: version 2 settles with args"), "{e}");
    // A click has element or target, not both.
    let mut s = scenario_json();
    s["steps"][1]["element"] = json!(1);
    let e = err(plan_json(), s);
    assert!(e.contains("not both"), "{e}");
    // Unknown fields are refused.
    let mut s = scenario_json();
    s["steps"][1]["target"]["key"] = json!(1);
    assert!(err(plan_json(), s).contains("unknown field `key`"));
    // The plan's hosts must be the scenario's.
    let mut p = plan_json();
    p["hosts"][0]["returns"] = json!("number");
    assert_eq!(
        err(p, scenario_json()),
        "the plan's hosts are not the scenario's"
    );
}

#[test]
fn an_uncaught_rejection_fails_the_run() {
    // `claim` without its try: the rejection at step 4 escapes the action.
    let mut p = plan_json();
    let steps = claim_steps(&mut p);
    let body = steps[1]["body"].clone();
    steps.truncate(1);
    steps.extend(body.as_array().unwrap().iter().cloned());
    let e = err(p, scenario_json());
    assert!(
        e.starts_with("step 4: uncaught failure in action claim: offline"),
        "{e}"
    );
}

#[test]
fn a_value_outside_its_types_fails_the_run() {
    // `{mode.title}`: a field read on a string passes the checker and the
    // builder (frontend-tracker's report), and fails here at mount.
    let mut p = plan_json();
    p["markup"][0]["children"][0]["children"][1]["value"] =
        json!({"op": "get", "object": {"op": "read", "source": "mode"}, "key": "title"});
    let e = err(p, scenario_json());
    assert!(e.contains("step 0: get title of"), "{e}");
    // ToString of a boolean.
    let mut p = plan_json();
    p["markup"][0]["children"][3]["children"][0]["value"] = json!({"op": "not", "value":
        {"op": "read", "source": "status"}});
    let e = err(p, scenario_json());
    assert!(e.contains("step 0: ToString of true"), "{e}");
    // A store path write through a missing row (`findIndex` gives -1).
    let mut p = plan_json();
    claim_steps(&mut p)[1]["body"][1]["path"][1]["index"] = json!({"op": "literal", "value": -1});
    let e = err(p, scenario_json());
    assert!(e.contains("step 3: store path index -1"), "{e}");
}

fn refused(p: J) -> String {
    validate(&serde_json::from_value(p).unwrap()).expect_err("refused")
}

#[test]
fn plans_outside_the_schema_are_refused() {
    let mut p = plan_json();
    // A row handler that guesses.
    row(&mut p)["children"][3]["events"][0]["steps"] =
        json!([{"op": "optimistic", "source": "shown", "value": {"op": "literal", "value": 1}}]);
    assert_eq!(refused(p), "a guess in a plain handler");
    let mut p = plan_json();
    claim_steps(&mut p)
        .push(json!({"op": "call", "action": "claim", "args": [{"op": "local", "name": "id"}]}));
    assert_eq!(refused(p), "an action calls the action claim");
    let mut p = plan_json();
    row(&mut p)["children"][1] = json!({"kind": "text", "value": {"op": "read", "source": "mode"}});
    assert_eq!(
        refused(p),
        "adjacent dynamic children need a marker the plan does not give"
    );
    let mut p = plan_json();
    p["sources"][2]["seed"] = json!({"op": "literal", "value": 1.5});
    assert_eq!(refused(p), "literal 1.5 is not a safe integer");
    let mut p = plan_json();
    p["sources"][2]["seed"] = json!({"op": "read", "source": "status"});
    assert_eq!(refused(p), "a constant expression reads status");
    let mut p = plan_json();
    p["memos"][0]["value"] = json!({"op": "read", "source": "missing"});
    assert_eq!(refused(p), "read of unknown source missing");
    let mut p = plan_json();
    p["markup"][0]["children"][2]["children"][0]["key"] = json!("id");
    assert_eq!(refused(p), "For key \"id\": rows are keyed by identity");
    let mut p = plan_json();
    claim_steps(&mut p)[1]["body"][2]["path"] = json!([{"key": "x"}]);
    assert_eq!(refused(p), "a path write targets status, not a store");
    let mut p = plan_json();
    row(&mut p)["children"][0]["value"] = json!({"op": "local", "name": "item"});
    assert_eq!(refused(p), "unbound local item");
    let mut p = plan_json();
    p["version"] = json!(3);
    assert_eq!(refused(p), "plan version 3 is not 2");
    let mut p = plan_json();
    p["memos"][1]["name"] = json!("visible");
    assert_eq!(refused(p), "name \"visible\" is not unique");
    // Unknown ops and fields are refused when the plan is read.
    let mut p = plan_json();
    p["memos"][0]["value"] = json!({"op": "peek", "source": "shown"});
    assert!(serde_json::from_value::<Plan>(p).is_err());
}

/// Rows are keyed by identity: a row whose item is still in the list keeps
/// its nodes; a claimed row's item is a fresh record, so it is a new row
/// (PLAN-V2.md, Markup). Not frame-visible; checked on the host tree.
#[test]
fn rows_are_kept_by_identity() {
    let mut app = App::mount(serde_json::from_value(plan_json()).unwrap()).unwrap();
    for _ in 0..3 {
        app.turn();
    }
    app.check().unwrap();
    let row_of = |app: &App, title: &str| {
        let h = app.host.borrow();
        app.clickables()
            .into_iter()
            .filter_map(|(_, p)| p)
            .find(|p| h.frame(*p).starts_with(title))
            .unwrap()
    };
    let (crash, slow) = (row_of(&app, "Crash"), row_of(&app, "Slow"));
    let take = app
        .clickables()
        .into_iter()
        .find(|(_, p)| *p == Some(crash))
        .unwrap()
        .0;
    app.click(take).unwrap();
    for _ in 0..3 {
        app.turn();
    }
    app.check().unwrap();
    assert_eq!(app.requests().len(), 1);
    assert_ne!(row_of(&app, "Crash"), crash, "the guessed row is a new row");
    assert_eq!(row_of(&app, "Slow"), slow, "an unchanged row is kept");
}

#[test]
fn the_scenario_binary_picks_the_consumer_by_plan_version() {
    let bin = env!("CARGO_BIN_EXE_scenario");
    let fixture = |f: &str| format!("{}/tests/fixtures/{f}", env!("CARGO_MANIFEST_DIR"));
    let out = Command::new(bin)
        .args([
            fixture("tracker.plan.json"),
            fixture("tracker.scenario.json"),
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let got: Vec<String> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(got, frames(&scenario_json()));
    let out = Command::new(bin)
        .args([fixture("like.plan.json"), fixture("like.scenario.json")])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        "[\"0\",\"1\",\"0\",\"1\",\"1\"]\n"
    );
    // A v1 plan with the version-2 scenario is refused by the v1 consumer.
    let out = Command::new(bin)
        .args([fixture("like.plan.json"), fixture("tracker.scenario.json")])
        .output()
        .unwrap();
    assert!(!out.status.success() && out.stdout.is_empty());
    let dir = std::env::temp_dir().join(format!("tracker-v9-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut p = plan_json();
    p["version"] = json!(9);
    let path = dir.join("plan.json");
    std::fs::write(&path, p.to_string()).unwrap();
    let out = Command::new(bin)
        .arg(&path)
        .arg(fixture("tracker.scenario.json"))
        .output()
        .unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    assert!(!out.status.success() && out.stdout.is_empty());
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "unsupported plan version Some(9)\n"
    );
}

/// Beyond frames: every host call (queries included), host request and
/// settled action, and the tree after each step, as Solid 2's own
/// primitives and `@solidjs/universal` make them on the same recording host.
/// The expected logs are `fuzz/plan-oracle.mjs`'s output, recorded with
/// `node --conditions=browser fuzz/plan-oracle.mjs PLAN SCENARIO`.
#[test]
fn the_host_log_is_solids() {
    let cases = [
        (
            include_str!("fixtures/tracker.plan.json"),
            include_str!("fixtures/tracker.scenario.json"),
            include_str!("fixtures/tracker.oracle.json"),
        ),
        (
            include_str!("fixtures/like.plan-v2.json"),
            include_str!("fixtures/like.scenario.json"),
            include_str!("fixtures/like-v2.oracle.json"),
        ),
    ];
    for (plan, scenario, oracle) in cases {
        let oracle: J = serde_json::from_str(oracle).unwrap();
        let (r, log) = trace_v2(
            serde_json::from_str(plan).unwrap(),
            serde_json::from_str(scenario).unwrap(),
        );
        assert_eq!(json!({"frames": r.unwrap()}), oracle["result"]);
        let expected = oracle["log"].as_array().unwrap();
        assert_eq!(log.len(), expected.len());
        for (i, (a, e)) in log.iter().zip(expected).enumerate() {
            assert_eq!(a, e, "host log entry {i}");
        }
    }
}
