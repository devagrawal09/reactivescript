//! Solid: verdict.ts — the `latest`/`isPending` windows, their readers
//! (CONFIG_VERDICT: a pass that probes is a verdict reader, routed into the
//! holder's verdict lane), and the verdict engine's hooks the async and
//! lane paths call (`observeFlight`, `holdWork`, `stageMark`,
//! `keepReaders`, `attachWaits`, `holdStaging`).
//!
//! Not ported: snapshots (a hydration claim's snapshot scope, never active
//! here), the dev and observe tiers and the shadow seat (`__TEST__`), the
//! store's witness mark (`GlobalQueue._witnessMark`, store/affects.ts), and
//! `attachWaits`'s hold search (`bornHeldOpen`): plain data inserts no DOM
//! node (`valueInserts` is false), so it is never reached, and it fails
//! closed if it is.
use super::*;

impl Runtime {
    // Solid: verdict.ts:110-113 (`watchVerdict`)
    fn watch_verdict(&mut self, c: NodeId, unanswered: bool) {
        if unanswered {
            self.nodes[c].flags |= REACTIVE_PROBE_UNANSWERED;
        }
        self.staged_readers.push(c);
    }

    // Solid: verdict.ts:124-132 (`route`)
    fn route(&mut self, c: NodeId, t: TxId) {
        if self.pass_lane.is_none()
            && self.nodes[c].flags & (REACTIVE_JOINED | REACTIVE_STAGED_READ) == 0
            && !(self.nodes[c].config & CONFIG_HELD_FRAME != 0 && {
                let r = self.resolve_tx(t);
                self.born_into(c, r)
            })
        {
            let l = self.verdict_lane(t);
            self.pass_lane = Some(l);
        }
        self.nodes[c].flags |= REACTIVE_LANE_READ;
    }

    /// `observeFlightHook` (verdict.ts:156-173): a verdict reader's plain
    /// read of a flight; true when it is served the committed value.
    pub(super) fn observe_flight(&mut self, c: NodeId, el: NodeId) -> bool {
        if self.pass_lane.is_some()
            && self.nodes[c].effect_type != 0
            && self.nodes[c].status & STATUS_UNINITIALIZED == 0
        {
            return true;
        }
        if self.nodes[el].config & CONFIG_INPUTS_PUBLISHED != 0
            || (self.nodes[el].config & CONFIG_HELD != 0 && {
                let t = self.tx_of(el);
                self.born_into(c, t)
            })
        {
            return false;
        }
        // `c._fam?.live.size !== 0`: a derived store's derive with no
        // reader observes nothing.
        let live = match self.nodes[c].fam {
            None => true,
            Some(f) => self.store.families[f].live.size() != 0,
        };
        if self.running && live {
            self.join_future(None);
            if self.nodes[el].config & CONFIG_HELD == 0 {
                self.queue_pending_node(el);
            }
            if let Some(i) = self.ahead.iter().position(|x| *x == c) {
                self.ahead.remove(i);
            }
            let f = self.flush_transaction.expect("joined");
            self.verdict_read(c, f, true);
        }
        true
    }

    // Solid: verdict.ts:192-196 (`verdictRead`)
    fn verdict_read(&mut self, c: NodeId, t: TxId, plain: bool) {
        self.route(c, t);
        if plain {
            self.stale_reader(c, t);
        } else if self.probing && self.txs[t].reruns.last() != Some(&c) {
            self.txs[t].reruns.push(c);
        }
    }

    // Solid: verdict.ts:218-235 (`provisionalVerdict`)
    fn provisional_verdict(&mut self, c: NodeId, not_final: bool) {
        if let Some(f) = self.flush_transaction {
            if self.probing && not_final {
                self.probe_found = true;
            }
            self.verdict_read(c, f, false);
            if self.probing && self.nodes[c].flags & REACTIVE_STAGED_READ != 0 {
                self.watch_verdict(c, false);
            }
            return;
        }
        let unanswered = !self.probing || not_final;
        self.watch_verdict(c, unanswered);
    }

    // Solid: verdict.ts:240-248 (`quietPending`)
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

    // Solid: verdict.ts:264-274 (`heldNotFinal`)
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

    // Solid: verdict.ts:277-305 (`pendingVerdict`)
    fn pending_verdict(&mut self, c: Option<NodeId>, el: NodeId) {
        if self.probing && !self.quiet_pending(el) {
            self.probe_found = true;
        }
        let Some(c) = c else { return };
        if !self.tracking {
            return;
        }
        if self.nodes[el].config & CONFIG_HELD != 0 {
            let t = self.tx_of(el);
            self.verdict_read(c, t, false);
        } else if self.running {
            if !self.probing {
                if self.nodes[c].flags & REACTIVE_LANE_READ == 0 {
                    self.ahead.push(c);
                }
                if self.flush_transaction.is_none() {
                    self.join_future(None);
                    let f = self.flush_transaction.expect("joined");
                    self.txs[f].latest = true;
                }
            } else if let Some(f) = self.flush_transaction.filter(|f| self.txs[*f].latest) {
                return self.route(c, f);
            }
            self.provisional_verdict(c, false);
        }
    }

    // Solid: verdict.ts:312-333 (`markVerdictReader`; no observe tier)
    fn mark_verdict_reader(&mut self, _window: u32) {
        let Some(c) = self.creator_pass(self.context) else {
            return;
        };
        if !self.tracking {
            return;
        }
        self.nodes[c].config &= !CONFIG_ASYNC;
        let reads = self.creator_reads(c, 0);
        let bit = if reads != 0 {
            reads
        } else {
            self.nodes[c].config |= CONFIG_VERDICT;
            0
        };
        self.nodes[c].flags |= REACTIVE_PROBED | REACTIVE_WINDOW | bit;
    }

    // Solid: verdict.ts:338-350 (`latest`)
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

    // Solid: verdict.ts:384-411 (`isPending`)
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

    // Solid: verdict.ts:414-417 (`staged`)
    fn staged(&self, el: NodeId) -> Result<Value, Error> {
        if self.nodes[el].config & CONFIG_STAGED_ERROR != 0 {
            return Err(self.nodes[el]
                .pending_err
                .clone()
                .expect("a staged error carries its error"));
        }
        Ok(self.nodes[el].pending.clone().expect("a staging"))
    }

    // Solid: verdict.ts:421-426 (`heldLatest`)
    fn held_latest(&mut self, el: NodeId, c: Option<NodeId>) -> Result<Value, Error> {
        match self.unflushed_value(el) {
            None => self.staged(el),
            Some(u) => {
                if let Some(c) = c {
                    self.mark_late_linker(c);
                }
                Ok(u)
            }
        }
    }

    /// The windows' read (`verdict`, core.ts `read`'s cold path).
    // Solid: verdict.ts:450-700 (`verdictValue`; no snapshot scope)
    pub(super) fn verdict_value(&mut self, el: NodeId, c: Option<NodeId>) -> Result<Value, Error> {
        let owner = el;
        let owned = c.is_some_and(|c| self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN == 0);
        let tracked = owned && self.tracking;
        let prev_probing = self.probing;
        let prev_latest = self.latest_active;
        self.probing = false;
        self.latest_active = false;
        self.verdict = false;
        // A signal has no `_flags`: the wake is a no-op for it.
        if self.nodes[el].fn_.is_some() {
            self.prepare_computed(owner, false);
        }
        if let Some(c) = c.filter(|_| self.tracking) {
            self.link(el, c);
            // #4544: asked of this staging, under its hold or this flush.
            if self.nodes[el].pending.is_some() {
                self.nodes[el].x = true;
                self.nodes[el].asked_in = if self.nodes[el].config & CONFIG_HELD != 0 {
                    AskedIn::Tx(self.tx_of(el))
                } else {
                    match self.flush_transaction {
                        Some(f) => AskedIn::Tx(f),
                        None => AskedIn::Clock(self.clock),
                    }
                };
            }
            if self.nodes[el].fn_.is_some() {
                self.pull_computed(owner, c);
            }
        }
        self.verdict = true;
        self.latest_active = prev_latest;
        self.probing = prev_probing;
        // A live `affects()` mark on the node or a dependency: not final.
        if self.probing && self.marked_now(owner) {
            self.probe_found = true;
            if tracked {
                if let Some(f) = self.flush_transaction {
                    self.verdict_read(c.unwrap(), f, false);
                }
            }
        }
        let status = self.nodes[el].status;
        let config = self.nodes[el].config;
        if config & CONFIG_OVERRIDE != 0
            && !(status & STATUS_ERROR != 0 && config & CONFIG_GUESS == 0)
        {
            let l = self.tx_of(el);
            let flying = status & STATUS_PENDING != 0 && !self.quiet_pending(el);
            let guess = config & CONFIG_GUESS != 0;
            let v = if guess {
                Some(Value::Int(0))
            } else if self.latest_active && !flying {
                self.lane_value_served(el)
            } else {
                self.display(el)
            };
            if let Some(v) = v {
                if tracked {
                    let t = self.txs[l].parent.unwrap_or(l);
                    self.verdict_read(c.unwrap(), t, false);
                }
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
                    if self.latest_active && self.txs[l].folded {
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
                if tracked && !self.probing {
                    let c = c.unwrap();
                    if self.nodes[c].effect_type == EFFECT_RENDER
                        && self.pass_lane.is_none()
                        && self.flush_transaction != Some(t)
                    {
                        if let Some(v) = self.txs[t].verdict.filter(|v| self.txs[*v].held) {
                            self.stale_reader(c, v);
                            return Ok(self.nodes[el].value.clone());
                        }
                    }
                }
                if tracked {
                    self.verdict_read(c.unwrap(), t, false);
                }
                if self.probing {
                    match c.filter(|c| self.nodes[*c].config & CONFIG_HELD != 0) {
                        Some(cc) => {
                            if self.nodes[el].pending.is_some() && !self.blocked(t) {
                                self.watch_verdict(cc, false);
                                return self.staged(el);
                            }
                            if self.nodes[cc].q == 0 {
                                self.stale_reader(cc, t);
                            }
                        }
                        None => {
                            if self.held_not_final(owner) {
                                self.probe_found = true;
                            }
                            if let Some(cc) = c {
                                if owned
                                    && !tracked
                                    && self.nodes[cc].q == 0
                                    && self.nodes[cc].status & STATUS_UNINITIALIZED == 0
                                {
                                    self.watch_verdict(cc, false);
                                }
                            }
                        }
                    }
                }
                if self.latest_active && self.nodes[el].pending.is_some() {
                    if !tracked && self.flush_transaction.is_some() && !self.running {
                        self.join_future(Some(t));
                    }
                    return self.held_latest(el, if tracked { c } else { None });
                }
                return Ok(self.nodes[el].value.clone());
            }
            if self.nodes[el].pending.is_some() && status & STATUS_PENDING == 0 {
                if self.probing && owned {
                    self.join_pass(c.unwrap(), el);
                }
                return self.staged(el);
            }
        } else if self.nodes[el].pending.is_some() {
            if status & STATUS_PENDING != 0
                && (!uninitialized || (self.probing && config & CONFIG_STAGED_ERROR == 0))
            {
                self.pending_verdict(if tracked { c } else { None }, owner);
            } else if tracked && self.running {
                let c = c.unwrap();
                // D-8: a signal's staging equal to its committed value nets.
                let netted = self.nodes[el].fn_.is_none()
                    && self.nodes[el].pending.as_ref() == Some(&self.nodes[el].value);
                match self.flush_transaction {
                    Some(f) if netted => self.route(c, f),
                    _ => {
                        let not_final = !self.latest_active && !uninitialized;
                        self.provisional_verdict(c, not_final)
                    }
                }
            } else if tracked && self.probing {
                self.watch_verdict(c.unwrap(), false);
            }
            if self.latest_active || uninitialized || (owned && !tracked) {
                if self.running {
                    return self.staged(el);
                }
                if let Some(c) = c {
                    self.mark_late_linker(c);
                }
            }
            return Ok(self.nodes[el].value.clone());
        }
        if status & STATUS_PENDING != 0 {
            if !uninitialized {
                self.pending_verdict(if tracked { c } else { None }, owner);
                return Ok(self.nodes[el].value.clone());
            }
            // As `read()`: an untracked read of a pending node still re-runs
            // its reader when the node settles (`spectating` is never set).
            if let Some(c) = c {
                if !self.tracking && el != c {
                    self.link(el, c);
                }
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

    // Solid: verdict.ts:873-890 (`holdStagingHook`)
    pub(super) fn hold_staging(&mut self, c: NodeId, el: NodeId) -> bool {
        // The conditions in Solid's order (`&&` short-circuits: the last
        // `resolveTx` is reached only when every earlier one holds).
        if self.nodes[c].config & (CONFIG_OWN_PROBE | CONFIG_FRAME) != 0
            || self.nodes[c].flags & (REACTIVE_WINDOW | REACTIVE_PROBE_UNANSWERED) != 0
            || self.nodes[el].pending.is_none()
            || self.nodes[el].config & (CONFIG_ASYNC | CONFIG_OVERRIDE) != 0
        {
            return false;
        }
        match self.nodes[el].asked_in {
            AskedIn::Clock(k) if k == self.clock => return false,
            AskedIn::Tx(t) => {
                let held = if self.nodes[el].config & CONFIG_HELD != 0 {
                    self.nodes[el].transaction
                } else {
                    self.flush_transaction
                };
                // `resolveTx(flushTransaction!)` of a null flush transaction
                // throws in Solid: fail closed.
                let h = held.expect("resolveTx(null) (verdict.ts:886) is not ported");
                if self.resolve_tx(t) == self.resolve_tx(h) {
                    return false;
                }
            }
            _ => {}
        }
        match self.pass_lane {
            None => true,
            Some(l) if self.is_verdict(l) => {
                self.pass_lane = None;
                true
            }
            Some(_) => false,
        }
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
