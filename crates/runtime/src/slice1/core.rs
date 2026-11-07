//! Solid: core.ts — node creation, `recompute`, `read` and `setSignal`.
//!
//! Not ported (constant in this slice): async results (`handleAsync`, flights,
//! STATUS_PENDING and the pending-source walks), verdict windows
//! (`observeFlightHook` tests key off CONFIG_VERDICT / REACTIVE_PROBED, never
//! set), snapshots, staged errors (D-41), parked child frames and zombies,
//! the dev/observe tiers, and promoted writes inside computations.
use super::*;

impl Runtime {
    // Solid: core.ts:201-224 (`GlobalQueue._update`; no tracked effects or
    // zombies here)
    pub(super) fn update(&mut self, el: NodeId) {
        self.recompute(el, false);
    }

    // Solid: core.ts:364-1090
    pub(super) fn recompute(&mut self, el: NodeId, create: bool) {
        self.bump_notify_epoch();
        let is_effect = self.nodes[el].effect_type;
        let mut superseded: Slot = None;
        let prev_lane = self.pass_lane;
        let prev_mount = self.lane_root;
        // laneStageHook is installed: `laneRoot = create && (prevLane || prevMount)`.
        let mount = if create {
            prev_lane.or(prev_mount)
        } else {
            None
        };
        self.lane_root = mount;
        let own_tx = self.nodes[el].transaction.filter(|t| self.txs[*t].lane);
        let seat = if (self.nodes[el].flags & REACTIVE_LANE_DIRTY != 0
            || self.nodes[el].config & (CONFIG_OVERRIDE | CONFIG_GUESS) == CONFIG_OVERRIDE)
            && own_tx.is_some()
        {
            own_tx
        } else if create
            // `prevLane?._parent!._verdict != prevLane`: no verdict lanes, so
            // true exactly when there is a creator lane.
            && prev_lane.is_some()
            && self
                .creator_pass(self.context)
                .is_some_and(|p| self.nodes[p].flags & REACTIVE_RECOMPUTING_DEPS != 0)
        {
            prev_lane
        } else {
            None
        };
        self.pass_lane = seat;
        let replaced = self.nodes[el].config & CONFIG_STAGED_ERROR;
        if !create {
            self.delete_from_heap(el);
            // `_inFlight` / `_parked` / flight teardown: no flights here.
            if self.nodes[el].config & CONFIG_HELD != 0 {
                let tx = self.tx_of(el);
                if self.txs[tx].lane || self.nodes[el].config & CONFIG_LAGS != 0 {
                } else if self.nodes[el].config & (CONFIG_VERDICT | CONFIG_FRAME) == 0 {
                    // `freshHook` (boundaries.ts:1080) is false with no boundary.
                    self.join_pass_tx(tx, false);
                } else if Some(tx) != self.flush_transaction
                    && !(self.nodes[el].status & STATUS_UNINITIALIZED != 0
                        || self.nodes[el].config & CONFIG_HELD_FRAME != 0)
                {
                    superseded = self.nodes[el].pending;
                    if superseded.is_some() {
                        self.insert_subs(el);
                    }
                    self.nodes[el].pending = None;
                    self.nodes[el].config &= !CONFIG_HELD;
                }
            }
            // Child frames (`disposeChildren` / `parkChildren`): no node in
            // this slice owns children.
        }
        let was_uninitialized = self.nodes[el].status & STATUS_UNINITIALIZED;
        let old_context = self.context;
        self.context = Some(el);
        self.nodes[el].deps_tail = None;
        self.nodes[el].dep_gen += 1;
        self.nodes[el].flags =
            REACTIVE_RECOMPUTING_DEPS | (self.nodes[el].flags & (REACTIVE_ZOMBIE | REACTIVE_REASK));
        self.nodes[el].time = self.clock;
        let prev_value = match self.nodes[el].pending {
            Some(v) => v,
            None => match self.nodes[el].lane {
                Some(l) if self.nodes[el].config & CONFIG_OVERRIDE != 0 => l,
                _ => self.nodes[el].value,
            },
        };
        let old_height = self.nodes[el].height;
        let prev_tracking = self.tracking;
        self.tracking = true;
        let f = self.nodes[el].fn_.clone().expect("computed");
        let mut value = prev_value;
        match f(self, prev_value) {
            Ok(v) => {
                value = Some(v);
                // `clearStatus` (async.ts:936-943): the effect status notifier
                // reaches `notify`, a no-op with no boundary and no pending.
                let n = &mut self.nodes[el];
                n.status = if create {
                    0
                } else {
                    n.status & STATUS_UNINITIALIZED
                };
                n.error = None;
            }
            Err(e) => {
                // `notifyStatus(el, STATUS_ERROR, e)`: recorded; no error
                // boundaries in this slice.
                self.nodes[el].status |= STATUS_ERROR;
                self.nodes[el].error = Some(e.clone());
                self.errors.push(e);
            }
        }
        self.tracking = prev_tracking;
        self.lane_root = prev_mount;
        let missed_wake = self.nodes[el].flags & REACTIVE_MISSED_WAKE != 0;
        let joined = self.nodes[el].flags
            & if mount.is_some() {
                // STATUS_PENDING never holds.
                REACTIVE_JOINED | REACTIVE_STAGED_READ
            } else {
                REACTIVE_JOINED
            }
            != 0;
        let flags = self.nodes[el].flags;
        self.nodes[el].flags = (flags
            & (REACTIVE_ZOMBIE
                | REACTIVE_DISPOSED
                | REACTIVE_FRAME_READ
                | REACTIVE_STAGED_READ
                | REACTIVE_LANE_READ
                | REACTIVE_SCREEN_READ
                | REACTIVE_PROBE_UNANSWERED))
            | if create {
                flags & REACTIVE_SNAPSHOT_STALE
            } else {
                0
            };
        self.context = old_context;
        if self.nodes[el].flags & REACTIVE_DISPOSED != 0 {
            self.clear_deps(el);
            self.pass_lane = prev_lane;
            return;
        }
        let mut lane = self.pass_lane;
        let errored = self.nodes[el].error.is_some();
        if let Some(l) = lane {
            if self.lane_stage(el, l, create, errored) {
                self.pass_lane = Some(l);
            } else {
                lane = None;
            }
        }
        if !errored {
            let unstaged = self.nodes[el].pending.is_none();
            let compare_value = match self.nodes[el].pending {
                Some(v) => v,
                None => match self.nodes[el].lane {
                    Some(l) if self.nodes[el].config & CONFIG_OVERRIDE != 0 => l,
                    _ => self.nodes[el].value,
                },
            };
            let value_changed = (unstaged && was_uninitialized != 0 && is_effect == 0)
                || replaced != 0
                || !self.is_same(el, compare_value, value);
            if is_effect != 0
                && value_changed
                && !(self.nodes[el].flags & REACTIVE_SCREEN_READ != 0
                    && !self.nodes[el].modified
                    && self.nodes[el].prev_value == value)
                && unstaged
            {
                self.nodes[el].modified = self.nodes[el].error.is_none();
                if !create {
                    self.enqueue(is_effect, QueueCallback::RunEffect(el), lane);
                }
            }
            if !create
                && lane.is_none()
                && self.nodes[el].config & CONFIG_GUESS != 0
                && self.lane_outcome(el, value, errored)
            {
                // The truth, staged under the lane's parent.
            } else if value_changed {
                if let Some(l) = lane {
                    if is_effect != 0 && self.nodes[el].pending.is_none() {
                        self.nodes[el].value = value;
                    } else if is_effect != 0 || self.txs[l].shown {
                        self.nodes[el].pending = Some(value);
                    } else {
                        self.nodes[el].lane = Some(value);
                    }
                } else if if create {
                    // `passTx` is never opened in this slice.
                    !(self.flush_transaction.is_some()
                        && (joined
                            || self
                                .creator_pass(old_context)
                                .is_some_and(|p| self.nodes[p].flags & REACTIVE_JOINED != 0)))
                } else {
                    is_effect != 0 && self.nodes[el].pending.is_none()
                } {
                    self.nodes[el].value = value;
                } else {
                    self.nodes[el].pending = Some(value);
                    if create {
                        let t = self
                            .flush_transaction
                            .expect("born held into the flush's transaction");
                        self.hold_node(el, t);
                        self.nodes[el].status |= STATUS_UNINITIALIZED;
                    }
                }
                if self.nodes[el].subs.is_some() {
                    match lane {
                        Some(l) => self.lane_dirty(el, l),
                        None => self.insert_subs(el),
                    }
                }
            } else if self.nodes[el].height != old_height {
                let mut s = self.nodes[el].subs;
                while let Some(l) = s {
                    let sub = self.links[l].sub;
                    self.insert_into_heap_height(sub);
                    s = self.links[l].next_sub;
                }
            }
        }
        if self.nodes[el].error.is_none()
            && self.nodes[el].pending.is_none()
            && !(is_effect != 0 && self.nodes[el].modified)
        {
            if create {
                self.trim_stale_deps(el);
            } else {
                self.held_trim(el);
            }
        }
        if self.nodes[el].pending.is_some()
            || (self.nodes[el].status & STATUS_UNINITIALIZED != 0 && !create)
        {
            self.nodes[el].config |= CONFIG_STAGED;
            if lane.is_none() {
                self.queue_pending_node(el);
            }
        }
        self.pass_lane = prev_lane;
        if missed_wake {
            self.enqueue_sub(el);
            self.schedule();
        }
        // `keepReadersHook` (verdict.ts #4417) keeps a superseded staging's
        // held readers; it needs a verdict engine reader, absent here.
        let _ = superseded;
    }

    // Solid: core.ts:1092-1137
    fn update_if_necessary(&mut self, el: NodeId) {
        if self.nodes[el].flags & (REACTIVE_RECOMPUTING_DEPS | REACTIVE_DISPOSED) != 0 {
            return;
        }
        if self.nodes[el].flags & REACTIVE_CHECK != 0 {
            let mut d = self.nodes[el].deps;
            while let Some(l) = d {
                let dep = self.links[l].dep;
                if self.nodes[dep].fn_.is_some() {
                    self.update_if_necessary(dep);
                }
                if self.nodes[el].flags & REACTIVE_DIRTY != 0 {
                    break;
                }
                d = self.links[l].next_dep;
            }
        }
        if self.nodes[el].flags & REACTIVE_DIRTY != 0 {
            self.recompute(el, false);
        }
        self.nodes[el].flags &= REACTIVE_SNAPSHOT_STALE
            | REACTIVE_IN_HEAP
            | REACTIVE_IN_HEAP_HEIGHT
            | REACTIVE_ZOMBIE
            | REACTIVE_DISPOSED
            | REACTIVE_MANUAL_WRITE
            | REACTIVE_FRAME_READ
            | REACTIVE_STAGED_READ
            | REACTIVE_LANE_READ
            | REACTIVE_SCREEN_READ
            | REACTIVE_PROBE_UNANSWERED;
    }

    // Solid: core.ts:1144-1253 (eager, default equality)
    pub(super) fn computed(&mut self, f: ComputeFn) -> NodeId {
        let n = self.add_node(Kind::Computed, None);
        let node = &mut self.nodes[n];
        node.config = if self.context.is_none() {
            CONFIG_AUTO_DISPOSE
        } else {
            0
        };
        node.fn_ = Some(f);
        node.status = STATUS_UNINITIALIZED;
        self.setup_computed_node(n, false);
        n
    }

    // Solid: core.ts:1292-1308
    fn join_pass(&mut self, c: NodeId, el: NodeId) {
        self.nodes[c].flags |= REACTIVE_JOINED;
        if self.nodes[el].status & STATUS_UNINITIALIZED != 0
            || self.nodes[c].effect_type != EFFECT_RENDER
        {
            let t = self.tx_of(el);
            // `freshHook(c)` is false with no boundary.
            let own =
                self.nodes[c].effect_type == 0 && self.nodes[c].status & STATUS_UNINITIALIZED != 0;
            self.join_pass_tx(t, own);
        }
    }

    // Solid: scheduler.ts:397-403 (`joinPassTx`); its pass-scoped arm (a
    // mainline mount outside any flush) is not reached by this slice.
    fn join_pass_tx(&mut self, t: TxId, own: bool) {
        if (self.running && !own) || self.flush_transaction.is_some() {
            return self.join_future(Some(t));
        }
        panic!("joinPassTx's pass-scoped transaction (passTx) is not ported");
    }

    // Solid: core.ts:1342-1399
    fn frame_read(&mut self, c: NodeId, el: NodeId) -> bool {
        // No verdict readers: `verdict` is false.
        let lane = self.pass_lane.is_some();
        // STATUS_PENDING never holds, so `c` uninitialized over a pending
        // `el` is false.
        if !(!lane
            && (self.nodes[c].config & (EFFECT_RENDER << 23) == 0
                || self.nodes[el].config & CONFIG_INPUTS_PUBLISHED != 0))
        {
            let t = self.tx_of(el);
            // `passLane.over`: no re-based lanes.
            if !((!lane && Some(t) == self.flush_transaction) || self.born_into(c, t)) {
                self.stale_reader(c, t);
                // `laneServedHook`: drops pending sources, none here.
                return true;
            }
        }
        self.join_pass(c, el);
        false
    }

    // Solid: core.ts:1406-1412
    pub(super) fn born_into(&mut self, c: NodeId, t: TxId) -> bool {
        (self.nodes[c].status & STATUS_UNINITIALIZED != 0
            || self.nodes[c].config & CONFIG_HELD_FRAME != 0)
            && self.nodes[c].config & CONFIG_HELD != 0
            && self.tx_of(c) == t
    }

    // Solid: core.ts:1416-1420
    pub(super) fn creator_pass(&self, owner: Option<NodeId>) -> Option<NodeId> {
        let o = owner?;
        if self.nodes[o].kind == Kind::Root {
            self.parent_computed(o)
        } else {
            Some(o)
        }
    }

    // Solid: core.ts:1452-1566 (`createEffectNode`)
    pub(super) fn create_effect_node(
        &mut self,
        f: ComputeFn,
        effect_fn: EffectFn,
        ty: u32,
    ) -> NodeId {
        let n = self.add_node(Kind::Computed, None);
        let node = &mut self.nodes[n];
        node.config = ty << 23;
        node.equals = false;
        node.fn_ = Some(f);
        node.flags = REACTIVE_LAZY;
        node.status = STATUS_UNINITIALIZED;
        node.effect_fn = Some(effect_fn);
        node.effect_type = ty;
        self.setup_computed_node(n, true);
        n
    }

    // Solid: core.ts:1590-1616
    fn setup_computed_node(&mut self, n: NodeId, lazy: bool) {
        self.nodes[n].prev_heap = n;
        let parent = self.creator_pass(self.context);
        if let Some(ctx) = self.context {
            self.nodes[n].parent = Some(ctx);
            self.link_child(ctx, n);
        }
        if let Some(p) = parent {
            self.nodes[n].height = self.nodes[p].height + 1;
        }
        if !lazy {
            self.recompute(n, true);
        }
    }

    // Solid: core.ts:1618-1662
    pub(super) fn signal_node(&mut self, v: Value) -> NodeId {
        self.add_node(Kind::Signal, v)
    }

    // Solid: core.ts:1909-1939 (owner-lifecycle disposal reads freeze)
    fn prepare_computed(&mut self, comp: NodeId) {
        if self.nodes[comp].flags & REACTIVE_LAZY != 0 {
            self.nodes[comp].flags &= !REACTIVE_LAZY;
            self.recompute(comp, true);
        } else if self.nodes[comp].flags & REACTIVE_DISPOSED != 0
            && self.nodes[comp].config & CONFIG_AUTO_DISPOSE != 0
        {
            panic!("reawakening a dormant memo is not ported");
        }
    }

    // Solid: core.ts:1984-1994
    fn unflushed_value(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if self.running || n.pending.is_none() {
            return None;
        }
        if n.config & CONFIG_HELD != 0 {
            return if n.flushed_at == self.clock as i64 {
                n.flushed
            } else {
                None
            };
        }
        Some(n.value)
    }

    // Solid: core.ts:1996-2003
    fn stash_flushed(&mut self, el: NodeId) {
        let clock = self.clock as i64;
        let n = &mut self.nodes[el];
        if n.flushed_at != clock {
            n.flushed = n.pending;
            n.flushed_at = clock;
            self.unflushed_staged = true;
        }
    }

    // Solid: core.ts:2016-2023
    pub(super) fn resync_unflushed_companions(&mut self) {
        self.unflushed_staged = false;
    }

    // Solid: core.ts:2028-2044
    fn pull_computed(&mut self, owner: NodeId, c: NodeId) {
        if self.nodes[owner].height >= self.dirty_queue.min {
            self.mark_node(c, REACTIVE_DIRTY);
            self.mark_heap();
            self.update_if_necessary(owner);
        }
        let height = self.nodes[owner].height;
        if height >= self.nodes[c].height && self.nodes[owner].parent != Some(c) {
            self.nodes[c].height = height + 1;
        }
    }

    // Solid: core.ts:2106-2447 (no verdict window, snapshot or dev tier)
    pub(super) fn read_node(&mut self, el: NodeId) -> Result<Value, String> {
        let mut c = self.context;
        if let Some(r) = c {
            if self.nodes[r].kind == Kind::Root {
                c = self.parent_computed(r);
            }
        }
        if self.nodes[el].fn_.is_some() {
            self.prepare_computed(el);
        }
        if self.nodes[el].fn_.is_none()
            && (!self.unflushed_staged || self.nodes[el].pending.is_none())
            && self.nodes[el].config & CONFIG_OVERRIDE == 0
        {
            if let Some(c) = c {
                if self.tracking {
                    self.link(el, c);
                }
                if self.nodes[el].config & CONFIG_HELD != 0
                    && self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN == 0
                    && self.frame_read(c, el)
                {
                    return Ok(self.nodes[el].value);
                }
            }
            let Some(c) = c.filter(|c| self.nodes[*c].config & CONFIG_CHILDREN_FORBIDDEN == 0)
            else {
                return Ok(self.nodes[el].value);
            };
            let Some(pending) = self.nodes[el].pending else {
                return Ok(self.nodes[el].value);
            };
            // D-8: writes that netted. (`stagedScreen` needs a verdict reader
            // or a folded lane.)
            if pending == self.nodes[el].value {
                return Ok(self.nodes[el].value);
            }
            self.staged_read(c, None);
            return Ok(pending);
        }
        let mut committed = false;
        if let Some(c) = c {
            if self.tracking {
                self.link(el, c);
                if self.nodes[el].fn_.is_some() {
                    self.pull_computed(el, c);
                }
            }
            if self.nodes[el].config & CONFIG_HELD != 0
                && self.nodes[el].config & CONFIG_OVERRIDE == 0
                && self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN == 0
            {
                if self.nodes[el].status & STATUS_UNINITIALIZED != 0 {
                    self.join_pass(c, el);
                } else {
                    committed = self.frame_read(c, el);
                }
            }
        }
        if self.nodes[el].config & CONFIG_OVERRIDE != 0 {
            if let Some(v) = self.lane_read(c, el)? {
                return Ok(v);
            }
        }
        if self.nodes[el].fn_.is_some() && self.nodes[el].status & STATUS_ERROR != 0 {
            return Err(self.nodes[el].error.clone().unwrap_or_default());
        }
        let value = self.serve(el, if committed { None } else { c })?;
        // Dormant-node sweep (#3078): no untracked read of an unobserved
        // auto-dispose memo happens in this slice.
        Ok(value)
    }

    // Solid: core.ts:2469-2523
    fn serve(&mut self, el: NodeId, c: Option<NodeId>) -> Result<Value, String> {
        let forbidden = c.is_some_and(|c| self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0);
        if self.nodes[el].pending.is_some()
            && self.nodes[el].status & STATUS_UNINITIALIZED != 0
            && (c.is_none() || forbidden)
        {
            return Err("NotReadyError".into());
        }
        let u = if c.is_some() && self.unflushed_staged {
            self.unflushed_value(el)
        } else {
            None
        };
        if let Some(u) = u {
            self.nodes[c.unwrap()].flags |= REACTIVE_MISSED_WAKE; // markLateLinker
            return Ok(u);
        }
        let Some(c) = c.filter(|_| !forbidden) else {
            return Ok(self.nodes[el].value);
        };
        let Some(pending) = self.nodes[el].pending else {
            return Ok(self.nodes[el].value);
        };
        // Prod: `!(__DEV__ && strictRead)` always holds.
        self.staged_read(c, Some(el));
        Ok(pending)
    }

    // Solid: core.ts:2557-2570
    pub(super) fn staged_read(&mut self, c: NodeId, el: Option<NodeId>) {
        if el.is_none_or(|el| self.nodes[el].status & STATUS_UNINITIALIZED == 0) {
            self.nodes[c].flags |= REACTIVE_STAGED_READ;
            // A verdict reader effect also pushes; none here.
            if self.pass_lane.is_some() {
                self.staged_readers.push(c);
            }
        }
    }

    // Solid: core.ts:2680-2691
    pub(super) fn is_same(&self, el: NodeId, a: Value, b: Value) -> bool {
        self.nodes[el].equals && a == b
    }

    // Solid: core.ts:2693-2797 (default equality; no write hook, snapshot,
    // or promoted write)
    pub(super) fn set_signal(&mut self, el: NodeId, v: i64) {
        let current = self.nodes[el].pending.unwrap_or(self.nodes[el].value);
        if self.nodes[el].config & CONFIG_OVERRIDE != 0 {
            self.lane_write(el, v);
            return;
        }
        if self.nodes[el].config & CONFIG_HELD != 0 {
            let t = self.tx_of(el);
            self.join_future(Some(t));
        }
        // `custom` is false: the default comparator is `isEqual`.
        let value_changed = self.nodes[el].status & STATUS_UNINITIALIZED != 0 || current != Some(v);
        if !value_changed {
            return;
        }
        let was_staged = self.nodes[el].pending.is_some();
        if !was_staged {
            self.queue_pending_node(el);
        } else if self.nodes[el].config & CONFIG_HELD != 0 && !self.running {
            self.stash_flushed(el);
        }
        self.nodes[el].pending = Some(Some(v));
        if self.nodes[el].fn_.is_some() {
            self.nodes[el].time = self.clock;
        }
        if was_staged && self.nodes[el].notified_at == self.notify_epoch as i64 {
            return;
        }
        self.insert_subs(el);
        self.schedule();
    }
}
