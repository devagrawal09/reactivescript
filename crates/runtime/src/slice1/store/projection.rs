//! Solid: store/projection.ts — derived stores: the derive runs in a
//! computed (the firewall) whose pass writes the store through a draft;
//! its answer is adopted through the reconcile channel; the family's
//! status reaches the leaves' readers (`wakeFamily`, `errorFamily`,
//! `settleFamily`).
//!
//! Not ported: a derive that writes its draft (the write override's
//! `mutate`: the ops' derive returns its answer), `wrapCommit` /
//! `aroundDraftWrite` (only `createAsyncStore`-style callers pass them),
//! shallow families, and async-iterator derives.
use super::super::value::DraftProxy;
use super::super::*;
use super::target::Family;
use super::{OrdSet, StoreKey};
use std::collections::HashMap;

/// One derive pass's closure state (`runProjectionComputed`'s locals the
/// flight's `commit` and `onError` close over).
#[derive(Clone)]
pub(in crate::slice1) struct ProjPass {
    pub fam: FamId,
    pub root: TargetId,
    pub key: Option<Rc<str>>,
    pub first: bool,
    pub shadow: Option<Obj>,
    pub draft: Value,
}

impl Runtime {
    // Solid: projection.ts:75-142 (`wrapDraft`: the wrapper is registered
    // as its target's alias)
    pub(in crate::slice1) fn wrap_draft(&mut self, inner: Value) -> Value {
        let shallow = false;
        let px = Value::Draft(DraftProxy::new(inner.clone(), shallow));
        if let Some(t) = self.target_of(&inner) {
            self.set_lookup(&px, t);
        }
        px
    }

    // Solid: projection.ts:144-146 (`JSON.parse(JSON.stringify(v))`)
    fn clone_state(&self, v: &Obj) -> Obj {
        fn deep(v: &Value) -> Value {
            match v {
                Value::Obj(o) if o.array => {
                    let p = o.props.borrow();
                    let mut items = vec![];
                    for i in 0..p.len {
                        items.push(deep(
                            p.idx
                                .get(&i)
                                .expect("a hole serializes as null, outside the op language"),
                        ));
                    }
                    Value::Obj(JsObj::new_array(items))
                }
                Value::Obj(o) => Value::Obj(JsObj::new_object(
                    o.keys()
                        .into_iter()
                        .filter(|k| !o.get(k).is_undef())
                        .map(|k| (Rc::from(k.text().as_str()), deep(&o.get(&k))))
                        .collect(),
                )),
                Value::Int(_) | Value::Bool(_) => v.clone(),
                other => panic!("JSON of {other:?} is outside the op language"),
            }
        }
        match deep(&Value::Obj(v.clone())) {
            Value::Obj(o) => o,
            _ => unreachable!(),
        }
    }

    /// `forEachFamilyNode(fam, fn)` (projection.ts:230-239).
    fn for_each_family_node(&mut self, fam: FamId, f: &mut dyn FnMut(&mut Runtime, NodeId)) {
        let mut i = 0;
        while let Some(entry) = self.store.families[fam].live.at(i) {
            i += 1;
            let Some(t) = entry else { continue };
            if let Some(nodes) = self.st(t).n.clone() {
                for key in nodes.keys() {
                    let n = self
                        .st(t)
                        .n
                        .as_ref()
                        .and_then(|n| n.get(&key))
                        .expect("a leaf released mid-walk is a TypeError");
                    f(self, n);
                }
            }
            if let Some(has) = self.st(t).h.clone() {
                for key in has.keys() {
                    let n = self
                        .st(t)
                        .h
                        .as_ref()
                        .and_then(|h| h.get(&key))
                        .expect("a presence node released mid-walk is a TypeError");
                    f(self, n);
                }
            }
            if let Some(k) = self.st(t).k {
                f(self, k);
            }
            if let Some(dk) = self.st(t).dk {
                f(self, dk);
            }
        }
    }

    // Solid: projection.ts:155-179
    pub(in crate::slice1) fn wake_family(&mut self, fam: FamId) {
        let fw = self.store.families[fam].node.expect("a derive");
        let error = error::not_ready(Some(fw));
        self.store.families[fam].woke = true;
        let skip = self.opt_ask(fam);
        self.for_each_family_node(fam, &mut |rt, n| {
            if rt.nodes[n].subs.is_none() || rt.ask_skips(skip, n) {
                return;
            }
            rt.add_pending_source(n, fw);
            rt.propagate_status(n, STATUS_PENDING, Some(error.clone()));
        });
    }

    // Solid: projection.ts:188-196
    pub(in crate::slice1) fn error_family(&mut self, fam: FamId, error: Option<Error>) {
        self.for_each_family_node(fam, &mut |rt, n| {
            if rt.nodes[n].subs.is_none() {
                return;
            }
            let mut s = rt.nodes[n].subs;
            while let Some(l) = s {
                let sub = rt.links[l].sub;
                s = rt.links[l].next_sub;
                if !(rt.nodes[sub].status & STATUS_ERROR != 0
                    && error::same(&rt.nodes[sub].error, &error))
                {
                    rt.enqueue_sub(sub);
                }
            }
        });
        self.schedule();
    }

    // Solid: projection.ts:201-212
    pub(in crate::slice1) fn settle_family(&mut self, fam: FamId) {
        if !self.store.families[fam].woke {
            return;
        }
        self.store.families[fam].woke = false;
        let fw = self.store.families[fam].node.expect("a derive");
        self.for_each_family_node(fam, &mut |rt, n| {
            if rt.nodes[n].subs.is_some() {
                rt.settle_pending_source(n, fw);
            }
        });
        self.insert_subs(fw);
    }

    // Solid: projection.ts:217-228 (`familyStatus`, the family's `st`)
    pub(in crate::slice1) fn family_status(
        &mut self,
        fam: FamId,
        status: u32,
        error: Option<Error>,
    ) {
        if status & STATUS_PENDING != 0 {
            self.wake_family(fam);
        } else if status == 0 {
            self.settle_family(fam);
        } else if status & STATUS_ERROR != 0 {
            self.error_family(fam, error);
        }
    }

    /// `asking()` (projection.ts:278-279).
    fn asking(&self, owner: NodeId) -> u64 {
        if self.question != 0 {
            return self.question;
        }
        if self.nodes[owner].in_flight.is_some() {
            self.nodes[owner].q
        } else {
            0
        }
    }

    // Solid: projection.ts:301-330 (`commit`, with `wrapCommit` unset)
    pub(in crate::slice1) fn projection_commit(
        &mut self,
        owner: NodeId,
        pass: &ProjPass,
        v: Value,
        wake: bool,
    ) -> Result<(), Error> {
        let mut v = v;
        if let Some(shadow) = &pass.shadow {
            if v.is_undef() || v == Value::Obj(shadow.clone()) {
                v = Value::Obj(self.clone_state(shadow));
            }
        }
        if v != pass.draft && !v.is_undef() {
            // `write()`
            let prev_q = self.question;
            let q = self.asking(owner);
            self.set_question(q);
            let key = pass.key.clone();
            let r = self.store_setter(
                &Value::Proxy(pass.root),
                &mut |rt: &mut Runtime, st: Value| {
                    rt.reconcile_state(&v, &st, key.clone(), true)?;
                    Ok(Value::Undef)
                },
                false,
            );
            self.set_question(prev_q);
            r?;
        }
        if !pass.first || self.nodes[owner].status & STATUS_UNINITIALIZED == 0 {
            self.settle_family(pass.fam);
        }
        if wake {
            self.insert_subs(owner);
        }
        Ok(())
    }

    // Solid: projection.ts:331-345 (`handleAsync`'s `onError`)
    pub(in crate::slice1) fn projection_on_error(
        &mut self,
        owner: NodeId,
        pass: &ProjPass,
        error: Error,
        pending: bool,
    ) {
        if pass.first && self.nodes[owner].status & STATUS_UNINITIALIZED != 0 {
            return;
        }
        if pending {
            self.wake_family(pass.fam);
        } else {
            self.error_family(pass.fam, Some(error));
        }
    }

    // Solid: projection.ts:246-375 (`runProjectionComputed`), inside the
    // computed's body (projection.ts:421-424)
    pub(in crate::slice1) fn run_projection_computed(
        &mut self,
        owner: NodeId,
        root: TargetId,
        derive: BodyFn,
        key: Option<Rc<str>>,
    ) -> Result<Out, Error> {
        let fam = self.st(root).fam.expect("a family");
        if self.store.families[fam].node.is_none() {
            self.store.families[fam].node = Some(owner);
        }
        self.store.families[fam].run += 1;
        let run = self.store.families[fam].run;
        // `observeFlightHook` is installed (verdict.ts).
        if self.store.families[fam].woke || self.store.families[fam].w != 0 {
            self.store.families[fam].w = 0;
            self.nodes[owner].config &= !CONFIG_VERDICT;
        }
        let shadow = if self.nodes[owner].loading {
            let v = self.st(root).v.clone();
            Some(self.clone_state(&v))
        } else {
            None
        };
        let draft = self.wrap_draft(Value::Proxy(root));
        let first = run == 1;
        let pass = ProjPass {
            fam,
            root,
            key,
            first,
            shadow: shadow.clone(),
            draft: draft.clone(),
        };
        let run_pass = |rt: &mut Runtime| -> Result<(), Error> {
            let pass = pass.clone();
            rt.store_setter(
                &draft,
                &mut |rt: &mut Runtime, s: Value| {
                    let arg = match &shadow {
                        Some(sh) => Value::Obj(sh.clone()),
                        None => s,
                    };
                    let result = derive(rt, arg)?;
                    let sync = rt.handle_async_result(owner, result, Some(pass.clone()))?;
                    if !rt.nodes[owner].loading {
                        let wake = rt.nodes[owner].status & (STATUS_PENDING | STATUS_ERROR) != 0;
                        rt.projection_commit(owner, &pass, sync, wake)?;
                    }
                    Ok(Value::Undef)
                },
                false,
            )
        };
        let r = if first {
            self.run_direct(|rt| run_pass(rt))
        } else {
            run_pass(self)
        };
        if let Err(e) = r {
            if !first {
                if e.is_not_ready() {
                    self.wake_family(fam);
                } else {
                    self.error_family(fam, Some(e.clone()));
                }
            }
            return Err(e);
        }
        if self.nodes[owner].status & STATUS_PENDING != 0
            && self.nodes[owner].in_flight.is_some()
            && !self.nodes[owner].loading
            && !first
        {
            self.wake_family(fam);
        }
        Ok(Out::Value(Value::Undef))
    }

    // Solid: projection.ts:379-433
    pub(in crate::slice1) fn create_projection_internal(
        &mut self,
        f: Option<BodyFn>,
        seed: Value,
        key: StoreKey,
        seed_loading: bool,
        opt: bool,
    ) -> Value {
        let seed = if seed.truthy() {
            seed
        } else {
            Value::Obj(JsObj::new_object(vec![]))
        };
        let key_option = match key {
            StoreKey::Field(k) => Some(k),
            StoreKey::Positional => None,
        };
        let fam = self.store.families.len();
        self.store.families.push(Family {
            opt,
            overlaid: None,
            asked: None,
            key: key_option.clone(),
            map: HashMap::new(),
            node: None,
            live: OrdSet::default(),
            shallow: false,
            run: 0,
            woke: false,
            w: 0,
        });
        let store = self.wrap(&seed, None, None, Some(fam));
        let Value::Proxy(root) = store else {
            unreachable!("a fresh target")
        };
        if self.store.families[fam].shallow {
            panic!("shallow families are not ported");
        }
        if let Some(derive) = f {
            let loading = seed_loading.then_some(Value::Undef);
            let node = self.computed_node(
                Body::Projection {
                    root,
                    derive,
                    key: key_option,
                },
                loading,
                0,
            );
            self.nodes[node].config &= !CONFIG_AUTO_DISPOSE;
            self.store.families[fam].node = Some(node);
            self.nodes[node].fam = Some(fam);
        }
        store
    }
}
