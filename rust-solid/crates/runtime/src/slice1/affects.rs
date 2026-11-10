//! Solid: affects.ts — `affects()`, the declaration verb of the pending
//! model — and affects-marks.ts, the mark core it shares with
//! `createDeferred`: a count on the marked node (`_x._marks`), coverage
//! pull-derived at probe time (`GlobalQueue._marked`), readers repolled at
//! registration and release.
//!
//! Not ported: the store half (store/affects.ts: a store or a record key as
//! the target, `storeMarks`, `installStoreAffects`, the witness mark); an
//! `affects()` here names an accessor's node (`$REFRESH`). Its
//! `releaseMarkScope` is the lookup of a store mark's scope, which a node
//! that is not a store mark's carrier never has (store/affects.ts:135-140):
//! a no-op here. A mark reaching a derived store's derive (`_fam`) or a
//! store slot node fails closed.
use super::*;

impl Runtime {
    // Solid: affects.ts:43-51
    fn release_mark_list(&mut self, nodes: Vec<NodeId>) {
        for n in nodes {
            // `if (unmark(n)) releaseMarkScope(n)`: no store mark scope.
            self.unmark(n);
        }
    }

    // Solid: affects.ts:55-65
    fn register_mark(&mut self, node: NodeId) {
        self.mark(node);
        match self.flush_transaction {
            None => self.ambient.push(node),
            Some(t) => {
                let u = self.resolve_tx(t);
                self.txs[u].marks.get_or_insert_with(Vec::new).push(node);
            }
        }
        self.repoll(node, &mut vec![], CONFIG_VERDICT | CONFIG_AUTHORITATIVE);
    }

    /// `affects(accessor)` (affects.ts:93-125): the accessor's node
    /// (`target[$REFRESH]`) is marked pending until the surrounding
    /// transaction lands, or, outside one, until the next seam.
    // Solid: affects.ts:93-125 (an accessor target; no key)
    pub fn affects(&mut self, node: NodeId) {
        self.register_mark(node);
        self.schedule();
    }

    /// `releaseMarksHook` (affects.ts:133-143): a landing's marks; a node
    /// whose own flight is up keeps its mark to the seam after that flight
    /// lands (ambient).
    pub(super) fn release_marks(&mut self, nodes: Vec<NodeId>) {
        let mut done = vec![];
        for n in nodes {
            if self.mark_in_flight(n) {
                self.ambient.push(n);
            } else {
                done.push(n);
            }
        }
        self.release_mark_list(done);
    }

    /// `releaseAmbientMarksHook` (affects.ts:144-167): at the seam.
    pub(super) fn release_ambient_marks(&mut self, parked: Option<TxId>) {
        if self.ambient.is_empty() {
            return;
        }
        if let Some(p) = parked {
            let ambient = std::mem::take(&mut self.ambient);
            self.txs[p]
                .marks
                .get_or_insert_with(Vec::new)
                .extend(ambient);
            return;
        }
        let ambient = std::mem::take(&mut self.ambient);
        let mut done = vec![];
        for n in ambient {
            if self.mark_in_flight(n) {
                self.ambient.push(n);
            } else {
                done.push(n);
            }
        }
        if !done.is_empty() {
            self.release_mark_list(done);
        }
    }

    // Solid: affects.ts:169-174 (`inFlight`; a slot node's family flight
    // is the store half's)
    fn mark_in_flight(&self, n: NodeId) -> bool {
        if self.nodes[n].config & CONFIG_SLOT_NODE != 0 {
            panic!("a mark on a store slot node (affects.ts:172, the store half) is not ported");
        }
        self.nodes[n].status & STATUS_PENDING != 0
    }

    // Solid: affects-marks.ts:38-57 (`repoll`)
    fn repoll(&mut self, node: NodeId, seen: &mut Vec<NodeId>, readers: u32) {
        let mut s = self.nodes[node].subs;
        while let Some(l) = s {
            let sub = self.links[l].sub;
            s = self.links[l].next_sub;
            if seen.contains(&sub) {
                continue;
            }
            seen.push(sub);
            if self.nodes[sub].config & readers != 0 {
                self.enqueue_sub(sub);
            }
            if self.nodes[sub].effect_type == 0 {
                self.repoll(sub, seen, readers);
            }
            if self.nodes[sub].fam.is_some() {
                panic!("a mark's repoll through a derived store (affects-marks.ts:50-56) is not ported");
            }
        }
    }

    // Solid: affects-marks.ts:66-83 (`marked`)
    fn marked(&self, el: NodeId, seen: &mut Vec<NodeId>) -> bool {
        if self.nodes[el].marks != 0 {
            return true;
        }
        if self.nodes[el].status & STATUS_ERROR != 0 || seen.contains(&el) {
            return false;
        }
        seen.push(el);
        if self.nodes[el].config & CONFIG_SLOT_NODE != 0 {
            panic!("a mark's coverage of a store slot node (affects-marks.ts:73-76) is not ported");
        }
        // Mid-recompute, only the validated prefix (up to `_depsTail`) is
        // this pass's; a pass that validated none yet reads none.
        let tail = if self.nodes[el].flags & REACTIVE_RECOMPUTING_DEPS != 0 {
            match self.nodes[el].deps_tail {
                None => return false,
                t => t,
            }
        } else {
            None
        };
        let mut d = self.nodes[el].deps;
        while let Some(l) = d {
            if self.marked(self.links[l].dep, seen) {
                return true;
            }
            if Some(l) == tail {
                break;
            }
            d = self.links[l].next_dep;
        }
        false
    }

    // Solid: affects-marks.ts:85-88 (`mark`)
    fn mark(&mut self, node: NodeId) {
        self.nodes[node].x = true; // `ext(node)._marks++`
        self.nodes[node].marks += 1;
        self.marks_active += 1;
    }

    // Solid: affects-marks.ts:92-97 (`unmark`)
    fn unmark(&mut self, node: NodeId) -> bool {
        self.marks_active -= 1;
        self.nodes[node].marks -= 1;
        if self.nodes[node].marks != 0 {
            return false;
        }
        self.repoll(node, &mut vec![], CONFIG_VERDICT | CONFIG_AUTHORITATIVE);
        true
    }

    /// `GlobalQueue._marked` (affects-marks.ts:99): a live mark covers `el`.
    pub(super) fn marked_now(&self, el: NodeId) -> bool {
        self.marks_active != 0 && self.marked(el, &mut vec![])
    }
}
