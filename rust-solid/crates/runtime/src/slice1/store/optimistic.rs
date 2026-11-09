//! Solid: store/optimistic.ts — optimistic stores on lanes: a user's write
//! is a guess on the written key's node (`optimisticWrite`), a presence
//! guess, and an arrangement guess (`LaneView`) on the container; reads
//! compose the lanes' values over the truth (`optimisticView`); landings
//! re-base (`_laneRebase`) or fold (`fold`) beneath arrangement guesses.
//!
//! Not ported (unreached by tier B; panics where it would be taken): a
//! derive's draft writes over guessed rows (`pairRows`), a user's
//! `reconcile` on an optimistic family (`reconcileDraft`), descriptor reads
//! (`optimisticOwnDescriptor`), `latestView`, and chained views
//! (`rebaseChained`, a store over another store's proxy).
use super::super::value::LaneView;
use super::super::*;
use super::reconcile::Pick;
use super::store::raw;
use super::{OrdSet, SlotKey};
use std::cell::RefCell;

/// `ask`'s answer: the leaves a `refresh()`'s wake skips (`n._subs._sub
/// ._x?._transaction?._lane`), or none.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::slice1) enum AskSkip {
    None,
    Reask,
}

impl Runtime {
    // Solid: optimistic.ts:102-108 (no chained backing: `base[$TARGET]` is
    // undefined)
    fn writer_backing(&self, t: TargetId) -> Obj {
        self.committed(t)
    }

    // Solid: optimistic.ts:115-118
    pub(in crate::slice1) fn optimistic_draft(&mut self, t: TargetId) -> Obj {
        if let Some(pb) = self.st(t).pb.clone() {
            self.store.opt_staged.retain(|(x, _)| *x != t);
            self.store.opt_staged.push((t, pb));
        }
        let base = self.writer_backing(t);
        let view = self
            .optimistic_view(t, &base, Pick::Latest, true)
            .unwrap_or_else(|e| {
                panic!(
                    "a writer's view that throws ({}) is outside tier B",
                    e.message()
                )
            });
        self.clone_raw(&view, t)
    }

    /// `guess(node, key, presence, nv)` (optimistic.ts:134-138; no chained
    /// target): `optimisticWrite(node, () => nv)`.
    fn guess(&mut self, node: NodeId, nv: Value) {
        self.optimistic_write_value(node, nv);
    }

    // Solid: optimistic.ts:120-223
    pub(in crate::slice1) fn notify_optimistic_writes(
        &mut self,
        t: TargetId,
        pb: &Obj,
    ) -> Option<Obj> {
        let base = self.writer_backing(t);
        let old = self
            .optimistic_view(t, &base, Pick::Latest, true)
            .unwrap_or_else(|e| {
                panic!(
                    "a writer's view that throws ({}) is outside tier B",
                    e.message()
                )
            });
        let is_arr = pb.array;
        if self.st(t).ch {
            panic!("an optimistic write over a chained store (§7b) is not ported");
        }
        let mut structural = false;
        for key in pb.own_keys() {
            if is_arr && key.is("length") {
                continue;
            }
            let raw_v = pb.get(&key);
            let nv = self.unwrap_value(&raw_v);
            if !old.has(&key) {
                let n = self.get_node(t, &key, -1);
                self.guess(n, nv);
                let h = self.get_has_node(t, &key);
                self.guess(h, Value::Bool(true));
                structural = true;
            } else {
                let previous = old.get(&key);
                let ov = self.unwrap_value(&previous);
                if ov != nv && !self.targets_equal(&ov, &nv) {
                    let n = self.get_node(t, &key, -1);
                    self.guess(n, nv);
                    if is_arr {
                        structural = true;
                    }
                }
            }
        }
        for key in old.own_keys() {
            if is_arr && key.is("length") {
                continue;
            }
            if pb.has(&key) {
                continue;
            }
            let n = self.get_node(t, &key, -1);
            self.guess(n, Value::Undef);
            let h = self.get_has_node(t, &key);
            self.guess(h, Value::Bool(false));
            structural = true;
        }
        if is_arr && old.len() != pb.len() {
            let n = self.get_node(t, &Key::name("length"), -1);
            self.guess(n, Value::Int(pb.len() as i64));
            structural = true;
        }
        if structural {
            let rows = if is_arr {
                // `pb.map(unwrapValue)`: holes stay holes.
                let out = JsObj::new_array(vec![]);
                for key in pb.own_keys() {
                    if let Key::Idx(_) = key {
                        let v = self.unwrap_value(&pb.get(&key));
                        out.set(&key, v);
                    }
                }
                out.set(&Key::name("length"), Value::Int(pb.len() as i64));
                out
            } else {
                self.shallow_keys(pb)
            };
            let mut removed: Option<Vec<Value>> = None;
            let fam = self.st(t).fam.expect("an optimistic family");
            if let (true, Some(key)) = (is_arr, self.store.families[fam].key.clone()) {
                let mut rem: Vec<Value> = vec![];
                let mut kept: Vec<Value> = vec![];
                let truth = base.elements();
                for r in rows.elements() {
                    let k = self.fam_key_raw(&key, &r);
                    if !k.is_undef() && !kept.contains(&k) {
                        kept.push(k);
                    }
                }
                let n = old.len() as usize;
                let mut all = old.elements();
                all.extend(base.elements());
                for (i, a) in all.iter().enumerate() {
                    let r = self.unwrap_value(a);
                    let k = self.fam_key_raw(&key, &r);
                    if !k.is_undef()
                        && (!kept.contains(&k) || (i < n && truth.contains(&r)))
                        && !rem.contains(&k)
                    {
                        rem.push(k);
                    }
                }
                removed = Some(rem);
            }
            let view = Rc::new(RefCell::new(LaneView {
                rows,
                base: base.clone(),
                removed,
                g: None,
            }));
            let d = self.store.families[fam].node;
            if view.borrow().removed.is_some()
                && d.is_some_and(|d| {
                    self.nodes[d].status & STATUS_PENDING != 0
                        && !(self.nodes[d].flags & REACTIVE_REASK != 0 || self.nodes[d].reask)
                })
            {
                view.borrow_mut().g = Some(None);
            }
            let k = self.get_container_node(t);
            self.optimistic_write_value(k, Value::View(view));
        }
        if self.st(t).dk.is_some() {
            panic!("the deep witness (deep()) is not ported");
        }
        self.mark_overlaid(t);
        let at = self.store.opt_staged.iter().position(|(x, _)| *x == t)?;
        Some(self.store.opt_staged.remove(at).1)
    }

    /// A family key read of a raw row (`fam.key`; a row here is unwrapped).
    // Solid: projection.ts:403-410 (`fam.key` of a raw row)
    pub(in crate::slice1) fn fam_key_raw(&self, key: &Rc<str>, row: &Value) -> Value {
        match row {
            Value::Obj(o) => o.get(&Key::name(key)),
            Value::Proxy(_) | Value::Draft(_) => {
                panic!("a key read of a proxy row inside the optimistic engine is not ported")
            }
            Value::View(_) => Value::Undef,
            _ => Value::Undef,
        }
    }

    /// `unwrapValue` with no materialization (an overlay is never made).
    // Solid: store.ts:230-241 (`unwrapValue`)
    pub(in crate::slice1) fn unwrap_ro(&self, v: &Value) -> Value {
        let Some(t) = self.target_of(v) else {
            return v.clone();
        };
        let fam = self.st(t).fam;
        if *v == Value::Proxy(t) || self.lookup_target(v, fam) == Some(t) {
            let target = self.st(t);
            return Value::Obj(target.pb.clone().unwrap_or_else(|| target.v.clone()));
        }
        v.clone()
    }

    // Solid: optimistic.ts:230-235
    pub(in crate::slice1) fn arrangement(&self, t: TargetId, a: &Value, b: &Value) -> bool {
        let av = matches!(a, Value::View(_));
        let bv = matches!(b, Value::View(_));
        if !av && !bv {
            return false;
        }
        let rows = |v: &Value| match v {
            Value::View(view) => Value::Obj(view.borrow().rows.clone()),
            other => other.clone(),
        };
        let fam = self.st(t).fam.expect("an optimistic family");
        self.arrangement_equal(&rows(a), &rows(b), fam)
    }

    // Solid: optimistic.ts:237-252
    fn row_same(&self, a: &Value, b: &Value, fam: FamId) -> bool {
        if a == b || self.targets_equal(a, b) {
            return true;
        }
        let Some(key) = self.store.families[fam].key.clone() else {
            return false;
        };
        if !self.is_wrappable(a) || !self.is_wrappable(b) {
            return false;
        }
        let a = self.unwrap_ro(a);
        let b = self.unwrap_ro(b);
        let ta = self.lookup_target(&a, Some(fam));
        let tb = self.lookup_target(&b, Some(fam));
        if ta.is_some() || tb.is_some() {
            return ta == tb;
        }
        self.fam_key_raw(&key, &a) == self.fam_key_raw(&key, &b)
    }

    // Solid: optimistic.ts:258-267
    fn echoes(&self, a: &Value, b: &Value) -> bool {
        if a == b {
            return true;
        }
        if !self.is_wrappable(a) || !self.is_wrappable(b) {
            return false;
        }
        let (a, b) = (self.unwrap_ro(a), self.unwrap_ro(b));
        let (Value::Obj(a), Value::Obj(b)) = (&a, &b) else {
            return false;
        };
        let ak = a.keys();
        if a.array != b.array || ak.len() != b.keys().len() {
            return false;
        }
        for k in ak {
            if !b.has_own(&k) || !self.echoes(&a.get(&k), &b.get(&k)) {
                return false;
            }
        }
        true
    }

    // Solid: optimistic.ts:270-276 (`GlobalQueue._echoes`; no cycles in
    // plain data)
    pub(in crate::slice1) fn echoes_hook(&self, guess: &Value, truth: &Value) -> bool {
        self.echoes(guess, truth)
    }

    // Solid: optimistic.ts:278-294
    fn arrangement_equal(&self, a: &Value, b: &Value, fam: FamId) -> bool {
        let (Value::Obj(a), Value::Obj(b)) = (a, b) else {
            panic!("an arrangement that is not a record or an array")
        };
        if a.array != b.array {
            return false;
        }
        if a.array {
            if a.len() != b.len() {
                return false;
            }
            for i in 0..a.len() {
                if !self.row_same(&a.get(&Key::Idx(i)), &b.get(&Key::Idx(i)), fam) {
                    return false;
                }
            }
            return true;
        }
        let ak = a.own_keys();
        if ak.len() != b.own_keys().len() {
            return false;
        }
        ak.iter().all(|k| b.has(k))
    }

    // Solid: optimistic.ts:300-346 (`reconcileDraft`: a user's reconcile
    // on an optimistic family)
    pub(in crate::slice1) fn reconcile_draft(
        &mut self,
        _draft: &Value,
        _incoming: &Value,
        _key: &Option<Rc<str>>,
    ) -> Result<(), Error> {
        panic!("a user's reconcile on an optimistic store (reconcileDraft) is not ported")
    }

    // Solid: optimistic.ts:353-374 (`GlobalQueue._slotTake`). `back`: the
    // node to give a guess back on (`Some`), or whether the re-ask took it.
    pub(in crate::slice1) fn slot_take_hook(&mut self, n: NodeId) -> bool {
        let t = self.nodes[n].host;
        let d = t
            .and_then(|t| self.st(t).fam)
            .and_then(|f| self.store.families[f].node)
            .and_then(|d| self.nodes[d].transaction);
        let g = self.tx_of(n);
        let Some(d) = d.filter(|d| self.txs[*d].lane) else {
            return false;
        };
        let t = t.expect("a slot node");
        if self.same_action(d, g) {
            return false;
        }
        for m in self.nodes_of(t).into_iter().flatten() {
            if self.nodes[m].config & CONFIG_GUESS != 0 && self.tx_of(m) == g {
                self.take(m, d, m != n);
            }
        }
        true
    }

    /// `_slotTake(n, true)`: the slot's node now (optimistic.ts:356-363).
    pub(in crate::slice1) fn slot_take_back(&mut self, n: NodeId) -> NodeId {
        let t = self.nodes[n].host.expect("a slot node");
        let k = self.nodes[n].key.clone();
        self.mark_overlaid(t);
        match k {
            SlotKey::Track => self.get_container_node(t),
            SlotKey::Key(k) if self.nodes[n].eq == Equals::IsEqual => self.get_has_node(t, &k),
            SlotKey::Key(k) => self.get_node(t, &k, -1),
            SlotKey::Deep => panic!("the deep witness (deep()) is not ported"),
        }
    }

    // Solid: optimistic.ts:397-466 (`GlobalQueue._laneRebase`): `Some(b)`
    // is a truthy/falsy answer, `None` is `undefined`.
    pub(in crate::slice1) fn lane_rebase(
        &mut self,
        el: NodeId,
        truth: &Value,
        older: bool,
    ) -> Option<bool> {
        let t = self.nodes[el].host;
        let g_null = t
            .and_then(|t| self.st(t).k)
            .and_then(|k| match &self.nodes[k].lane {
                Some(Value::View(v)) => Some(matches!(v.borrow().g, Some(None))),
                _ => None,
            })
            .unwrap_or(false);
        if !older && !g_null {
            return Some(self.fold(el, truth));
        }
        let Some(t) = t else { return Some(true) };
        if self.nodes[el].key != SlotKey::Track {
            return Some(true);
        }
        let Some(Value::View(view)) = self.nodes[el].lane.clone() else {
            return None;
        };
        let truth_arr = matches!(truth, Value::Obj(o) if o.array);
        if !truth_arr || !view.borrow().rows.array {
            view.borrow_mut().base = raw(truth);
            return None;
        }
        let truth = raw(truth);
        let fam = self.st(t).fam.expect("a family");
        let key = self.store.families[fam].key.clone()?;
        let mut by_key: Vec<(Value, Value)> = vec![];
        for r in truth.elements() {
            let k = if self.is_wrappable(&r) {
                self.fam_key_raw(&key, &r)
            } else {
                Value::Undef
            };
            if !k.is_undef() && !by_key.iter().any(|(x, _)| *x == k) {
                by_key.push((k, r));
            }
        }
        let mut used: Vec<Value> = vec![];
        let removed = view
            .borrow()
            .removed
            .clone()
            .expect("a keyed guess's removed set");
        let mut rows: Vec<Value> = vec![];
        if matches!(view.borrow().g, Some(None)) {
            let d = self.store.families[fam].node.expect("a derive");
            let l = self.tx_of(el);
            self.txs[l].over = self.nodes[d].transaction;
        }
        let guessed = {
            let mut v = view.borrow_mut();
            match v.g.clone() {
                Some(Some(g)) => g,
                _ => {
                    let rows = v.rows.clone();
                    v.g = Some(Some(rows.clone()));
                    rows
                }
            }
        };
        for g in guessed.elements() {
            let k = if self.is_wrappable(&g) {
                self.fam_key_raw(&key, &g)
            } else {
                Value::Undef
            };
            let tr = if k.is_undef() {
                None
            } else {
                by_key.iter().find(|(x, _)| *x == k).map(|(_, r)| r.clone())
            };
            match tr {
                Some(tr) => {
                    rows.push(tr);
                    used.push(k);
                }
                None => {
                    if !removed.contains(&k) {
                        rows.push(g);
                    }
                }
            }
        }
        for r in truth.elements() {
            let k = if self.is_wrappable(&r) {
                self.fam_key_raw(&key, &r)
            } else {
                Value::Undef
            };
            if !k.is_undef() && !used.contains(&k) && !removed.contains(&k) {
                rows.push(r);
            }
        }
        let rows = JsObj::new_array(rows);
        view.borrow_mut().rows = rows.clone();
        view.borrow_mut().base = rows.clone();
        let lane = self.tx_of(el);
        let base = self.committed(t);
        let had_nodes = self.st(t).n.is_some();
        let key_fn = Some(key.clone());
        for i in 0..rows.len() {
            let row = rows.get(&Key::Idx(i));
            let node = if had_nodes {
                self.st(t).n.as_ref().and_then(|n| n.get(&Key::Idx(i)))
            } else {
                None
            };
            match node {
                None => {
                    if !self.opt_same_row(&base.get(&Key::Idx(i)), &row, &key_fn) {
                        let n = self.get_node(t, &Key::Idx(i), -1);
                        self.lane_set(n, row, lane);
                    }
                }
                Some(node) => {
                    let cur = if self.nodes[node].config & CONFIG_OVERRIDE != 0 {
                        self.nodes[node].lane.clone().unwrap_or(Value::Undef)
                    } else {
                        base.get(&Key::Idx(i))
                    };
                    if !self.opt_same_row(&cur, &row, &key_fn) {
                        self.lane_set(node, row, lane);
                    }
                }
            }
        }
        if had_nodes {
            let mut i = rows.len();
            while let Some(node) = self.st(t).n.as_ref().and_then(|n| n.get(&Key::Idx(i))) {
                self.lane_set(node, Value::Undef, lane);
                i += 1;
            }
            let len = self
                .st(t)
                .n
                .as_ref()
                .and_then(|n| n.get(&Key::name("length")));
            if let Some(len) = len {
                if self.nodes[len].config & CONFIG_OVERRIDE != 0 || base.len() != rows.len() {
                    self.lane_set(len, Value::Int(rows.len() as i64), lane);
                }
            }
        }
        Some(true)
    }

    // Solid: optimistic.ts:475-492
    fn fold(&mut self, el: NodeId, truth: &Value) -> bool {
        let k = self.nodes[el].host.and_then(|t| self.st(t).k);
        let l = self.tx_of(el);
        let keyed = k.is_some_and(|k| {
            self.nodes[k].config & CONFIG_OVERRIDE != 0
                && matches!(&self.nodes[k].lane, Some(Value::View(v)) if v.borrow().removed.is_some())
        });
        if !self.txs[l].shown || !keyed {
            return false;
        }
        let guess = self.nodes[el].lane.clone();
        if !self.equals_slot(el, &guess, &Some(truth.clone()))
            && !self.echoes_hook(guess.as_ref().unwrap_or(&Value::Undef), truth)
        {
            self.txs[l].folded = true;
        } else {
            self.truth_confirmed(l);
        }
        if self.txs[l].folded {
            self.insert_subs(el);
        }
        let p = self.txs[l].parent.unwrap_or(l);
        let p = self.resolve_tx(p);
        self.join_future(Some(p));
        true
    }

    // Solid: optimistic.ts:502-517 (`foldedRead`): `None` is NOT_PENDING.
    pub(in crate::slice1) fn folded_read(&mut self, c: Option<NodeId>, el: NodeId) -> Slot {
        if let Some(c) = c {
            let derive = self.nodes[el]
                .host
                .and_then(|t| self.st(t).fam)
                .and_then(|f| self.store.families[f].node);
            if self.nodes[el].config & CONFIG_GUESS == 0
                || self.pass_lane.is_some()
                || self.nodes[c].effect_type == EFFECT_RENDER
                || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0
                || derive == Some(c)
            {
                return None;
            }
            let l = self.tx_of(el);
            let p = self.txs[l].parent.unwrap_or(l);
            let p = self.resolve_tx(p);
            self.join_pass_at(c, p);
        }
        if let Some(p) = self.nodes[el].pending.clone() {
            return Some(p);
        }
        Some(if self.nodes[el].config & CONFIG_SLOT_NODE != 0 {
            self.slot_covered(el)
        } else {
            self.nodes[el].value.clone()
        })
    }

    // Solid: optimistic.ts:519-524
    fn opt_same_row(&self, a: &Value, b: &Value, key_fn: &Option<Rc<str>>) -> bool {
        if a == b {
            return true;
        }
        if !self.is_wrappable(a) || !self.is_wrappable(b) {
            return false;
        }
        let key = key_fn.as_ref().expect("a keyed family");
        let ka = self.fam_key_raw(key, &self.unwrap_ro(a));
        !ka.is_undef() && ka == self.fam_key_raw(key, &self.unwrap_ro(b))
    }

    // Solid: optimistic.ts:529-537
    fn lane_set(&mut self, node: NodeId, value: Value, lane: TxId) {
        if self.nodes[node].config & CONFIG_OVERRIDE == 0 {
            self.nodes[node].config |= CONFIG_OVERRIDE;
            self.list(node, lane);
        } else if self.nodes[node].lane.as_ref() == Some(&value) {
            return;
        }
        self.nodes[node].lane = Some(value);
        if self.nodes[node].subs.is_some() {
            self.lane_dirty(node, lane);
        }
    }

    // Solid: optimistic.ts:546-563 (`pairRows`: a derive's draft writes new
    // objects over guessed rows)
    pub(in crate::slice1) fn pair_rows(&mut self, t: TargetId, _pb: &Obj) {
        let fam = self.st(t).fam.expect("a family");
        if self.store.families[fam]
            .overlaid
            .as_ref()
            .is_some_and(|o| o.size() != 0)
        {
            panic!("a derive's draft writes over guessed rows (pairRows, D-34) are not ported");
        }
    }

    // Solid: optimistic.ts:586-599 (`ask`)
    pub(in crate::slice1) fn opt_ask(&mut self, fam: FamId) -> AskSkip {
        if self.store.families[fam]
            .overlaid
            .as_ref()
            .is_none_or(|o| o.size() == 0)
        {
            return AskSkip::None;
        }
        let d = self.store.families[fam].node.expect("a derive");
        if self.nodes[d].flags & REACTIVE_REASK != 0 {
            return AskSkip::Reask;
        }
        let mut a = !(self.clock as i64);
        let overlaid = self.store.families[fam].overlaid.clone().unwrap();
        let mut i = 0;
        while let Some(entry) = overlaid.at(i) {
            i += 1;
            let Some(g) = entry else { continue };
            if let Some(n) = self.lane_node_of(g, false) {
                match self.pass_lane {
                    None => a = self.clock as i64 + 1,
                    Some(p) => {
                        let tn = self.tx_of(n);
                        if self.same_action(tn, p) {
                            return AskSkip::None;
                        }
                    }
                }
            }
        }
        self.store.families[fam].asked = Some(a);
        if a > 0 {
            self.join_future(None);
        }
        AskSkip::None
    }

    /// The skip fn `ask` returns for a `refresh()`.
    // Solid: optimistic.ts:588 (`ask`'s skip fn)
    pub(in crate::slice1) fn ask_skips(&self, skip: AskSkip, n: NodeId) -> bool {
        match skip {
            AskSkip::None => false,
            AskSkip::Reask => {
                let first = self.nodes[n].subs.expect("a subscribed leaf");
                let sub = self.links[first].sub;
                self.nodes[sub]
                    .transaction
                    .is_some_and(|t| self.txs[t].lane)
            }
        }
    }

    // Solid: optimistic.ts:620-636 (`stands`)
    pub(in crate::slice1) fn opt_stands(&mut self, t: TargetId) -> Result<bool, Error> {
        let f = self.st(t).fam.expect("a family");
        let o_size = self.store.families[f]
            .overlaid
            .as_ref()
            .map_or(0, |o| o.size());
        let o_has = self.store.families[f]
            .overlaid
            .as_ref()
            .is_some_and(|o| o.has(t));
        let a = self.store.families[f].asked;
        let d = self.store.families[f].node.expect("a derive");
        let c = self.context;
        let clock = self.clock as i64;
        if o_size == 0
            || (a == Some(clock + 1) && self.pass_lane.is_none() && !o_has)
            || a == Some(!clock)
        {
            return Ok(false);
        }
        // (`heldC === c`: `heldC` is only ever a reader, so a null `c` never matches.)
        let j = c.is_some() && self.store.held_c == c && self.store.held_at == self.clock;
        if let Some(cn) = c {
            if self.linked_to(cn, d) {
                return Ok(j && self.store.held_v > 1);
            }
        }
        let g_null = self
            .st(t)
            .k
            .and_then(|k| match &self.nodes[k].lane {
                Some(Value::View(v)) => Some(matches!(v.borrow().g, Some(None))),
                _ => None,
            })
            .unwrap_or(false);
        if let Some(cn) = c {
            if g_null && self.nodes[cn].status & STATUS_PENDING != 0 {
                if self.nodes[cn].effect_type == EFFECT_RENDER {
                    self.read_node(d)?;
                } else {
                    let v = if j {
                        self.store.held_v
                    } else {
                        self.store.held_c = Some(cn);
                        self.store.held_at = self.clock;
                        self.store.held_v = u8::from(self.held(cn, &mut vec![]));
                        self.store.held_v
                    };
                    if v != 0 {
                        if self.nodes[d].transaction.is_some() {
                            self.link(d, cn);
                            let td = self.tx_of(d);
                            self.stale_reader(cn, td);
                            self.store.held_v = 2;
                        } else {
                            self.read_node(d)?;
                        }
                    }
                }
            }
        }
        Ok(true)
    }

    // Solid: optimistic.ts:640-647 (`park`)
    pub(in crate::slice1) fn opt_park(&mut self, t: TxId) {
        let fams = self.store.overlaid_families.clone();
        let mut i = 0;
        while let Some(entry) = fams.at(i) {
            i += 1;
            let Some(fam) = entry else { continue };
            if self.store.families[fam].asked != Some(self.clock as i64 + 1) {
                continue;
            }
            let overlaid = self.store.families[fam]
                .overlaid
                .clone()
                .unwrap_or_default();
            let mut j = 0;
            while let Some(e) = overlaid.at(j) {
                j += 1;
                let Some(g) = e else { continue };
                if let Some(n) = self.lane_node_of(g, true) {
                    let tn = self.tx_of(n);
                    let p = self.txs[tn].parent.expect("a lane's parent");
                    self.merge(p, t);
                }
            }
        }
    }

    // Solid: optimistic.ts:654-663
    fn held(&self, c: NodeId, seen: &mut Vec<NodeId>) -> bool {
        let mut s = self.nodes[c].subs;
        while let Some(l) = s {
            let r = self.links[l].sub;
            s = self.links[l].next_sub;
            if self.nodes[r].status & STATUS_PENDING != 0
                && (self.nodes[r].effect_type == EFFECT_RENDER
                    || (self.nodes[r].effect_type == 0 && !seen.contains(&r) && {
                        seen.push(r);
                        self.held(r, seen)
                    }))
            {
                return true;
            }
        }
        false
    }

    // Solid: optimistic.ts:670-672
    pub(in crate::slice1) fn same_action(&self, a: TxId, b: TxId) -> bool {
        self.resolve_tx(self.txs[a].parent.expect("a lane"))
            == self.resolve_tx(self.txs[b].parent.expect("a lane"))
    }

    // Solid: optimistic.ts:674-678
    fn shallow_keys(&mut self, o: &Obj) -> Obj {
        let out = JsObj::new_object(vec![]);
        for k in o.own_keys() {
            let v = self.unwrap_value(&o.get(&k));
            out.set(&k, v);
        }
        out
    }

    // Solid: optimistic.ts:687-691
    pub(in crate::slice1) fn mark_overlaid(&mut self, t: TargetId) {
        let fam = self.st(t).fam.expect("an optimistic family");
        self.store.families[fam]
            .overlaid
            .get_or_insert_with(OrdSet::default)
            .add(t);
        self.store.overlaid_families.add(fam);
    }

    // Solid: optimistic.ts:693-708
    pub(in crate::slice1) fn sweep_overlaid(&mut self) {
        if self.store.overlaid_families.size() == 0 {
            return;
        }
        let mut i = 0;
        while let Some(entry) = self.store.overlaid_families.at(i) {
            i += 1;
            let Some(fam) = entry else { continue };
            let mut j = 0;
            while let Some(e) = self.store.families[fam].overlaid.as_ref().unwrap().at(j) {
                j += 1;
                let Some(t) = e else { continue };
                if self.lane_node_of(t, false).is_none() {
                    self.store.families[fam]
                        .overlaid
                        .as_mut()
                        .unwrap()
                        .delete(t);
                    if self.st(t).ch {
                        panic!("a chained view's re-base (rebaseChained, §7b) is not ported");
                    }
                    if let Some(k) = self.st(t).k {
                        if let Value::View(v) = &self.nodes[k].value {
                            let base = v.borrow().base.clone();
                            self.nodes[k].value = Value::Obj(base);
                        }
                    }
                }
            }
            if self.store.families[fam].overlaid.as_ref().unwrap().size() == 0 {
                self.store.overlaid_families.delete(fam);
            }
        }
    }

    // Solid: optimistic.ts:763-768
    pub(in crate::slice1) fn nodes_of(&self, t: TargetId) -> Vec<Option<NodeId>> {
        let target = self.st(t);
        let mut all = vec![target.k, target.dk];
        for r in [&target.n, &target.h].into_iter().flatten() {
            for k in r.keys() {
                all.push(r.get(&k));
            }
        }
        all
    }

    // Solid: optimistic.ts:771-777
    pub(in crate::slice1) fn lane_node_of(&self, t: TargetId, read: bool) -> Option<NodeId> {
        for n in self.nodes_of(t).into_iter().flatten() {
            if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
                if !read {
                    return Some(n);
                }
                let mut s = self.nodes[n].subs;
                while let Some(l) = s {
                    let sub = self.links[l].sub;
                    if self.links[l].gen == self.nodes[sub].dep_gen {
                        return Some(n);
                    }
                    s = self.links[l].next_sub;
                }
            }
        }
        None
    }

    // Solid: optimistic.ts:779-782
    fn overlaid(&self, t: TargetId) -> bool {
        let Some(fam) = self.st(t).fam else {
            return false;
        };
        let f = &self.store.families[fam];
        f.opt && f.overlaid.as_ref().is_some_and(|o| o.has(t))
    }

    // Solid: optimistic.ts:787 (`shown`)
    fn shown(&mut self, n: NodeId) -> Result<Value, Error> {
        self.untrack(|rt| rt.read_node(n))
    }

    // Solid: optimistic.ts:792-799
    pub(in crate::slice1) fn optimistic_has(
        &mut self,
        t: TargetId,
        key: &Key,
    ) -> Result<Option<bool>, Error> {
        if !self.overlaid(t) {
            return Ok(None);
        }
        if let Some(h) = self.st(t).h.as_ref().and_then(|h| h.get(key)) {
            if self.nodes[h].config & CONFIG_OVERRIDE != 0 {
                return Ok(Some(self.shown(h)?.truthy()));
            }
        }
        if let Some(n) = self.st(t).n.as_ref().and_then(|n| n.get(key)) {
            if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
                return Ok(Some(!self.shown(n)?.is_undef()));
            }
        }
        Ok(None)
    }

    /// `pick(node)`.
    // Solid: optimistic.ts:787, 825 (`pick`: `shown` or `laneValueOf`)
    fn pick(&mut self, pick: Pick, n: NodeId) -> Result<Value, Error> {
        match pick {
            Pick::Shown => self.shown(n),
            Pick::Latest => Ok(self.lane_value_of(n).expect("a slot's lane value")),
        }
    }

    // Solid: optimistic.ts:823-870 (the hook's `view`, 568-569: `pick` is
    // `laneValueOf` for the writer's view, `shown` otherwise)
    pub(in crate::slice1) fn optimistic_view(
        &mut self,
        t: TargetId,
        src: &Obj,
        pick: Pick,
        writer: bool,
    ) -> Result<Obj, Error> {
        if !writer && !self.overlaid(t) {
            return Ok(src.clone());
        }
        let mut out: Option<Obj> = None;
        // `[...src]` (no stamp, holes as `undefined`) or `{...src}` (the
        // stamp copied).
        let ensure = |out: &mut Option<Obj>| -> Obj {
            out.get_or_insert_with(|| {
                if src.array {
                    JsObj::new_array(src.elements())
                } else {
                    src.shallow_clone()
                }
            })
            .clone()
        };
        if let Some(nodes) = self.st(t).n.clone() {
            for key in nodes.keys() {
                let Some(node) = self.st(t).n.as_ref().and_then(|n| n.get(&key)) else {
                    continue;
                };
                let ov;
                if self.nodes[node].config & CONFIG_OVERRIDE != 0 {
                    ov = self.pick(pick, node)?;
                } else {
                    if !writer {
                        continue;
                    }
                    match self.pending_guess_of(node) {
                        Some(g) => ov = g,
                        None => {
                            if self.nodes[node].config & CONFIG_HELD == 0 {
                                continue;
                            }
                            ov = self.nodes[node].value.clone();
                        }
                    }
                }
                if key.is("length") && src.array {
                    let cur = out.as_ref().unwrap_or(src).len() as i64;
                    if Value::Int(cur) != ov {
                        ensure(&mut out).set(&Key::name("length"), ov);
                    }
                } else if src.get(&key) != ov || !src.has_own(&key) {
                    ensure(&mut out).set(&key, ov);
                }
            }
        }
        if let Some(has) = self.st(t).h.clone() {
            for key in has.keys() {
                let Some(node) = self.st(t).h.as_ref().and_then(|h| h.get(&key)) else {
                    continue;
                };
                let pv;
                if self.nodes[node].config & CONFIG_OVERRIDE != 0 {
                    pv = self.pick(pick, node)?;
                } else {
                    if !writer {
                        continue;
                    }
                    match self.pending_guess_of(node) {
                        Some(g) => pv = g,
                        None => continue,
                    }
                }
                let view = out.clone().unwrap_or_else(|| src.clone());
                if !pv.truthy() && view.has(&key) {
                    ensure(&mut out).delete(&key);
                }
            }
        }
        Ok(out.unwrap_or_else(|| src.clone()))
    }

    // Solid: optimistic.ts:895-916 (`createOptimisticStore`)
    pub(in crate::slice1) fn create_optimistic_store_internal(
        &mut self,
        f: Option<BodyFn>,
        v: Value,
        key: super::StoreKey,
        seed_loading: bool,
    ) -> Value {
        self.create_projection_internal(f, v, key, seed_loading, true)
    }
}
