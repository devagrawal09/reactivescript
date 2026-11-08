//! Solid: owner.ts — roots, child chains, `onCleanup` disposal lists, the
//! parked frame (`markDisposal`, the zombie drain) and disposal.
//! Not ported: context and ids (`_context`, `_childCount`, `inheritId`:
//! no op reads them), and the cleanup error channel (`cleanupError`: no
//! cleanup here throws).
use super::*;

impl Runtime {
    /// `createOwner()` (owner.ts:387-449): a root under the current owner.
    // Solid: owner.ts:387-449 (prod literal; no dev diagnostics, no ids)
    pub fn create_owner(&mut self) -> NodeId {
        let parent = self.context;
        let owner = self.add_node(Kind::Root, Value::Undef);
        self.nodes[owner].flags = REACTIVE_NONE;
        // `_parentComputed: parent?._root ? parent._parentComputed : parent`
        self.nodes[owner].parent_computed = match parent {
            Some(p) if self.nodes[p].kind == Kind::Root => self.nodes[p].parent_computed,
            p => p,
        };
        self.nodes[owner].parent = parent;
        if let Some(p) = parent {
            self.link_child(p, owner);
        }
        owner
    }

    /// `createRoot` (owner.ts:487-496): `createOwner()`; the caller runs
    /// its init under it (`runWithOwner`).
    // Solid: owner.ts:487-496
    pub fn create_root(&mut self) -> NodeId {
        self.create_owner()
    }

    /// `getOwner()` (owner.ts:316-318).
    // Solid: owner.ts:316-318
    pub fn get_owner(&self) -> Option<NodeId> {
        self.context
    }

    /// `runWithOwner` (core.ts:2868-2896).
    // Solid: core.ts:2868-2896
    pub fn with_owner<R>(&mut self, owner: Option<NodeId>, f: impl FnOnce(&mut Self) -> R) -> R {
        let old_context = self.context;
        let prev_tracking = self.tracking;
        self.context = owner;
        self.tracking = false;
        let r = f(self);
        self.context = old_context;
        self.tracking = prev_tracking;
        r
    }

    // Solid: owner.ts:46-53
    pub(super) fn mark_disposal(&mut self, el: NodeId) {
        let mut child = self.nodes[el].first_child;
        while let Some(c) = child {
            self.nodes[c].flags |= REACTIVE_ZOMBIE;
            self.mark_disposal(c);
            child = self.nodes[c].next_sibling;
        }
    }

    // Solid: owner.ts:55-64
    pub(super) fn dispose(&mut self, node: NodeId) {
        self.nodes[node].config &= !CONFIG_AUTO_DISPOSE;
        self.unobserved(node);
    }

    // Solid: owner.ts:76-85 (`runCleanup`; no cleanup here throws, so the
    // collected-error arm is not reached)
    fn run_cleanup(&mut self, f: Cleanup) {
        f(self);
    }

    /// A root's `dispose` (`disposeRootSelf`, owner.ts:366-371).
    // Solid: owner.ts:366-371
    pub fn dispose_root(&mut self, root: NodeId) {
        self.dispose_root_self(root, true);
    }

    // Solid: owner.ts:366-371 (`cleanupError` is never set)
    pub(super) fn dispose_root_self(&mut self, root: NodeId, self_: bool) {
        self.dispose_children(root, self_, false);
    }

    /// `onCleanup(fn)` (signals.ts:99-128): `cleanup(fn)` on the current
    /// owner.
    // Solid: signals.ts:99-128 (prod: no diagnostics)
    pub fn on_cleanup(&mut self, f: Cleanup) {
        let owner = self.context;
        self.cleanup(f, owner);
    }

    // Solid: owner.ts:338-344
    pub(super) fn cleanup(&mut self, f: Cleanup, owner: Option<NodeId>) {
        let Some(owner) = owner else {
            return;
        };
        self.nodes[owner].disposal.push(f);
    }

    /// `isDisposed(owner)` (owner.ts:362-364).
    // Solid: owner.ts:362-364
    pub fn is_disposed(&self, node: NodeId) -> bool {
        self.nodes[node].flags & REACTIVE_DISPOSED != 0
    }

    /// The computed whose pass a creation under a root belongs to: a root's
    /// `_parentComputed` (owner.ts:399/421, map.ts:410).
    // Solid: owner.ts:399, 421 (`_parentComputed`); map.ts:410
    pub(super) fn parent_computed(&self, root: NodeId) -> Option<NodeId> {
        self.nodes[root].parent_computed
    }

    // Solid: owner.ts:204-210
    pub(super) fn link_child(&mut self, parent: NodeId, node: NodeId) {
        let head = self.nodes[parent].first_child;
        self.nodes[node].prev_sibling = None;
        self.nodes[node].next_sibling = head;
        if let Some(h) = head {
            self.nodes[h].prev_sibling = Some(node);
        }
        self.nodes[parent].first_child = Some(node);
    }

    // Solid: owner.ts:95-202
    pub(super) fn dispose_children(&mut self, node: NodeId, self_: bool, zombie: bool) {
        let flags = self.nodes[node].flags;
        if flags & REACTIVE_DISPOSED != 0 {
            return;
        }
        if self_ {
            // A parked frame dies with its owner (#3024).
            if !zombie
                && (self.nodes[node].pending_first_child.is_some()
                    || !self.nodes[node].pending_disposal.is_empty())
            {
                self.dispose_children(node, false, true);
            }
            self.nodes[node].flags = flags | REACTIVE_DISPOSED;
            if self.nodes[node].fn_.is_some() {
                self.clear_in_flight(node);
                if (self.nodes[node].status & STATUS_PENDING != 0
                    && self.nodes[node].transaction.is_some())
                    || flags & REACTIVE_FRAME_READ != 0
                    || !self.pending_nodes.is_empty()
                {
                    self.schedule();
                }
            }
        }
        let mut child = if zombie {
            self.nodes[node].pending_first_child.take()
        } else {
            self.nodes[node].first_child.take()
        };
        while let Some(c) = child {
            self.nodes[c].config &= !CONFIG_AUTO_DISPOSE;
            self.delete_from_heap(c);
            self.clear_deps(c);
            self.nodes[c].prev_sibling = Some(c);
            self.dispose_children(c, true, false);
            child = self.nodes[c].next_sibling;
        }
        // `node._childCount = 0`: ids are not ported.
        if self_
            && !zombie
            && flags & REACTIVE_ZOMBIE == 0
            && self.nodes[node]
                .parent
                .is_some_and(|p| self.nodes[p].flags & REACTIVE_DISPOSED == 0)
        {
            // owner.ts:176-191: splice out of a live parent's child chain.
            let parent = self.nodes[node].parent.unwrap();
            let prev = self.nodes[node].prev_sibling;
            let next = self.nodes[node].next_sibling;
            match prev {
                Some(p) => self.nodes[p].next_sibling = next,
                None => self.nodes[parent].first_child = next,
            }
            if let Some(n) = next {
                self.nodes[n].prev_sibling = prev;
            }
            self.nodes[node].prev_sibling = None;
        }
        self.run_disposal(node, zombie);
        if self_ {
            if let Some(cleanup) = self.nodes[node].cleanup.take() {
                self.run_cleanup(cleanup);
            }
        }
    }

    // Solid: owner.ts:212-238
    fn run_disposal(&mut self, node: NodeId, zombie: bool) {
        let disposal = if zombie {
            std::mem::take(&mut self.nodes[node].pending_disposal)
        } else {
            std::mem::take(&mut self.nodes[node].disposal)
        };
        if disposal.is_empty() {
            return;
        }
        // Unwind order (#3572): later registrations run first.
        for f in disposal.into_iter().rev() {
            self.run_cleanup(f);
        }
    }
}
