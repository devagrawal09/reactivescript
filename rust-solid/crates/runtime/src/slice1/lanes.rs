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
    // Solid: lanes.ts:119-123
    fn new_lane(&mut self, parent: TxId) -> TxId {
        let l = self.new_transaction(true, Some(parent));
        self.lanes.push(l);
        l
    }

    // Solid: lanes.ts:128-135
    pub(super) fn display(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        let shown = n.transaction.is_some_and(|t| self.txs[t].shown);
        match n.lane.clone() {
            Some(v) if shown => Some(v),
            _ if n.status & STATUS_UNINITIALIZED != 0 => None,
            _ => Some(n.value.clone()),
        }
    }

    // Solid: lanes.ts:147-152
    pub(super) fn guessed_value_of(&self, n: NodeId) -> Value {
        if let Some(g) = self.pending_guess_of(n) {
            return g;
        }
        if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
            if let Some(g) = self.lane_value_of(n) {
                return g;
            }
        }
        self.nodes[n].value.clone()
    }

    // Solid: lanes.ts:154-158
    pub(super) fn pending_guess_of(&self, n: NodeId) -> Option<Value> {
        self.pending_guesses
            .iter()
            .rev()
            .find(|(m, _, _)| *m == n)
            .map(|(_, v, _)| v.clone())
    }

    // Solid: lanes.ts:174-181
    pub(super) fn take(&mut self, n: NodeId, l: TxId, d: bool) {
        let lane = self.nodes[n].lane.clone();
        let tx = self.nodes[n].transaction;
        let q = self.nodes[n].q;
        self.kept.push((n, lane, tx, q, l));
        self.rerun(n, l);
        self.nodes[n].config &= if d {
            !(CONFIG_GUESS | CONFIG_OVERRIDE)
        } else {
            !CONFIG_GUESS
        };
        if d {
            self.nodes[n].transaction = None;
            self.nodes[n].lane = None;
        } else {
            self.list(n, l);
        }
    }

    // Solid: lanes.ts:183-185
    fn rerun(&mut self, n: NodeId, t: TxId) {
        let mut s = self.nodes[n].subs;
        while let Some(link) = s {
            let sub = self.links[link].sub;
            self.stale_reader(sub, t);
            s = self.links[link].next_sub;
        }
    }

    // Solid: lanes.ts:186-200
    pub(super) fn optimistic_write_value(&mut self, n: NodeId, v: Value) {
        let _ = self.optimistic_write_fn(n, &mut |_, _| Ok(v.clone()));
    }

    /// `optimisticWrite(n, prev => …)`: the updater composes on what the
    /// user sees; its throw leaves nothing written.
    pub(super) fn optimistic_write_fn(
        &mut self,
        n: NodeId,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
    ) -> Result<(), Error> {
        let prev = self.guessed_value_of(n);
        let v = f(self, prev.clone())?;
        if self.equals(n, &prev, &v) && self.nodes[n].config & CONFIG_GUESS == 0 {
            return Ok(());
        }
        let q = if self.question != 0 {
            self.question
        } else {
            self.next_question()
        };
        self.pending_guesses.push((n, v, q));
        self.guessing = true; // armGuessing
        self.guessed = true;
        self.schedule();
        Ok(())
    }

    // Solid: lanes.ts:213-218
    fn in_flight(&self, n: NodeId) -> bool {
        self.nodes[n].status & STATUS_PENDING != 0
            || (self.nodes[n].config & CONFIG_SLOT_NODE != 0 && self.slot_flight(n))
    }

    // Solid: lanes.ts:220-273
    fn apply_guesses(&mut self, mut parent: Option<TxId>) {
        let mut lane: Option<TxId> = None;
        let guesses = std::mem::take(&mut self.pending_guesses);
        for (n, v, q) in guesses {
            let mut changed = true;
            let mut holder: Option<TxId> = None;
            self.nodes[n].x = true; // `ext(n)._lane`
            if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
                changed = !self.equals_slot(n, &self.lane_value_of(n), &Some(v.clone()));
                if self.nodes[n].config & CONFIG_GUESS == 0 {
                    self.set_pending(n, None);
                    self.nodes[n].config |= CONFIG_GUESS;
                }
                self.nodes[n].lane = Some(v.clone());
                let t = self.tx_of(n);
                holder = self.txs[t].parent;
            } else {
                let l = if self.nodes[n].config & CONFIG_HELD != 0 {
                    let h = self.tx_of(n);
                    holder = Some(h);
                    self.new_lane(h)
                } else {
                    if parent.is_none() && self.in_flight(n) {
                        parent = Some(self.new_transaction(false, None));
                    }
                    let Some(p) = parent else { continue };
                    match lane {
                        Some(l) => l,
                        None => {
                            let l = self.new_lane(p);
                            lane = Some(l);
                            l
                        }
                    }
                };
                self.nodes[n].lane = Some(v.clone());
                self.nodes[n].config |= CONFIG_OVERRIDE | CONFIG_GUESS;
                self.list(n, l);
            }
            if let (Some(p), Some(h)) = (parent, holder) {
                self.merge(p, h);
            }
            self.nodes[n].q = q;
            if changed {
                let t = self.tx_of(n);
                self.lane_dirty(n, t);
            }
        }
    }

    // Solid: lanes.ts:283-337
    fn enter_lane(&mut self, l: TxId, c: NodeId) {
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
                        self.staged_read(c, None);
                    }
                }
            }
            Some(p) if self.same_lane(p, l) => self.pass_lane = Some(l),
            Some(p) => {
                if !self.under(p, l) {
                    if !self.under(l, p) {
                        self.link_lanes(p, l);
                    }
                    self.pass_lane = Some(l);
                }
            }
        }
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

    // Solid: lanes.ts:343-347
    fn under(&self, l: TxId, a: TxId) -> bool {
        let mut t = self.txs[l].parent;
        while let Some(x) = t {
            if !self.txs[x].lane {
                break;
            }
            if x == a {
                return true;
            }
            t = self.txs[x].parent;
        }
        false
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

    // Solid: lanes.ts:408-492
    pub(super) fn lane_stage(
        &mut self,
        el: NodeId,
        l: TxId,
        create: bool,
        errored: Errored,
    ) -> bool {
        if !(create
            || errored.truthy()
            || self.nodes[el].flags & REACTIVE_LANE_READ != 0
            || self.nodes[el].config & CONFIG_GUESS != 0)
        {
            if let Some(tx) = self.nodes[el].transaction.filter(|t| self.txs[*t].lane) {
                if self.txs[tx].shown {
                    let parent = self.resolve_tx(self.txs[tx].parent.unwrap());
                    if self.flush_transaction.is_none() || !self.blocked(parent) {
                        self.nodes[el].notified_at = LEFT_SHOWN;
                    } else {
                        // (NOT_PENDING for a node with nothing on screen.)
                        self.nodes[el].value = self.display(el).unwrap_or(Value::NotPending);
                    }
                }
                self.nodes[el].transaction = None;
            }
            self.nodes[el].lane = None;
            self.nodes[el].config &= !(CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_HELD_FRAME);
            return false;
        }
        if self.nodes[el].effect_type == 0 {
            if self.nodes[el].config & CONFIG_OVERRIDE == 0 {
                self.set_pending(el, None);
                self.nodes[el].config =
                    (self.nodes[el].config & !(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
                self.nodes[el].x = true; // `ext(el)`
            }
            let other = self.nodes[el]
                .transaction
                .filter(|t| self.txs[*t].lane)
                .is_some_and(|t| {
                    let a = self.resolve_tx(self.txs[t].parent.unwrap());
                    let b = self.resolve_tx(self.txs[l].parent.unwrap());
                    a != b
                });
            if self.guessed && self.nodes[el].config & CONFIG_GUESS != 0 && other {
                self.take(el, l, false);
            } else if !errored.truthy() {
                self.nodes[el].config &= !CONFIG_GUESS;
            }
        } else if errored.truthy() {
            if let Errored::Node(src) = errored {
                if self.nodes[src].status & STATUS_UNINITIALIZED == 0
                    && (self.nodes[el].config & CONFIG_HELD != 0
                        || self.nodes[el].flags & REACTIVE_RECOMPUTING_DEPS != 0)
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

    // Solid: lanes.ts:510-542 (the observe tier is folded away)
    pub(super) fn supersede(&mut self, n: NodeId, value: Value, changed: bool) {
        let l = self.tx_of(n);
        let parent = self.resolve_tx(self.txs[l].parent.unwrap_or(l));
        let mut changed = changed;
        if changed
            && self.nodes[n].config & CONFIG_SLOT_NODE != 0
            && self.echoes_hook(self.nodes[n].lane.as_ref().unwrap_or(&Value::Undef), &value)
        {
            changed = false;
        }
        if changed {
            self.dissolve_lane(l, Some(parent), Some(n));
            if self.guessed && self.reverting && !self.reverted.contains(&l) {
                self.reverted.push(l);
            }
            if self.txs[l].shown {
                self.nodes[n].value = self.nodes[n].lane.clone().unwrap_or(Value::NotPending);
            }
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            self.nodes[n].lane = None;
            self.hold_node(n, parent);
            if self.nodes[n].subs.is_some() {
                self.insert_subs(n);
            }
        } else {
            self.nodes[n].config |= CONFIG_HELD;
            self.truth_confirmed(l);
        }
        self.set_pending(n, Some(value));
    }

    // Solid: lanes.ts:554-695
    fn dissolve_lane(&mut self, l: TxId, into: Option<TxId>, except: Option<NodeId>) {
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
        let mut loading: Vec<NodeId> = vec![];
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
            let slot = self.nodes[n].lane.clone();
            let shown = if self.txs[l].shown && effect == 0 {
                slot.clone()
            } else {
                Some(self.nodes[n].value.clone())
            };
            let latest = self.lane_value_of(n);
            self.nodes[n].lane = None;
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            match into {
                None => {
                    self.nodes[n].transaction = None;
                    if effect == 0 && guess == 0 {
                        let first_load = slot.is_none()
                            && self.nodes[n].status & (STATUS_UNINITIALIZED | STATUS_PENDING)
                                == STATUS_UNINITIALIZED | STATUS_PENDING
                            && (self.nodes[n].in_flight.is_some()
                                || loading
                                    .iter()
                                    .any(|q| self.set_has(self.nodes[n].pending_sources, *q)));
                        if first_load {
                            loading.push(n);
                        } else if self.nodes[n].pending.is_none() {
                            // (A staging is `latest` itself: unchanged.)
                            self.set_pending(n, latest);
                        }
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
                        if let Some(s) = shown {
                            if !self.equals(n, &s, &self.nodes[n].value) {
                                self.insert_subs(n);
                            }
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
                    if self.nodes[n].pending.is_none() {
                        let c = self.covered(n);
                        self.set_pending(n, Some(c));
                    }
                    if self.txs[l].shown {
                        self.nodes[n].value = slot.unwrap_or(Value::NotPending);
                    }
                    self.hold_node(n, into);
                    self.insert_subs(n);
                }
                Some(_) => {
                    self.nodes[n].transaction = None;
                    if effect == 0 {
                        if shown.is_some() && self.txs[l].shown {
                            self.set_pending(n, shown);
                        }
                        if self.nodes[n].status & STATUS_PENDING != 0 {
                            self.nodes[n].in_flight = None;
                            self.enqueue_sub(n);
                        }
                    }
                    if self.txs[l].shown {
                        self.commit_pending_node(n);
                        if effect == 0 {
                            self.nodes[n].config |= CONFIG_INPUTS_PUBLISHED;
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

    // Solid: lanes.ts:716-814
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
            return Ok(None);
        }
        let Some(c) = c else {
            return Ok(self.lane_value_served(el));
        };
        let pending = !guess && status & STATUS_PENDING != 0;
        if !self.tracking || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
            if self.pass_lane.is_none() || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
                return Ok(self.display(el));
            }
        } else if self.nodes[c].effect_type == EFFECT_RENDER {
            let never = pending && self.nodes[el].lane.is_none();
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
                    && (!self.txs[l].shown || self.is_verdict(l))
                    && self.nodes[el].pending.is_some()
                    && self.nodes[c].config & CONFIG_HELD != 0
                    && self.flush_transaction.is_some()
                    && self.resolve_tx(self.flush_transaction.unwrap()) == self.tx_of(c)
                {
                    return Ok(self.pending_value(el));
                }
                if self.txs[l].held || pending {
                    if self.nodes[c].flags & REACTIVE_SCREEN_READ == 0 {
                        self.nodes[c].flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
                        self.txs[l].reruns.push(c);
                    }
                    return match self.display(el) {
                        None => Err(error::not_ready(None)),
                        Some(v) => Ok(Some(v)),
                    };
                }
                if self.nodes[c].config & CONFIG_VERDICT != 0 && !self.is_verdict(l) {
                    self.entered.push(c);
                }
            }
        }
        self.enter_lane(l, c);
        Ok(if pending {
            None
        } else {
            self.lane_value_served(el)
        })
    }

    // Solid: lanes.ts:1245-1249 (`laneServedHook`)
    pub(super) fn lane_served(&mut self, c: NodeId, el: NodeId) {
        let Some(from) = self.nodes[el].pending_sources else {
            return;
        };
        if self.nodes[c].pending_sources.is_none() {
            return;
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
    }

    // Solid: lanes.ts:818-822
    fn covered(&self, n: NodeId) -> Value {
        if self.nodes[n].config & CONFIG_SLOT_NODE != 0 {
            self.slot_covered(n)
        } else {
            self.nodes[n].value.clone()
        }
    }

    // Solid: lanes.ts:826-832
    fn guess_flights(&self, l: TxId) -> bool {
        self.txs[l].nodes.iter().any(|&n| {
            self.nodes[n].config & CONFIG_GUESS != 0
                && self.nodes[n].transaction == Some(l)
                && self.in_flight(n)
        })
    }

    // Solid: lanes.ts:847-870
    pub(super) fn lane_corrections(&mut self) -> bool {
        let mut judged = false;
        let live = self.lanes.clone();
        for l in live {
            if !self.lanes.contains(&l) {
                continue;
            }
            let p = self.resolve_tx(self.txs[l].parent.unwrap());
            if !self.txs[p].acted
                || self.txs[p].open != 0
                || self.txs[p].lane
                || self.own_flights(p)
                || self.guess_flights(l)
            {
                continue;
            }
            judged = true;
            let mut i = 0;
            while i < self.txs[l].nodes.len() && self.lanes.contains(&l) {
                let n = self.txs[l].nodes[i];
                i += 1;
                if self.nodes[n].config & CONFIG_GUESS != 0 && self.nodes[n].transaction == Some(l)
                {
                    let truth = match self.nodes[n].pending.clone() {
                        Some(p) => p,
                        None => self.covered(n),
                    };
                    // (`__OBSERVE__ || guessed`: `guessed` is set by every guess.)
                    if self.guessed {
                        self.reverting = self.nodes[n].pending.is_none();
                    }
                    let changed = !self.equals_slot(n, &self.nodes[n].lane, &Some(truth.clone()));
                    self.supersede(n, truth, changed);
                    if self.guessed {
                        self.reverting = false;
                    }
                }
            }
        }
        judged
    }

    // Solid: lanes.ts:872-902
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
        if self.reruns(l) {
            let p = self.resolve_tx(self.txs[l].parent.unwrap());
            self.revealing.push(p);
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
            if self.nodes[n].config & CONFIG_GUESS == 0 && self.nodes[n].effect_type == 0 {
                // `x._lane = n._pendingValue`: a staged error (D-41) moves as
                // the `StatusError` object; CONFIG_STAGED_ERROR stays set.
                if let Some(p) = self.pending_value(n) {
                    self.nodes[n].lane = Some(p);
                    self.set_pending(n, None);
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

    /// `(l._links || [l]).some(u => u.over && liveTx(u.over) == t)`
    /// (lanes.ts:1152).
    fn over_reads(&self, l: TxId, t: TxId) -> bool {
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

    // Solid: lanes.ts:906-938
    pub(super) fn end_lanes(&mut self, u: TxId) {
        if self.guessed {
            let mut i = self.kept.len() as isize - 1;
            while i >= 0 {
                let at = i as usize;
                i -= 1;
                if at >= self.kept.len() {
                    continue;
                }
                let taker = self.kept[at].4;
                let p = self.txs[taker].parent.expect("a lane's parent");
                if self.resolve_tx(p) != u {
                    continue;
                }
                let (mut n, v, g, q, t) = self.kept.remove(at);
                let g_live = g.is_some_and(|g| self.lanes.contains(&g));
                if self.reverted.contains(&t)
                    && g_live
                    && (self.nodes[n].config & CONFIG_SLOT_NODE == 0 || {
                        n = self.slot_take_back(n);
                        true
                    })
                {
                    let g = g.unwrap();
                    self.nodes[n].x = true; // `ext(n)`
                    if self.nodes[n].transaction.is_none() || self.tx_of(n) == u {
                        self.commit_pending_node(n);
                        self.nodes[n].lane = v;
                        self.nodes[n].q = q;
                        self.nodes[n].config |= CONFIG_OVERRIDE | CONFIG_GUESS;
                        self.list(n, g);
                        self.rerun(n, u);
                    }
                }
            }
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

    // Solid: lanes.ts:945-947
    pub(super) fn lanes_blocked(&mut self, t: TxId) -> bool {
        (self.txs[t].lane && self.link_blocked(t)) || self.nested_blocked(t)
    }

    // Solid: lanes.ts:954-962
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

    // Solid: lanes.ts:969-1001
    pub(super) fn lane_write(&mut self, el: NodeId, v: Value) {
        if self.nodes[el].config & CONFIG_GUESS != 0 && !(self.guessed && self.slot_take_hook(el)) {
            let older = self.stale(el, self.question);
            if self.lane_rebase(el, &v, older) == Some(true) || older {
                self.set_pending(el, Some(v.clone()));
                self.nodes[el].config |= CONFIG_HELD;
                self.schedule();
                return;
            }
            let changed = !self.equals_slot(el, &self.nodes[el].lane, &Some(v.clone()));
            self.supersede(el, v, changed);
        } else {
            let l = self.tx_of(el);
            if self.equals_slot(el, &self.lane_value_of(el), &Some(v.clone())) {
                return;
            }
            if self.txs[l].shown {
                self.set_pending(el, Some(v.clone()));
            } else {
                self.nodes[el].lane = Some(v);
            }
            if self.nodes[el].fn_.is_some() {
                self.nodes[el].time = self.clock;
            }
            self.lane_dirty(el, l);
        }
        self.schedule();
    }

    // Solid: lanes.ts:1014-1023
    pub(super) fn lane_outcome(&mut self, el: NodeId, value: Value, errored: bool) -> bool {
        if errored {
            return true;
        }
        if self.stale(el, self.answered(el)) {
            self.set_pending(el, Some(value));
            self.nodes[el].config |= CONFIG_HELD;
            return true;
        }
        let changed = !self.equals_slot(el, &self.nodes[el].lane, &Some(value.clone()));
        self.supersede(el, value, changed);
        true
    }

    // Solid: lanes.ts:1028-1030
    fn stale(&self, el: NodeId, q: u64) -> bool {
        q != 0 && q < self.nodes[el].q
    }

    // Solid: lanes.ts:1035-1042
    fn answered(&self, el: NodeId) -> u64 {
        let mut q = 0;
        let mut l = self.nodes[el].deps;
        while let Some(link) = l {
            let d = self.links[link].dep;
            if self.nodes[d].q > q && self.nodes[d].time == self.clock {
                q = self.nodes[d].q;
            }
            l = self.links[link].next_dep;
        }
        q
    }

    // Solid: lanes.ts:1049-1052
    pub(super) fn apply_guesses_at(&mut self, parent: Option<TxId>) {
        self.judged = self.lanes.len();
        if !self.pending_guesses.is_empty() {
            self.apply_guesses(parent);
        }
    }

    // Solid: lanes.ts:1082-1086
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

    // Solid: lanes.ts:1053-1075 (`heldBy`)
    fn held_by(&mut self, t: TxId, r: NodeId) -> bool {
        if self.txs[t].open != 0 || (self.txs[t].lane && self.link_blocked(t)) {
            return false;
        }
        let mut k: isize = -1;
        let mut u = Some(t);
        while let Some(x) = u {
            if x == t || self.resolve_tx(self.txs[x].parent.expect("a lane's parent")) == t {
                if x != t && self.guess_flights(x) {
                    return false;
                }
                let mut i = 0;
                while i < self.txs[x].nodes.len() {
                    let n = self.txs[x].nodes[i];
                    i += 1;
                    if n == r
                        || self.nodes[n].status & STATUS_PENDING == 0
                        || (self.nodes[n].transaction.is_some() && self.tx_of(n) != x)
                    {
                        continue;
                    }
                    let s = self.nodes[n].pending_sources;
                    let only_r =
                        s.is_some_and(|s| self.sets[s].size == 1 && self.set_has(Some(s), r));
                    if self.nodes[n].effect_type != EFFECT_RENDER || !only_r {
                        return false;
                    }
                }
            }
            k += 1;
            u = self.lanes.get(k as usize).copied();
        }
        true
    }

    // Solid: lanes.ts:1087-1215
    pub(super) fn lane_seams(&mut self, t: Option<TxId>) {
        self.revealing.clear();
        // #4661 (F-6): a verdict reader that read a flight of the frame ahead
        // of it is no frame reader of it.
        for c in std::mem::take(&mut self.ahead) {
            if self.nodes[c].flags & REACTIVE_FRAME_READ != 0 {
                self.nodes[c].flags ^= REACTIVE_FRAME_READ;
                if let Some(t) = t {
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
                                    !self.blocked(t) || self.held_by(t, r)
                                })
                                || self.over_reads(l, t)
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
                    // R5 for an async reader: the landing adopts its frame
                    // flight (`_parked`, `adoptParked`) — not ported.
                    if self.nodes[r].in_flight.is_some() {
                        if !self.blocked(t) {
                            continue;
                        }
                        panic!("a parked frame flight (lanes.ts:1176-1178, `adoptParked`) is not ported");
                    } else if self.blocked(t) {
                        let mut sl = self.nodes[r].subs;
                        while let Some(link) = sl {
                            let n = self.links[link].sub;
                            sl = self.links[link].next_sub;
                            if self.nodes[n].in_flight.is_some()
                                && self.set_has(self.nodes[n].pending_sources, n)
                                && self.nodes[n].config & CONFIG_HELD != 0
                                && self.tx_of(n) == t
                            {
                                panic!("a parked frame flight (lanes.ts:1184-1192, `adoptParked`) is not ported");
                            }
                        }
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
            // `k < judged || isVerdict(lanes[k])` (past the end, `lanes[k]` is
            // undefined: not a verdict lane).
            let l = self.lanes.get(k as usize).copied();
            if (k as usize) < self.judged || l.is_some_and(|l| self.is_verdict(l)) {
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
    }
}
