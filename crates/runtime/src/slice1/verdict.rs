//! Solid: verdict.ts — the `latest`/`isPending` windows and the verdict
//! engine's hooks the async paths call (`holdWork`, `stageMark`).
//!
//! Only untracked windows are ported: the op language calls `latest` and
//! `isPending` outside every computation, so `creatorPass(context)` is null
//! and the reader `c` is null. A window inside a pass makes it a verdict
//! reader (CONFIG_VERDICT, `verdictRead`, `route`, `watchVerdict`,
//! `provisionalVerdict`, `observeFlight`, verdict lanes); those arms panic
//! "not ported" so a program reaching one fails closed. `attachWaits` and
//! `holdStaging` are ported for the values they meet here: plain data
//! inserts no DOM node, and no pass has a verdict posture of its own.
use super::*;

impl Runtime {
    // Solid: verdict.ts:240-248
    fn quiet_pending(&self, el: NodeId) -> bool {
        if let Some(s) = self.nodes[el].pending_sources {
            for source in self.set_values(s) {
                if !self.nodes[source].reask {
                    return false;
                }
            }
            return true;
        }
        self.nodes[el].reask
    }

    // Solid: verdict.ts:264-274
    fn held_not_final(&self, owner: NodeId) -> bool {
        let n = &self.nodes[owner];
        if n.status & STATUS_PENDING != 0 && !self.quiet_pending(owner) {
            return true;
        }
        n.pending.is_some()
            && !self.latest_active
            && !n.reask
            && (n.shown_error.is_some()
                || n.pending_err.is_some()
                || !self.equals_slot(owner, &Some(n.value.clone()), &n.pending))
    }

    // Solid: verdict.ts:277-305 (`c` is null: the tracked arm is not reached)
    fn pending_verdict(&mut self, c: Option<NodeId>, el: NodeId) {
        if self.probing && !self.quiet_pending(el) {
            self.probe_found = true;
        }
        if c.is_some() && self.tracking {
            panic!("a tracked isPending/latest of a flight (verdict.ts:279-304) is not ported");
        }
    }

    // Solid: verdict.ts:312-333
    fn mark_verdict_reader(&mut self, _window: u32) {
        let c = self.creator_pass(self.context);
        if c.is_some() && self.tracking {
            panic!("a verdict window inside a pass (CONFIG_VERDICT readers) is not ported");
        }
    }

    // Solid: verdict.ts:338-350
    pub(super) fn latest_window<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.mark_verdict_reader(2);
        let prev = self.latest_active;
        let prev_verdict = self.verdict;
        self.latest_active = true;
        self.verdict = true;
        let r = f(self);
        self.latest_active = prev;
        self.verdict = prev_verdict;
        r
    }

    // Solid: verdict.ts:384-411
    pub(super) fn is_pending_window(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<(), Error>,
    ) -> Result<bool, Error> {
        self.mark_verdict_reader(1);
        let prev_probing = self.probing;
        let prev_found = self.probe_found;
        let prev_verdict = self.verdict;
        self.probing = true;
        self.probe_found = false;
        self.verdict = true;
        let r = match f(self) {
            Ok(()) => Ok(self.probe_found),
            Err(e) => {
                if e.is_not_ready() && !self.probe_found && self.context.is_some() {
                    Err(e)
                } else {
                    Ok(self.probe_found)
                }
            }
        };
        self.probing = prev_probing;
        self.probe_found = prev_found;
        self.verdict = prev_verdict;
        r
    }

    // Solid: verdict.ts:414-417
    fn staged(&self, el: NodeId) -> Result<Value, Error> {
        if self.nodes[el].config & CONFIG_STAGED_ERROR != 0 {
            return Err(self.nodes[el]
                .pending_err
                .clone()
                .expect("a staged error carries its error"));
        }
        Ok(self.nodes[el].pending.clone().expect("a staging"))
    }

    // Solid: verdict.ts:421-426 (`c` is null: no late linker)
    fn held_latest(&self, el: NodeId) -> Result<Value, Error> {
        match self.unflushed_value(el) {
            None => self.staged(el),
            Some(u) => Ok(u),
        }
    }

    // Solid: verdict.ts:450-700 for an untracked window (`c` null: `owned`
    // and `tracked` are false; no snapshot scope; no `affects()` marks)
    pub(super) fn verdict_value(&mut self, el: NodeId, c: Option<NodeId>) -> Result<Value, Error> {
        if c.is_some() {
            panic!("a verdict window read by a pass (verdict.ts:450-700, c != null) is not ported");
        }
        let prev_probing = self.probing;
        let prev_latest = self.latest_active;
        self.probing = false;
        self.latest_active = false;
        self.verdict = false;
        // A signal has no `_flags`: the wake is a no-op for it.
        if self.nodes[el].fn_.is_some() {
            self.prepare_computed(el, false);
        }
        self.verdict = true;
        self.latest_active = prev_latest;
        self.probing = prev_probing;
        // `GlobalQueue._marked`: no `affects()` mark is active.
        let status = self.nodes[el].status;
        let config = self.nodes[el].config;
        if config & CONFIG_OVERRIDE != 0
            && !(status & STATUS_ERROR != 0 && config & CONFIG_GUESS == 0)
        {
            let _l = self.tx_of(el);
            let flying = status & STATUS_PENDING != 0 && !self.quiet_pending(el);
            let guess = config & CONFIG_GUESS != 0;
            let v = if guess {
                Some(Value::Int(0))
            } else if self.latest_active && !flying {
                self.served_as_value(el);
                self.lane_value_of(el)
            } else {
                self.display(el)
            };
            if let Some(v) = v {
                let n = &self.nodes[el];
                if guess {
                    if self.probing
                        && (flying
                            || (n.pending.is_some()
                                && (n.pending_err.is_some()
                                    || !self.equals_slot(el, &n.lane, &n.pending))))
                    {
                        self.probe_found = true;
                    }
                    if self.latest_active && self.txs[_l].folded {
                        return Ok(self.folded_read(None, el).expect("a folded value"));
                    }
                    return Ok(self.nodes[el]
                        .lane
                        .clone()
                        .expect("a guess carries its lane value"));
                }
                if flying
                    && v == n.value
                    && status & STATUS_UNINITIALIZED != 0
                    && (self.latest_active || n.shown_error.is_none())
                {
                    return Err(n.error.clone().expect("a pending node carries its error"));
                }
                if self.probing && flying {
                    self.probe_found = true;
                }
                return Ok(v);
            }
        }
        let uninitialized = status & STATUS_UNINITIALIZED != 0;
        if config & CONFIG_HELD != 0 {
            if !uninitialized {
                let t = self.tx_of(el);
                if self.probing && self.held_not_final(el) {
                    self.probe_found = true;
                }
                if self.latest_active && self.nodes[el].pending.is_some() {
                    if self.flush_transaction.is_some() && !self.running {
                        self.join_future(Some(t));
                    }
                    return self.held_latest(el);
                }
                return Ok(self.nodes[el].value.clone());
            }
            if self.nodes[el].pending.is_some() && status & STATUS_PENDING == 0 {
                return self.staged(el);
            }
        } else if self.nodes[el].pending.is_some() {
            if status & STATUS_PENDING != 0
                && (!uninitialized || (self.probing && config & CONFIG_STAGED_ERROR == 0))
            {
                self.pending_verdict(None, el);
            }
            if (self.latest_active || uninitialized) && self.running {
                return self.staged(el);
            }
            return Ok(self.nodes[el].value.clone());
        }
        if status & STATUS_PENDING != 0 {
            if !uninitialized {
                self.pending_verdict(None, el);
                return Ok(self.nodes[el].value.clone());
            }
            return Err(self.nodes[el]
                .error
                .clone()
                .expect("a pending node carries its error"));
        }
        if self.nodes[el].fn_.is_some() && status & STATUS_ERROR != 0 {
            return Err(self.nodes[el]
                .error
                .clone()
                .expect("an errored node carries its error"));
        }
        Ok(self.nodes[el].value.clone())
    }

    // Solid: verdict.ts:873-890 (`holdStagingHook`). `_askedIn` is set only
    // by a tracked window's read (verdict.ts:475), and a verdict lane
    // (`passLane._parent._verdict === passLane`) never exists here.
    pub(super) fn hold_staging(&mut self, c: NodeId, el: NodeId) -> bool {
        const CONFIG_OWN_PROBE: u32 = REACTIVE_WINDOW << 9;
        !(self.nodes[c].config & (CONFIG_OWN_PROBE | CONFIG_FRAME) != 0
            || self.nodes[c].flags & (REACTIVE_WINDOW | REACTIVE_PROBE_UNANSWERED) != 0)
            && self.nodes[el].pending.is_some()
            && self.nodes[el].config & (CONFIG_ASYNC | CONFIG_OVERRIDE) == 0
            && self.pass_lane.is_none()
    }

    // Solid: verdict.ts:836-840 (`valueInserts`): a DOM node (`nodeType`) in
    // the value. A store proxy answers through its traps (`v.some(…)` is
    // the native `some`: `Get` "some", "length", then `HasProperty` and
    // `Get` per index).
    fn value_inserts(&mut self, v: &Value) -> bool {
        if !v.is_object() {
            return false;
        }
        let traps = |r: Result<Value, Error>| {
            r.unwrap_or_else(|e| {
                panic!(
                    "a trap that throws in valueInserts ({}) is outside tier B",
                    e.message()
                )
            })
        };
        if self.is_array(v) {
            if matches!(v, Value::Proxy(_)) {
                traps(self.js_get(v, &Key::name("some")));
            }
            let n = traps(self.js_get(v, &Key::name("length")))
                .as_int()
                .expect("an array length") as u32;
            for i in 0..n {
                let present = self.js_has(v, &Key::Idx(i)).unwrap_or_else(|e| {
                    panic!("a trap that throws in valueInserts ({})", e.message())
                });
                if present {
                    let x = traps(self.js_get(v, &Key::Idx(i)));
                    if self.value_inserts(&x) {
                        return true;
                    }
                }
            }
            return false;
        }
        // `v.nodeType > 0`: plain data has no `nodeType`.
        match traps(self.js_get(v, &Key::name("nodeType"))) {
            Value::Undef => false,
            other => panic!("a `nodeType` of {other:?} (a DOM node) is outside the op language"),
        }
    }

    // Solid: verdict.ts:845-860 (`attachHook`). With no DOM node in a value
    // the hold search (`bornHeldOpen`) is never reached.
    pub(super) fn attach_waits(&mut self, node: NodeId) -> bool {
        if self.nodes[node].effect_type != EFFECT_RENDER
            || !(self.nodes[node].config & CONFIG_VERDICT != 0
                || self.nodes[node]
                    .transaction
                    .is_some_and(|t| self.txs[t].lane))
        {
            return false;
        }
        let v = match &self.nodes[node].pending {
            Some(p) => p.clone(),
            None => self.nodes[node].value.clone(),
        };
        if !self.value_inserts(&v) {
            return false;
        }
        panic!("an attach waiting on a hold (bornHeldOpen, #4574) is not ported")
    }

    // Solid: verdict.ts:736-749 (`holdWorkHook`): truthy when it drops the
    // verdict posture.
    pub(super) fn hold_work(&mut self, n: NodeId, source: NodeId) -> bool {
        let node = &self.nodes[n];
        if node.config & CONFIG_ASYNC != 0
            && (node.status & STATUS_PENDING == 0
                || node.transaction.is_some_and(|t| self.txs[t].lane)
                || self.nodes[source].flags & REACTIVE_REASK != 0)
        {
            self.nodes[n].config &= !CONFIG_VERDICT;
            return true;
        }
        false
    }

    // Solid: verdict.ts:796-813 (`keepReadersHook`)
    pub(super) fn keep_readers(&mut self, el: NodeId) {
        let mut s = self.nodes[el].subs;
        while let Some(link) = s {
            let r = self.links[link].sub;
            s = self.links[link].next_sub;
            if self.nodes[r].config & (CONFIG_HELD | CONFIG_STAGED) != CONFIG_HELD | CONFIG_STAGED
                || self.nodes[r].effect_type != 0
            {
                continue;
            }
            let mut d = self.nodes[r].deps;
            while let Some(l) = d {
                let dep = self.links[l].dep;
                if !(dep == el || self.nodes[dep].config & CONFIG_HELD == 0) {
                    break;
                }
                d = self.links[l].next_dep;
            }
            if d.is_some() {
                continue;
            }
            self.delete_from_heap(r);
            self.nodes[r].flags &= !(REACTIVE_DIRTY | REACTIVE_CHECK);
            self.nodes[r].config &= !CONFIG_HELD;
            self.queue_pending_node(r);
            self.insert_subs(r);
        }
    }

    // Solid: verdict.ts:766-790 (`stageMarkHook`)
    pub(super) fn stage_mark(&mut self, node: NodeId, el: NodeId) {
        if self.nodes[el].config & CONFIG_STAGED_ERROR != 0
            && self.nodes[node].config & (CONFIG_REDERIVE | CONFIG_STAGED_ERROR | (3 << 23)) == 0
        {
            let mut d = self.nodes[node].deps;
            while let Some(l) = d {
                if self.nodes[self.links[l].dep].config & CONFIG_STAGED_ERROR != 0 {
                    self.nodes[node].pending = self.nodes[el].pending.clone();
                    self.nodes[node].pending_err = self.nodes[el].pending_err.clone();
                    self.nodes[node].config |= CONFIG_STAGED_ERROR;
                    self.queue_pending_node(node);
                    if let Some(f) = self.nodes[node].fam {
                        self.family_status(f, STATUS_ERROR, None);
                    }
                    return self.settle_pending_source(node, node);
                }
                d = self.links[l].next_dep;
            }
        }
    }
}
