//! `Show` and `For` of Solid's server build (solid/src/server/flow.ts). Props
//! are getters, as the compiler's hoisted prop constructors (`_P$`) define
//! them: a getter runs where the component reads it.
use super::signals::{create_memo, map_array, Compute, MapOptions, MemoOptions};
use super::value::{call, JsVal, Res};
use super::Server;
use std::rc::Rc;

/// `<Show>`'s props. `keyed` is absent (`undefined`) in every plan app;
/// `fallback` is absent when the plan has no fallback views.
pub struct ShowProps {
    pub when: JsVal,
    pub keyed: bool,
    pub fallback: Option<JsVal>,
    pub children: JsVal,
}

// Solid: flow.ts:131-166 (`Show`): the condition memo (a real memo, at the
// client's child slot 0), an id burned for the client's non-keyed condition
// memo, then the sync memo that picks the branch.
pub fn show(s: &mut Server, props: ShowProps) -> Res<JsVal> {
    let ShowProps {
        when,
        keyed,
        fallback,
        children,
    } = props;
    let condition_value = create_memo(
        s,
        Rc::new(move |s, _| call(s, &when, &[])),
        MemoOptions::default(),
    )?;
    if let Some(o) = s.get_owner() {
        if s.owner(o).id.is_some() && !keyed {
            s.get_next_child_id(o)?;
        }
    }
    let compute: Compute = Rc::new(move |s, _| {
        let when = call(s, &condition_value, &[])?;
        if when.truthy() {
            let child = call(s, &children, &[])?;
            if let JsVal::Fn(f) = &child {
                if f.arity > 0 {
                    // A function child: keyed gets the value, non-keyed an
                    // accessor of it.
                    let w = when.clone();
                    let arg = if keyed {
                        when
                    } else {
                        JsVal::func(0, move |_, _| Ok(w.clone()))
                    };
                    return call(s, &child, &[arg]);
                }
            }
            return Ok(child);
        }
        match &fallback {
            Some(f) => call(s, f, &[]),
            None => Ok(JsVal::Undefined),
        }
    });
    create_memo(
        s,
        compute,
        MemoOptions {
            sync: true,
            ..Default::default()
        },
    )
}

/// `<For>`'s props: `each` is a getter, `children` the row function. Plan
/// apps pass no `keyed` and no `fallback`.
pub struct ForProps {
    pub each: JsVal,
    pub children: JsVal,
    pub fallback: Option<JsVal>,
}

// Solid: flow.ts:63-78 (`For`): `mapArray(() => props.each, props.children,
// options)`, with `fallback` only when the prop is present.
pub fn for_(s: &mut Server, props: ForProps) -> Res<JsVal> {
    let each = props.each;
    let list = JsVal::func(0, move |s, _| call(s, &each, &[]));
    let fallback = props
        .fallback
        .map(|f| JsVal::func(0, move |s, _| call(s, &f, &[])));
    map_array(
        s,
        list,
        props.children,
        MapOptions {
            keyed: None,
            fallback,
        },
    )
}
