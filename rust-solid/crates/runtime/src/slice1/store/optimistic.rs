//! Solid: store/optimistic.ts — optimistic stores (S-59: a guess's slot is
//! the point of write). A user's write to an optimistic store is a guess on
//! a per-target *carrier* (a `$PATCH` slot node holding the whole written
//! frame, one per target per lane), with the keys it wrote (`wk`), deleted
//! (`del`), borrowed from another carrier and, for an array, its guessed
//! arrangement (`g`, `removed`). Reads of a guessed key are served from the
//! carrier's frame (`read`, `has`, `descriptor`, `frame`); landings re-base
//! the arrangement (`_laneRebase`) or fold beneath it (`fold`).
//!
//! Not ported (panics where it would be taken): chained views (a store
//! over another store's proxy, §7b), the deep witness (`deep()`), and
//! adopting a parked frame flight.
use super::super::*;
use super::store::raw;
use super::{Carrier, CarrierRows, OrdSet, SlotKey};

/// `ask`'s answer: the leaves a `refresh()`'s wake skips (`n._subs._sub
/// ._x?._transaction?._lane`), or none.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::slice1) enum AskSkip {
    None,
    Reask,
}

/// `INDEX.test(key)` / `key === "length"`: an arrangement key.
fn arrangement_key(key: &Key) -> bool {
    matches!(key, Key::Idx(_)) || key.is("length")
}

impl Runtime {
    /// `kgOf(t)`: the target's carriers (a copy).
    fn kg_of(&self, t: TargetId) -> Option<Vec<NodeId>> {
        self.store.carriers.get(&t).cloned()
    }
    fn carrier(&self, g: NodeId) -> &Carrier {
        self.store.carrier.get(&g).expect("a guess carrier")
    }
    fn carrier_mut(&mut self, g: NodeId) -> &mut Carrier {
        self.store.carrier.get_mut(&g).expect("a guess carrier")
    }

    // Solid: optimistic.ts `guessFor`: the newest live carrier that wrote
    // (or deleted) `key`, or, a read of an arrangement key, the newest that
    // guessed the arrangement without borrowing it.
    fn guess_for(&self, t: TargetId, key: &Key, _shape: bool, reads: bool) -> Option<NodeId> {
        let kg = self.store.carriers.get(&t)?;
        for &g in kg.iter().rev() {
            let c = self.carrier(g);
            if self.nodes[g].config & (CONFIG_OVERRIDE | CONFIG_HELD) != 0
                && (c.wk.as_ref().is_some_and(|w| w.contains(key))
                    || c.del.as_ref().is_some_and(|d| d.contains(key))
                    || (reads
                        && c.g != CarrierRows::Undef
                        && !c.borrowed.as_ref().is_some_and(|b| b.contains(key))
                        && arrangement_key(key)))
            {
                return Some(g);
            }
        }
        None
    }

    // Solid: optimistic.ts `newestGuess`
    fn newest_guess(&self, t: TargetId) -> Option<NodeId> {
        let kg = self.store.carriers.get(&t)?;
        kg.iter()
            .rev()
            .copied()
            .find(|&g| self.nodes[g].config & (CONFIG_OVERRIDE | CONFIG_HELD) != 0)
    }

    // Solid: optimistic.ts `heldCarrier`: the container node holds a staging.
    fn held_carrier(&self, t: TargetId) -> Option<NodeId> {
        let k = self.st(t).k?;
        (self.nodes[k].config & CONFIG_HELD != 0 && self.nodes[k].pending.is_some()).then_some(k)
    }

    /// `carrierValue(frame, key)`: `frame[key]` (no `__proto__` reads here).
    fn carrier_value(frame: &Value, key: &Key) -> Value {
        match frame {
            Value::Obj(o) => o.get(key),
            _ => Value::Undef,
        }
    }

    // Solid: optimistic.ts `writerBacking` (no chained backing: `base[$TARGET]`
    // is undefined).
    fn writer_backing(&self, t: TargetId, plain: bool) -> Obj {
        let base = self.committed(t);
        if plain {
            base
        } else {
            self.guess_view_writer(t, &base)
        }
    }

    // Solid: optimistic.ts `guessView(t, src, true)`: the writer's frame of
    // the newest carrier with one.
    fn guess_view_writer(&self, t: TargetId, src: &Obj) -> Obj {
        if let Some(kg) = self.store.carriers.get(&t) {
            for &g in kg.iter().rev() {
                if let Some(Value::Obj(v)) = self.writer_frame(g) {
                    return self.owned_keys(t, g, kg, &v);
                }
            }
        }
        src.clone()
    }

    // Solid: optimistic.ts `guessView(t, src)` (the reader's: `view` hook):
    // the newest live carrier's served frame.
    pub(in crate::slice1) fn guess_view(&mut self, t: TargetId, src: &Obj) -> Result<Obj, Error> {
        if let Some(kg) = self.kg_of(t) {
            for &g in kg.iter().rev() {
                if self.nodes[g].config & (CONFIG_OVERRIDE | CONFIG_HELD) != 0 {
                    match self.untrack(|rt| rt.read_node(g))? {
                        Value::Obj(v) => return Ok(v),
                        Value::NotPending => {}
                        other => panic!("a carrier frame that is not a record ({other:?})"),
                    }
                }
            }
        }
        Ok(src.clone())
    }

    // Solid: optimistic.ts `writerFrame`: what a writer composes on — the
    // carrier's guess (pending or live), else its held truth.
    fn writer_frame(&self, g: NodeId) -> Slot {
        if self.nodes[g].config & CONFIG_OVERRIDE != 0 || self.pending_guess_of(g).is_some() {
            let v = self.guessed_value_of(g);
            if v != Value::NotPending {
                return Some(v);
            }
        }
        if self.nodes[g].config & CONFIG_HELD != 0 {
            Some(self.nodes[g].value.clone())
        } else {
            None
        }
    }

    // Solid: optimistic.ts `ownedKeys`: each key from the carrier that owns
    // it (#4988).
    fn owned_keys(&self, t: TargetId, g: NodeId, kg: &[NodeId], v: &Obj) -> Obj {
        let mut out = v.clone();
        if !v.array {
            for &o in kg {
                if o == g {
                    continue;
                }
                let Some(wk) = self.carrier(o).wk.clone() else {
                    continue;
                };
                for key in wk {
                    if self.guess_for(t, &key, false, false) == Some(o) {
                        if let Some(Value::Obj(f)) = self.writer_frame(o) {
                            let fv = f.get(&key);
                            if fv != out.get(&key) {
                                if Rc::ptr_eq(&out, v) {
                                    out = v.shallow_clone();
                                }
                                out.set(&key, fv);
                            }
                        }
                    }
                }
            }
        }
        out
    }

    // Solid: optimistic.ts `optimisticDraft`
    pub(in crate::slice1) fn optimistic_draft(&mut self, t: TargetId) -> Obj {
        if let Some(pb) = self.st(t).pb.clone() {
            self.store.opt_staged.retain(|(x, _)| *x != t);
            self.store.opt_staged.push((t, pb));
        }
        let base = self.writer_backing(t, false);
        self.clone_raw(&base, t)
    }

    // Solid: optimistic.ts `guessCarrier`: the carrier a write's keys go on —
    // the newest live one (or one still waiting to apply), one that wrote
    // the same keys, else a new one (held where the container holds).
    fn guess_carrier(&mut self, t: TargetId, keys: Option<&[Key]>) -> NodeId {
        let kg = self.store.carriers.entry(t).or_default().clone();
        for &g in kg.iter().rev() {
            let live = self.nodes[g].config & (CONFIG_OVERRIDE | CONFIG_GUESS) != 0;
            let pending = self.pending_guess_of(g).is_some();
            if !live && !pending && !(self.nodes[g].config & CONFIG_HELD != 0 && keys.is_some()) {
                continue;
            }
            if pending || (live && keys.is_none()) {
                return self.entangle(t, g, keys);
            }
            let c = self.carrier(g);
            if let Some(wk) = &c.wk {
                if keys
                    .unwrap()
                    .iter()
                    .any(|k| wk.contains(k) || c.del.as_ref().is_some_and(|d| d.contains(k)))
                {
                    return g;
                }
            }
        }
        let v = Value::Obj(self.committed(t));
        let g = self.slot_signal(v, Equals::Patch, t, SlotKey::Patch, false);
        if let Some(p) = self.held_carrier(t) {
            self.nodes[g].pending = self.nodes[p].pending.clone();
            let tp = self.tx_of(p);
            self.hold_node(g, tp);
        }
        self.store.carrier.insert(g, Carrier::default());
        self.store.carriers.get_mut(&t).unwrap().push(g);
        g
    }

    // Solid: optimistic.ts `entangle`: a carrier taking keys another live
    // carrier wrote is the same hold.
    fn entangle(&mut self, t: TargetId, g: NodeId, keys: Option<&[Key]>) -> NodeId {
        if let Some(keys) = keys {
            for o in self.kg_of(t).unwrap_or_default() {
                if o == g || self.nodes[o].config & CONFIG_OVERRIDE == 0 {
                    continue;
                }
                let c = self.carrier(o);
                let Some(wk) = c.wk.as_ref() else { continue };
                if keys
                    .iter()
                    .any(|k| wk.contains(k) || c.del.as_ref().is_some_and(|d| d.contains(k)))
                {
                    let to = self.tx_of(o);
                    let holder = self.resolve_tx(self.txs[to].parent.expect("a lane"));
                    if self.nodes[g].config & CONFIG_OVERRIDE != 0 {
                        let tg = self.tx_of(g);
                        let p = self.resolve_tx(self.txs[tg].parent.expect("a lane"));
                        self.merge(p, holder);
                    } else if self.nodes[g].config & CONFIG_HELD == 0 {
                        self.hold_node(g, holder);
                    }
                    break;
                }
            }
        }
        g
    }

    // Solid: optimistic.ts `reasked`: the derive waits only on re-asks.
    fn reasked(&self, d: NodeId) -> bool {
        if self.nodes[d].flags & REACTIVE_REASK != 0 || self.nodes[d].reask {
            return true;
        }
        let Some(ps) = self.nodes[d].pending_sources else {
            return false;
        };
        let vals = self.set_values(ps);
        if vals.is_empty() {
            return false;
        }
        vals.into_iter()
            .all(|s| s != d && (self.nodes[s].flags & REACTIVE_REASK != 0 || self.nodes[s].reask))
    }

    // Solid: optimistic.ts `patchEquals` (a carrier's `_equals`): two frames
    // are the same guess when its arrangement and written keys echo.
    pub(in crate::slice1) fn patch_equals(&self, node: NodeId, a: &Value, b: &Value) -> bool {
        if a == b {
            return true;
        }
        let frame = |v: &Value| -> Option<Obj> {
            match v {
                Value::Obj(o) => Some(o.clone()),
                Value::Proxy(t) => Some(self.writer_backing(*t, true)),
                _ => None,
            }
        };
        let (Some(a), Some(b)) = (frame(a), frame(b)) else {
            return false;
        };
        let t = self.nodes[node].host.expect("a carrier");
        let fam = self.st(t).fam.expect("an optimistic family");
        let c = self.carrier(node);
        if c.g != CarrierRows::Undef {
            if a.get(&Key::name("length")) != b.get(&Key::name("length")) {
                return false;
            }
            let ae = a.elements();
            for (i, r) in ae.iter().enumerate() {
                if !self.row_same(r, &b.get(&Key::Idx(i as u32)), fam) {
                    return false;
                }
            }
        }
        if let Some(wk) = &c.wk {
            for key in wk {
                if a.has(key) != b.has(key) {
                    return false;
                }
                if !self.echoes_hook(&a.get(key), &b.get(key)) {
                    return false;
                }
            }
        }
        if let Some(del) = &c.del {
            for key in del {
                if a.has(key) != b.has(key) {
                    return false;
                }
            }
        }
        true
    }

    // Solid: optimistic.ts `carriedVerbatim`: a keyed row the write kept as is.
    fn carried_verbatim(&mut self, t: TargetId, old: &Obj, pb: &Obj, key: &Key) -> bool {
        if !matches!(key, Key::Idx(_)) {
            return false;
        }
        let fam = self.st(t).fam;
        if fam
            .and_then(|f| self.store.families[f].key.clone())
            .is_none()
        {
            return false;
        }
        let row = self.unwrap_value(&pb.get(key));
        self.is_wrappable(&row) && row == old.get(key)
    }

    // Solid: optimistic.ts `notifyOptimisticWrites` (the `writes` hook): a
    // user's draft becomes a guess on a carrier.
    pub(in crate::slice1) fn notify_optimistic_writes(
        &mut self,
        t: TargetId,
        pb: &Obj,
    ) -> Option<Obj> {
        let old = self.writer_backing(t, false);
        let is_arr = pb.array;
        if self.st(t).ch {
            panic!("an optimistic write over a chained store (§7b) is not ported");
        }
        let mut changed: Vec<Key> = vec![];
        let mut del: Option<Vec<Key>> = None;
        let mut structural = false;
        let mut shape = false;
        for key in pb.own_keys() {
            let nv = self.unwrap_value(&pb.get(&key));
            if !old.has(&key) {
                changed.push(key);
                structural = true;
                shape = true;
            } else {
                let previous = old.get(&key);
                let ov = self.unwrap_value(&previous);
                if ov != nv && !self.targets_equal(&ov, &nv) {
                    if is_arr && self.echoes(&ov, &nv) {
                        pb.set(&key, previous);
                    } else {
                        changed.push(key);
                        if is_arr {
                            structural = true;
                        }
                    }
                }
            }
        }
        for key in old.own_keys() {
            if pb.has(&key) {
                continue;
            }
            del.get_or_insert_with(Vec::new).push(key);
            structural = true;
            shape = true;
        }
        let staged = match self.store.opt_staged.iter().position(|(x, _)| *x == t) {
            Some(i) => Some(self.store.opt_staged.remove(i).1),
            None => None,
        };
        if changed.is_empty() && del.is_none() {
            return staged;
        }
        let keys: Vec<Key> = match &del {
            None => changed.clone(),
            Some(d) => {
                let mut k = changed.clone();
                for x in d {
                    if !k.contains(x) {
                        k.push(x.clone());
                    }
                }
                k
            }
        };
        let g = self.guess_carrier(t, Some(&keys));
        let q = self.question;
        {
            let c = self.carrier_mut(g);
            if !c.qs.contains(&q) {
                c.qs.push(q);
            }
            match &mut c.wk {
                None => c.wk = Some(changed.clone()),
                Some(wk) => {
                    for k in &changed {
                        if !wk.contains(k) {
                            wk.push(k.clone());
                        }
                    }
                }
            }
            if let Some(d) = &del {
                match &mut c.del {
                    None => c.del = Some(d.clone()),
                    Some(cd) => {
                        for k in d {
                            if !cd.contains(k) {
                                cd.push(k.clone());
                            }
                        }
                    }
                }
            }
        }
        let kg = self.kg_of(t).unwrap_or_default();
        if kg.len() > 1 && !shape && !changed.iter().any(|k| k.is("length")) {
            for &o in &kg {
                if o == g {
                    continue;
                }
                let live = self.nodes[o].config & (CONFIG_OVERRIDE | CONFIG_GUESS | CONFIG_HELD)
                    != 0
                    || self.pending_guess_of(o).is_some();
                if !live {
                    continue;
                }
                let oc = self.carrier(o).clone();
                for key in oc.wk.iter().flatten().chain(oc.del.iter().flatten()) {
                    if !changed.contains(key)
                        && !del.as_ref().is_some_and(|d| d.contains(key))
                        && !self.carried_verbatim(t, &old, pb, key)
                    {
                        let b = self.carrier_mut(g).borrowed.get_or_insert_with(Vec::new);
                        if !b.contains(key) {
                            b.push(key.clone());
                        }
                    }
                }
            }
        }
        if structural && is_arr {
            let fam = self.st(t).fam.expect("an optimistic family");
            let rows: Vec<Value> = pb
                .elements()
                .into_iter()
                .map(|r| self.arrangement_row(fam, &r))
                .collect();
            let mut removed: Option<Vec<Value>> = None;
            if let Some(key) = self.store.families[fam].key.clone() {
                let mut rem: Vec<Value> = vec![];
                let mut kept: Vec<Value> = vec![];
                let base = self.committed(t).elements();
                for r in &rows {
                    if self.is_wrappable(r) {
                        let k = self.row_key(&key, &self.unwrap_ro(r));
                        if !k.is_undef() && !kept.contains(&k) {
                            kept.push(k);
                        }
                    }
                }
                let n = old.len() as usize;
                let mut all = old.elements();
                all.extend(base.iter().cloned());
                for (i, a) in all.iter().enumerate() {
                    let r = self.unwrap_value(a);
                    if !self.is_wrappable(&r) {
                        continue;
                    }
                    let k = self.row_key(&key, &r);
                    if !k.is_undef()
                        && (!kept.contains(&k) || (i < n && base.contains(&r)))
                        && !rem.contains(&k)
                    {
                        rem.push(k);
                    }
                }
                removed = Some(rem);
            }
            let d = self.store.families[fam].node;
            let wait = removed.is_some()
                && d.is_some_and(|d| {
                    self.nodes[d].status & STATUS_PENDING != 0 && !self.reasked(d)
                });
            let c = self.carrier_mut(g);
            c.removed = removed;
            c.g = if wait {
                CarrierRows::Null
            } else {
                CarrierRows::Rows(rows)
            };
        }
        self.optimistic_write_value(g, Value::Obj(pb.clone()));
        if self.st(t).dk.is_some() {
            panic!("the deep witness (deep()) is not ported");
        }
        self.mark_overlaid(t);
        staged
    }

    // Solid: optimistic.ts `arrangementRow`: a row of this family as its
    // raw, another family's proxy as is.
    fn arrangement_row(&mut self, fam: FamId, row: &Value) -> Value {
        match self.target_of(row) {
            Some(rt) if self.st(rt).fam == Some(fam) => self.unwrap_value(row),
            Some(_) => row.clone(),
            None => self.unwrap_value(row),
        }
    }

    // Solid: optimistic.ts `reconcileDraft` (the `reconcile` hook, under
    // `diffing`): a user's returned value or reconcile diffed into the draft.
    pub(in crate::slice1) fn reconcile_draft(
        &mut self,
        draft: &Value,
        incoming: &Value,
        key: &Option<Rc<str>>,
    ) -> Result<(), Error> {
        let prev = self.store.diffing;
        self.store.diffing = true;
        let r = self.reconcile_draft_in(draft, incoming, key);
        self.store.diffing = prev;
        r
    }

    fn reconcile_draft_in(
        &mut self,
        draft: &Value,
        incoming: &Value,
        key: &Option<Rc<str>>,
    ) -> Result<(), Error> {
        let len = Key::name("length");
        if self.is_array(incoming) {
            let inc_len = self.js_get(incoming, &len)?.as_int().unwrap_or(0) as u32;
            let n = self.js_get(draft, &len)?.as_int().unwrap_or(0) as u32;
            let mut prev: Vec<Value> = Vec::with_capacity(n as usize);
            for i in 0..n {
                prev.push(self.js_get(draft, &Key::Idx(i))?);
            }
            let mut by_key: Option<Vec<(Value, Value)>> = None;
            if let Some(k) = key {
                let mut m: Vec<(Value, Value)> = vec![];
                for p in &prev {
                    let raw = self.unwrap_value(p);
                    if !self.is_wrappable(&raw) {
                        continue;
                    }
                    let kv = self.row_key(k, &raw);
                    if !kv.is_undef() && !m.iter().any(|(x, _)| *x == kv) {
                        m.push((kv, p.clone()));
                    }
                }
                by_key = Some(m);
            }
            for i in 0..inc_len {
                let nv = self.js_get(incoming, &Key::Idx(i))?;
                let mut matched: Option<Value> = None;
                if self.is_wrappable(&nv) {
                    if let Some(m) = &by_key {
                        let kv = self.row_key(key.as_ref().unwrap(), &nv);
                        if !kv.is_undef() {
                            matched = m.iter().find(|(x, _)| *x == kv).map(|(_, v)| v.clone());
                        }
                    } else if i < n {
                        let u = self.unwrap_value(&prev[i as usize]);
                        if self.is_wrappable(&u) {
                            matched = Some(prev[i as usize].clone());
                        }
                    }
                }
                match matched {
                    Some(m) => {
                        if self.unwrap_value(&m) != nv {
                            self.reconcile_draft_in(&m, &nv, key)?;
                        }
                        if self.js_get(draft, &Key::Idx(i))? != m {
                            self.js_set(draft, &Key::Idx(i), m)?;
                        }
                    }
                    None => {
                        let cur = self.js_get(draft, &Key::Idx(i))?;
                        if self.unwrap_value(&cur) != nv {
                            self.js_set(draft, &Key::Idx(i), nv)?;
                        }
                    }
                }
            }
            if self.js_get(draft, &len)? != Value::Int(inc_len as i64) {
                self.js_set(draft, &len, Value::Int(inc_len as i64))?;
            }
            return Ok(());
        }
        for k in self.js_keys(incoming) {
            let nv = self.js_get(incoming, &k)?;
            let cur = self.js_get(draft, &k)?;
            let cur_raw = self.unwrap_value(&cur);
            let same_shape = self.is_wrappable(&nv)
                && self.is_wrappable(&cur_raw)
                && self.is_array(&nv) == self.is_array(&cur_raw)
                && (key.is_none()
                    || self.is_array(&nv)
                    || self.row_key(key.as_ref().unwrap(), &nv)
                        == self.row_key(key.as_ref().unwrap(), &cur_raw));
            if same_shape {
                if cur_raw != nv {
                    self.reconcile_draft_in(&cur, &nv, key)?;
                }
            } else if cur_raw != nv {
                self.js_set(draft, &k, nv)?;
            }
        }
        for k in self.js_keys(draft) {
            if !self.js_has(incoming, &k)? {
                self.js_delete(draft, &k)?;
            }
        }
        Ok(())
    }

    /// `Object.keys(v)`: a raw record's keys; a store proxy's inside a write
    /// (the `ownKeys` trap's `readSource` backing, minus deleted keys).
    fn js_keys(&self, v: &Value) -> Vec<Key> {
        match v {
            Value::Obj(o) => o.keys(),
            Value::Proxy(t) if self.in_draft(*t) || self.store.write_override => {
                let st = self.st(*t);
                let src = st.pb.clone().unwrap_or_else(|| st.v.clone());
                let mut keys = src.keys();
                if st.pb.is_some() {
                    if let Some(del) = &st.del {
                        keys.retain(|k| !del.contains(k));
                    }
                }
                keys
            }
            _ => panic!(
                "Object.keys of a store proxy outside a write (the ownKeys trap) is not ported"
            ),
        }
    }

    // Solid: optimistic.ts `readersOf`: the nodes that serve a carrier's keys.
    fn readers_of(&self, n: NodeId) -> Vec<NodeId> {
        let mut out = vec![];
        if self.nodes[n].key != SlotKey::Patch {
            return out;
        }
        let t = self.nodes[n].host.expect("a carrier");
        let c = self.carrier(n);
        let target = self.st(t);
        let each = |keys: &[Key], out: &mut Vec<NodeId>| {
            for key in keys {
                if let Some(leaf) = target.n.as_ref().and_then(|m| m.get(key)) {
                    if self.nodes[leaf].subs.is_some() {
                        out.push(leaf);
                    }
                }
                if let Some(has) = target.h.as_ref().and_then(|m| m.get(key)) {
                    if self.nodes[has].subs.is_some() {
                        out.push(has);
                    }
                }
            }
        };
        each(c.wk.as_deref().unwrap_or(&[]), &mut out);
        if let Some(d) = &c.del {
            each(d, &mut out);
        }
        if let Some(k) = target.k {
            if self.nodes[k].subs.is_some() {
                out.push(k);
            }
        }
        out
    }

    // Solid: optimistic.ts `GlobalQueue._slotDirty`
    pub(in crate::slice1) fn slot_dirty_hook(&mut self, n: NodeId, l: TxId) {
        for node in self.readers_of(n) {
            self.lane_dirty(node, l);
        }
    }

    // Solid: optimistic.ts `GlobalQueue._slotRerun`
    pub(in crate::slice1) fn slot_rerun_hook(&mut self, n: NodeId, t: TxId) {
        for node in self.readers_of(n) {
            let mut s = self.nodes[node].subs;
            while let Some(link) = s {
                let sub = self.links[link].sub;
                s = self.links[link].next_sub;
                self.stale_reader(sub, t);
            }
        }
    }

    // Solid: optimistic.ts `GlobalQueue._slotMerge`: a truth landing on a
    // carrier while its derive re-asks in another action's lane merges the
    // two holds (#5140).
    pub(in crate::slice1) fn slot_merge_hook(&mut self, n: NodeId) {
        let Some(t) = self.nodes[n].host else { return };
        let d = self
            .st(t)
            .fam
            .and_then(|f| self.store.families[f].node)
            .and_then(|d| self.nodes[d].transaction);
        let g = self.tx_of(n);
        let Some(d) = d.filter(|d| self.txs[*d].lane) else {
            return;
        };
        if self.same_action(d, g) {
            return;
        }
        let h = self.resolve_tx(self.txs[g].parent.expect("a lane"));
        let dp = self.resolve_tx(self.txs[d].parent.expect("a lane"));
        self.merge(dp, h);
        self.txs[d].over = Some(self.resolve_tx(h));
        self.txs[d].held = true;
    }

    // Solid: optimistic.ts `GlobalQueue._laneRebase`: `Some(b)` is a
    // truthy/falsy answer, `None` is `undefined`.
    pub(in crate::slice1) fn lane_rebase(
        &mut self,
        el: NodeId,
        truth: &Value,
        older: bool,
    ) -> Option<bool> {
        let t = self.nodes[el].host?;
        if self.nodes[el].key != SlotKey::Patch {
            if older {
                return Some(true);
            }
            let g = self.kg_of(t).and_then(|kg| {
                kg.into_iter().find(|&c| {
                    self.nodes[c].config & CONFIG_OVERRIDE != 0 && self.carrier(c).removed.is_some()
                })
            });
            return Some(match g {
                Some(g) if self.carrier(g).g != CarrierRows::Null => self.fold(g, truth),
                _ => false,
            });
        }
        let guess = self.latest_val(el).unwrap_or(Value::NotPending);
        if !older && self.carrier(el).g != CarrierRows::Null {
            return Some(self.fold(el, truth));
        }
        let q = self.question;
        if older && self.carrier(el).qs.contains(&q) {
            return Some(true);
        }
        let mut by: Option<CarrierRows> = None;
        if older {
            for o in self.kg_of(t).unwrap_or_default() {
                if o != el && self.carrier(o).qs.contains(&q) {
                    let (to, te) = (self.tx_of(o), self.tx_of(el));
                    if self.same_action(to, te) {
                        return Some(true);
                    }
                    by = Some(self.carrier(o).g.clone());
                }
            }
        }
        let (Value::Obj(truth_o), Value::Obj(guess_o)) = (truth, &guess) else {
            return Some(true);
        };
        if !truth_o.array || !guess_o.array {
            return Some(true);
        }
        let fam = self.st(t).fam.expect("an optimistic family");
        let key = self.store.families[fam].key.clone()?;
        let mut by_key: Vec<(Value, Value)> = vec![];
        for r in truth_o.elements() {
            if self.is_wrappable(&r) {
                let k = self.row_key(&key, &self.unwrap_ro(&r));
                if !k.is_undef() && !by_key.iter().any(|(x, _)| *x == k) {
                    by_key.push((k, r));
                }
            }
        }
        let mut used: Vec<Value> = vec![];
        let removed: Vec<Value> = self.carrier(el).removed.clone().unwrap_or_default();
        let mut rows: Vec<Value> = vec![];
        if self.carrier(el).g == CarrierRows::Null {
            let d = self.store.families[fam].node.expect("a derive");
            let te = self.tx_of(el);
            self.txs[te].over = self.nodes[d].transaction;
        }
        let guessed: Vec<Value> = match self.carrier(el).g.clone() {
            CarrierRows::Rows(r) => r,
            _ => {
                let r: Vec<Value> = guess_o
                    .elements()
                    .into_iter()
                    .map(|r| self.arrangement_row(fam, &r))
                    .collect();
                self.carrier_mut(el).g = CarrierRows::Rows(r.clone());
                r
            }
        };
        let by_rows = match by {
            Some(CarrierRows::Rows(r)) => Some(r),
            _ => None,
        };
        for g in &guessed {
            let k = if self.is_wrappable(g) {
                self.row_key(&key, &self.unwrap_ro(g))
            } else {
                Value::Undef
            };
            let tr = if k.is_undef() {
                None
            } else {
                by_key.iter().find(|(x, _)| *x == k).map(|(_, v)| v.clone())
            };
            if let Some(tr) = tr {
                let gt = if self.is_wrappable(g) {
                    let u = self.unwrap_ro(g);
                    self.lookup_target(&u, Some(fam))
                } else {
                    None
                };
                if let Some(gt) = gt {
                    if self.lookup_target(&tr, Some(fam)).is_none() {
                        let px = Value::Proxy(gt);
                        self.reconcile_state(&tr, &px, Some(key.clone()), true)
                            .unwrap_or_else(|e| {
                                panic!("a re-base's reconcile that throws ({})", e.message())
                            });
                    }
                }
                rows.push(tr);
                used.push(k);
            } else if !removed.contains(&k) && !by_rows.as_ref().is_some_and(|b| b.contains(g)) {
                rows.push(g.clone());
            }
        }
        for r in truth_o.elements() {
            let k = if self.is_wrappable(&r) {
                self.row_key(&key, &self.unwrap_ro(&r))
            } else {
                Value::Undef
            };
            if !k.is_undef() && !used.contains(&k) && !removed.contains(&k) {
                rows.push(r);
            }
        }
        let n = rows
            .len()
            .max(guess_o.len() as usize)
            .max(self.committed(t).len() as usize);
        {
            let wk = self.carrier_mut(el).wk.get_or_insert_with(Vec::new);
            for i in 0..n {
                let k = Key::Idx(i as u32);
                if !wk.contains(&k) {
                    wk.push(k);
                }
            }
            let l = Key::name("length");
            if !wk.contains(&l) {
                wk.push(l);
            }
        }
        let l = self.tx_of(el);
        let same = self.same_rows(&guess_o.elements(), &rows, fam);
        self.set_lane_value(el, l, Value::Obj(JsObj::new_array(rows)), false);
        if !same {
            self.lane_dirty(el, l);
        }
        Some(true)
    }

    // Solid: optimistic.ts `sameRows`
    fn same_rows(&self, a: &[Value], b: &[Value], fam: FamId) -> bool {
        if a.len() != b.len() {
            return false;
        }
        for (x, y) in a.iter().zip(b) {
            let (x, y) = (self.unwrap_ro(x), self.unwrap_ro(y));
            if self.is_wrappable(&x) {
                let xt = self.lookup_target(&x, Some(fam));
                if xt.is_none() || xt != self.lookup_target(&y, Some(fam)) {
                    return false;
                }
            } else if x != y {
                return false;
            }
        }
        true
    }

    // Solid: optimistic.ts `fold`: a current truth beneath a shown keyed
    // arrangement guess folds into its lane's reads.
    fn fold(&mut self, el: NodeId, truth: &Value) -> bool {
        let l = self.tx_of(el);
        if !self.txs[l].shown || self.carrier(el).removed.is_none() {
            return false;
        }
        let guess = self.latest_val(el);
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

    // Solid: optimistic.ts `foldedRead`: `None` is NOT_PENDING.
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
        if self.nodes[el].pending.is_some() {
            return self.pending_value(el);
        }
        self.covered(el)
    }

    // Solid: optimistic.ts `pairRows` (the `pair` hook): a derive's draft
    // pairs its new rows with the targets the guesses made (D-34).
    pub(in crate::slice1) fn pair_rows(&mut self, t: TargetId, pb: &Obj, viewed: bool) {
        let fam = self.st(t).fam.expect("a family");
        let key = self.store.families[fam].key.clone();
        let list = pb.array;
        let mut at: Option<Vec<(Value, u32)>> = None;
        let mut pair = |rt: &mut Runtime, k: Value, px: TargetId, lent: bool| {
            if list && at.is_none() {
                let mut m: Vec<(Value, u32)> = vec![];
                for (i, r) in pb.elements().into_iter().enumerate() {
                    let rk = match (&key, rt.is_wrappable(&r)) {
                        (Some(key), true) => rt.row_key(key, &rt.unwrap_ro(&r)),
                        _ => Value::Undef,
                    };
                    if !rk.is_undef() && !m.iter().any(|(x, _)| *x == rk) {
                        m.push((rk, i as u32));
                    }
                }
                at = Some(m);
            }
            if viewed && rt.st(px).ch {
                return;
            }
            let i: Option<Key> = if list {
                at.as_ref()
                    .unwrap()
                    .iter()
                    .find(|(x, _)| *x == k)
                    .map(|(_, i)| Key::Idx(*i))
            } else {
                match &k {
                    Value::Int(n) => Some(Key::Idx(*n as u32)),
                    Value::Str(s) => Some(Key::name(s)),
                    _ => None,
                }
            };
            let nv = i.as_ref().map_or(Value::Undef, |i| pb.get(i));
            if rt.is_wrappable(&nv) && rt.lookup_target(&nv, Some(fam)).is_none() {
                rt.reconcile_state(&nv, &Value::Proxy(px), key.clone(), true)
                    .unwrap_or_else(|e| {
                        panic!("a row pairing's reconcile that throws ({})", e.message())
                    });
                if lent {
                    pb.set(i.as_ref().unwrap(), Value::Proxy(px));
                }
            }
        };
        let overlaid: Vec<TargetId> = self.store.families[fam]
            .overlaid
            .as_ref()
            .map(|o| o.values())
            .unwrap_or_default();
        for c0 in &overlaid {
            let mut c = Some(*c0);
            while let Some(x) = c {
                if self.st(x).u == Some(t) {
                    break;
                }
                c = self.st(x).u;
            }
            if let Some(c) = c {
                let k = if list {
                    match &key {
                        Some(key) => self.row_key(key, &Value::Obj(self.st(c).v.clone())),
                        None => Value::Undef,
                    }
                } else {
                    match &self.st(c).pk {
                        Some(Key::Idx(i)) => Value::Int(*i as i64),
                        Some(Key::Name(n)) => Value::Str(n.clone()),
                        _ => Value::Undef,
                    }
                };
                pair(self, k, c, false);
            }
        }
        let Some(k) = key.clone() else { return };
        if !list {
            return;
        }
        if !overlaid.is_empty() {
            for ov in self.committed(t).elements() {
                if self.is_wrappable(&ov) {
                    if let Some(rt) = self.lookup_target(&ov, Some(fam)) {
                        let kv = self.row_key(&k, &ov);
                        pair(self, kv, rt, false);
                    }
                }
            }
        }
        if !viewed {
            for c in self.kg_of(t).unwrap_or_default() {
                if let Value::Obj(f) = self.guessed_value_of(c) {
                    if f.array {
                        for r in f.elements() {
                            if let Value::Proxy(ft) = r {
                                if self.st(ft).fam != Some(fam) {
                                    let kv = self.row_key(&k, &self.unwrap_ro(&r));
                                    pair(self, kv, ft, true);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Solid: optimistic.ts `noteRead`: an action's untracked read of a
    // guessed value derives from that guess (#4788).
    fn note_read(&mut self, t: TargetId, key: &Key, v: Option<&Value>) {
        if self.action_depth == 0 || self.store.diffing {
            return;
        }
        let g = self.guess_for(t, key, false, false);
        let g_live = g.is_some_and(|g| self.nodes[g].config & CONFIG_OVERRIDE != 0);
        let tv = self.st(t).v.clone();
        let p = if g_live {
            None
        } else {
            self.store.placed.get(&tv.id).cloned()
        };
        if p.is_none() && !g_live {
            return;
        }
        let l = match &p {
            Some((l, _)) => *l,
            None => self.tx_of(g.unwrap()),
        };
        let old = match &p {
            Some((_, prev)) => {
                let x = match prev {
                    Value::Obj(o) => o.get(key),
                    _ => Value::Undef,
                };
                self.unwrap_value(&x)
            }
            None => self.unwrap_value(&tv.get(key)),
        };
        let r = match v {
            Some(v) => v.clone(),
            None => match g {
                Some(g) => Self::carrier_value(&self.guessed_value_of(g), key),
                None => tv.get(key),
            },
        };
        let r = self.unwrap_value(&r);
        if self.is_wrappable(&r) {
            if r != old {
                if let Value::Obj(o) = &r {
                    self.store.placed.insert(o.id, (l, old));
                }
            }
        } else if p.is_none() || r != old {
            self.read_guesses.push((l, self.question));
        }
    }

    // Solid: optimistic.ts `noteShape`: an action's read of a guessed
    // shape (presence, keys) derives from that guess.
    fn note_shape(&mut self, t: TargetId, key: Option<&Key>) {
        if self.action_depth == 0 || self.store.diffing {
            return;
        }
        let Some(kg) = self.kg_of(t) else { return };
        let tv = self.st(t).v.clone();
        for &g in kg.iter().rev() {
            if self.nodes[g].config & CONFIG_OVERRIDE == 0 {
                continue;
            }
            let c = self.carrier(g);
            let hit = match key {
                Some(k) => {
                    c.del.as_ref().is_some_and(|d| d.contains(k))
                        || (c.wk.as_ref().is_some_and(|w| w.contains(k)) && !tv.has(k))
                }
                None => {
                    c.del.as_ref().is_some_and(|d| !d.is_empty())
                        || c.wk.iter().flatten().any(|k| !tv.has(k))
                }
            };
            if hit {
                let l = self.tx_of(g);
                self.read_guesses.push((l, self.question));
            }
        }
    }

    // Solid: optimistic.ts the `read` hook: a guessed key's value from its
    // carrier's frame (the leaf linked for a tracked reader); NOT_PENDING
    // (`None`) when no carrier guessed it.
    pub(in crate::slice1) fn opt_hook_read(
        &mut self,
        t: TargetId,
        key: &Key,
    ) -> Result<Option<Value>, Error> {
        let g = self.guess_for(t, key, false, true);
        let obs = self.get_observer();
        let Some(g) = g else {
            if let Some(obs) = obs {
                for c in self.kg_of(t).unwrap_or_default() {
                    if self
                        .carrier(c)
                        .borrowed
                        .as_ref()
                        .is_some_and(|b| b.contains(key))
                    {
                        self.link(c, obs);
                    }
                }
            }
            return Ok(None);
        };
        let frame = self.read_node(g)?;
        let node = if obs.is_some() {
            Some(self.get_node(t, key, -1))
        } else {
            self.st(t).n.as_ref().and_then(|n| n.get(key))
        };
        if let Some(obs) = obs {
            self.link(node.unwrap(), obs);
        }
        let v = Self::carrier_value(&frame, key);
        if obs.is_none() {
            self.note_read(t, key, Some(&v));
        }
        Ok(Some(self.serve_key_value(t, key, v, false, node)?))
    }

    // Solid: optimistic.ts the `drafted` hook
    pub(in crate::slice1) fn opt_hook_drafted(
        &mut self,
        t: TargetId,
        key: Option<&Key>,
        shape: bool,
    ) {
        if shape {
            self.note_shape(t, key);
        } else {
            self.note_read(t, key.expect("a drafted key"), None);
        }
    }

    // Solid: optimistic.ts the `has` hook
    pub(in crate::slice1) fn opt_hook_has(
        &mut self,
        t: TargetId,
        key: &Key,
    ) -> Result<Option<bool>, Error> {
        let Some(g) = self.guess_for(t, key, true, true) else {
            return Ok(None);
        };
        if let Some(obs) = self.get_observer() {
            let h = self.get_has_node(t, key);
            self.link(h, obs);
        }
        let frame = self.read_node(g)?;
        Ok(Some(match frame {
            Value::Obj(o) => o.has(key),
            _ => false,
        }))
    }

    // Solid: optimistic.ts the `frame` hook: the newest carrier's frame.
    pub(in crate::slice1) fn opt_hook_frame(&mut self, t: TargetId) -> Result<Slot, Error> {
        match self.newest_guess(t) {
            None => Ok(None),
            Some(g) => Ok(Some(self.read_node(g)?)),
        }
    }

    // Solid: optimistic.ts the `covers` hook: a carrier serves `key`.
    pub(in crate::slice1) fn opt_hook_covers(&self, t: TargetId, key: &Key, shape: bool) -> bool {
        self.guess_for(t, key, shape, false).is_some()
    }

    // Solid: optimistic.ts the `judge` hook: each live carrier is set to the
    // landed truth's frame (its comparator judges echoes).
    pub(in crate::slice1) fn opt_hook_judge(&mut self, t: TargetId, truth: &Obj) {
        let Some(kg) = self.kg_of(t) else { return };
        let frame = if truth.array {
            JsObj::new_array(truth.elements())
        } else {
            let o = truth.shallow_clone();
            o.set_owner(None);
            o
        };
        for g in kg {
            if self.nodes[g].config & (CONFIG_OVERRIDE | CONFIG_HELD) != 0 {
                self.set_signal(g, Value::Obj(frame.clone()));
            }
        }
    }

    // Solid: optimistic.ts the `ask` hook
    pub(in crate::slice1) fn opt_ask(&mut self, fam: FamId) -> AskSkip {
        if self.store.families[fam]
            .overlaid
            .as_ref()
            .is_none_or(|o| o.size() == 0)
        {
            return AskSkip::None;
        }
        let d = self.store.families[fam].node.expect("a derive");
        if self.reasked(d) {
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

    // Solid: optimistic.ts the `stands` hook
    pub(in crate::slice1) fn opt_stands(&mut self, t: TargetId) -> Result<bool, Error> {
        let f = self.st(t).fam.expect("a family");
        let o: Vec<TargetId> = self.store.families[f]
            .overlaid
            .as_ref()
            .map(|o| o.values())
            .unwrap_or_default();
        let a = self.store.families[f].asked;
        let d = self.store.families[f].node.expect("a derive");
        let c = self.context;
        let clock = self.clock as i64;
        let pass_ok = |rt: &mut Runtime| -> bool {
            match rt.pass_lane {
                None => !o.contains(&t),
                Some(p) => !o.clone().into_iter().any(|g| {
                    rt.lane_node_of(g, false).is_some_and(|n| {
                        let tn = rt.tx_of(n);
                        rt.same_action(tn, p)
                    })
                }),
            }
        };
        if o.is_empty() || (a == Some(clock + 1) && pass_ok(self)) || a == Some(!clock) {
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
            .kg_of(t)
            .unwrap_or_default()
            .into_iter()
            .any(|g| self.carrier(g).g == CarrierRows::Null);
        if let Some(cn) = c.filter(|cn| g_null && self.nodes[*cn].status & STATUS_PENDING != 0) {
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
        } else if let Some(cn) = c {
            // `c?._depsTail !== undefined`: a computation (not a root).
            if self.nodes[cn].kind != Kind::Root
                && self.nodes[cn].effect_type != EFFECT_RENDER
                && self.nodes[d].reask
                && self.nodes[d].transaction.is_some()
            {
                let td = self.tx_of(d);
                if !self.own_flight(&o, td) {
                    self.link(d, cn);
                    self.stale_reader(cn, td);
                }
            }
        }
        Ok(true)
    }

    // Solid: optimistic.ts the `park` hook
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

    // Solid: optimistic.ts `ownFlight`
    fn own_flight(&mut self, o: &[TargetId], f: TxId) -> bool {
        for &t in o {
            let mut ns = self.kg_of(t).unwrap_or_default();
            if let Some(dk) = self.st(t).dk {
                ns.push(dk);
            }
            for n in ns {
                if self.nodes[n].transaction.is_some() {
                    let l = self.tx_of(n);
                    let p = self.txs[l].parent.unwrap_or(l);
                    if self.resolve_tx(p) == f {
                        return true;
                    }
                }
            }
        }
        false
    }

    // Solid: optimistic.ts `sweepOverlaid` (the `sweep` hook)
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
                let keep = |rt: &Runtime, g: NodeId, mask: u32| {
                    rt.nodes[g].config & mask != 0 || rt.nodes[g].pending.is_some()
                };
                if self.lane_node_of(t, false).is_none() {
                    self.store.families[fam]
                        .overlaid
                        .as_mut()
                        .unwrap()
                        .delete(t);
                    let live: Vec<NodeId> = self
                        .kg_of(t)
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|&g| keep(self, g, CONFIG_HELD))
                        .collect();
                    if live.is_empty() {
                        self.store.carriers.remove(&t);
                    } else {
                        self.store.carriers.insert(t, live);
                    }
                } else if let Some(kg) = self.kg_of(t) {
                    let live: Vec<NodeId> = kg
                        .into_iter()
                        .filter(|&g| keep(self, g, CONFIG_OVERRIDE | CONFIG_GUESS | CONFIG_HELD))
                        .collect();
                    if live.is_empty() {
                        self.store.carriers.remove(&t);
                    } else {
                        self.store.carriers.insert(t, live);
                    }
                }
            }
            if self.store.families[fam].overlaid.as_ref().unwrap().size() == 0 {
                self.store.overlaid_families.delete(fam);
            }
        }
    }

    // Solid: optimistic.ts `laneNodeOf`: a carrier (or the deep witness) in a
    // lane — with `read`, one a reader still reads.
    pub(in crate::slice1) fn lane_node_of(&self, t: TargetId, read: bool) -> Option<NodeId> {
        let mut ns = self.store.carriers.get(&t).cloned().unwrap_or_default();
        if let Some(dk) = self.st(t).dk {
            ns.push(dk);
        }
        for n in ns {
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

    /// `raw(o)` re-exported for the hooks above.
    #[allow(dead_code)]
    fn raw_of(v: &Value) -> Obj {
        raw(v)
    }

    /// `fam.key(row)` (store.rs `fam_key`), a throw failing closed.
    fn row_key(&mut self, key: &Rc<str>, row: &Value) -> Value {
        self.fam_key(key, row)
            .unwrap_or_else(|e| panic!("a key fn that throws ({})", e.message()))
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

    // Solid: optimistic.ts:687-691
    pub(in crate::slice1) fn mark_overlaid(&mut self, t: TargetId) {
        let fam = self.st(t).fam.expect("an optimistic family");
        self.store.families[fam]
            .overlaid
            .get_or_insert_with(OrdSet::default)
            .add(t);
        self.store.overlaid_families.add(fam);
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
