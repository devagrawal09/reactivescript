//! Solid: truth.ts — a lane node's latest value, and the truth readers
//! (`refresh()`'s waiter, CONFIG_AUTHORITATIVE) over lane nodes.
use super::error;
use super::*;

impl Runtime {
    // Solid: truth.ts:23-29
    pub(super) fn lane_value_of(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if n.config & CONFIG_GUESS == 0 && n.pending.is_some() {
            return n.pending.clone();
        }
        match n.lane.clone() {
            Some(v) => Some(v),
            None if n.status & STATUS_UNINITIALIZED != 0 => None,
            None => Some(n.value.clone()),
        }
    }

    // Solid: truth.ts:36-40 (`GlobalQueue._truth`)
    pub(super) fn truth_read(&self, el: NodeId) -> Result<Slot, Error> {
        if self.truth_of(el) {
            return Ok(self.lane_value_of(el));
        }
        if self.nodes[el].config & CONFIG_GUESS == 0 {
            return Err(error::not_ready(None));
        }
        Ok(Some(
            self.nodes[el]
                .pending
                .clone()
                .unwrap_or(self.nodes[el].value.clone()),
        ))
    }

    // Solid: truth.ts:43-47 (`GlobalQueue._confirmed`, installed by the
    // first truth reader's `watch`)
    pub(super) fn truth_confirmed(&mut self, l: TxId) {
        if !self.truth {
            return;
        }
        let mut i = 0;
        while i < self.txs[l].nodes.len() {
            let n = self.txs[l].nodes[i];
            i += 1;
            let mut s = self.nodes[n].subs;
            while let Some(link) = s {
                let sub = self.links[link].sub;
                if self.nodes[sub].config & CONFIG_AUTHORITATIVE != 0 {
                    self.enqueue_sub(sub);
                }
                s = self.links[link].next_sub;
            }
        }
    }

    // Solid: truth.ts:51-58
    fn truth_of(&self, n: NodeId) -> bool {
        let node = &self.nodes[n];
        if node.config & CONFIG_GUESS != 0 {
            // A staged error is an object no guess equals.
            return node.pending.is_some()
                && node.pending_err.is_none()
                && self.equals_slot(n, &node.lane, &node.pending);
        }
        if node.pending.is_some() {
            return false;
        }
        if node.config & CONFIG_OVERRIDE != 0 {
            let mut d = node.deps;
            while let Some(l) = d {
                if !self.truth_of(self.links[l].dep) {
                    return false;
                }
                d = self.links[l].next_dep;
            }
        }
        true
    }
}
