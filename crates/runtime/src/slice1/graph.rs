//! Solid: graph.ts — dependency links (alien-signals) and their trimming.
use super::*;

impl Runtime {
    fn new_link(&mut self, link: Link) -> LinkId {
        if let Some(id) = self.free_links.pop() {
            self.links[id] = link;
            id
        } else {
            self.links.push(link);
            self.links.len() - 1
        }
    }

    // Solid: graph.ts:23-58
    pub(super) fn unlink_subs(&mut self, link: LinkId) -> Option<LinkId> {
        let Link {
            dep,
            next_dep,
            next_sub,
            prev_sub,
            ..
        } = self.links[link];
        match next_sub {
            Some(n) => self.links[n].prev_sub = prev_sub,
            None => self.nodes[dep].subs_tail = prev_sub,
        }
        match prev_sub {
            Some(p) => self.links[p].next_sub = next_sub,
            None => {
                self.nodes[dep].subs = next_sub;
                // No `_unobserved` hooks and no store slots in this slice.
                // STATUS_PENDING never holds here (no async), and nothing
                // defers releases (`deferredReleases`, #4142: only a staged
                // pass's child teardown does, and no node here owns children).
                if next_sub.is_none()
                    && self.nodes[dep].fn_.is_some()
                    && self.nodes[dep].config & CONFIG_AUTO_DISPOSE != 0
                    && self.nodes[dep].flags & REACTIVE_ZOMBIE == 0
                {
                    self.unobserved(dep);
                }
            }
        }
        self.free_links.push(link);
        next_dep
    }

    // Solid: graph.ts:60-70
    pub(super) fn trim_stale_deps(&mut self, el: NodeId) {
        let deps_tail = self.nodes[el].deps_tail;
        let mut to_remove = match deps_tail {
            Some(t) => self.links[t].next_dep,
            None => self.nodes[el].deps,
        };
        if to_remove.is_some() {
            while let Some(l) = to_remove {
                to_remove = self.unlink_subs(l);
            }
            match deps_tail {
                Some(t) => self.links[t].next_dep = None,
                None => self.nodes[el].deps = None,
            }
        }
    }

    // Solid: graph.ts:77-82
    pub(super) fn clear_deps(&mut self, el: NodeId) {
        if self.nodes[el].deps.is_some() {
            self.nodes[el].deps_tail = None;
            self.trim_stale_deps(el);
        }
    }

    // Solid: graph.ts:96-100
    pub(super) fn unobserved(&mut self, el: NodeId) {
        self.delete_from_heap(el);
        self.clear_deps(el);
        self.dispose_children(el, true);
    }

    // Solid: graph.ts:149-190
    pub(super) fn link(&mut self, dep: NodeId, sub: NodeId) {
        let prev_dep = self.nodes[sub].deps_tail;
        if let Some(p) = prev_dep {
            if self.links[p].dep == dep {
                return;
            }
        }
        let mut next_dep = None;
        let is_recomputing = self.nodes[sub].flags & REACTIVE_RECOMPUTING_DEPS != 0;
        if is_recomputing {
            next_dep = match prev_dep {
                Some(p) => self.links[p].next_dep,
                None => self.nodes[sub].deps,
            };
            if let Some(n) = next_dep {
                if self.links[n].dep == dep {
                    self.links[n].gen = self.nodes[sub].dep_gen;
                    self.nodes[sub].deps_tail = Some(n);
                    return;
                }
            }
        }
        let prev_sub = self.nodes[dep].subs_tail;
        if let Some(p) = prev_sub {
            if self.links[p].sub == sub
                && (!is_recomputing || self.links[p].gen == self.nodes[sub].dep_gen)
            {
                return;
            }
        }
        let new_link = self.new_link(Link {
            dep,
            sub,
            next_dep,
            prev_sub,
            next_sub: None,
            gen: self.nodes[sub].dep_gen,
        });
        self.nodes[sub].deps_tail = Some(new_link);
        self.nodes[dep].subs_tail = Some(new_link);
        match prev_dep {
            Some(p) => self.links[p].next_dep = Some(new_link),
            None => self.nodes[sub].deps = Some(new_link),
        }
        match prev_sub {
            Some(p) => self.links[p].next_sub = Some(new_link),
            None => self.nodes[dep].subs = Some(new_link),
        }
        self.bump_notify_epoch();
    }
}
