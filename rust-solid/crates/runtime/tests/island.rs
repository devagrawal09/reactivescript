//! The React frontend's island level (frontend `react/island.ts`): a plan
//! whose markup holds a component kept as JS is read, and refused by name,
//! because this runtime has no JS host to run the island's module.
use rust_solid::plan_v2::{islands, validate, App, Plan, NEEDS_JS_HOST};
use serde_json::json;

fn island_plan() -> Plan {
    serde_json::from_value(json!({
        "version": 2, "component": "A", "hosts": [], "sources": [], "memos": [], "actions": [],
        "markup": [{ "kind": "island", "component": "A", "reasons": ["REACT_EFFECT"],
            "imports": [{ "from": "react", "names": ["useEffect", "useState"] }],
            "module": "const __React = __import(\"react\"); function A() { return null; } __exports.default = A;" }]
    }))
    .unwrap()
}

#[test]
fn a_plan_with_an_island_needs_a_js_host() {
    let plan = island_plan();
    assert_eq!(islands(&plan), ["A"]);
    assert!(validate(&plan).unwrap_err().starts_with(NEEDS_JS_HOST));
    assert!(App::mount(plan).err().unwrap().starts_with(NEEDS_JS_HOST));
}
