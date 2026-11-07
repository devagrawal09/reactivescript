//! Solid: lanes.ts (and truth.ts `laneValueOf`) — guesses, lanes, their
//! seams, corrections and endings.
//!
//! Not ported (constant in this slice): verdict lanes (`_verdict` is always
//! null, `isVerdict` always false), linked lanes (`_links`, `linkLanes`:
//! only a pass reading two lanes links them), `take`/`kept`/`reverted`
//! (another action's guess taken over by a lane), store slots
//! (CONFIG_SLOT_NODE), truth readers (CONFIG_AUTHORITATIVE), folded and
//! re-based lanes, `ahead`/`entered` verdict readers, and flights
//! (`inFlight` is false: no node is ever STATUS_PENDING).
use super::*;

impl Runtime {
    // Solid: truth.ts:23-29
    pub(super) fn lane_value_of(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if n.config & CONFIG_GUESS == 0 && n.pending.is_some() {
            return n.pending;
        }
        match n.lane {
            Some(v) => Some(v),
            None if n.status & STATUS_UNINITIALIZED != 0 => None,
            None => Some(n.value),
        }
    }

    // Solid: lanes.ts:119-123
    fn new_lane(&mut self, parent: TxId) -> TxId {
        let l = self.new_transaction(true, Some(parent));
        self.lanes.push(l);
        l
    }

    // Solid: lanes.ts:128-135
    fn display(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        let shown = n.transaction.is_some_and(|t| self.txs[t].shown);
        match n.lane {
            Some(v) if shown => Some(v),
            _ if n.status & STATUS_UNINITIALIZED != 0 => None,
            _ => Some(n.value),
        }
    }

    // Solid: lanes.ts:147-152
    pub(super) fn guessed_value_of(&self, n: NodeId) -> Value {
        if let Some(g) = self.pending_guess_of(n) {
            return Some(g);
        }
        if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
            if let Some(g) = self.lane_value_of(n) {
                return g;
            }
        }
        self.nodes[n].value
    }

    // Solid: lanes.ts:154-158
    fn pending_guess_of(&self, n: NodeId) -> Option<i64> {
        self.pending_guesses
            .iter()
            .rev()
            .find(|(m, _, _)| *m == n)
            .map(|(_, v, _)| *v)
    }

    // Solid: lanes.ts:186-200
    pub fn optimistic_write(&mut self, n: NodeId, v: i64) {
        let prev = self.guessed_value_of(n);
        if self.nodes[n].equals && prev == Some(v) && self.nodes[n].config & CONFIG_GUESS == 0 {
            return;
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
    }

    // Solid: lanes.ts:220-273 (`inFlight` is false: no pending nodes)
    fn apply_guesses(&mut self, parent: Option<TxId>) {
        let mut lane: Option<TxId> = None;
        let guesses = std::mem::take(&mut self.pending_guesses);
        for (n, v, q) in guesses {
            let mut changed = true;
            let mut holder: Option<TxId> = None;
            if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
                changed = !self.nodes[n].equals || self.lane_value_of(n) != Some(Some(v));
                if self.nodes[n].config & CONFIG_GUESS == 0 {
                    self.nodes[n].pending = None;
                    self.nodes[n].config |= CONFIG_GUESS;
                }
                self.nodes[n].lane = Some(Some(v));
                let t = self.tx_of(n);
                holder = self.txs[t].parent;
            } else {
                let l = if self.nodes[n].config & CONFIG_HELD != 0 {
                    let h = self.tx_of(n);
                    holder = Some(h);
                    self.new_lane(h)
                } else {
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
                self.nodes[n].lane = Some(Some(v));
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

    // Solid: lanes.ts:283-337 (no verdict lanes; a pass reading a second,
    // unrelated lane would link the two — not ported)
    fn enter_lane(&mut self, l: TxId, c: NodeId) {
        self.nodes[c].flags |= REACTIVE_LANE_READ;
        let f = self.nodes[c].flags;
        match self.pass_lane {
            None => {
                self.pass_lane = Some(l);
                if f & REACTIVE_STAGED_READ != 0 && (self.guessed || f & REACTIVE_JOINED != 0) {
                    self.staged_read(c, None);
                }
            }
            Some(p) if self.same_lane(p, l) => self.pass_lane = Some(l),
            Some(p) => {
                if !self.under(p, l) {
                    panic!("linked lanes (linkLanes, lanes.ts:350-363) are not ported");
                }
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

    // Solid: lanes.ts:408-492
    pub(super) fn lane_stage(&mut self, el: NodeId, l: TxId, create: bool, errored: bool) -> bool {
        if !(create
            || errored
            || self.nodes[el].flags & REACTIVE_LANE_READ != 0
            || self.nodes[el].config & CONFIG_GUESS != 0)
        {
            if let Some(tx) = self.nodes[el].transaction.filter(|t| self.txs[*t].lane) {
                if self.txs[tx].shown {
                    let parent = self.resolve_tx(self.txs[tx].parent.unwrap());
                    if self.flush_transaction.is_none() || !self.blocked(parent) {
                        self.nodes[el].notified_at = LEFT_SHOWN;
                    } else {
                        self.nodes[el].value = self.display(el).expect("displayed value");
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
                self.nodes[el].pending = None;
                self.nodes[el].config =
                    (self.nodes[el].config & !(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
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
                panic!("take (another action's guess, lanes.ts:174-184) is not ported");
            } else if !errored {
                self.nodes[el].config &= !CONFIG_GUESS;
            }
        } else if errored {
            self.nodes[el].flags |= REACTIVE_LANE_DIRTY;
        }
        self.list(el, l);
        true
    }

    // Solid: lanes.ts:510-542 (no store echoes, truth readers or reverts)
    fn supersede(&mut self, n: NodeId, value: Value, changed: bool) {
        let l = self.tx_of(n);
        let parent = self.resolve_tx(self.txs[l].parent.unwrap_or(l));
        if changed {
            self.dissolve_lane(l, Some(parent), Some(n));
            if self.txs[l].shown {
                self.nodes[n].value = self.nodes[n].lane.expect("a guess carries its lane value");
            }
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            self.nodes[n].lane = None;
            self.hold_node(n, parent);
            if self.nodes[n].subs.is_some() {
                self.insert_subs(n);
            }
        } else {
            self.nodes[n].config |= CONFIG_HELD;
        }
        self.nodes[n].pending = Some(value);
    }

    // Solid: lanes.ts:554-695
    fn dissolve_lane(&mut self, l: TxId, into: Option<TxId>, except: Option<NodeId>) {
        if let Some(k) = self.lanes.iter().position(|x| *x == l) {
            self.lanes.remove(k);
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
            let slot = self.nodes[n].lane;
            let shown = if self.txs[l].shown && effect == 0 {
                slot
            } else {
                Some(self.nodes[n].value)
            };
            let latest = self.lane_value_of(n);
            self.nodes[n].lane = None;
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            match into {
                None => {
                    self.nodes[n].transaction = None;
                    // The first-load test needs a pending node; none here.
                    if effect == 0 && guess == 0 {
                        self.nodes[n].pending = latest;
                    }
                    self.commit_pending_node(n);
                    if effect == 0 {
                        if self.nodes[n].flags
                            & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK)
                            != 0
                        {
                            self.nodes[n].config |= CONFIG_INPUTS_PUBLISHED;
                        }
                        if let Some(s) = shown {
                            if !self.nodes[n].equals || s != self.nodes[n].value {
                                self.insert_subs(n);
                            }
                        }
                    }
                }
                Some(into) if guess != 0 => {
                    if self.nodes[n].pending.is_none() {
                        self.nodes[n].pending = Some(self.covered(n));
                    }
                    if self.txs[l].shown {
                        self.nodes[n].value = slot.expect("a guess carries its lane value");
                    }
                    self.hold_node(n, into);
                    self.insert_subs(n);
                }
                Some(_) => {
                    self.nodes[n].transaction = None;
                    if effect == 0 && shown.is_some() && self.txs[l].shown {
                        self.nodes[n].pending = shown;
                    }
                    if self.txs[l].shown {
                        self.commit_pending_node(n);
                        if effect == 0 {
                            self.nodes[n].config |= CONFIG_INPUTS_PUBLISHED;
                        }
                    } else {
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

    // Solid: lanes.ts:716-814 (no folded lanes, truth readers or pending
    // members: `pending` and `never` are false)
    pub(super) fn lane_read(&mut self, c: Option<NodeId>, el: NodeId) -> Result<Slot, String> {
        let guess = self.nodes[el].config & CONFIG_GUESS != 0;
        let l = self.tx_of(el);
        if !guess && self.nodes[el].status & STATUS_ERROR != 0 {
            return Ok(None);
        }
        let Some(c) = c else {
            return Ok(self.lane_value_of(el));
        };
        if !self.tracking || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
            if self.pass_lane.is_none() || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0 {
                return Ok(self.display(el));
            }
        } else if self.nodes[c].effect_type == EFFECT_RENDER {
            let same = self.pass_lane.is_some_and(|p| self.same_lane(p, l));
            if !same {
                if !guess
                    && !self.txs[l].shown
                    && self.nodes[el].pending.is_some()
                    && self.nodes[c].config & CONFIG_HELD != 0
                    && self.flush_transaction.is_some()
                    && self.resolve_tx(self.flush_transaction.unwrap()) == self.tx_of(c)
                {
                    return Ok(self.nodes[el].pending);
                }
                if self.txs[l].held {
                    if self.nodes[c].flags & REACTIVE_SCREEN_READ == 0 {
                        self.nodes[c].flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
                        self.txs[l].reruns.push(c);
                    }
                    return Ok(Some(self.display(el).ok_or("NotReadyError")?));
                }
            }
        }
        self.enter_lane(l, c);
        Ok(self.lane_value_of(el))
    }

    // Solid: lanes.ts:818-822 (no store slots)
    fn covered(&self, n: NodeId) -> Value {
        self.nodes[n].value
    }

    // Solid: lanes.ts:826-832: a guess in flight needs a pending node.
    fn guess_flights(&self, _l: TxId) -> bool {
        false
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
                    let truth = self.nodes[n].pending.unwrap_or(self.covered(n));
                    let changed = !self.nodes[n].equals || self.nodes[n].lane != Some(truth);
                    self.supersede(n, truth, changed);
                }
            }
        }
        judged
    }

    // Solid: lanes.ts:872-902 (no child frames)
    fn lane_seam(&mut self, l: TxId, leaked: bool) {
        if leaked || self.blocked(l) {
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
                if let Some(p) = self.nodes[n].pending.take() {
                    self.nodes[n].lane = Some(p);
                }
            }
            self.nodes[n].config &= !CONFIG_STAGED;
        }
        self.release_queues(l);
    }

    // Solid: lanes.ts:906-938 (`kept` is always empty: no `take`)
    pub(super) fn end_lanes(&mut self, u: TxId) {
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

    // Solid: lanes.ts:945-947 (no links)
    pub(super) fn lanes_blocked(&mut self, t: TxId) -> bool {
        self.nested_blocked(t)
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

    // Solid: lanes.ts:969-1001 (no store re-bases or slot takes)
    pub(super) fn lane_write(&mut self, el: NodeId, v: i64) {
        if self.nodes[el].config & CONFIG_GUESS != 0 {
            if self.stale(el, self.question) {
                self.nodes[el].pending = Some(Some(v));
                self.nodes[el].config |= CONFIG_HELD;
                self.schedule();
                return;
            }
            let changed = !self.nodes[el].equals || self.nodes[el].lane != Some(Some(v));
            self.supersede(el, Some(v), changed);
        } else {
            let l = self.tx_of(el);
            if self.nodes[el].equals && self.lane_value_of(el) == Some(Some(v)) {
                return;
            }
            if self.txs[l].shown {
                self.nodes[el].pending = Some(Some(v));
            } else {
                self.nodes[el].lane = Some(Some(v));
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
            self.nodes[el].pending = Some(value);
            self.nodes[el].config |= CONFIG_HELD;
            return true;
        }
        let changed = !self.nodes[el].equals || self.nodes[el].lane != Some(value);
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

    // Solid: lanes.ts:1087-1215 (no verdict readers, probes or re-based lanes)
    pub(super) fn lane_seams(&mut self, t: Option<TxId>) {
        self.revealing.clear();
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
                        Some(_) if lane.is_some() => false,
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
            if (k as usize) < self.judged {
                let l = self.lanes[k as usize];
                let is_leaked = leaked.contains(&l);
                self.lane_seam(l, is_leaked);
            }
            k -= 1;
        }
    }
}
