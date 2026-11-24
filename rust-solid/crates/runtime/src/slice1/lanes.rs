//! Solid: lanes.ts (and truth.ts `laneValueOf`) — guesses, lanes, their
//! seams, corrections and endings.
//!
//! Not ported (constant in these slices): verdict lanes (`_verdict` is
//! always null, `isVerdict` always false), `ahead`/`entered` verdict
//! readers, and parked frame flights (`adoptParked` finds none). The store
//! hooks (`GlobalQueue._slotFlight`, `_slotTake`, `_slotCovered`,
//! `_echoes`, `_laneRebase`, a lane's `folded`/`over`) are store/*.rs.
use super::error;
use super::r#async::Errored;
use super::*;

impl Runtime {
    // Solid: lanes.ts `newLane`
    pub(super) fn new_lane(&mut self, parent: TxId) -> TxId {
        let l = self.new_transaction(true, Some(parent));
        self.lanes.push(l);
        l
    }

    // Solid: lanes.ts `setLaneValue`: a guess waits in `covers` (shown now
    // when its lane or the node is on screen, unless it waits for its
    // lane's reveal); a derivation's lane value is the screen's once shown,
    // else its staging.
    pub(super) fn set_lane_value(&mut self, n: NodeId, l: TxId, v: Value, wait: bool) {
        if self.nodes[n].config & CONFIG_GUESS != 0 {
            self.covers.insert(n, v);
            if !wait && (self.txs[l].shown || self.nodes[n].shown) {
                self.reveal(n);
            }
        } else if self.txs[l].shown || self.nodes[n].shown {
            self.nodes[n].value = v;
            self.nodes[n].shown = true;
            self.nodes[n].status &= !STATUS_UNINITIALIZED;
        } else {
            self.set_pending(n, Some(v));
        }
    }

    // Solid: lanes.ts `reveal`: the waiting guess goes on screen; the
    // committed value it covers stays beneath it to revert to.
    pub(super) fn reveal(&mut self, n: NodeId) {
        let g = self.covers.remove(&n).unwrap_or(Value::Undef);
        if self.nodes[n].pending.is_none() {
            let v = self.nodes[n].value.clone();
            self.set_pending(n, Some(v));
            self.nodes[n].revert = true;
        }
        self.nodes[n].value = g;
        self.nodes[n].shown = true;
        self.nodes[n].status &= !STATUS_UNINITIALIZED;
    }

    // Solid: lanes.ts `screenOf`
    pub(super) fn screen_of(&self, el: NodeId) -> Slot {
        if self.nodes[el].status & STATUS_UNINITIALIZED != 0 {
            None
        } else {
            Some(self.nodes[el].value.clone())
        }
    }

    // Solid: lanes.ts `landBeneath`
    pub(super) fn land_beneath(&mut self, n: NodeId, truth: Slot) {
        self.set_pending_slot(n, truth);
        self.nodes[n].revert = false;
        self.nodes[n].config |= CONFIG_HELD;
    }

    /// `n._pendingValue = v` where `v` may be a staged error object a read
    /// handed out (`latestOf`/`underOf`): it goes back as the staging.
    pub(super) fn set_pending_slot(&mut self, n: NodeId, v: Slot) {
        match v {
            Some(Value::Error(e)) if self.nodes[n].config & CONFIG_STAGED_ERROR != 0 => {
                self.nodes[n].pending = Some(Value::Undef);
                self.nodes[n].pending_err = Some(e);
            }
            v => self.set_pending(n, v),
        }
    }

    // Solid: lanes.ts `keptGuess`
    pub(super) fn kept_guess(&self, n: NodeId) -> bool {
        self.guessed && self.marked_nodes.contains(&n)
    }

    // Solid: lanes.ts `rerun` (and optimistic.ts `GlobalQueue._slotRerun`)
    // has no caller at main: not ported.

    // Solid: lanes.ts `inFlight`
    pub(super) fn in_flight(&self, n: NodeId) -> bool {
        self.nodes[n].status & STATUS_PENDING != 0
            || (self.nodes[n].config & CONFIG_SLOT_NODE != 0 && self.slot_flight(n))
    }

    // Solid: lanes.ts:283-337
    fn enter_lane(&mut self, l: TxId, c: NodeId) -> Result<(), Error> {
        self.nodes[c].flags |= REACTIVE_LANE_READ;
        let f = self.nodes[c].flags;
        match self.pass_lane {
            None => {
                let verdict = self.is_verdict(l);
                // A verdict lane's value read by a pass that read the frame's
                // staging or joined its hold (or whose creator did), by a
                // re-run of another hold's held pass, or by a member of a
                // held frame of that hold stays the frame's (D-25, D-26).
                let stays = verdict && {
                    let ty_or_f = if self.nodes[c].effect_type != 0 {
                        self.nodes[c].effect_type
                    } else {
                        f
                    };
                    self.creator_reads(c, ty_or_f) != 0 || {
                        let hold = self.resolve_tx(self.txs[l].parent.expect("a lane's parent"));
                        (self.nodes[c].config
                            & (CONFIG_HELD
                                | CONFIG_VERDICT
                                | CONFIG_FRAME
                                | CONFIG_LAGS
                                | CONFIG_OVERRIDE)
                            == CONFIG_HELD
                            && self.tx_of(c) != hold)
                            || (self.nodes[c].config & CONFIG_HELD_FRAME != 0
                                && self.born_into(c, hold))
                    }
                };
                if !stays {
                    self.pass_lane = Some(l);
                    if f & REACTIVE_STAGED_READ != 0
                        && (self.guessed || verdict || f & REACTIVE_JOINED != 0)
                    {
                        self.staged_read(c, None)?;
                    }
                }
            }
            Some(p) if self.same_lane(p, l) => self.pass_lane = Some(l),
            Some(p) => {
                self.link_lanes(p, l);
                self.pass_lane = Some(l);
            }
        }
        Ok(())
    }

    // Solid: lanes.ts:339-341 (`isVerdict`)
    pub(super) fn is_verdict(&self, l: TxId) -> bool {
        self.txs[l]
            .parent
            .is_some_and(|p| self.txs[p].verdict == Some(l))
    }

    /// `verdictLane(t)` (lanes.ts:389-391): `t._verdict ??= newLane(t)`.
    pub(super) fn verdict_lane(&mut self, t: TxId) -> TxId {
        match self.txs[t].verdict {
            Some(v) => v,
            None => {
                let v = self.new_lane(t);
                self.txs[t].verdict = Some(v);
                v
            }
        }
    }

    // Solid: lanes.ts:348-360
    fn link_lanes(&mut self, a: TxId, b: TxId) {
        let ga = match self.txs[a].links {
            Some(g) => g,
            None => {
                self.link_groups.push(vec![a]);
                let g = self.link_groups.len() - 1;
                self.txs[a].links = Some(g);
                g
            }
        };
        let gb = self.txs[b].links;
        if gb == Some(ga) {
            return;
        }
        match gb {
            None => {
                self.link_groups[ga].push(b);
                self.txs[b].links = Some(ga);
            }
            Some(gb) => {
                let members = self.link_groups[gb].clone();
                for k in members {
                    self.link_groups[ga].push(k);
                    self.txs[k].links = Some(ga);
                }
            }
        }
    }

    // Solid: lanes.ts:365-373
    fn link_blocked(&mut self, l: TxId) -> bool {
        let Some(g) = self.txs[l].links else {
            return false;
        };
        let mut i = 0;
        while i < self.link_groups[g].len() {
            let k = self.link_groups[g][i];
            i += 1;
            if k != l && (self.txs[k].open != 0 || self.own_flights(k) || self.nested_blocked(k)) {
                return true;
            }
        }
        false
    }

    // Solid: lanes.ts:374-380
    fn unlink(&mut self, l: TxId) {
        let Some(g) = self.txs[l].links else {
            return;
        };
        if let Some(k) = self.link_groups[g].iter().position(|x| *x == l) {
            self.link_groups[g].remove(k);
        }
        self.txs[l].links = None;
    }

    // Solid: lanes.ts `laneStage`
    pub(super) fn lane_stage(
        &mut self,
        el: NodeId,
        l: TxId,
        create: bool,
        errored: Errored,
    ) -> bool {
        let mut errored = errored;
        if !create
            && self.nodes[el].status & STATUS_PENDING != 0
            && self.nodes[el].flags & REACTIVE_STAGED_READ != 0
        {
            if self.nodes[el].flags & REACTIVE_LANE_READ == 0
                && self.nodes[el].config & CONFIG_ASYNC == 0
            {
                errored = Errored::No;
            } else {
                self.lane_wait(el, l);
            }
        }
        if !(create
            || errored.truthy()
            || self.nodes[el].flags & REACTIVE_LANE_READ != 0
            || self.nodes[el].config & CONFIG_GUESS != 0)
        {
            if self.nodes[el].x {
                if let Some(tx) = self.nodes[el].transaction.filter(|t| self.txs[*t].lane) {
                    if self.txs[tx].shown && self.nodes[el].status & STATUS_PENDING == 0 {
                        let parent = self.resolve_tx(self.txs[tx].parent.unwrap());
                        if self.flush_transaction.is_none() || !self.blocked(parent) {
                            self.nodes[el].notified_at = LEFT_SHOWN;
                        }
                    }
                    self.nodes[el].shown = false;
                    self.nodes[el].transaction = None;
                }
                if self.nodes[el].pending.is_some() {
                    self.insert_subs(el);
                }
                self.set_pending(el, None);
            }
            self.nodes[el].config &= !(CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_HELD_FRAME);
            if self.guessed {
                let mut i = 0;
                while i < self.txs[l].nodes.len() {
                    let n = self.txs[l].nodes[i];
                    i += 1;
                    if self.host_fam_node(n) == Some(el) && self.nodes[n].transaction == Some(l) {
                        let v = self.nodes[n].pending.clone();
                        let ve = self.nodes[n].pending_err.clone();
                        self.lane_stage(n, l, false, Errored::No);
                        if v.is_some() {
                            self.queue_pending_node(n);
                            self.nodes[n].pending = v;
                            self.nodes[n].pending_err = ve;
                        }
                    }
                }
            }
            return false;
        }
        if self.nodes[el].effect_type == 0 {
            if self.nodes[el].config & CONFIG_OVERRIDE == 0 {
                if self.nodes[el].config & CONFIG_HELD != 0
                    && self.nodes[el].pending.is_some()
                    && self.txs[self.txs[l].parent.unwrap()].verdict != Some(l)
                {
                    self.insert_subs(el);
                }
                self.set_pending(el, None);
                self.nodes[el].config =
                    (self.nodes[el].config & !(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
                self.nodes[el].x = true; // `ext(el)`
            }
            let other = self.guessed
                && self.nodes[el].config & CONFIG_GUESS != 0
                && self.nodes[el]
                    .transaction
                    .filter(|t| self.txs[*t].lane)
                    .is_some_and(|t| {
                        let a = self.resolve_tx(self.txs[t].parent.unwrap());
                        let b = self.resolve_tx(self.txs[l].parent.unwrap());
                        a != b
                    });
            if other {
                // An input change merges with another hold's guess instead of
                // taking its slot (#5140).
                let t = self.nodes[el].transaction.unwrap();
                let h = self.resolve_tx(self.txs[t].parent.unwrap());
                let lp = self.resolve_tx(self.txs[l].parent.unwrap());
                self.merge(lp, h);
                self.txs[l].over = Some(self.resolve_tx(h));
                self.txs[l].held = true;
                return false;
            } else if !errored.truthy() {
                if self.guessed && self.nodes[el].config & CONFIG_GUESS != 0 {
                    self.covers.remove(&el);
                    if self.nodes[el].revert {
                        self.set_pending(el, None);
                        self.nodes[el].revert = false;
                    }
                }
                self.nodes[el].config &= !CONFIG_GUESS;
            }
        } else if errored.truthy() {
            if let Errored::Node(src) = errored {
                if (self.nodes[el].config & CONFIG_HELD != 0
                    || (self.nodes[src].status & STATUS_UNINITIALIZED == 0
                        && self.nodes[el].flags & REACTIVE_RECOMPUTING_DEPS != 0))
                    && !self.nodes[el].transaction.is_some_and(|t| self.txs[t].lane)
                {
                    self.queue_pending_node(el);
                    return false;
                }
            }
            self.nodes[el].flags |= REACTIVE_LANE_DIRTY;
        }
        self.list(el, l);
        true
    }

    /// `(n as any)._host?._fam?.node`: a store slot's derived family's
    /// derive computed.
    fn host_fam_node(&self, n: NodeId) -> Option<NodeId> {
        let t = self.nodes[n].host?;
        let f = self.store.targets[t].fam?;
        self.store.families[f].node
    }

    // Solid: lanes.ts `dissolveLane`
    pub(super) fn dissolve_lane(&mut self, l: TxId, into: Option<TxId>, except: Option<NodeId>) {
        if let Some(k) = self.lanes.iter().position(|x| *x == l) {
            self.lanes.remove(k);
        }
        self.unlink(l);
        // Its verdicts end with it.
        if let Some(v) = self.txs[l].verdict.take() {
            if self.lanes.contains(&v) {
                self.dissolve_lane(v, None, None);
            }
        }
        let mut i = 0;
        while i < self.txs[l].nodes.len() {
            let n = self.txs[l].nodes[i];
            i += 1;
            if Some(n) == except
                || self.nodes[n].transaction != Some(l)
                || self.nodes[n].flags & REACTIVE_DISPOSED != 0
            {
                continue;
            }
            let effect = self.nodes[n].effect_type;
            let guess = self.nodes[n].config & CONFIG_GUESS;
            let shown = self.nodes[n].value.clone();
            let truth = if guess != 0 { self.under_of(n) } else { None };
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            self.nodes[n].shown = false;
            self.nodes[n].revert = false;
            self.covers.remove(&n);
            match into {
                None => {
                    self.nodes[n].transaction = None;
                    if guess != 0 {
                        self.set_pending_slot(n, truth);
                    }
                    self.commit_pending_node(n);
                    if effect == 0 {
                        if self.nodes[n].flags
                            & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK)
                            != 0
                            || self.nodes[n].status & STATUS_PENDING != 0
                        {
                            self.nodes[n].config |= CONFIG_INPUTS_PUBLISHED;
                        }
                        if !self.equals(n, &shown, &self.nodes[n].value) {
                            self.insert_subs(n);
                        }
                    }
                    if self.nodes[n].flags & REACTIVE_FRAME_READ != 0
                        && self.nodes[n].status & STATUS_ERROR != 0
                        && self.nodes[n].error.as_ref().and_then(|e| e.source()) == Some(Some(n))
                    {
                        self.enqueue_sub(n);
                    }
                }
                Some(into)
                    if guess != 0
                        || (self.guessed
                            && self.nodes[n].config & CONFIG_SLOT_NODE != 0
                            && self.nodes[n].pending.is_some()) =>
                {
                    if guess != 0 {
                        self.set_pending_slot(n, truth);
                    }
                    if self.txs[l].shown && self.guessed {
                        self.mark_guess(n);
                    }
                    self.hold_node(n, into);
                    self.insert_subs(n);
                }
                Some(_) => {
                    self.nodes[n].transaction = None;
                    if effect == 0 {
                        if !self.txs[l].held && self.nodes[n].pending.is_some() {
                            self.insert_subs(n);
                        }
                        self.set_pending(n, None);
                        self.nodes[n].config &= !CONFIG_STAGED_ERROR;
                        if self.nodes[n].status & STATUS_PENDING != 0 {
                            self.nodes[n].in_flight = None;
                            self.enqueue_sub(n);
                        }
                    }
                    if self.txs[l].shown {
                        let born = effect == 0 && self.nodes[n].status & STATUS_UNINITIALIZED != 0;
                        self.commit_pending_node(n);
                        if effect == 0 {
                            self.nodes[n].config |= CONFIG_INPUTS_PUBLISHED;
                            if born {
                                self.enqueue_sub(n);
                            }
                        } else if self.txs[l].held && self.nodes[n].prev_value == Value::Undef {
                            self.enqueue_sub(n);
                        }
                    } else {
                        if self.nodes[n].pending_first_child.is_some()
                            || !self.nodes[n].pending_disposal.is_empty()
                        {
                            self.dispose_children(n, false, true);
                        }
                        self.nodes[n].config &= !(CONFIG_STAGED | CONFIG_HELD | CONFIG_HELD_FRAME);
                    }
                }
            }
        }
        if into.is_none() || (self.txs[l].shown && !self.txs[l].held) {
            self.release_queues(l);
        } else {
            self.txs[l].queues = [vec![], vec![]];
        }
    }

    // Solid: lanes.ts `laneRead`
    pub(super) fn lane_read(&mut self, c: Option<NodeId>, el: NodeId) -> Result<Slot, Error> {
        let guess = self.nodes[el].config & CONFIG_GUESS != 0;
        let l = self.tx_of(el);
        if c.is_some() && self.txs[l].folded {
            if let Some(v) = self.folded_read(c, el) {
                return Ok(Some(v));
            }
        }
        if let Some(c) = c {
            if self.nodes[c].config & CONFIG_AUTHORITATIVE != 0 {
                return self.truth_read(el);
            }
        }
        let status = self.nodes[el].status;
        if !guess && status & STATUS_ERROR != 0 {
            if let Some(c) = c {
                if self.tracking && self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN == 0 {
                    self.enter_lane(l, c)?;
                }
            }
            return Ok(None);
        }
        let Some(c) = c else {
            if guess && self.action_depth != 0 && self.nodes[el].config & CONFIG_SLOT_NODE == 0 {
                self.read_guesses.push((l, self.question));
            }
            return Ok(self.latest_val(el));
        };
        let pending = !guess && status & STATUS_PENDING != 0;
        if !self.tracking || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
            if self.pass_lane.is_none() || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
                return Ok(self.screen_of(el));
            }
        } else if self.nodes[c].effect_type == EFFECT_RENDER {
            let never = pending && !self.nodes[el].shown && !self.reasks(el);
            // A verdict lane's seat leaves the lane for a node it cannot
            // show, or another lane's.
            if let Some(p) = self.pass_lane {
                if self.is_verdict(p) && (never || p != l) {
                    self.pass_lane = None;
                }
            }
            let same = self.pass_lane.is_some_and(|p| self.same_lane(p, l));
            if !same {
                if never && self.txs[l].shown {
                    return Ok(None);
                }
                if !guess
                    && self.txs[l].shown
                    && self.is_verdict(l)
                    && self.nodes[el].pending.is_some()
                    && self.nodes[c].config & CONFIG_HELD != 0
                    && self.flush_transaction.is_some()
                    && self.resolve_tx(self.flush_transaction.unwrap()) == self.tx_of(c)
                {
                    return Ok(self.pending_value(el));
                }
                if self.txs[l].held || pending {
                    if pending
                        && self.nodes[c].config & CONFIG_MOUNT_AHEAD != 0
                        && self.nodes[c].status & STATUS_UNINITIALIZED != 0
                    {
                        return Ok(None);
                    }
                    if self.nodes[c].flags & REACTIVE_SCREEN_READ == 0
                        && (self.txs[l].held || !self.txs[l].shown)
                    {
                        self.nodes[c].flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
                        self.txs[l].reruns.push(c);
                    }
                    return match self.screen_of(el) {
                        None => Err(error::not_ready(None)),
                        Some(v) => Ok(Some(v)),
                    };
                }
                if self.nodes[c].config & CONFIG_VERDICT != 0 && !self.is_verdict(l) {
                    self.entered.push(c);
                }
            }
        }
        self.enter_lane(l, c)?;
        let hide = pending
            && !(self.guessed && !(self.nodes[c].effect_type > EFFECT_RENDER) && self.reasks(el))
            && !(self.nodes[c].config & CONFIG_FRAME != 0
                && self.nodes[c].effect_type == 0
                && self.nodes[el].shown);
        Ok(if hide { None } else { self.latest_val(el) })
    }

    // Solid: lanes.ts `laneServed` (`laneServedHook`): with `el` null, a
    // served flight's wait (a throw of its error, or `true` with `flight`);
    // with `flight`, lane work served a flight's committed value; else the
    // served node's pending sources leave the reader.
    pub(super) fn lane_served(
        &mut self,
        c: NodeId,
        el: Option<NodeId>,
        flight: bool,
    ) -> Result<bool, Error> {
        let Some(el) = el else {
            if let Some(&(f, gen)) = self.served.get(&c) {
                if gen == self.nodes[c].dep_gen && self.nodes[f].status & STATUS_PENDING != 0 {
                    if flight {
                        return Ok(true);
                    }
                    return Err(self.nodes[f]
                        .error
                        .clone()
                        .expect("a pending flight's error"));
                }
            }
            return Ok(false);
        };
        if flight {
            if self.nodes[c].flags & REACTIVE_STAGED_READ != 0 {
                return Ok(false);
            }
            if let Some(u) = self.nodes[el].transaction.or(self.flush_transaction) {
                let u = self.resolve_tx(u);
                self.stale_reader(c, u);
            }
            let gen = self.nodes[c].dep_gen;
            self.served.insert(c, (el, gen));
            return Ok(true);
        }
        let Some(from) = self.nodes[el].pending_sources else {
            return Ok(false);
        };
        if self.nodes[c].pending_sources.is_none() {
            return Ok(false);
        }
        let mut i = 0;
        while let Some(entry) = self.set_at(from, i) {
            i += 1;
            if let Some(s) = entry {
                if self.remove_pending_source(c, s) {
                    self.settle_pending_source(c, s);
                }
            }
        }
        Ok(false)
    }

    // Solid: lanes.ts `guessFlights`
    pub(super) fn guess_flights(&self, l: TxId) -> bool {
        self.txs[l].nodes.iter().any(|&n| {
            self.nodes[n].config & CONFIG_GUESS != 0
                && self.nodes[n].transaction == Some(l)
                && self.in_flight(n)
        })
    }

    // Solid: lanes.ts `laneSeam`
    fn lane_seam(&mut self, l: TxId, leaked: bool) {
        let held = leaked
            || self.blocked(l)
            || match self.txs[l].over {
                Some(over) => {
                    let u = self.live_tx(over).unwrap_or(l);
                    self.blocked(u)
                }
                None => false,
            };
        if held {
            self.txs[l].held = true;
            return;
        }
        self.txs[l].held = false;
        self.txs[l].shown = true;
        let p = self.resolve_tx(self.txs[l].parent.unwrap());
        let v: Vec<NodeId> = self.txs[p]
            .reruns
            .iter()
            .copied()
            .filter(|&r| self.nodes[r].modified && self.nodes[r].transaction == Some(l))
            .collect();
        if self.reruns(l) {
            self.revealing.push(p);
        }
        // The parent lands this seam and re-derives readers whose runs the
        // lane stashed, voiding them (`reruns`): beside other runs of the
        // lane they show first (F-6, #4677).
        else if self.txs[l].queues[0].len() > v.len() {
            self.restores.push(v);
            let i = self.restores.len() - 1;
            self.txs[l].queues[0].insert(0, QueueCallback::Restore(i));
        }
        let mut i = 0;
        while i < self.txs[l].nodes.len() {
            let n = self.txs[l].nodes[i];
            i += 1;
            if self.nodes[n].notified_at == LEFT_SHOWN {
                self.insert_subs(n);
            }
            if self.nodes[n].transaction != Some(l) {
                continue;
            }
            if self.nodes[n].effect_type == 0 {
                if self.nodes[n].config & CONFIG_GUESS != 0 {
                    if self.covers.contains_key(&n) {
                        self.reveal(n);
                    }
                } else if self.nodes[n].pending.is_some() {
                    self.commit_pending_node(n);
                    self.nodes[n].shown = true;
                }
            }
            // The frame this pass built is the screen's now; the one it
            // replaced goes.
            if self.nodes[n].pending_first_child.is_some()
                || !self.nodes[n].pending_disposal.is_empty()
            {
                self.dispose_children(n, false, true);
            }
            self.nodes[n].config &= !CONFIG_STAGED;
        }
        self.release_queues(l);
    }

    /// `marked.add(n)` for a node (lanes.ts `marked`, #4690).
    pub(super) fn mark_guess(&mut self, n: NodeId) {
        if !self.marked_nodes.contains(&n) {
            self.marked_nodes.push(n);
        }
    }

    // Solid: lanes.ts `landing` (#4677): a transaction lands; its lanes end.
    pub(super) fn landing(&mut self, u: TxId) {
        self.walk(u);
        self.end_lanes(u);
    }

    // Solid: lanes.ts `walk` (#4677): the effects that derive plainly from a
    // landing that re-derives a stale reader wait with its held runs.
    fn walk(&mut self, u: TxId) {
        let rr = &self.txs[u].reruns;
        if !rr.iter().any(|&r| {
            self.nodes[r].effect_type == 0 && self.nodes[r].flags & REACTIVE_FRAME_READ != 0
        }) || !rr.iter().any(|&r| {
            (self.nodes[r].flags & REACTIVE_FRAME_READ != 0
                || self.nodes[r].config & CONFIG_VERDICT != 0)
                && (self.nodes[r].effect_type != 0 || self.nodes[r].config & CONFIG_HELD != 0)
        }) {
            return;
        }
        if self.waiting.is_none() {
            self.waiting = Some(vec![]);
            self.queues[1].push(QueueCallback::ClearWaiting);
        }
        let mut q: Vec<NodeId> = self.txs[u]
            .nodes
            .iter()
            .copied()
            .filter(|&n| self.nodes[n].config & CONFIG_VERDICT == 0)
            .collect();
        while let Some(n) = q.pop() {
            let mut s = self.nodes[n].subs;
            while let Some(link) = s {
                s = self.links[link].next_sub;
                let c = self.links[link].sub;
                if self.waiting.as_ref().unwrap().contains(&c)
                    || self.nodes[c].config & CONFIG_VERDICT != 0
                    || self.nodes[c].transaction.is_some_and(|t| self.txs[t].lane)
                {
                    continue;
                }
                self.waiting.as_mut().unwrap().push(c);
                if self.nodes[c].effect_type == 0 {
                    q.push(c);
                }
            }
        }
    }

    // Solid: lanes.ts `endLanes`
    pub(super) fn end_lanes(&mut self, u: TxId) {
        if self.guessed {
            let nodes = &self.txs[u].nodes;
            self.marked_nodes.retain(|n| !nodes.contains(n));
        }
        let mut k = self.lanes.len() as isize - 1;
        while k >= 0 {
            let Some(&l) = self.lanes.get(k as usize) else {
                k -= 1;
                continue;
            };
            k -= 1;
            if self.resolve_tx(self.txs[l].parent.unwrap()) != u {
                continue;
            }
            self.end_lanes(l);
            self.dissolve_lane(l, None, None);
        }
    }

    // Solid: lanes.ts `lanesBlocked`
    pub(super) fn lanes_blocked(&mut self, t: TxId) -> bool {
        // A shown guess a correction re-homed into `t` (`marked`) keeps it
        // open on its own flight (#4690).
        if self.guessed && !self.txs[t].lane {
            let nodes = self.txs[t].nodes.clone();
            if nodes
                .iter()
                .any(|&n| self.marked_nodes.contains(&n) && self.in_flight(n))
            {
                return true;
            }
        }
        if !self.txs[t].lane {
            let mut i = 0;
            while i < self.lanes.len() {
                let l = self.lanes[i];
                i += 1;
                if let (Some(w), Some(over)) = (&self.txs[l].waits, self.txs[l].over) {
                    if self.live_tx(over) == Some(t)
                        && w.iter()
                            .any(|&n| self.nodes[n].status & STATUS_PENDING != 0)
                    {
                        return true;
                    }
                }
            }
        }
        if self.txs[t].lane && self.is_verdict(t) {
            let p = self.resolve_tx(self.txs[t].parent.unwrap());
            if (self.txs[t].opened && self.holds_on(p)) || self.held_mount_under(None, Some(t)) {
                return true;
            }
        }
        if !self.txs[t].lane && self.r5(None, Some(t)) {
            return true;
        }
        (self.txs[t].lane && self.link_blocked(t)) || self.nested_blocked(t)
    }

    // Solid: lanes.ts `collectMounts`
    fn collect_mounts(&mut self) {
        for k in 0..self.transactions.len() {
            let t = self.transactions[k];
            let from = self.txs[t].scanned;
            for i in from..self.txs[t].nodes.len() {
                let r = self.txs[t].nodes[i];
                if self.nodes[r].config & CONFIG_MOUNT_AHEAD != 0 {
                    self.ahead_mounts.push(r);
                }
            }
            self.txs[t].scanned = self.txs[t].nodes.len();
        }
    }

    // Solid: lanes.ts `holdsOn`
    fn holds_on(&self, t: TxId) -> bool {
        self.txs[t].open != 0
            || self.txs[t].nodes.iter().any(|&n| {
                self.nodes[n].effect_type == 0
                    && self.nodes[n].status & STATUS_PENDING != 0
                    && self.nodes[n].flags & REACTIVE_DISPOSED == 0
            })
    }

    // Solid: lanes.ts `shownBy`
    fn shown_by(&self, r: NodeId) -> bool {
        let mut s = self.nodes[r].subs;
        while let Some(link) = s {
            let sub = self.links[link].sub;
            if self.nodes[sub].effect_type == EFFECT_RENDER
                && !self.hidden_by(sub, &mut None).truthy()
            {
                return true;
            }
            s = self.links[link].next_sub;
        }
        false
    }

    // Solid: lanes.ts `heldMountUnder`: a display-ahead mount born held under
    // owner `o` (or a node of lane `l`) still waits.
    pub(super) fn held_mount_under(&mut self, o: Option<NodeId>, l: Option<TxId>) -> bool {
        self.collect_mounts();
        let mut i = self.ahead_mounts.len() as isize - 1;
        while i >= 0 {
            let r = self.ahead_mounts[i as usize];
            if self.nodes[r].status & STATUS_UNINITIALIZED == 0
                || self.nodes[r].config & CONFIG_HELD == 0
                || self.nodes[r].flags & REACTIVE_DISPOSED != 0
            {
                self.ahead_mounts.remove(i as usize);
                i -= 1;
                continue;
            }
            i -= 1;
            let t = self.resolve_tx(self.nodes[r].transaction.expect("a held mount's hold"));
            let holds = self.holds_on(t);
            let hidden = if self.nodes[r].effect_type != 0 {
                self.hidden_by(r, &mut None).truthy()
            } else {
                !self.shown_by(r)
            };
            if hidden
                || !(self.nodes[r].status & STATUS_PENDING != 0 || holds)
                || (l.is_some()
                    && !holds
                    && self.nodes[r]
                        .pending_sources
                        .is_none_or(|s| self.sets[s].size == 0)
                    && {
                        let l = l.unwrap();
                        let group = match self.txs[l].links {
                            Some(g) => self.link_groups[g].clone(),
                            None => vec![l],
                        };
                        group.iter().any(|u| self.txs[*u].reruns.contains(&r))
                    })
            {
                continue;
            }
            let mut p = self.nodes[r].parent;
            while let Some(x) = p {
                if match l {
                    Some(l) => self.nodes[x].transaction == Some(l),
                    None => Some(x) == o,
                } {
                    return true;
                }
                p = self.nodes[x].parent;
            }
        }
        false
    }

    // Solid: lanes.ts `laneWait`: a pending lane pass that read the frame's
    // staging waits on its flight with the frame (S-57).
    fn lane_wait(&mut self, el: NodeId, l: TxId) {
        if !self.running || self.is_verdict(l) {
            return;
        }
        let t = self.flush_transaction;
        if t.is_some() && Some(self.resolve_tx(self.txs[l].parent.unwrap())) == t {
            return;
        }
        let o = self.txs[l].over.and_then(|o| self.live_tx(o));
        if o.is_some() && o != t {
            return;
        }
        self.join_future(None);
        self.txs[l].over = self.flush_transaction;
        self.txs[l].waits.get_or_insert_with(Vec::new).push(el);
        if let Some(k) = self.staged_readers.iter().position(|x| *x == el) {
            self.staged_readers.remove(k);
        }
    }

    // Solid: lanes.ts `nestedBlocked`
    fn nested_blocked(&mut self, t: TxId) -> bool {
        if self.revealing.contains(&t) {
            return true;
        }
        let mut i = 0;
        while i < self.lanes.len() {
            let l = self.lanes[i];
            i += 1;
            if self.resolve_tx(self.txs[l].parent.unwrap()) != t {
                continue;
            }
            if self.blocked(l) || self.guess_flights(l) {
                return true;
            }
        }
        false
    }

    // Solid: lanes.ts `laneWrite`
    pub(super) fn lane_write(&mut self, el: NodeId, v: Value) {
        if self.nodes[el].config & CONFIG_GUESS != 0 {
            self.guess_write(el, v);
            return;
        }
        let l = self.tx_of(el);
        if self.equals_slot(el, &self.latest_val(el), &Some(v.clone())) {
            return;
        }
        self.set_pending(el, Some(v));
        if self.nodes[el].fn_.is_some() {
            self.nodes[el].time = self.clock;
        }
        self.lane_dirty(el, l);
        self.schedule();
    }

    // Solid: lanes.ts `readsHeld`
    fn reads_held(&self, r: NodeId) -> bool {
        let mut d = self.nodes[r].deps;
        while let Some(l) = d {
            if self.nodes[self.links[l].dep].config & CONFIG_HELD != 0 {
                return true;
            }
            d = self.links[l].next_dep;
        }
        false
    }

    // Solid: lanes.ts `laneSeams`
    pub(super) fn lane_seams(&mut self, t: Option<TxId>) {
        self.revealing.clear();
        // #4661 (F-6): a verdict reader that read a flight of the frame ahead
        // of it is no frame reader of it.
        for c in std::mem::take(&mut self.ahead) {
            if self.nodes[c].flags & REACTIVE_FRAME_READ != 0 {
                self.nodes[c].flags ^= REACTIVE_FRAME_READ;
                if let Some(t) = t {
                    // `splice(indexOf(c) >>> 0, 1)`: a miss removes nothing.
                    if let Some(i) = self.txs[t].reruns.iter().position(|x| *x == c) {
                        self.txs[t].reruns.remove(i);
                    }
                }
            }
        }
        let mut leaked: Vec<TxId> = vec![];
        if let Some(t) = t {
            let mut i = 0;
            while i < self.staged_readers.len() {
                let r = self.staged_readers[i];
                i += 1;
                let l = self.nodes[r].transaction.or(
                    if self.nodes[r].flags & REACTIVE_STAGED_READ != 0 {
                        Some(t)
                    } else {
                        None
                    },
                );
                let lane = l.filter(|l| self.txs[*l].lane);
                let skip = self.nodes[r].flags & REACTIVE_DISPOSED != 0
                    || match l {
                        Some(l) if lane.is_some() => {
                            (self.is_verdict(l)
                                && if self.nodes[r].config & CONFIG_VERDICT != 0 {
                                    self.nodes[r].flags & REACTIVE_PROBE_UNANSWERED == 0
                                } else {
                                    !self.blocked(t)
                                })
                                || {
                                    let group = match self.txs[l].links {
                                        Some(g) => self.link_groups[g].clone(),
                                        None => vec![l],
                                    };
                                    group.iter().any(|u| {
                                        self.txs[*u]
                                            .over
                                            .is_some_and(|o| self.live_tx(o) == Some(t))
                                    })
                                }
                        }
                        Some(l) => {
                            !(self.nodes[r].flags & REACTIVE_PROBE_UNANSWERED != 0
                                || ((self.nodes[r].flags & REACTIVE_STAGED_READ != 0
                                    || self.reads_held(r))
                                    && self.blocked(l)
                                    && !self.born_into(r, l)))
                        }
                        None => false,
                    };
                if skip {
                    continue;
                }
                if lane.is_some() && self.nodes[r].effect_type != 0 {
                    self.nodes[r].flags |= REACTIVE_LANE_DIRTY;
                } else if lane.is_none() && self.nodes[r].flags & REACTIVE_PROBE_UNANSWERED != 0 {
                    if self.r5(Some(r), Some(t)) {
                        continue;
                    }
                    if let Some(v) = self.txs[t].verdict {
                        if !leaked.contains(&v) {
                            leaked.push(v);
                        }
                    }
                }
                self.enqueue_sub(r);
                if let Some(l) = lane {
                    if !leaked.contains(&l) {
                        leaked.push(l);
                    }
                }
            }
        }
        let mut k = self.lanes.len() as isize - 1;
        while k >= 0 {
            // `(k < judged && lanes[k]._reguessed !== clock) || isVerdict(lanes[k])`
            // (past the end, `lanes[k]` is undefined: not a verdict lane).
            let l = self.lanes.get(k as usize).copied();
            let judged = (k as usize) < self.judged
                && l.is_none_or(|l| self.txs[l].reguessed != Some(self.clock));
            if judged || l.is_some_and(|l| self.is_verdict(l)) {
                let l = l.expect("laneSeam of a live lane");
                let is_leaked = leaked.contains(&l);
                self.lane_seam(l, is_leaked);
            }
            k -= 1;
        }
        // A verdict reader that entered a lane this seam held re-derives next
        // round from the frame's seat (#4284).
        while let Some(r) = self.entered.pop() {
            if self.nodes[r].transaction.is_some_and(|t| self.txs[t].held) {
                self.nodes[r].flags &= !REACTIVE_LANE_DIRTY;
                self.enqueue_sub(r);
            }
        }
        self.r5(None, None);
    }
}
