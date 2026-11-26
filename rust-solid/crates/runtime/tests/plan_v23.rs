//! Plan v2.3, composition (frontend `plan/docs/PLAN-V2.md`, "v2.3:
//! composition"): element attributes, the module's components, their props
//! (values, callbacks, actions and function props passed on) and children.
//!
//! - The plan v2.3 fuzz: programs of the frontend's composition fuzz
//!   (`fixtures/plan-fuzz-compose/`, chosen to cover every v2.3 form the
//!   generator produces), each with native Solid's full host log.
//! - An action passed by name and a function prop passed on
//!   (`fixtures/compose-forward.*`, from the React frontend; frames recorded
//!   on React 19 and replayed on the JS plan leg).
//! - The static refusals, and the server renderer's typed refusal.
use rust_solid::plan_v2::{validate, Plan};
use rust_solid::scenario::{run_v2, trace_v2};
use serde_json::{json, Value as J};

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

#[test]
fn generated_composition_programs_give_native_solids_host_log() {
    let corpus = corpus("plan-fuzz-compose");
    assert!(corpus.len() >= 5, "corpus of {} programs", corpus.len());
    for (name, f) in corpus {
        assert_eq!(f["plan"]["version"], json!(2.3), "{name}");
        let (r, log) = trace_v2(
            serde_json::from_value(f["plan"].clone()).unwrap(),
            serde_json::from_value(f["scenario"].clone()).unwrap(),
        );
        let result = match &r {
            Ok(frames) => json!({ "frames": frames }),
            Err(e) => json!({ "error": e }),
        };
        assert_eq!(result, f["native"]["result"], "{name}: result");
        let expected = f["native"]["log"].as_array().unwrap();
        for (i, (a, b)) in log.iter().zip(expected).enumerate() {
            assert_eq!(a, b, "{name}: log entry {i}");
        }
        assert_eq!(log.len(), expected.len(), "{name}: log length");
    }
}

#[test]
fn an_action_by_name_and_a_forwarded_prop_give_the_recorded_frames() {
    let scenario = fixture("compose-forward.scenario.json");
    let frames = run_v2(
        serde_json::from_value(fixture("compose-forward.plan.json")).unwrap(),
        serde_json::from_value(scenario.clone()).unwrap(),
    )
    .unwrap();
    let expected: Vec<&str> = scenario["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["frame"].as_str().unwrap())
        .collect();
    assert_eq!(frames, expected);
}

fn refused(p: J) -> String {
    let plan: Plan = serde_json::from_value(p).unwrap();
    validate(&plan).unwrap_err()
}

fn base() -> J {
    let p = fixture("compose-forward.plan.json");
    validate(&serde_json::from_value(p.clone()).unwrap()).unwrap();
    p
}

#[test]
fn the_version_says_whether_a_v23_form_occurs() {
    let mut p = base();
    p["version"] = json!(2);
    assert_eq!(refused(p), "plan version 2 uses a v2.3 form");
    let mut p = fixture("tracker.plan.json");
    p["version"] = json!(2.3);
    assert_eq!(refused(p), "plan version 2.3 uses no v2.3 form");
}

#[test]
fn a_prop_read_names_a_declared_value_prop() {
    let mut p = base();
    p["components"][0]["markup"][0]["children"][0]["value"] = json!({"op": "prop", "name": "nope"});
    assert_eq!(refused(p), "read of undeclared prop nope");
}

#[test]
fn a_prop_call_names_a_declared_function_prop() {
    let mut p = base();
    p["components"][0]["markup"][0]["events"][0]["steps"][0]["prop"] = json!("n");
    assert_eq!(refused(p), "call of n, not a function prop");
}

#[test]
fn an_element_with_attrs_carries_its_events_there() {
    let mut p = base();
    p["components"][0]["markup"][0]["attrs"] =
        json!([{"name": "title", "value": {"op": "literal", "value": "t"}}]);
    assert_eq!(
        refused(p),
        "an element with attrs has its events among them"
    );
}

#[test]
fn a_site_names_a_component_of_the_plan() {
    let mut p = base();
    p["markup"][0]["children"][0]["name"] = json!("Missing");
    assert_eq!(refused(p), "unknown component Missing");
}

#[test]
fn children_are_read_only_where_a_children_prop_is_declared() {
    let mut p = base();
    p["components"][0]["markup"][0]["children"] = json!([{"kind": "children"}]);
    assert_eq!(
        refused(p),
        "props.children in a component that does not read them"
    );
}

#[test]
fn the_server_renderer_refuses_plan_v23_with_a_typed_error() {
    let plan: Plan = serde_json::from_value(base()).unwrap();
    assert_eq!(
        rust_solid::ssr::plan::render(&plan).unwrap_err(),
        "plan v2.3 (composition) is not ported to the server renderer"
    );
}

#[test]
fn a_handler_that_takes_its_event_reads_the_inputs_new_text() {
    let field = |key: &str, object: J| json!({ "op": "get", "object": object, "key": key });
    let plan: Plan = serde_json::from_value(json!({
        "version": 2.3, "component": "App", "hosts": [],
        "sources": [{ "name": "draft", "kind": "signal", "seed": { "op": "literal", "value": "" } }],
        "memos": [], "actions": [],
        "markup": [{ "kind": "element", "tag": "div", "events": [], "children": [
            { "kind": "element", "tag": "input", "events": [], "children": [], "attrs": [
                { "name": "value", "value": { "op": "read", "source": "draft" } },
                { "name": "onInput", "param": "e", "steps": [{ "op": "write", "source": "draft",
                    "value": field("value", field("target", json!({ "op": "local", "name": "e" }))) }] }
            ]},
            { "kind": "text", "value": { "op": "read", "source": "draft" } }
        ]}]
    }))
    .unwrap();
    let mut app = rust_solid::plan_v2::App::mount(plan).unwrap();
    app.turn();
    let input = {
        let h = app.host.borrow();
        h.handlers_of(h.root(), "input")[0]
    };
    app.dispatch(input, "input", Some("milk")).unwrap();
    app.turn();
    assert_eq!(app.frame(), "milk");
    assert_eq!(app.host.borrow().prop(input, "value").to_js_string().as_deref(), Some("milk"));
}
