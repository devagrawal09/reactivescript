//! The node arena. JS frees a disposed node when nothing references it any
//! more; here a disposed node's slot is handed back at the end of a global
//! flush once nothing in the runtime points at it (`Runtime::reclaim`), and a
//! later node reuses it.
//!
//! Built with `--cfg node_check`, a freed slot is never reused and any read
//! of it panics, so the fuzzers prove nothing touches a node after it is
//! freed.
use super::{Node, NodeId};
use std::ops::{Index, IndexMut};

#[derive(Default)]
pub(super) struct NodeTable {
    v: Vec<Node>,
    free: Vec<NodeId>,
    #[cfg(node_check)]
    dead: Vec<bool>,
}

impl NodeTable {
    pub fn alloc(&mut self, make: impl FnOnce(NodeId) -> Node) -> NodeId {
        if let Some(id) = self.free.pop() {
            self.v[id] = make(id);
            return id;
        }
        let id = self.v.len();
        self.v.push(make(id));
        #[cfg(node_check)]
        self.dead.push(false);
        id
    }
    /// Drops the node's contents (its closures and values) and frees the slot.
    pub fn release(&mut self, id: NodeId, blank: Node) {
        self.v[id] = blank;
        #[cfg(node_check)]
        {
            self.dead[id] = true;
        }
        #[cfg(not(node_check))]
        self.free.push(id);
    }
    /// Slots in use (live nodes and disposed ones not yet freed).
    pub fn live(&self) -> usize {
        self.v.len() - self.free.len()
    }
    pub fn slots(&self) -> usize {
        self.v.len()
    }
}

impl Index<NodeId> for NodeTable {
    type Output = Node;
    #[inline]
    fn index(&self, i: NodeId) -> &Node {
        #[cfg(node_check)]
        assert!(!self.dead[i], "node {i} read after it was freed");
        &self.v[i]
    }
}

impl IndexMut<NodeId> for NodeTable {
    #[inline]
    fn index_mut(&mut self, i: NodeId) -> &mut Node {
        #[cfg(node_check)]
        assert!(!self.dead[i], "node {i} written after it was freed");
        &mut self.v[i]
    }
}
