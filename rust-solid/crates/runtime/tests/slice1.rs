//! Slice-1 runtime tests. Every expected value was checked against Solid
//! rc.21: docs/slice1-fuzz/parity/tools/unit-expectations.mjs.
use rust_solid::{
    plan::Plan,
    scenario::{run, Scenario},
    slice1::{ActionBody, ActionStep, Resume, Runtime},
};
use std::{cell::RefCell, rc::Rc};
fn plan() -> Plan {
    serde_json::from_str(include_str!("fixtures/like.plan.json")).unwrap()
}
fn scenario() -> Scenario {
    serde_json::from_str(include_str!("fixtures/like.scenario.json")).unwrap()
}
/// A write inside an action body: plain (`setSignal`) or optimistic.
enum W {
    Set(usize, i64),
    Guess(usize, i64),
    Bump(usize),
}
/// `function*(){ writes; yield flight; }` — one slice, then return.
struct Body(Vec<W>, &'static str);
impl ActionBody for Body {
    fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
        match input {
            Resume::Start => {
                for w in &self.0 {
                    match *w {
                        W::Set(n, v) => rt.write(n, v),
                        W::Guess(n, v) => rt.optimistic_write(n, v),
                        W::Bump(n) => {
                            let v = rt.current(n).unwrap() + 1;
                            rt.optimistic_write(n, v)
                        }
                    }
                }
                ActionStep::Yield(self.1.into())
            }
            Resume::Value(_) => ActionStep::Return,
            Resume::Error(e) => ActionStep::Throw(e),
        }
    }
}
/// A flight settles: `await drain()` then `flush()`, as the host does.
fn resolve(r: &mut Runtime, flight: &str) {
    r.settle_flight(flight, Ok(0));
    r.run_microtasks(&mut |_, _| {});
    r.flush();
}
#[test]
fn equal_write_to_a_held_source_still_joins_the_hold() {
    let mut r = Runtime::default();
    let s = r.signal(0);
    r.action(Box::new(Body(vec![W::Set(s, 1)], "a")));
    r.flush();
    r.action(Box::new(Body(vec![W::Set(s, 1)], "b")));
    r.flush();
    resolve(&mut r, "a");
    assert_eq!(r.read(s).unwrap(), 0);
    resolve(&mut r, "b");
    assert_eq!(r.read(s).unwrap(), 1);
}
#[test]
fn no_op_write_does_not_hold_an_unrelated_source() {
    let mut r = Runtime::default();
    let s = r.signal(1);
    let o = r.optimistic_value(0);
    r.write(s, 1);
    r.action(Box::new(Body(vec![W::Guess(o, 6)], "f")));
    r.flush();
    r.write(s, 3);
    r.flush();
    assert_eq!(r.read(s).unwrap(), 3);
    assert_eq!(r.read(o).unwrap(), 6);
    resolve(&mut r, "f");
    assert_eq!(r.read(s).unwrap(), 3);
    assert_eq!(r.read(o).unwrap(), 0);
}
#[test]
fn held_write_and_lane_are_separate() {
    let mut r = Runtime::default();
    let root = r.create_root();
    let likes = r.with_owner(Some(root), |r| r.signal(0));
    let shown = r.with_owner(Some(root), |r| {
        r.optimistic(Rc::new(move |r, _| r.read(likes)))
    });
    assert_eq!(r.read(shown).unwrap(), 0);
    r.action(Box::new(Body(
        vec![W::Guess(shown, 1), W::Set(likes, 7)],
        "f",
    )));
    r.flush();
    assert_eq!(r.read(likes).unwrap(), 0);
    assert_eq!(r.read(shown).unwrap(), 1);
    resolve(&mut r, "f");
    assert_eq!(r.read(likes).unwrap(), 7);
    assert_eq!(r.read(shown).unwrap(), 7);
}
#[test]
fn updater_composes_before_flush() {
    let mut r = Runtime::default();
    let n = r.optimistic_value(0);
    r.action(Box::new(Body(vec![W::Bump(n), W::Bump(n)], "f")));
    r.flush();
    assert_eq!(r.read(n).unwrap(), 2);
    resolve(&mut r, "f");
    assert_eq!(r.read(n).unwrap(), 0);
}
#[test]
fn same_tick_actions_remain_open_until_both_return() {
    let mut r = Runtime::default();
    let n = r.signal(0);
    r.action(Box::new(Body(vec![W::Set(n, 1)], "a")));
    r.action(Box::new(Body(vec![W::Set(n, 2)], "b")));
    r.flush();
    resolve(&mut r, "a");
    assert_eq!(r.read(n).unwrap(), 0);
    resolve(&mut r, "b");
    assert_eq!(r.read(n).unwrap(), 2);
}
/// docs/slice1-fuzz/final/reduced-scalar-actions-compute-effect_cleanup.json:
/// the flush first computes the staged truth (s = 3 staged, guess not yet
/// applied: 3 + 1 = 4, held with the action's transaction), then the seam
/// applies the guess and the effect re-derives as lane work, reading s's
/// committed 2 as a stale reader beside the guess 7: it shows 9.
#[test]
fn staged_truth_pass_precedes_the_lane_presentation() {
    let mut r = Runtime::default();
    let log = Rc::new(RefCell::new(Vec::<String>::new()));
    let root = r.create_root();
    let s = r.with_owner(Some(root), |r| r.signal(2));
    let o = r.with_owner(Some(root), |r| r.optimistic_value(1));
    let (l1, l2) = (log.clone(), log.clone());
    r.with_owner(Some(root), |r| {
        r.render_effect(
            Rc::new(move |r, p| {
                l1.borrow_mut().push(format!("compute {p:?}"));
                Ok(r.read(s)? + r.read(o)?)
            }),
            Rc::new(move |_, v, p| {
                l2.borrow_mut().push(format!("effect {v} {p:?}"));
                None
            }),
        )
    });
    struct Slices(usize, usize);
    impl ActionBody for Slices {
        fn step(&mut self, rt: &mut Runtime, input: Resume) -> ActionStep {
            match input {
                Resume::Start => {
                    rt.optimistic_write(self.1, 7);
                    rt.write(self.0, 3);
                    ActionStep::Yield("f0".into())
                }
                Resume::Value(_) => {
                    rt.write(self.0, 2);
                    ActionStep::Return
                }
                Resume::Error(e) => ActionStep::Throw(e),
            }
        }
    }
    r.action(Box::new(Slices(s, o)));
    r.flush();
    assert_eq!(
        *log.borrow(),
        [
            "compute None",
            "effect 3 None",
            "compute Some(3)",
            "compute Some(4)",
            "effect 9 Some(3)"
        ]
    );
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
