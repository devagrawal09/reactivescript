//! Solid: guesses.ts — the guess layer split out of lanes.ts: optimistic
//! writes, their application at the seam, corrections at a body's end,
//! a guess's own landing (`guessWrite`, `laneOutcome`).
use super::*;

impl Runtime {
    // Solid: guesses.ts `guessedValueOf`
    pub(super) fn guessed_value_of(&self, n: NodeId) -> Value {
        if let Some(g) = self.pending_guess_of(n) {
            return g;
        }
        if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
            if let Some(g) = self.latest_val(n) {
                return g;
            }
        }
        self.nodes[n].value.clone()
    }

    // Solid: guesses.ts `pendingGuessOf`
    pub(super) fn pending_guess_of(&self, n: NodeId) -> Option<Value> {
        self.pending_guesses
            .iter()
            .rev()
            .find(|(m, _, _)| *m == n)
            .map(|(_, v, _)| v.clone())
    }

    // Solid: guesses.ts `optimisticWrite`
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
        // A guess written in the question that read another lane's guess
        // untracked derives from it: the two entangle at the seam (#4788).
        for i in 0..self.read_guesses.len() {
            if self.read_guesses[i].1 == self.question {
                let l = self.read_guesses[i].0;
                self.read_from.push(l);
            }
        }
        self.guessing = true; // armGuessing
        self.guessed = true; // armGuessed
        self.schedule();
        Ok(())
    }

    // Solid: guesses.ts `applyGuesses`
    fn apply_guesses(&mut self, mut parent: Option<TxId>) {
        let mut lane: Option<TxId> = None;
        let guesses = std::mem::take(&mut self.pending_guesses);
        for (n, v, q) in guesses {
            let mut changed = true;
            let mut wait = false;
            let mut holder: Option<TxId> = None;
            if self.nodes[n].config & CONFIG_OVERRIDE != 0 {
                changed = !self.equals_slot(n, &self.latest_val(n), &Some(v.clone()));
                if self.nodes[n].config & CONFIG_GUESS == 0 {
                    self.set_pending(n, None);
                    self.nodes[n].config |= CONFIG_GUESS;
                } else if self.nodes[n].shown {
                    wait = true;
                }
                let t = self.tx_of(n);
                if wait {
                    self.txs[t].reguessed = Some(self.clock);
                }
                self.set_lane_value(n, t, v.clone(), wait);
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
                self.nodes[n].config |= CONFIG_OVERRIDE | CONFIG_GUESS;
                self.list(n, l);
                self.set_lane_value(n, l, v.clone(), false);
            }
            if let (Some(p), Some(h)) = (parent, holder) {
                self.merge(p, h);
            }
            self.nodes[n].x = true; // `ext(n)`
            self.nodes[n].q = q;
            if changed {
                let t = self.tx_of(n);
                self.lane_dirty(n, t);
            }
        }
    }

    // Solid: guesses.ts `applyGuessesAt`
    pub(super) fn apply_guesses_at(&mut self, parent: Option<TxId>) {
        self.judged = self.lanes.len();
        if !self.pending_guesses.is_empty() {
            if let Some(p) = parent {
                let from = self.read_from.clone();
                for r in from {
                    if self.lanes.contains(&r) {
                        let rp = self.txs[r].parent.expect("a lane's parent");
                        self.merge(p, rp);
                    }
                }
            }
            self.apply_guesses(parent);
        }
        let lanes = &self.lanes;
        self.read_guesses.retain(|(l, _)| lanes.contains(l));
        self.read_from.clear();
    }

    // Solid: guesses.ts `supersede` (the observe tier is folded away)
    pub(super) fn supersede(&mut self, n: NodeId, value: Slot, changed: bool) {
        let l = self.tx_of(n);
        let parent = self.resolve_tx(self.txs[l].parent.unwrap_or(l));
        let mut changed = changed;
        if changed && self.nodes[n].config & CONFIG_SLOT_NODE != 0 {
            let g = self.latest_val(n).unwrap_or(Value::NotPending);
            if self.echoes_hook(&g, value.as_ref().unwrap_or(&Value::NotPending)) {
                changed = false;
            }
        }
        if changed {
            self.dissolve_lane(l, Some(parent), Some(n));
            if self.txs[l].shown {
                self.mark_guess(n);
                self.nodes[n].config &= !CONFIG_INPUTS_PUBLISHED;
            }
            self.nodes[n].config &= !(CONFIG_OVERRIDE | CONFIG_GUESS);
            self.nodes[n].shown = false;
            self.nodes[n].revert = false;
            self.covers.remove(&n);
            self.hold_node(n, parent);
            self.set_pending_slot(n, value);
            let mut s = self.nodes[n].subs;
            while let Some(link) = s {
                let sub = self.links[link].sub;
                s = self.links[link].next_sub;
                if self.nodes[sub].flags & REACTIVE_ZOMBIE != 0 {
                    self.stale_reader(sub, parent);
                }
            }
            if self.nodes[n].subs.is_some() {
                self.insert_subs(n);
            }
        } else {
            self.land_beneath(n, value);
            self.truth_confirmed(l);
        }
    }

    // Solid: guesses.ts `laneCorrections`
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
                    let truth = self.under_of(n);
                    let changed = !self.equals_slot(n, &self.latest_val(n), &truth);
                    self.supersede(n, truth, changed);
                }
            }
        }
        judged
    }

    // Solid: guesses.ts `guessWrite` (`guessWriteHook`): a write to a guessed
    // node — its truth landing beneath the guess, or superseding it.
    pub(super) fn guess_write(&mut self, el: NodeId, v: Value) {
        self.slot_merge_hook(el);
        let older = self.stale(el, self.question);
        if self.lane_rebase(el, &v, older) == Some(true) || older {
            self.land_beneath(el, Some(v));
        } else {
            let changed = !self.equals_slot(el, &self.latest_val(el), &Some(v.clone()));
            self.supersede(el, Some(v), changed);
        }
        self.schedule();
    }

    // Solid: guesses.ts `laneOutcome`
    pub(super) fn lane_outcome(&mut self, el: NodeId, value: Value, errored: bool) -> bool {
        if errored {
            return true;
        }
        if self.stale(el, self.answered(el)) {
            self.land_beneath(el, Some(value));
            return true;
        }
        let changed = !self.equals_slot(el, &self.latest_val(el), &Some(value.clone()));
        self.supersede(el, Some(value), changed);
        true
    }

    // Solid: guesses.ts `stale`
    fn stale(&self, el: NodeId, q: u64) -> bool {
        q != 0 && q < self.nodes[el].q
    }

    // Solid: guesses.ts `answered`
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
}
