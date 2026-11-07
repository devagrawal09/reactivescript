//! Solid: owner.ts — roots, child chains and disposal.
//! Not ported: `onCleanup` disposal lists, parked frames (`_pendingFirstChild`,
//! zombies), context and ids. No node in this slice owns children other
//! than a root's computeds.
use super::*;

impl Runtime {
    /// `createRoot` / `createOwner` (owner.ts:381-449, 487-496).
    pub fn create_root(&mut self) -> NodeId {
        let parent = self.context;
        let owner = self.add_node(Kind::Root, None);
        self.nodes[owner].parent = parent;
        if let Some(p) = parent {
            self.link_child(p, owner);
        }
        owner
    }

    /// `runWithOwner` (core.ts:2868-2896).
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

    /// A root's `dispose` (`disposeRootSelf`, owner.ts:366-371).
    pub fn dispose_root(&mut self, root: NodeId) {
        self.dispose_children(root, true);
    }

    /// The computed whose pass a creation under a root belongs to: a root's
    /// `_parentComputed` (owner.ts:421).
    pub(super) fn parent_computed(&self, root: NodeId) -> Option<NodeId> {
        let mut p = self.nodes[root].parent;
        while let Some(n) = p {
            if self.nodes[n].kind != Kind::Root {
                return Some(n);
            }
            p = self.nodes[n].parent;
        }
        None
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

    // Solid: owner.ts:95-202 (`zombie` frames are not ported)
    pub(super) fn dispose_children(&mut self, node: NodeId, self_: bool) {
        let flags = self.nodes[node].flags;
        if flags & REACTIVE_DISPOSED != 0 {
            return;
        }
        if self_ {
            self.nodes[node].flags = flags | REACTIVE_DISPOSED;
            if self.nodes[node].fn_.is_some() {
                // `clearInFlight`: no flights here. STATUS_PENDING never holds.
                if flags & REACTIVE_FRAME_READ != 0 || !self.pending_nodes.is_empty() {
                    self.schedule();
                }
            }
        }
        let mut child = self.nodes[node].first_child.take();
        while let Some(c) = child {
            self.nodes[c].config &= !CONFIG_AUTO_DISPOSE;
            self.delete_from_heap(c);
            self.clear_deps(c);
            self.nodes[c].prev_sibling = Some(c);
            self.dispose_children(c, true);
            child = self.nodes[c].next_sibling;
        }
        if self_
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
        // `runDisposal`: no `onCleanup` lists in this slice.
        if self_ {
            if let Some(cleanup) = self.nodes[node].cleanup.take() {
                cleanup(self);
            }
        }
    }
}
