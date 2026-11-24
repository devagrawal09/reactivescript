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
use super::error;
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
        if n.status & STATUS_PENDING != 0
            && (!self.quiet_pending(owner) || self.held_beneath(owner))
        {
            return true;
        }
        n.pending.is_some()
            && !self.latest_active
            && !n.reask
            && (n.shown_error.is_some()
                || n.pending_err.is_some()
                || !self.equals_slot(owner, &Some(n.value.clone()), &n.pending))
    }

    // Solid: verdict.ts `aheadError`: `latest` keeps a held error through a
    // re-ask (D-22, D-41).
    fn ahead_error_of(&self, el: NodeId) -> Result<(), Error> {
        if self.nodes[el].status & STATUS_PENDING != 0 {
            if let Some(e) = self.nodes[el]
                .ahead_error
                .clone()
                .or_else(|| self.nodes[el].shown_error.clone())
            {
                return Err(e);
            }
        }
        Ok(())
    }

    // Solid: verdict.ts `heldBeneath`: a dependency holds a staging that
    // changes its value (no re-ask): the pending is not quiet.
    fn held_beneath(&self, el: NodeId) -> bool {
        let mut d = self.nodes[el].deps;
        while let Some(l) = d {
            let dep = self.links[l].dep;
            let n = &self.nodes[dep];
            if n.config & CONFIG_HELD != 0
                && n.pending.is_some()
                && !n.reask
                && (n.pending_err.is_some()
                    || !self.is_same(dep, &n.value, n.pending.as_ref().unwrap()))
            {
                return true;
            }
            d = self.links[l].next_dep;
        }
        false
    }

    // Solid: verdict.ts `pendingVerdict`
    fn pending_verdict(&mut self, c: Option<NodeId>, el: NodeId) {
        if self.probing && (!self.quiet_pending(el) || self.held_beneath(el)) {
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

    // Solid: verdict.ts `markVerdictReader` (no observe tier): true for a
    // pass that left a parked lane (`left`): its window reads plainly. A
    // joined pass that becomes a verdict reader restarts (its merges undone).
    fn mark_verdict_reader(&mut self, window: u32) -> Result<bool, Error> {
        let Some(c) = self.creator_pass(self.context) else {
            return Ok(false);
        };
        if !self.tracking {
            return Ok(false);
        }
        if self.left.iter().any(|(n, _)| *n == c) {
            self.watch_verdict(c, true);
            return Ok(true);
        }
        let restart = Some(c) == self.adopter
            && self.flush_transaction.is_some()
            && self.nodes[c].flags & REACTIVE_JOINED != 0
            && self.nodes[c].config & CONFIG_VERDICT == 0
            && self.nodes[c].status & STATUS_UNINITIALIZED == 0;
        let reads = self.creator_reads(c, 0);
        let bit = if reads != 0 {
            reads
        } else {
            self.nodes[c].config |= CONFIG_VERDICT;
            0
        };
        self.nodes[c].flags |= REACTIVE_PROBED | REACTIVE_WINDOW | (window << WINDOW_KINDS) | bit;
        if restart && self.nodes[c].config & CONFIG_VERDICT != 0 {
            self.adopter = None;
            self.drop_flush_tx();
            self.nodes[c].flags |= REACTIVE_MISSED_WAKE;
            self.nodes[c].loading = true;
            return Err(error::not_ready(None));
        }
        Ok(false)
    }

    // Solid: verdict.ts:338-350 (`latest`)
    pub(super) fn latest_window<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if self.mark_verdict_reader(2)? {
            return f(self);
        }
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
        let plain = self.mark_verdict_reader(1)?;
        self.tr(|| {
            let c = self
                .context
                .map_or("undefined".to_string(), |c| self.label(c).to_string());
            format!("IP {c} plain={}", plain as u8)
        });
        let prev_probing = self.probing;
        let prev_found = self.probe_found;
        let prev_verdict = self.verdict;
        self.probing = !plain;
        self.probe_found = false;
        if !plain {
            self.verdict = true;
        }
        let r = match f(self) {
            Ok(()) => {
                self.tr(|| format!("IPR {}", self.probe_found as u8));
                Ok(self.probe_found)
            }
            Err(e) => {
                self.tr(|| format!("IPE {} {}", e.is_not_ready() as u8, self.probe_found as u8));
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
                self.latest_val(el)
            } else {
                self.screen_of(el)
            };
            if let Some(v) = v {
                let in_lane = self.pass_lane.is_some_and(|p| self.same_lane(p, l));
                if tracked {
                    let t = self.txs[l].parent.unwrap_or(l);
                    self.verdict_read(c.unwrap(), t, false);
                }
                if guess {
                    let n = &self.nodes[el];
                    if self.probing
                        && (flying
                            || (self.landed(el)
                                && (n.pending_err.is_some()
                                    || !self.equals_slot(el, &self.latest_val(el), &n.pending))))
                    {
                        self.probe_found = true;
                    }
                    if self.latest_active && self.txs[l].folded {
                        return Ok(self.folded_read(None, el).expect("a folded value"));
                    }
                    return Ok(self.latest_val(el).expect("a guess's value"));
                }
                let up = self.txs[l].parent.unwrap_or(l);
                let up = self.resolve_tx(up);
                if self.probing && (flying || self.park_up(up)) {
                    self.probe_found = true;
                } else if self.probing
                    && !in_lane
                    && self.txs[l].held
                    && !self.nodes[el].shown
                    && self.nodes[el].pending.is_some()
                    && (self.nodes[el].pending_err.is_some()
                        || !self.equals_slot(
                            el,
                            &Some(self.nodes[el].value.clone()),
                            &self.nodes[el].pending,
                        ))
                {
                    self.probe_found = true;
                    if tracked {
                        self.stale_reader(c.unwrap(), l);
                    }
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
                    // A held reader seated in a lane is judged as any other
                    // (`!c._x._transaction?._lane`).
                    match c.filter(|c| {
                        self.nodes[*c].config & CONFIG_HELD != 0
                            && !self.nodes[*c].transaction.is_some_and(|t| self.txs[t].lane)
                    }) {
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
                    // `latest` keeps a displayed guess over a correction until
                    // the commit (#4689, D-34).
                    if self.kept_guess(el) && self.blocked(t) {
                        return Ok(self.nodes[el].value.clone());
                    }
                    if !tracked && self.flush_transaction.is_some() && !self.running {
                        self.join_future(Some(t));
                    }
                    return self.held_latest(el, if tracked { c } else { None });
                }
                if self.latest_active {
                    self.ahead_error_of(owner)?;
                }
                return Ok(self.nodes[el].value.clone());
            }
            if self.nodes[el].pending.is_some()
                && (status & STATUS_PENDING == 0 || (self.latest_active && !self.probing))
            {
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
                if self.latest_active {
                    self.ahead_error_of(owner)?;
                }
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

    // Solid: verdict.ts `holdStaging` (`holdStagingHook`)
    pub(super) fn hold_staging(&mut self, c: NodeId, el: Option<NodeId>) -> bool {
        if let Some(el) = el {
            // A sync verdict memo's staging is display while only the frame
            // reads it (#4776): a memo pass reads its committed value.
            if self.nodes[c].effect_type == 0
                && self.pass_lane.is_none()
                && self.nodes[el].fn_.is_some()
                && self.nodes[el].config
                    & (CONFIG_VERDICT | CONFIG_ASYNC | CONFIG_HELD | CONFIG_OVERRIDE)
                    == CONFIG_VERDICT
            {
                return true;
            }
        }
        // The conditions in Solid's order (`&&` short-circuits).
        let Some(r) = self.nodes[c].read_in else {
            return false;
        };
        if self.nodes[c].config & (CONFIG_OWN_PROBE | CONFIG_FRAME) != 0
            || self.nodes[c].flags & (REACTIVE_WINDOW | REACTIVE_PROBE_UNANSWERED) != 0
        {
            return false;
        }
        if let Some(el) = el {
            if self.nodes[el].pending.is_none()
                || self.nodes[el].config & (CONFIG_ASYNC | CONFIG_OVERRIDE) != 0
            {
                return false;
            }
            let held = if self.nodes[el].config & CONFIG_HELD != 0 {
                self.nodes[el].transaction
            } else {
                self.flush_transaction
            };
            // `resolveTx(flushTransaction!)` of a null flush transaction
            // throws in Solid: fail closed.
            let h = held.expect("resolveTx(null) (verdict.ts holdStaging) is not ported");
            let h = self.resolve_tx(h);
            match self.nodes[el].asked_in {
                AskedIn::Clock(k) if k == self.clock => return false,
                AskedIn::Tx(t) if self.resolve_tx(t) == h => return false,
                _ => {}
            }
            if self.resolve_tx(r) != h {
                return false;
            }
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

    // Solid: verdict.ts `attachWaits` (`attachHook`)
    pub(super) fn attach_waits(&mut self, node: NodeId) -> bool {
        // A run of the frame a landing holds for its re-derivation (lanes.ts
        // `waiting`, #4677) runs next round, with the landing's held runs.
        if self.waiting.as_ref().is_some_and(|w| w.contains(&node)) {
            let ty = self.nodes[node].effect_type;
            let lane = self.pass_lane;
            self.enqueue(ty, QueueCallback::RunEffect(node), lane);
            return true;
        }
        false
    }

    // Solid: verdict.ts:736-749 (`holdWorkHook`): truthy when it drops the
    // verdict posture.
    pub(super) fn hold_work(&mut self, n: NodeId, source: NodeId) -> bool {
        let node = &self.nodes[n];
        if node.config & (CONFIG_ASYNC | CONFIG_OWN_PROBE) == CONFIG_ASYNC
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
            if self.held_mount_under(Some(r), None) {
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
                let dep = self.links[l].dep;
                // A lane reader does not carry a hold's staged error (#4841),
                // unless it is its own lane's guess.
                let lane_reader = self.nodes[node]
                    .transaction
                    .is_some_and(|t| self.txs[t].lane)
                    && (self.nodes[dep].config & CONFIG_GUESS == 0
                        || self.nodes[dep].transaction == self.nodes[node].transaction);
                if self.nodes[dep].config & CONFIG_STAGED_ERROR != 0 && !lane_reader {
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

    // Solid: verdict.ts `park`: a frame flight a hold waits on is parked on
    // the reader; its settling unparks it (`done`).
    fn park(&mut self, r: NodeId, t: TxId) {
        let p = self.nodes[r].in_flight;
        self.nodes[r].parked = p;
        let waits = self.txs[t].nodes.clone().into_iter().any(|n| {
            if self.nodes[n].status & STATUS_PENDING == 0
                || !(n == r || self.set_has(self.nodes[n].pending_sources, r))
            {
                return false;
            }
            if self.nodes[n].effect_type == EFFECT_RENDER {
                return true;
            }
            let mut s = self.nodes[n].subs;
            while let Some(link) = s {
                let e = self.links[link].sub;
                s = self.links[link].next_sub;
                let en = &self.nodes[e];
                if if en.effect_type == EFFECT_RENDER {
                    en.status & STATUS_PENDING != 0 || en.flags & REACTIVE_FRAME_READ != 0
                } else {
                    en.config & CONFIG_REDERIVE != 0 && en.status == STATUS_PENDING
                } {
                    return true;
                }
            }
            false
        });
        if waits {
            if !self.parks.contains(&r) {
                self.parks.push(r);
            }
            let p = p.expect("a parked flight");
            self.on_flight(p, Reaction::ParkDone(r, p));
        }
    }

    /// `park`'s `done`: the parked flight settled.
    pub(super) fn park_done(&mut self, r: NodeId, p: FlightId) {
        if let Some(i) = self.parks.iter().position(|x| *x == r) {
            if self.nodes[r].parked == Some(p) {
                self.parks.remove(i);
                self.schedule();
            }
        }
    }

    // Solid: verdict.ts `parkUp`: a parked reader in a lane of `t`.
    fn park_up(&mut self, t: TxId) -> bool {
        let mut i = self.parks.len() as isize - 1;
        while i >= 0 {
            let r = self.parks[i as usize];
            let l = self.nodes[r].transaction;
            if self.nodes[r].parked.is_none() || self.nodes[r].flags & REACTIVE_DISPOSED != 0 {
                self.parks.remove(i as usize);
            } else if let Some(l) = l.filter(|l| self.txs[*l].lane) {
                if self.resolve_tx(self.txs[l].parent.unwrap()) == t {
                    return true;
                }
            }
            i -= 1;
        }
        false
    }

    // Solid: verdict.ts `reask`
    fn reask_parked(&mut self, c: NodeId, l: TxId, cur: NodeId) {
        if self.left.iter().any(|(n, _)| *n == c) {
            return;
        }
        let Some(i) = self.parks.iter().position(|x| *x == c) else {
            if self.nodes[c].effect_type == 0 && self.nodes[c].transaction == Some(l) {
                let mut s = self.nodes[c].subs;
                while let Some(link) = s {
                    let sub = self.links[link].sub;
                    s = self.links[link].next_sub;
                    self.reask_parked(sub, l, cur);
                }
            }
            return;
        };
        self.parks.remove(i);
        self.leave(c, l, cur);
    }

    // Solid: verdict.ts `seat`
    fn seat(&mut self, r: NodeId, t: TxId) {
        let v = self.verdict_lane(t);
        self.list(r, v);
        self.nodes[r].flags |= REACTIVE_LANE_DIRTY;
    }

    // Solid: verdict.ts `leave`
    fn leave(&mut self, c: NodeId, l: TxId, cur: NodeId) {
        let pending_unshown = !self.nodes[c].shown && self.nodes[c].status & STATUS_PENDING != 0;
        match self.left.iter_mut().find(|(n, _)| *n == c) {
            Some(e) => e.1 = pending_unshown,
            None => self.left.push((c, pending_unshown)),
        }
        self.nodes[c].shown = false;
        self.nodes[c].transaction = None;
        self.nodes[c].parked = None;
        self.set_pending(c, None);
        self.nodes[c].config &= !(CONFIG_OVERRIDE | CONFIG_VERDICT);
        if c != cur {
            self.nodes[c].flags |= REACTIVE_DIRTY;
            self.enqueue_sub(c);
        }
        let mut d = self.nodes[c].deps;
        while let Some(link) = d {
            let n = self.links[link].dep;
            d = self.links[link].next_dep;
            if self.nodes[n].fn_.is_some()
                && self.nodes[n].transaction == Some(l)
                && !self.left.iter().any(|(x, _)| *x == n)
            {
                self.leave(n, l, cur);
            }
        }
    }

    // Solid: verdict.ts `adoptParked` (`laneAdoptHook`): visit 2, a lane node
    // re-run leaves its parked lane; visit 1, a landing adopts the frame
    // flight parked on an armed reader; no visit, a re-derived reader arms.
    pub(super) fn adopt(&mut self, r: NodeId, visit: u8) -> bool {
        if visit == 2 {
            let l = self.nodes[r].transaction;
            if !self.parks.is_empty() && l.is_some_and(|l| self.is_verdict(l)) {
                self.reask_parked(r, l.unwrap(), r);
            }
            return false;
        }
        if visit != 0 {
            let Some(i) = self.armed.iter().position(|x| *x == r) else {
                return false;
            };
            self.armed.remove(i);
            panic!("adopting a parked frame flight (verdict.ts `adoptParked`, `handleAsync(r, parked.then())`) is not ported");
        }
        if !(self.nodes[r].effect_type != 0 || self.nodes[r].config & CONFIG_ASYNC != 0) {
            let mut s = self.nodes[r].subs;
            while let Some(link) = s {
                let e = self.links[link].sub;
                s = self.links[link].next_sub;
                if self.nodes[e].effect_type != 0 && self.nodes[e].modified {
                    self.nodes[e].modified = false;
                    self.enqueue_sub(e);
                }
                self.arm(e);
            }
        }
        self.arm(r);
        false
    }

    /// `laneAdoptHook?.(r)` from `reruns`.
    pub(super) fn lane_adopt(&mut self, r: NodeId) {
        self.adopt(r, 0);
    }

    // Solid: verdict.ts `arm`
    fn arm(&mut self, r: NodeId) {
        if self.nodes[r].parked.is_some()
            && self.nodes[r].flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP) == 0
            && !self.armed.contains(&r)
        {
            self.armed.push(r);
        }
    }

    // Solid: verdict.ts `r5` (`r5Hook`): with no reader, `t`'s lanes wait on
    // a parked flight (or, with neither, the seam's state clears); else an
    // unanswered probe's reader parks its frame flight on a blocked hold.
    pub(super) fn r5(&mut self, r: Option<NodeId>, t: Option<TxId>) -> bool {
        let Some(r) = r else {
            if let Some(t) = t {
                return self.park_up(t);
            }
            self.armed.clear();
            self.left.clear();
            return false;
        };
        let t = t.expect("r5 of a reader has a transaction");
        if self.nodes[r].in_flight.is_some() {
            if !self.blocked(t) {
                return true;
            }
            self.park(r, t);
            self.seat(r, t);
        } else if self.blocked(t) {
            if self.left.iter().any(|(n, _)| *n == r) {
                self.seat(r, t);
            }
            let mut s = self.nodes[r].subs;
            while let Some(link) = s {
                let n = self.links[link].sub;
                s = self.links[link].next_sub;
                if self.nodes[n].in_flight.is_some()
                    && self.set_has(self.nodes[n].pending_sources, n)
                    && self.nodes[n].config & CONFIG_HELD != 0
                    && self.tx_of(n) == t
                    && self.nodes[n].flags & REACTIVE_FRAME_READ == 0
                {
                    self.park(n, t);
                    if self.left.iter().any(|(x, v)| *x == n && *v) {
                        self.seat(n, t);
                        self.enqueue_sub(n);
                    }
                }
            }
        }
        false
    }

    // Solid: verdict.ts `revert` (`revertHook`): D-8, a tick's writes that
    // net back to the committed value wake nothing new.
    pub(super) fn revert(&mut self) {
        let pending = self.pending_nodes.clone();
        for n in pending {
            if self.nodes[n].pending.as_ref() == Some(&self.nodes[n].value)
                && self.nodes[n].pending_err.is_none()
                && (self.nodes[n].fn_.is_none() || self.nodes[n].flags & REACTIVE_MANUAL_WRITE != 0)
            {
                self.unwake(n);
            }
        }
        if !self.held_rewrites.is_empty() {
            for n in std::mem::take(&mut self.held_rewrites) {
                self.unwake(n);
            }
        }
    }

    /// core.ts `tickBase`: the value a signal had when this tick began
    /// writing it.
    fn tick_base(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if n.config & CONFIG_HELD != 0 && n.flushed_at == self.clock as i64 {
            n.flushed.clone()
        } else {
            Some(n.value.clone())
        }
    }

    /// `isSame(n, a, b)` over slots (NOT_PENDING equals only itself).
    fn same_slot(&self, n: NodeId, a: &Slot, b: &Slot) -> bool {
        match (a, b) {
            (Some(a), Some(b)) => self.is_same(n, a, b),
            (None, None) => true,
            _ => false,
        }
    }

    // Solid: verdict.ts `unwake`
    fn unwake(&mut self, n: NodeId) {
        if self.nodes[n].pending.is_none()
            || self.nodes[n].pending_err.is_some()
            || !self.same_slot(n, &self.tick_base(n), &self.nodes[n].pending)
        {
            return;
        }
        let mut s = self.nodes[n].subs;
        while let Some(link) = s {
            let sub = self.links[link].sub;
            s = self.links[link].next_sub;
            if self.nodes[sub].flags & REACTIVE_IN_HEAP == 0
                || self.nodes[sub].flags & REACTIVE_MISSED_WAKE != 0
                || self.nodes[sub].config & CONFIG_VERDICT != 0
            {
                continue;
            }
            let mut same = true;
            let mut d = self.nodes[sub].deps;
            while let Some(l) = d {
                if !same {
                    break;
                }
                let dep = self.links[l].dep;
                d = self.links[l].next_dep;
                let fnd = self.nodes[dep].fn_.is_some();
                same = !(fnd
                    && self.nodes[dep].flags
                        & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK)
                        != 0)
                    && (self.nodes[dep].pending.is_none()
                        || (fnd && self.nodes[dep].flags & REACTIVE_MANUAL_WRITE == 0)
                        || (self.nodes[dep].pending_err.is_none()
                            && self.same_slot(
                                dep,
                                &self.tick_base(dep),
                                &self.nodes[dep].pending,
                            )));
            }
            if same {
                self.delete_from_heap(sub);
                self.nodes[sub].flags &= !(REACTIVE_DIRTY | REACTIVE_CHECK);
            }
        }
    }

    // Solid: verdict.ts `pass` (`passHook`): at a pass's head, the held error
    // `latest` keeps (`tail` false); at its tail, whether a pending pass read
    // only committed values (a re-ask).
    pub(super) fn pass(&mut self, el: NodeId, tail: bool) -> bool {
        if !tail {
            self.nodes[el].ahead_error = if self.nodes[el].config
                & (CONFIG_STAGED_ERROR | CONFIG_HELD)
                == CONFIG_STAGED_ERROR | CONFIG_HELD
            {
                self.nodes[el].pending_err.clone()
            } else {
                None
            };
            return false;
        }
        if self.guessing
            || self.pass_lane.is_some()
            || self.nodes[el].status & STATUS_UNINITIALIZED != 0
        {
            return false;
        }
        let tail_link = self.nodes[el].deps_tail;
        let mut d = self.nodes[el].deps;
        while let Some(l) = d {
            let dep = self.links[l].dep;
            let n = &self.nodes[dep];
            let moved = match &n.pending {
                Some(p) => n.pending_err.is_some() || !self.is_same(dep, &n.value, p),
                None => n.fn_.is_some() && n.status & STATUS_PENDING != 0,
            };
            if moved {
                return false;
            }
            if Some(l) == tail_link {
                break;
            }
            d = self.links[l].next_dep;
        }
        true
    }
}
