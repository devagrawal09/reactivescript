use rust_solid::{
    plan::Plan,
    scenario::{run, Scenario},
    slice1::Runtime,
    Computation,
};
use std::rc::Rc;
fn plan() -> Plan {
    serde_json::from_str(include_str!("fixtures/like.plan.json")).unwrap()
}
fn scenario() -> Scenario {
    serde_json::from_str(include_str!("fixtures/like.scenario.json")).unwrap()
}
#[test]
fn equal_write_to_a_held_source_still_joins_the_hold() {
    let r = Runtime::default();
    let s = r.signal(0);
    let a = r.begin_action();
    r.write(s, 1);
    r.flush();
    let b = r.begin_action();
    r.write(s, 1);
    r.flush();
    r.join_future(a);
    r.finish_action(a);
    r.flush();
    assert_eq!(r.read(s).unwrap(), 0);
    r.join_future(b);
    r.finish_action(b);
    r.flush();
    assert_eq!(r.read(s).unwrap(), 1);
}
#[test]
fn no_op_write_does_not_hold_an_unrelated_source() {
    let r = Runtime::default();
    let s = r.signal(1);
    let o = r.optimistic_value(0);
    r.write(s, 1);
    let t = r.begin_action();
    r.optimistic_write(o, 6);
    r.flush();
    r.write(s, 3);
    r.flush();
    assert_eq!(r.read(s).unwrap(), 3);
    assert_eq!(r.read(o).unwrap(), 6);
    r.join_future(t);
    r.finish_action(t);
    r.flush();
}
#[test]
fn render_expression_errors_fail_the_run() {
    let mut p: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/like.plan.json")).unwrap();
    p["markup"][0]["children"][0]["value"] = serde_json::json!({"op":"read","source":"missing"});
    assert!(run(serde_json::from_value(p).unwrap(), scenario())
        .unwrap_err()
        .contains("unknown source"));
}
#[test]
fn native_like_scenario() {
    assert_eq!(
        run(plan(), scenario()).unwrap(),
        vec!["0", "1", "0", "1", "1"]
    );
}
#[test]
fn wrong_expected_frame_fails() {
    let mut s: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/like.scenario.json")).unwrap();
    s["steps"][2]["frame"] = serde_json::json!("1");
    assert!(run(plan(), serde_json::from_value(s).unwrap())
        .unwrap_err()
        .contains("step 2"));
}
#[test]
fn duplicate_settlement_fails() {
    let mut s: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/like.scenario.json")).unwrap();
    let step = s["steps"][2].clone();
    s["steps"].as_array_mut().unwrap().insert(3, step);
    assert!(run(plan(), serde_json::from_value(s).unwrap())
        .unwrap_err()
        .contains("already settled"));
}
#[test]
fn held_write_and_lane_are_separate() {
    let r = Runtime::default();
    let likes = r.signal(0);
    let n = r.node(likes);
    let shown = r.optimistic(Rc::new(move |g, _| Ok(Computation::Ready(g.read(n)?))));
    assert_eq!(r.read(shown).unwrap(), 0);
    let t = r.begin_action();
    r.optimistic_write(shown, 1);
    r.write(likes, 7);
    r.flush();
    assert_eq!(r.read(likes).unwrap(), 0);
    assert_eq!(r.read(shown).unwrap(), 1);
    r.join_future(t);
    r.finish_action(t);
    r.flush();
    assert_eq!(r.read(likes).unwrap(), 7);
    assert_eq!(r.read(shown).unwrap(), 7);
}
#[test]
fn updater_composes_before_flush() {
    let r = Runtime::default();
    let n = r.optimistic_value(0);
    let t = r.begin_action();
    r.optimistic_write(n, r.current(n).unwrap() + 1);
    r.optimistic_write(n, r.current(n).unwrap() + 1);
    r.flush();
    assert_eq!(r.read(n).unwrap(), 2);
    r.join_future(t);
    r.finish_action(t);
    r.flush();
    assert_eq!(r.read(n).unwrap(), 0);
}
#[test]
fn same_tick_actions_remain_open_until_both_return() {
    let r = Runtime::default();
    let n = r.signal(0);
    let a = r.begin_action();
    r.write(n, 1);
    let b = r.begin_action();
    r.write(n, 2);
    r.flush();
    r.join_future(a);
    r.finish_action(a);
    r.flush();
    assert_eq!(r.read(n).unwrap(), 0);
    r.join_future(b);
    r.finish_action(b);
    r.flush();
    assert_eq!(r.read(n).unwrap(), 2);
}
