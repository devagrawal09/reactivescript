//! Solid: heap.ts — the dirty heap, ordered by height.
use super::*;

impl Runtime {
    // Solid: heap.ts:19-22
    pub(super) fn enqueue_sub(&mut self, node: NodeId) {
        if self.dirty_queue.min > self.nodes[node].height {
            self.dirty_queue.min = self.nodes[node].height;
        }
        self.insert_into_heap(node);
    }

    // Solid: heap.ts:37-52
    fn actual_insert_into_heap(&mut self, n: NodeId) {
        let parent_height = match self.nodes[n].parent {
            Some(p) if self.nodes[p].kind == Kind::Root => {
                self.parent_computed(p).map(|c| self.nodes[c].height)
            }
            Some(p) => Some(self.nodes[p].height),
            None => None,
        }
        .unwrap_or(-1);
        if parent_height >= self.nodes[n].height {
            self.nodes[n].height = parent_height + 1;
        }
        let height = self.nodes[n].height;
        let h = height as usize;
        if self.dirty_queue.heap.len() <= h {
            self.dirty_queue.heap.resize(h + 1, None);
        }
        match self.dirty_queue.heap[h] {
            None => self.dirty_queue.heap[h] = Some(n),
            Some(head) => {
                let tail = self.nodes[head].prev_heap;
                self.nodes[tail].next_heap = Some(n);
                self.nodes[n].prev_heap = tail;
                self.nodes[head].prev_heap = n;
            }
        }
        if height > self.dirty_queue.max {
            self.dirty_queue.max = height;
        }
    }

    // Solid: heap.ts:53-75
    pub(super) fn insert_into_heap(&mut self, n: NodeId) {
        let flags = self.nodes[n].flags;
        if flags & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS) != 0 {
            return;
        }
        if flags & REACTIVE_CHECK != 0 {
            self.nodes[n].flags =
                (flags & !(REACTIVE_CHECK | REACTIVE_DIRTY)) | REACTIVE_DIRTY | REACTIVE_IN_HEAP;
        } else {
            self.nodes[n].flags = flags | REACTIVE_IN_HEAP;
            if self.dirty_queue.marked {
                self.mark_node(n, REACTIVE_DIRTY);
            }
        }
        if flags & REACTIVE_IN_HEAP_HEIGHT == 0 {
            self.actual_insert_into_heap(n);
        }
    }

    // Solid: heap.ts:77-82
    pub(super) fn insert_into_heap_height(&mut self, n: NodeId) {
        let flags = self.nodes[n].flags;
        if flags & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS | REACTIVE_IN_HEAP_HEIGHT) != 0 {
            return;
        }
        self.nodes[n].flags = flags | REACTIVE_IN_HEAP_HEIGHT;
        self.actual_insert_into_heap(n);
    }

    // Solid: heap.ts:84-100
    pub(super) fn delete_from_heap(&mut self, n: NodeId) {
        let flags = self.nodes[n].flags;
        if flags & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT) == 0 {
            return;
        }
        self.nodes[n].flags = flags & !(REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
        let height = self.nodes[n].height as usize;
        if self.nodes[n].prev_heap == n {
            self.dirty_queue.heap[height] = None;
        } else {
            let next = self.nodes[n].next_heap;
            let dhh = self.dirty_queue.heap[height].expect("heap row");
            let end = next.unwrap_or(dhh);
            if n == dhh {
                self.dirty_queue.heap[height] = next;
            } else {
                let prev = self.nodes[n].prev_heap;
                self.nodes[prev].next_heap = next;
            }
            self.nodes[end].prev_heap = self.nodes[n].prev_heap;
        }
        self.nodes[n].prev_heap = n;
        self.nodes[n].next_heap = None;
    }

    // Solid: heap.ts:102-111
    pub(super) fn mark_heap(&mut self) {
        if self.dirty_queue.marked {
            return;
        }
        self.dirty_queue.marked = true;
        for i in 0..=self.dirty_queue.max.max(0) as usize {
            let mut el = self.dirty_queue.heap.get(i).copied().flatten();
            while let Some(e) = el {
                if self.nodes[e].flags & REACTIVE_IN_HEAP != 0 {
                    self.mark_node(e, REACTIVE_DIRTY);
                }
                el = self.nodes[e].next_heap;
            }
        }
    }

    // Solid: heap.ts:113-120
    pub(super) fn mark_node(&mut self, el: NodeId, new_state: u32) {
        let flags = self.nodes[el].flags;
        if (flags & (REACTIVE_CHECK | REACTIVE_DIRTY)) >= new_state {
            return;
        }
        self.nodes[el].flags = (flags & !(REACTIVE_CHECK | REACTIVE_DIRTY)) | new_state;
        let mut link = self.nodes[el].subs;
        while let Some(l) = link {
            let sub = self.links[l].sub;
            self.mark_node(sub, REACTIVE_CHECK);
            link = self.links[l].next_sub;
        }
    }

    // Solid: heap.ts:122-133 (`recompute` is GlobalQueue._update)
    pub(super) fn run_heap(&mut self) {
        self.dirty_queue.marked = false;
        self.dirty_queue.min = 0;
        while self.dirty_queue.min <= self.dirty_queue.max {
            let row = self.dirty_queue.min as usize;
            let mut el = self.dirty_queue.heap.get(row).copied().flatten();
            while let Some(e) = el {
                if self.nodes[e].flags & REACTIVE_IN_HEAP != 0 {
                    self.update(e);
                } else {
                    self.adjust_height(e);
                }
                el = self
                    .dirty_queue
                    .heap
                    .get(self.dirty_queue.min as usize)
                    .copied()
                    .flatten();
            }
            self.dirty_queue.min += 1;
        }
        self.dirty_queue.max = 0;
    }

    // Solid: heap.ts:135-148
    fn adjust_height(&mut self, el: NodeId) {
        self.delete_from_heap(el);
        let mut new_height = self.nodes[el].height;
        let mut d = self.nodes[el].deps;
        while let Some(l) = d {
            let dep = self.links[l].dep;
            if self.nodes[dep].fn_.is_some() && self.nodes[dep].height >= new_height {
                new_height = self.nodes[dep].height + 1;
            }
            d = self.links[l].next_dep;
        }
        if self.nodes[el].height != new_height {
            self.nodes[el].height = new_height;
            let mut s = self.nodes[el].subs;
            while let Some(l) = s {
                let sub = self.links[l].sub;
                self.insert_into_heap_height(sub);
                s = self.links[l].next_sub;
            }
        }
    }
}
