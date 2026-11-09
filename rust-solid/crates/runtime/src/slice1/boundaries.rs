//! Solid: boundaries.ts — the boundary hooks the scheduler calls
//! (`installBoundaryHooks`, boundaries.ts:1078-1088).
//!
//! No `Loading`/`Errored` boundary exists in these slices, so `boundaryOf`
//! is always undefined, `collecting` is always empty and every loop over a
//! boundary chain runs zero times. What remains is each hook's answer for a
//! node with no boundary: `catchStatus` false, `freshHook` false, and
//! `hiddenBy`'s walk through a CONFIG_REDERIVE output (a `refresh()`
//! waiter). `boundarySeam` and `heldRun` are no-ops and not ported.
use super::*;

impl Runtime {
    // Solid: boundaries.ts:251-299 (`catchHook`): with `flags === 0` the
    // `collecting` loop is empty; otherwise `boundaryOf(node)` is undefined.
    pub(super) fn catch_status(&mut self, _node: NodeId, _flags: u32) -> bool {
        false
    }

    // Solid: boundaries.ts:303-306 (no boundary: undefined)
    fn armed_over(&self, _node: NodeId) -> bool {
        false
    }

    // Solid: boundaries.ts:1080-1084 (`freshHook`)
    pub(super) fn fresh_hook(&mut self, node: NodeId, held: bool) -> bool {
        !held
            && if self.nodes[node].status & STATUS_UNINITIALIZED != 0 {
                self.catch_status(node, STATUS_PENDING)
            } else {
                self.armed_over(node)
            }
    }

    // Solid: boundaries.ts:310-334 (`hiddenHook`; no boundary on the chain).
    // Truthy when `r` reaches only readers that are hidden: a REDERIVE
    // output (a waiter) with no render effect below it.
    pub(super) fn hidden_by(&self, r: NodeId, seen: &mut Option<Vec<NodeId>>) -> bool {
        let mut h = false;
        let mut s = self.nodes[r].subs;
        if seen.is_some() || self.nodes[r].config & CONFIG_REDERIVE != 0 {
            seen.get_or_insert_with(Vec::new);
            h = self.nodes[r].effect_type != EFFECT_RENDER;
            while let Some(l) = s {
                let sub = self.links[l].sub;
                let set = seen.as_mut().unwrap();
                h = if set.contains(&sub) {
                    true
                } else {
                    set.push(sub);
                    self.hidden_by(sub, seen)
                };
                if !h {
                    break;
                }
                s = self.links[l].next_sub;
            }
        }
        h
    }
}
