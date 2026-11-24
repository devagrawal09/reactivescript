//! Solid: truth.ts — a lane node's two values (`covers`, `latestOf`,
//! `covered`, `underOf`, `landed`), and the truth readers (`refresh()`'s
//! waiter, CONFIG_AUTHORITATIVE) over lane nodes.
use super::error;
use super::*;

impl Runtime {
    /// `el._pendingValue` as a reader is handed it: a staged error (D-41,
    /// CONFIG_STAGED_ERROR) is the `StatusError` object itself.
    pub(super) fn pending_value(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        match &n.pending_err {
            Some(e) if n.pending.is_some() => Some(Value::Error(e.clone())),
            _ => n.pending.clone(),
        }
    }

    // Solid: truth.ts `latestOf`: a guess's waiting value (`covers`) or its
    // shown one; otherwise the staging (a staged error as its object), else
    // the committed value (NOT_PENDING for a node never answered).
    pub(super) fn latest_val(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if n.config & CONFIG_GUESS != 0 {
            return Some(match self.covers.get(&el) {
                Some(v) => v.clone(),
                None => n.value.clone(),
            });
        }
        if n.pending.is_some() {
            return self.pending_value(el);
        }
        if n.status & STATUS_UNINITIALIZED != 0 {
            None
        } else {
            Some(n.value.clone())
        }
    }

    // Solid: truth.ts `covered`: the truth a shown guess covers.
    pub(super) fn covered(&self, n: NodeId) -> Slot {
        if self.nodes[n].shown {
            self.pending_value(n)
        } else {
            Some(self.nodes[n].value.clone())
        }
    }

    // Solid: truth.ts `underOf`
    pub(super) fn under_of(&self, n: NodeId) -> Slot {
        if self.nodes[n].pending.is_some() {
            self.pending_value(n)
        } else {
            self.covered(n)
        }
    }

    // Solid: truth.ts `landed`: a truth staged beneath the guess (not the
    // committed value a reveal moved there to revert to).
    pub(super) fn landed(&self, n: NodeId) -> bool {
        self.nodes[n].pending.is_some() && !self.nodes[n].revert
    }

    // Solid: truth.ts `truthRead` (`GlobalQueue._truth`)
    pub(super) fn truth_read(&self, el: NodeId) -> Result<Slot, Error> {
        if self.truth_of(el) {
            return Ok(self.latest_val(el));
        }
        if self.nodes[el].config & CONFIG_GUESS == 0 {
            return Err(error::not_ready(None));
        }
        Ok(self.under_of(el))
    }

    // Solid: truth.ts `truthConfirmed` (`GlobalQueue._confirmed`, installed
    // by the first truth reader's `watch`)
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

    // Solid: truth.ts `truth`
    fn truth_of(&self, n: NodeId) -> bool {
        let node = &self.nodes[n];
        if node.config & CONFIG_GUESS != 0 {
            // A staged error is an object no guess equals.
            return self.landed(n)
                && node.pending_err.is_none()
                && self.equals_slot(n, &self.latest_val(n), &node.pending);
        }
        if node.config & CONFIG_OVERRIDE != 0 {
            let mut d = node.deps;
            while let Some(l) = d {
                if !self.truth_of(self.links[l].dep) {
                    return false;
                }
                d = self.links[l].next_dep;
            }
            return true;
        }
        node.pending.is_none()
    }
}
