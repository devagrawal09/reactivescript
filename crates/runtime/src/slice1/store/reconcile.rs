//! Solid: store/reconcile.ts — the immutable-diff adoption channel.
//!
//! Not ported: symbol keys on records and chained (proxy) bases — each
//! panics where it would be taken.
use super::super::*;
use super::store::raw;

/// The row key fn of a reconcile (`keyFn`, reconcile.ts:55): `item?.[key]`
/// — a proxy row answers through its trap.
pub(in crate::slice1) type KeyFn = Option<Rc<str>>;

/// A `prevByKey` entry: one index, or the indices of duplicate keys.
enum Slots {
    One(usize),
    Many(Vec<usize>),
}

impl Runtime {
    /// `keyFn(item)` = `item?.[key]`.
    // Solid: reconcile.ts:54-55 (`keyFn`)
    pub(in crate::slice1) fn reconcile_key(
        &mut self,
        key: &Rc<str>,
        item: &Value,
    ) -> Result<Value, Error> {
        self.js_get(item, &Key::name(key))
    }

    // Solid: reconcile.ts:45-87
    pub(in crate::slice1) fn reconcile_state(
        &mut self,
        value: &Value,
        state: &Value,
        key: KeyFn,
        replace: bool,
    ) -> Result<(), Error> {
        let t = self.target_of(state).expect("reconcile of a store proxy");
        if *state != Value::Proxy(t) {
            panic!("reconcile target is not a store proxy");
        }
        if self.user_writing() && self.st(t).fam.is_some_and(|f| self.store.families[f].opt) {
            let incoming = self.unwrap_value(value);
            return self.reconcile_draft(state, &incoming, &key);
        }
        if replace && value != state && self.target_of(value).is_some() {
            panic!("a replace-mode reconcile chaining to another store (§7b) is not ported");
        }
        let incoming = self.unwrap_value(value);
        if let Some(k) = &key {
            let prev = Value::Obj(
                self.st(t)
                    .pb
                    .clone()
                    .unwrap_or_else(|| self.st(t).v.clone()),
            );
            let eq = self.reconcile_key(k, &prev)?;
            if !eq.is_undef() && self.reconcile_key(k, &incoming)? != eq {
                if !replace {
                    return Err(error::user(String::new()));
                }
                panic!("a replace-mode reconcile of a different root entity is not ported");
            }
        }
        self.apply_adopt(t, &raw(&incoming), &key, replace)
    }

    // Solid: reconcile.ts:92-288
    fn apply_adopt(
        &mut self,
        t: TargetId,
        incoming: &Obj,
        key_fn: &KeyFn,
        proj: bool,
    ) -> Result<(), Error> {
        if self.st(t).ovl {
            panic!("prototype-overlay drafts (#3044) are not ported");
        }
        let old = self
            .st(t)
            .pb
            .clone()
            .unwrap_or_else(|| self.st(t).v.clone());
        if Rc::ptr_eq(incoming, &old) && !self.is_owned(&Value::Obj(old.clone())) {
            return Ok(());
        }
        let is_opt = self.st(t).fam.is_some_and(|f| self.store.families[f].opt);
        let prev_view = if is_opt {
            self.optimistic_view(t, &old, Pick::Shown, false)?
        } else {
            old.clone()
        };
        let next_arr = incoming.array;
        let shallow = self.st(t).s;
        self.adopt_pb(t, incoming, false);
        if shallow {
            self.mark_raw_ingest(incoming);
        }
        // The deep witness (`dk`) exists only for `deep()`: `bumped` is true.
        if prev_view.array != next_arr {
            self.notify_fold(t, &old, incoming);
            return Ok(());
        }
        if next_arr {
            let nodes = self.st(t).n.clone();
            let mut nodes_hit = 0usize;
            if let Some(kf) = key_fn.as_ref().filter(|_| !shallow) {
                let plen = prev_view.len() as usize;
                let nlen = incoming.len() as usize;
                let mut i = 0usize;
                let end = plen.min(nlen);
                while i < end {
                    let nv = incoming.get(&Key::Idx(i as u32));
                    let pv_raw = prev_view.get(&Key::Idx(i as u32));
                    if pv_raw != nv && !self.same_row(&pv_raw, &nv, &Some(kf.clone()))? {
                        break;
                    }
                    if nv.is_object() && (pv_raw != nv || self.is_owned(&nv)) {
                        let pv = self.unwrap_value(&pv_raw);
                        self.descend(&pv, &nv, key_fn, proj, t, &Key::Idx(i as u32))?;
                    }
                    if let Some(node) = nodes.as_ref().and_then(|n| n.get(&Key::Idx(i as u32))) {
                        nodes_hit += 1;
                        let ov = old.get(&Key::Idx(i as u32));
                        self.notify_key_value(node, &Key::Idx(i as u32), &ov, &nv, &old, incoming);
                    }
                    i += 1;
                }
                let struct_start = i;
                let mut prev_by_key: Option<Vec<(Value, Slots)>> = None;
                while i < incoming.len() as usize {
                    let nv = incoming.get(&Key::Idx(i as u32));
                    if nv.is_object() {
                        let nk = self.reconcile_key(kf, &nv)?;
                        let pv;
                        if !nk.is_undef() {
                            if prev_by_key.is_none() {
                                let mut m: Vec<(Value, Slots)> = vec![];
                                for j in struct_start..prev_view.len() as usize {
                                    let p = self.unwrap_value(&prev_view.get(&Key::Idx(j as u32)));
                                    if p.is_object() {
                                        let pk = self.reconcile_key(kf, &p)?;
                                        if pk.is_undef() {
                                            continue;
                                        }
                                        match m.iter_mut().find(|(k, _)| *k == pk) {
                                            None => m.push((pk, Slots::One(j))),
                                            Some((_, Slots::Many(v))) => v.push(j),
                                            Some((_, slot)) => {
                                                let Slots::One(first) = *slot else {
                                                    unreachable!()
                                                };
                                                *slot = Slots::Many(vec![first, j]);
                                            }
                                        }
                                    }
                                }
                                prev_by_key = Some(m);
                            }
                            let m = prev_by_key.as_mut().unwrap();
                            let at = m.iter().position(|(k, _)| *k == nk);
                            pv = match at {
                                None => Value::Undef,
                                Some(at) => match &mut m[at].1 {
                                    Slots::Many(v) => {
                                        let j = v.remove(0);
                                        let p =
                                            self.unwrap_value(&prev_view.get(&Key::Idx(j as u32)));
                                        if let Slots::Many(v) = &m[at].1 {
                                            if v.len() == 1 {
                                                m[at].1 = Slots::One(v[0]);
                                            }
                                        }
                                        p
                                    }
                                    Slots::One(j) => {
                                        let j = *j;
                                        m.remove(at);
                                        self.unwrap_value(&prev_view.get(&Key::Idx(j as u32)))
                                    }
                                },
                            };
                        } else {
                            pv = self.unwrap_value(&prev_view.get(&Key::Idx(i as u32)));
                        }
                        self.descend(&pv, &nv, key_fn, proj, t, &Key::Idx(i as u32))?;
                    }
                    if let Some(node) = nodes.as_ref().and_then(|n| n.get(&Key::Idx(i as u32))) {
                        nodes_hit += 1;
                        self.notify_key_diff(node, &Key::Idx(i as u32), &old, incoming);
                    }
                    i += 1;
                }
            } else {
                let dlen = prev_view.len().min(incoming.len());
                let nlen = incoming.len();
                for i in 0..nlen {
                    let nv_p = incoming.get(&Key::Idx(i));
                    if !shallow && i < dlen && nv_p.is_object() {
                        let pv = self.unwrap_value(&prev_view.get(&Key::Idx(i)));
                        self.descend(&pv, &nv_p, key_fn, proj, t, &Key::Idx(i))?;
                    }
                    if let Some(node) = nodes.as_ref().and_then(|n| n.get(&Key::Idx(i))) {
                        nodes_hit += 1;
                        self.notify_key_diff(node, &Key::Idx(i), &old, incoming);
                    }
                }
            }
            if let Some(nodes) = &nodes {
                if nodes_hit < self.st(t).nc {
                    for key in nodes.keys() {
                        let in_range = matches!(key, Key::Idx(i) if i < incoming.len());
                        if !in_range {
                            let node = nodes.get(&key).unwrap();
                            self.notify_key_diff(node, &key, &old, incoming);
                        }
                    }
                }
            }
            self.notify_fold_tail(t, &old, incoming);
            return Ok(());
        }
        let nodes = self.st(t).n.clone();
        let mut nodes_hit = 0usize;
        // `for (const k in incoming)`: enumerable string keys, own (no
        // inherited enumerable keys on a plain record).
        for k in incoming.keys() {
            let nv = incoming.get(&k);
            let mut ov = old.get(&k);
            if ov == nv && !Rc::ptr_eq(&prev_view, &old) {
                ov = prev_view.get(&k);
            }
            let is_obj = nv.is_object();
            let node = nodes.as_ref().and_then(|n| n.get(&k));
            if ov == nv
                && (!is_obj || !self.is_owned(&nv))
                && node.is_none_or(|n| !self.has_accessor_flag(n))
            {
                if node.is_some() {
                    nodes_hit += 1;
                }
                continue;
            }
            if is_obj && !shallow {
                let pv = self.unwrap_value(&prev_view.get(&k));
                self.descend(&pv, &nv, key_fn, proj, t, &k)?;
            }
            if let Some(node) = node {
                nodes_hit += 1;
                self.notify_key_value(node, &k, &ov, &nv, &old, incoming);
            }
        }
        if let Some(nodes) = &nodes {
            if nodes_hit < self.st(t).nc {
                for key in nodes.keys() {
                    if !incoming.has_own(&key) {
                        if key.is("__proto__") {
                            panic!("a removed __proto__ key is not ported");
                        }
                        let node = nodes.get(&key).unwrap();
                        self.notify_key_diff(node, &key, &old, incoming);
                    }
                }
            }
        }
        self.notify_fold_tail(t, &old, incoming);
        Ok(())
    }

    // Solid: reconcile.ts:303-340
    fn descend(
        &mut self,
        pv: &Value,
        nv: &Value,
        key_fn: &KeyFn,
        proj: bool,
        t: TargetId,
        k: &Key,
    ) -> Result<(), Error> {
        if !pv.is_object() {
            return Ok(());
        }
        let fam = self.st(t).fam;
        let nv = self.unwrap_value(nv);
        let mut ct = self.lookup_target(pv, fam);
        let nt = self.lookup_target(&nv, fam);
        if let Some(c) = ct {
            if self.st(c).pk.as_ref() != Some(k) {
                let cpk = self.st(c).pk.clone();
                let tv = self.st(t).v.clone();
                // `ct.pk != k` (loose: "0" == 0 — keys are canonical here).
                if cpk
                    .as_ref()
                    .is_some_and(|p| tv.get(p) == Value::Obj(self.st(c).v.clone()))
                {
                    ct = None;
                } else if self.st(c).u == Some(t) {
                    self.stm(c).pk = Some(k.clone());
                }
            }
        }
        if let Some(n) = nt {
            if Some(n) != ct {
                if Value::Obj(self.st(n).v.clone()) == nv {
                    if self.st(n).u == Some(t) {
                        self.stm(n).pk = Some(k.clone());
                    }
                    return Ok(());
                }
                self.delete_lookup(&nv, fam);
            }
        }
        let Some(ct) = ct else { return Ok(()) };
        if !self.is_wrappable(&nv) {
            return Ok(());
        }
        if self.store.raw_values_used && self.is_raw_value(&nv) {
            return Ok(());
        }
        if self.is_array(pv) != self.is_array(&nv) {
            return Ok(());
        }
        if !matches!(k, Key::Idx(_)) {
            if let Some(kf) = key_fn {
                let pk = self.reconcile_key(kf, pv)?;
                let nk = self.reconcile_key(kf, &nv)?;
                if !pk.is_undef() && !nk.is_undef() && pk != nk {
                    return Ok(());
                }
            }
        }
        if !proj && key_fn.is_some() && !self.st(ct).d {
            return Ok(());
        }
        self.apply_adopt(ct, &raw(&nv), key_fn, proj)
    }
}

/// What `optimisticView` picks of a lane node (`pick`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::slice1) enum Pick {
    /// `shown`: what the lane shows an untracked reader.
    Shown,
    /// `laneValueOf`: the lane's latest.
    Latest,
}
