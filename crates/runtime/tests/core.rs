use rust_solid::*;
use std::{cell::RefCell, rc::Rc};
#[test]
fn writes_are_stale_until_flush_and_coalesce() {
    let r = Runtime::<i64>::new();
    let s = r.signal(1);
    s.set(2);
    assert_eq!(s.get(), Ok(1));
    s.set(3);
    r.flush();
    assert_eq!(s.get(), Ok(3));
}
#[test]
fn split_effects_render_before_user_and_cleanup() {
    let r = Runtime::<i64>::new();
    let owner = r.create_owner(None, None);
    let s = r.signal(0);
    let logs = Rc::new(RefCell::new(vec![]));
    r.with_owner(owner, || {
        for (name, kind) in [("user", EffectKind::User), ("render", EffectKind::Render)] {
            let s = s.clone();
            let l = logs.clone();
            r.effect(
                Rc::new(move |_, _| s.get().map(Computation::Ready)),
                Rc::new(move |v, _| {
                    l.borrow_mut().push((name, v));
                    None
                }),
                kind,
                None,
                false,
            );
        }
    });
    assert_eq!(*logs.borrow(), vec![("render", 0)]);
    r.flush();
    s.set(1);
    r.flush();
    assert_eq!(
        *logs.borrow(),
        vec![("render", 0), ("user", 0), ("render", 1), ("user", 1)]
    );
    r.dispose(owner);
    s.set(2);
    r.flush();
    assert_eq!(logs.borrow().len(), 4);
}
#[test]
fn async_is_loading_then_pending_and_old_answers_are_ignored() {
    let r = Runtime::<i64>::new();
    let s = r.signal(0);
    let ss = s.clone();
    let m = r.memo(
        Rc::new(move |_, _| Ok(Computation::Await(format!("f{}", ss.get()?)))),
        MemoOptions::default(),
    );
    assert!(r.is_loading(m));
    assert!(!r.is_pending(m));
    r.settle("f0".into(), Ok(10));
    r.drain();
    assert_eq!(r.read(m), Ok(10));
    s.set(1);
    r.flush();
    assert!(r.is_pending(m));
    assert_eq!(r.read(m), Ok(10));
    s.set(2);
    r.flush();
    r.settle("f1".into(), Ok(11));
    r.drain();
    assert_eq!(r.read(m), Ok(10));
    r.settle("f2".into(), Ok(12));
    r.drain();
    assert_eq!(r.read(m), Ok(12));
}
#[test]
fn action_failure_commits_intent_and_reverts_guess() {
    let r = Runtime::<i64>::new();
    let s = r.signal(0);
    let o = r.signal_with(0, None, true);
    let ss = s.clone();
    let oo = o.clone();
    let mut first = true;
    r.action(Box::new(move |_, input| {
        if first {
            first = false;
            ss.set(1);
            oo.set(9);
            ActionStep::Yield("save".into())
        } else {
            assert!(input.is_err());
            ActionStep::Fail("no".into())
        }
    }));
    r.flush();
    assert_eq!(s.get(), Ok(0));
    assert_eq!(r.latest(s.id()), Ok(1));
    assert_eq!(o.get(), Ok(9));
    r.settle("save".into(), Err(ReadError::Failed("no".into())));
    r.drain();
    assert_eq!(s.get(), Ok(1));
    assert_eq!(o.get(), Ok(0));
}
#[test]
fn cleanup_is_children_then_reverse_registration() {
    let r = Runtime::<i64>::new();
    let a = r.create_owner(None, None);
    let b = r.create_owner(Some(a), None);
    let log = Rc::new(RefCell::new(vec![]));
    for (o, v) in [(a, 1), (a, 2), (b, 3)] {
        let log = log.clone();
        r.with_owner(o, || r.on_cleanup(move || log.borrow_mut().push(v)));
    }
    r.dispose(a);
    r.dispose(a);
    assert_eq!(*log.borrow(), vec![3, 2, 1]);
}

#[test]
fn completed_flights_still_need_a_continuation_turn() {
    let r = Runtime::<i64>::new();
    r.settle("ready".into(), Ok(7));
    let m = r.memo(
        Rc::new(|_, _| Ok(Computation::Await("ready".into()))),
        MemoOptions::default(),
    );
    assert_eq!(r.read(m), Err(ReadError::Pending));
    assert!(r.has_work());
    r.drain();
    assert_eq!(r.read(m), Ok(7));
}
#[test]
fn loading_value_is_a_real_initial_commit() {
    let r = Runtime::<i64>::new();
    let m = r.memo(
        Rc::new(|_, prev| {
            assert_eq!(prev, Some(0));
            Ok(Computation::Await("f".into()))
        }),
        MemoOptions {
            loading_value: Some(0),
            ..Default::default()
        },
    );
    assert_eq!(r.read(m), Ok(0));
    assert!(!r.is_pending(m));
    assert!(!r.is_loading(m));
    r.settle("f".into(), Ok(5));
    r.drain();
    assert_eq!(r.read(m), Ok(5));
}
#[test]
fn handled_error_keeps_apply_cleanup_until_recovery_or_disposal() {
    let r = Runtime::<i64>::new();
    let owner = r.create_owner(None, None);
    let s = r.signal(1);
    let ss = s.clone();
    let count = Rc::new(RefCell::new(0));
    let cc = count.clone();
    r.with_owner(owner, || {
        r.effect(
            Rc::new(move |_, _| {
                if ss.get()? == 0 {
                    Err(ReadError::Failed("bad".into()))
                } else {
                    Ok(Computation::Ready(1))
                }
            }),
            Rc::new(move |_, _| {
                let cc = cc.clone();
                Some(Box::new(move || *cc.borrow_mut() += 1))
            }),
            EffectKind::User,
            Some(Rc::new(|_| {})),
            false,
        )
    });
    r.flush();
    s.set(0);
    r.flush();
    assert_eq!(*count.borrow(), 0);
    r.dispose(owner);
    assert_eq!(*count.borrow(), 1);
}
#[test]
fn errors_reach_the_nearest_owner_handler() {
    let r = Runtime::<i64>::new();
    let seen = Rc::new(RefCell::new(vec![]));
    let s = seen.clone();
    let root = r.create_owner(None, Some(Rc::new(move |e| s.borrow_mut().push(e))));
    let child = r.create_owner(Some(root), None);
    r.with_owner(child, || {
        r.effect(
            Rc::new(|_, _| Err(ReadError::Failed("bad".into()))),
            Rc::new(|_, _| None),
            EffectKind::User,
            None,
            false,
        )
    });
    r.flush();
    assert_eq!(*seen.borrow(), vec!["bad"]);
    assert!(r.take_errors().is_empty());
}
#[test]
fn same_tick_actions_hold_until_both_finish() {
    let r = Runtime::<i64>::new();
    let s = r.signal(0);
    for (f, v) in [("a", 1), ("b", 2)] {
        let s = s.clone();
        let mut first = true;
        r.action(Box::new(move |_, _| {
            if first {
                first = false;
                s.set(v);
                ActionStep::Yield(f.into())
            } else {
                ActionStep::Done
            }
        }));
    }
    r.flush();
    assert_eq!(s.get(), Ok(0));
    r.settle("a".into(), Ok(1));
    r.drain();
    assert_eq!(s.get(), Ok(0));
    r.settle("b".into(), Ok(1));
    r.drain();
    assert_eq!(s.get(), Ok(2));
}
#[test]
fn lazy_release_keeps_previous_committed_value() {
    let r = Runtime::<i64>::new();
    let m = r.memo(
        Rc::new(|_, prev| Ok(Computation::Ready(prev.unwrap_or(0) + 1))),
        MemoOptions {
            lazy: true,
            ..Default::default()
        },
    );
    assert_eq!(r.read(m), Ok(1));
    r.flush();
    assert_eq!(r.read(m), Ok(2));
}
#[test]
fn plain_signal_outlives_its_creation_owner() {
    let r = Runtime::<i64>::new();
    let o = r.create_owner(None, None);
    let s = r.with_owner(o, || r.signal(1));
    r.dispose(o);
    s.set(2);
    r.flush();
    assert_eq!(s.get(), Ok(2));
}

#[test]
fn refresh_of_the_same_resolved_promise_does_not_reenter_pending() {
    let r = Runtime::<i64>::new();
    let m = r.memo(
        Rc::new(|_, _| Ok(Computation::Await("same".into()))),
        MemoOptions::default(),
    );
    r.settle("same".into(), Ok(4));
    r.drain();
    r.refresh(m);
    r.flush();
    assert_eq!(r.read(m), Ok(4));
    assert!(!r.is_pending(m));
}
#[test]
fn old_error_stays_visible_while_next_request_is_pending() {
    let r = Runtime::<i64>::new();
    let s = r.signal(0);
    let ss = s.clone();
    let m = r.memo(
        Rc::new(move |_, _| Ok(Computation::Await(format!("f{}", ss.get()?)))),
        MemoOptions::default(),
    );
    r.settle("f0".into(), Ok(10));
    r.drain();
    s.set(1);
    r.flush();
    r.settle("f1".into(), Err(ReadError::Failed("bad".into())));
    r.drain();
    s.set(2);
    r.flush();
    assert_eq!(r.read(m), Err(ReadError::Failed("bad".into())));
    assert_eq!(r.latest(m), Ok(10));
    assert!(r.is_pending(m));
    r.settle("f2".into(), Ok(20));
    r.drain();
    assert_eq!(r.read(m), Ok(20));
}
#[test]
fn idle_lazy_memos_release_before_source_work_runs() {
    let r = Runtime::<i64>::new();
    let s = r.signal(0);
    let ss = s.clone();
    let calls = Rc::new(RefCell::new(0));
    let count = calls.clone();
    let m = r.memo(
        Rc::new(move |_, _| {
            *count.borrow_mut() += 1;
            ss.get().map(Computation::Ready)
        }),
        MemoOptions {
            lazy: true,
            ..Default::default()
        },
    );
    assert_eq!(r.read(m), Ok(0));
    s.set(1);
    r.flush();
    assert_eq!(*calls.borrow(), 1);
    assert_eq!(r.read(m), Ok(1));
    assert_eq!(*calls.borrow(), 2);
}
