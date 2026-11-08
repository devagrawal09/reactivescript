//! Solid: core.ts — node creation, `recompute`, `read` and `setSignal`.
//!
//! Not ported (unreached by the slices): snapshots, tracked verdict readers
//! (`observeFlightHook` arms keyed off CONFIG_VERDICT on the reader, never
//! set), the dev/observe tiers and the dormant-node sweep (every memo here
//! is owned). Promoted writes are ported but never promote: every write
//! inside a computation runs in a flush (`notePromotedWrite` returns).
use super::error::{self, Thrown};
use super::r#async::Errored;
use super::*;

impl Runtime {
    // Solid: core.ts:201-224 (`GlobalQueue._update`; `laneStageHook` is
    // installed)
    pub(super) fn update(&mut self, el: NodeId) {
        let flags = self.nodes[el].flags;
        if self.nodes[el].effect_type == EFFECT_TRACKED {
            self.delete_from_heap(el);
            self.nodes[el].modified = true;
            self.enqueue(EFFECT_USER, QueueCallback::RunEffect(el), None);
        } else if flags & REACTIVE_ZOMBIE != 0 && flags & REACTIVE_LANE_DIRTY == 0 {
            self.defer_zombie(el);
        } else if flags & REACTIVE_ZOMBIE != 0 && self.lane_frame_member(el) {
            self.delete_from_heap(el);
            self.nodes[el].flags &= !(REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_LANE_DIRTY);
        } else {
            self.recompute(el, false);
        }
    }

    // Solid: core.ts:229-236
    fn lane_frame_member(&self, el: NodeId) -> bool {
        let mut o = self.nodes[el].parent.expect("a zombie has an owner");
        while self.nodes[o].flags & REACTIVE_ZOMBIE != 0 {
            o = self.nodes[o].parent.expect("a zombie has an owner");
        }
        let n = &self.nodes[o];
        n.config & (CONFIG_OVERRIDE | CONFIG_GUESS) == CONFIG_OVERRIDE
            || (n.kind != Kind::Root
                && n.effect_type != 0
                && n.transaction.is_some_and(|t| self.txs[t].lane))
    }

    /// `el._fn(value)`.
    fn call_body(&mut self, el: NodeId, prev: Value) -> Result<Out, Error> {
        match self.nodes[el].fn_.clone().expect("computed") {
            Body::User(f) => f(self, prev),
            Body::Waiter { target, own } => self.waiter_body(el, target, own),
            Body::Projection { root, derive, key } => {
                self.run_projection_computed(el, root, derive, key)
            }
            Body::Map(d) => self.update_keyed_map(d).map(Out::Value),
        }
    }

    // Solid: core.ts:364-1090
    pub(super) fn recompute(&mut self, el: NodeId, create: bool) {
        self.tr(|| {
            let n = &self.nodes[el];
            format!(
                "R {} {} f{} c{} s{}",
                self.label(el),
                create as u8,
                n.flags,
                n.config,
                n.status
            )
        });
        self.bump_notify_epoch();
        let is_effect = self.nodes[el].effect_type;
        let mut released: Option<Vec<NodeId>> = None;
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
            if is_effect == 0
                && (self.nodes[el].status & STATUS_PENDING != 0
                    || self.nodes[el].config & (CONFIG_ASYNC | CONFIG_HELD)
                        == CONFIG_ASYNC | CONFIG_HELD)
            {
                self.nodes[el].config &= !CONFIG_VERDICT;
            }
            // `_parked` (only `laneSeams`' unanswered-probe arm parks one)
            // and iterator teardowns: none here.
            self.nodes[el].in_flight = None;
            if self.nodes[el].config & CONFIG_HELD != 0 {
                let tx = self.tx_of(el);
                if self.txs[tx].lane || self.nodes[el].config & CONFIG_LAGS != 0 {
                } else if self.nodes[el].config & (CONFIG_VERDICT | CONFIG_FRAME) == 0 {
                    let uninit = self.nodes[el].status & STATUS_UNINITIALIZED != 0;
                    let own = self.fresh_hook(el, uninit);
                    self.join_pass_tx(tx, own);
                } else if Some(tx) != self.flush_transaction
                    && !(self.nodes[el].status & STATUS_UNINITIALIZED != 0
                        || self.nodes[el].config & CONFIG_HELD_FRAME != 0)
                {
                    superseded = self.nodes[el].pending.clone();
                    if superseded.is_some() {
                        self.insert_subs(el);
                    }
                    self.set_pending(el, None);
                    self.nodes[el].config &= !CONFIG_HELD;
                }
            }
            // The previous pass's frame: a pass still awaiting its commit
            // (CONFIG_STAGED) never showed its children, which die on the
            // spot (releases deferred to this pass's end, #4142); otherwise
            // they are parked until this pass commits.
            if is_effect == EFFECT_TRACKED || self.nodes[el].config & CONFIG_STAGED != 0 {
                let prev = self.deferred_releases.replace(vec![]);
                self.dispose_children(el, false, false);
                released = std::mem::replace(&mut self.deferred_releases, prev);
            } else if self.nodes[el].first_child.is_some() || !self.nodes[el].disposal.is_empty() {
                self.park_children(el);
            }
            if self.nodes[el].config & CONFIG_STAGED_ERROR != 0 {
                self.set_pending(el, None);
                self.nodes[el].config ^= CONFIG_STAGED_ERROR;
            }
        }
        let was_uninitialized = self.nodes[el].status & STATUS_UNINITIALIZED;
        let outgoing_error = if self.nodes[el].status & STATUS_ERROR != 0 {
            self.nodes[el].error.clone()
        } else {
            None
        };
        let was_pending = self.nodes[el].status & STATUS_PENDING != 0;
        let outgoing_pending_sources = if was_pending {
            self.nodes[el].pending_sources
        } else {
            None
        };
        let was_pending_source = self.set_has(self.nodes[el].pending_sources, el);
        let mut staged_err = false;
        let reask = self.nodes[el].flags & REACTIVE_REASK != 0
            && !((self.nodes[el].status & STATUS_PENDING != 0
                || (self.guessing && self.nodes[el].pending.is_some()))
                && !self.nodes[el].reask);
        let old_context = self.context;
        self.context = Some(el);
        self.nodes[el].deps_tail = None;
        self.nodes[el].dep_gen += 1;
        let release_after = self.nodes[el].flags & REACTIVE_RELEASE_AFTER;
        self.nodes[el].flags =
            REACTIVE_RECOMPUTING_DEPS | (self.nodes[el].flags & (REACTIVE_ZOMBIE | REACTIVE_REASK));
        self.nodes[el].time = self.clock;
        let prev_value = match self.nodes[el].pending.clone() {
            Some(v) => v,
            None => match self.nodes[el].lane.clone() {
                Some(l) if self.nodes[el].config & CONFIG_OVERRIDE != 0 => l,
                _ => self.nodes[el].value.clone(),
            },
        };
        let old_height = self.nodes[el].height;
        let prev_tracking = self.tracking;
        self.tracking = true;
        let mut value = prev_value.clone();
        // The try block (core.ts:617-653). A projection's body registers
        // its own flight (`selfRegistered`); a non-object return is a sync
        // answer; an object one (a promise, an array, a store proxy) goes
        // through `handleAsync`.
        let prev_in_flight = self.nodes[el].in_flight;
        // The CONFIG_SYNC fast arm (prod): no async-shape probe.
        let result = if self.nodes[el].config & CONFIG_SYNC != 0 {
            match self.call_body(el, prev_value) {
                Ok(Out::Value(v)) => {
                    self.nodes[el].in_flight = None;
                    self.nodes[el].loading = false;
                    Ok(v)
                }
                Ok(Out::Flight(_)) => {
                    panic!("a sync computed returning a promise is outside the op language")
                }
                Err(e) => Err(e),
            }
        } else {
            match self.call_body(el, prev_value) {
                Ok(out) => {
                    let self_registered = self.nodes[el].in_flight != prev_in_flight;
                    let is_async_result = match &out {
                        Out::Flight(_) => true,
                        Out::Value(v) => v.is_object(),
                    };
                    if self_registered || !is_async_result {
                        let Out::Value(v) = out else {
                            unreachable!("a flight is an object")
                        };
                        if !self_registered && !is_async_result {
                            self.nodes[el].in_flight = None;
                            // `holdWorkHook` is installed.
                            self.nodes[el].config &= !CONFIG_ASYNC;
                            self.nodes[el].loading = false;
                        }
                        Ok(v)
                    } else {
                        self.handle_async_result(el, out, None)
                    }
                }
                Err(e) => Err(e),
            }
        };
        match result {
            Ok(v) => {
                value = v;
                // `_statusFlags !== 0 || _x !== null`: on a status-free node
                // with no extension `clearStatus` changes nothing.
                self.clear_status(el, create);
            }
            Err(e) => {
                // core.ts:654-705
                let not_ready = e.is_not_ready();
                if !not_ready || self.nodes[el].loading {
                    self.nodes[el].config &= !CONFIG_ASYNC;
                }
                if not_ready && self.nodes[el].loading {
                    self.park_loading_window(el, &e);
                } else {
                    if not_ready || {
                        staged_err = self.stage_error(el, e.clone(), true);
                        !staged_err
                    } {
                        if not_ready {
                            self.nodes[el].blocked = true;
                        }
                        self.notify_status(
                            el,
                            if not_ready {
                                STATUS_PENDING
                            } else {
                                STATUS_ERROR
                            },
                            Some(e),
                        );
                        if not_ready && was_pending_source && self.nodes[el].in_flight.is_none() {
                            self.settle_pending_source(el, el);
                        }
                    }
                    if not_ready || staged_err {
                        if let Some(set) = outgoing_pending_sources {
                            let mut i = 0;
                            while let Some(entry) = self.set_at(set, i) {
                                i += 1;
                                let Some(source) = entry else { continue };
                                if source != el
                                    && !(self.set_has(self.nodes[el].pending_sources, source)
                                        && (self.nodes[source].status & STATUS_PENDING != 0
                                            || self.retry_reaches(el, source)))
                                {
                                    self.settle_pending_source(el, source);
                                }
                            }
                        }
                    }
                }
            }
        }
        // The finally block (core.ts:706-771).
        self.tracking = prev_tracking;
        self.lane_root = prev_mount;
        let missed_wake = self.nodes[el].flags & REACTIVE_MISSED_WAKE != 0;
        let joined = self.nodes[el].flags
            & match mount {
                Some(_) => {
                    if prev_lane.is_some()
                        || is_effect != 0
                        || self.nodes[el].status & STATUS_PENDING == 0
                    {
                        REACTIVE_JOINED | REACTIVE_STAGED_READ
                    } else {
                        0
                    }
                }
                None => REACTIVE_JOINED,
            }
            != 0;
        // `observeFlightHook`: the pass's verdict posture. No pass probes
        // here (REACTIVE_PROBED, REACTIVE_WINDOW, REACTIVE_AHEAD are never
        // set), so it clears CONFIG_VERDICT and keeps nothing.
        self.nodes[el].config &= !CONFIG_VERDICT;
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
        if let Some(released) = released {
            for node in released {
                self.release_if_settled_unobserved(node);
            }
        }
        self.nodes[el].reask = reask && self.nodes[el].status & STATUS_PENDING != 0;
        if self.nodes[el].flags & REACTIVE_DISPOSED != 0 {
            self.clear_deps(el);
            self.clear_in_flight(el);
            self.pass_lane = prev_lane;
            return;
        }
        let mut lane = self.pass_lane;
        let errored = self.nodes[el].error.is_some() || staged_err;
        if let Some(l) = lane {
            let e = if errored { Errored::Yes } else { Errored::No };
            if self.lane_stage(el, l, create, e) {
                self.pass_lane = Some(l);
            } else {
                lane = None;
            }
        }
        if !errored {
            let unstaged = self.nodes[el].pending.is_none();
            let compare_value = match self.nodes[el].pending.clone() {
                Some(v) => v,
                None => match self.nodes[el].lane.clone() {
                    Some(l) if self.nodes[el].config & CONFIG_OVERRIDE != 0 => l,
                    _ => self.nodes[el].value.clone(),
                },
            };
            let value_changed = (unstaged && was_uninitialized != 0 && is_effect == 0)
                || self.nodes[el].shown_error.is_some()
                || replaced != 0
                || self.nodes[el].pending_err.is_some()
                || !self.is_same(el, &compare_value, &value);
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
                && self.lane_outcome(el, value.clone(), errored)
            {
                // The truth, staged under the lane's parent.
            } else if value_changed {
                if let Some(l) = lane {
                    if is_effect != 0 && self.nodes[el].pending.is_none() {
                        self.nodes[el].value = value.clone();
                    } else if is_effect != 0 || self.txs[l].shown {
                        self.set_pending(el, Some(value.clone()));
                    } else {
                        self.nodes[el].lane = Some(value.clone());
                    }
                } else if if create {
                    !((self.flush_transaction.is_some() || self.pass_tx.is_some())
                        && (joined
                            || self
                                .creator_pass(old_context)
                                .is_some_and(|p| self.nodes[p].flags & REACTIVE_JOINED != 0)))
                } else {
                    is_effect != 0 && self.nodes[el].pending.is_none()
                } {
                    self.nodes[el].value = value.clone();
                } else {
                    self.set_pending(el, Some(value.clone()));
                    if outgoing_error.is_some() {
                        self.nodes[el].shown_error = outgoing_error.clone();
                    }
                    if create {
                        let t = self
                            .flush_transaction
                            .or(self.pass_tx)
                            .expect("born held into the flush's transaction");
                        self.hold_node(el, t);
                        self.nodes[el].status |= STATUS_UNINITIALIZED;
                        let held = mount.is_none() && self.flush_transaction.is_some();
                        self.fresh_hook(el, held);
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
            if !value_changed && self.nodes[el].error.is_none() {
                if let Some(oe) = outgoing_error.clone() {
                    self.settle_errored_dependents(el, oe);
                }
                if let Some(set) = outgoing_pending_sources {
                    let mut i = 0;
                    while let Some(entry) = self.set_at(set, i) {
                        i += 1;
                        if let Some(source) = entry {
                            if source != el {
                                self.settle_pending_source(el, source);
                            }
                        }
                    }
                }
            }
            if was_pending_source
                && self.nodes[el].status & (STATUS_PENDING | STATUS_UNINITIALIZED) == 0
            {
                self.settle_pending_source(el, el);
            }
        }
        if create && lane.is_none() && joined && self.nodes[el].status & STATUS_PENDING != 0 {
            if let Some(t) = self.flush_transaction.or(self.pass_tx) {
                // `freshHook(el) === CAUGHT_REARMED`: no boundary re-arms.
                if !self.txs[t].lane {
                    self.hold_node(el, t);
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
            || self.nodes[el].pending_first_child.is_some()
            || !self.nodes[el].pending_disposal.is_empty()
            || (self.nodes[el].status & (STATUS_PENDING | STATUS_UNINITIALIZED) != 0
                && (!create || self.nodes[el].status & STATUS_PENDING != 0))
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
        if superseded.is_some() && superseded == Some(value) {
            self.keep_readers(el);
        }
        if release_after != 0 {
            self.release_if_settled_unobserved(el);
        }
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
        if self.nodes[el].flags & REACTIVE_DIRTY != 0
            || (self.nodes[el].error.is_some()
                && self.nodes[el].time < self.clock
                && self.nodes[el].in_flight.is_none())
        {
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

    // Solid: core.ts:1144-1253 (eager, default equality; `loadingValue`
    // and `_extraConfig`)
    pub(super) fn computed_node(
        &mut self,
        f: Body,
        loading: Option<Value>,
        extra_config: u32,
    ) -> NodeId {
        self.computed_with(f, loading, extra_config, Equals::IsEqual)
    }

    /// `computed(fn, options)` with `options.equals` (`_equals`).
    // Solid: core.ts:1144-1253
    pub(super) fn computed_with(
        &mut self,
        f: Body,
        loading: Option<Value>,
        extra_config: u32,
        eq: Equals,
    ) -> NodeId {
        let n = self.add_node(Kind::Computed, Value::Undef);
        self.nodes[n].eq = eq;
        let context = self.context;
        let node = &mut self.nodes[n];
        node.config = if context.is_none() {
            CONFIG_AUTO_DISPOSE
        } else {
            0
        } | extra_config;
        node.fn_ = Some(f);
        node.loading = loading.is_some();
        node.value = loading.clone().unwrap_or(Value::Undef);
        node.status = if loading.is_some() {
            0
        } else {
            STATUS_UNINITIALIZED
        };
        self.setup_computed_node(n, false);
        n
    }

    pub(super) fn computed(&mut self, f: BodyFn, loading: Option<Value>) -> NodeId {
        self.computed_node(Body::User(f), loading, 0)
    }

    // Solid: core.ts:1292-1308
    fn join_pass(&mut self, c: NodeId, el: NodeId) {
        self.nodes[c].flags |= REACTIVE_JOINED;
        if self.nodes[el].status & STATUS_UNINITIALIZED != 0
            || self.nodes[c].effect_type != EFFECT_RENDER
        {
            let t = self.tx_of(el);
            let own = (self.nodes[c].effect_type == 0
                && self.nodes[c].status & STATUS_UNINITIALIZED != 0)
                || self.fresh_hook(c, false);
            self.join_pass_tx(t, own);
        }
    }

    // Solid: scheduler.ts:397-402 (`joinPassTx`)
    pub(super) fn join_pass_tx(&mut self, t: TxId, own: bool) {
        if (self.running && !own) || self.flush_transaction.is_some() {
            return self.join_future(Some(t));
        }
        match self.pass_tx {
            None => self.pass_tx = Some(self.resolve_tx(t)),
            Some(p) => {
                let t = self.resolve_tx(t);
                self.merge(t, p)
            }
        }
        self.schedule();
    }

    // Solid: core.ts:1342-1399 (no verdict readers: `verdict` is false)
    fn frame_read(&mut self, c: NodeId, el: NodeId) -> bool {
        let lane = self.pass_lane.is_some();
        if !((!lane
            || (self.nodes[c].status & STATUS_UNINITIALIZED != 0
                && self.nodes[el].status & STATUS_PENDING != 0))
            && (self.nodes[c].config & (EFFECT_RENDER << 23) == 0
                || self.nodes[el].config & CONFIG_INPUTS_PUBLISHED != 0))
        {
            let t = self.tx_of(el);
            if lane {
                if let Some(over) = self.txs[self.pass_lane.unwrap()].over {
                    if self.resolve_tx(over) == t {
                        return false;
                    }
                }
            }
            if !((!lane && Some(t) == self.flush_transaction) || self.born_into(c, t)) {
                self.stale_reader(c, t);
                if lane {
                    self.lane_served(c, el);
                }
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

    // Solid: core.ts:1436-1444
    fn park_children(&mut self, el: NodeId) {
        self.mark_disposal(el);
        self.nodes[el].pending_disposal = std::mem::take(&mut self.nodes[el].disposal);
        self.nodes[el].pending_first_child = self.nodes[el].first_child.take();
        // `el._childCount = 0`: ids are not ported.
    }

    // Solid: core.ts:1452-1566 (`createEffectNode`)
    pub(super) fn create_effect_node(
        &mut self,
        f: BodyFn,
        effect_fn: ValueEffectFn,
        error_fn: Option<ErrorFn>,
        ty: u32,
    ) -> NodeId {
        let n = self.add_node(Kind::Computed, Value::Undef);
        let node = &mut self.nodes[n];
        node.config = ty << 23;
        node.eq = Equals::Never;
        node.fn_ = Some(Body::User(f));
        node.flags = REACTIVE_LAZY;
        node.status = STATUS_UNINITIALIZED;
        node.effect_fn = Some(effect_fn);
        node.error_fn = error_fn;
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

    // Solid: core.ts:1909-1939 (owner-lifecycle disposal reads freeze; the
    // `refresh` argument's arm is unreached)
    pub(super) fn prepare_computed(&mut self, comp: NodeId, _refresh: bool) {
        if self.nodes[comp].flags & REACTIVE_LAZY != 0 {
            self.nodes[comp].flags &= !REACTIVE_LAZY;
            self.recompute(comp, true);
        } else if self.nodes[comp].flags & REACTIVE_DISPOSED != 0
            && self.nodes[comp].config & CONFIG_AUTO_DISPOSE != 0
        {
            panic!("reawakening a dormant memo is not ported");
        }
    }

    // Solid: core.ts:1957-1964
    fn reader_sees_committed(&self, el: NodeId, c: Option<NodeId>) -> bool {
        match c {
            None => true,
            Some(c) => {
                self.nodes[el].pending.is_none()
                    || self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0
            }
        }
    }

    // Solid: core.ts:1984-1992
    pub(super) fn unflushed_value(&self, el: NodeId) -> Slot {
        let n = &self.nodes[el];
        if self.running || n.pending.is_none() || n.config & CONFIG_PROMOTED != 0 {
            return None;
        }
        if n.config & CONFIG_HELD != 0 {
            return if n.flushed_at == self.clock as i64 {
                n.flushed.clone()
            } else {
                None
            };
        }
        Some(n.value.clone())
    }

    // Solid: core.ts:1996-2003
    fn stash_flushed(&mut self, el: NodeId) {
        let clock = self.clock as i64;
        let n = &mut self.nodes[el];
        if n.flushed_at != clock {
            n.flushed = n.pending.clone();
            n.flushed_at = clock;
            self.unflushed_staged = true;
        }
    }

    // Solid: core.ts:2009-2014
    fn mark_late_linker(&mut self, c: NodeId) {
        self.nodes[c].flags |= REACTIVE_MISSED_WAKE;
    }

    // Solid: core.ts:2016-2023
    pub(super) fn resync_unflushed_companions(&mut self) {
        self.unflushed_staged = false;
        if !self.promoted_writes.is_empty() {
            for el in std::mem::take(&mut self.promoted_writes) {
                self.nodes[el].config &= !CONFIG_PROMOTED;
            }
        }
    }

    // Solid: core.ts:2624-2628
    pub(super) fn note_promoted_write(&mut self, el: NodeId) {
        if self.running || self.nodes[el].config & CONFIG_PROMOTED != 0 {
            return;
        }
        self.nodes[el].config |= CONFIG_PROMOTED;
        self.promoted_writes.push(el);
    }

    // Solid: core.ts:1312-1316 (`joinPassAt`)
    pub(super) fn join_pass_at(&mut self, c: NodeId, t: TxId) {
        self.nodes[c].flags |= REACTIVE_JOINED;
        let own = (self.nodes[c].effect_type == 0
            && self.nodes[c].status & STATUS_UNINITIALIZED != 0)
            || self.fresh_hook(c, false);
        self.join_pass_tx(t, own);
    }

    // Solid: core.ts:2585-2612 (`stagedScreen`). `holdStagingHook` is the
    // verdict engine's (verdict.ts:873-890); `latestOpened` is set only by
    // a tracked `latest()`, which no pass here runs.
    pub(super) fn staged_screen(&mut self, c: NodeId, el: Option<NodeId>) -> bool {
        let Some(f) = self.flush_transaction else {
            return false;
        };
        if self.born_into(c, f)
            || el.is_some_and(|el| {
                self.nodes[el].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
            })
            || el.is_some_and(|el| self.hold_staging(c, el))
        {
            return false;
        }
        self.stale_reader(c, f);
        true
    }

    // Solid: core.ts:2028-2044
    fn pull_computed(&mut self, owner: NodeId, c: NodeId) {
        if self.nodes[owner].height >= self.dirty_queue.min {
            self.mark_node(c, REACTIVE_DIRTY);
            self.mark_heap();
            self.update_if_necessary(owner);
        } else if self.nodes[c].config & CONFIG_FRESH_READ != 0 {
            self.update_if_necessary(owner);
        }
        let height = self.nodes[owner].height;
        if height >= self.nodes[c].height && self.nodes[owner].parent != Some(c) {
            self.nodes[c].height = height + 1;
        }
    }

    // Solid: core.ts:2090-2104
    fn serves_staged(&mut self, c: NodeId, el: NodeId, owner: NodeId) -> bool {
        if !(self.pass_lane.is_none()
            && self.nodes[c].status & self.nodes[owner].status & STATUS_UNINITIALIZED != 0
            && self.nodes[el].pending.is_some()
            && self.nodes[el].config & (CONFIG_HELD | CONFIG_STAGED_ERROR) == 0
            && self.nodes[c].effect_type == 0)
        {
            return false;
        }
        if self.nodes[c].flags & REACTIVE_MISSED_WAKE != 0 {
            return true;
        }
        if !(self.nodes[c].pending.is_none() && self.nodes[c].served != self.clock as i64) {
            return false;
        }
        if self.nodes[c].status & STATUS_PENDING != 0 {
            let source = match self.nodes[owner].error.as_deref() {
                Some(Thrown::NotReady(s)) => *s,
                _ => panic!("a pending read's error is a NotReadyError"),
            };
            let deleted = match (self.nodes[c].pending_sources, source) {
                (Some(s), Some(src)) => self.set_delete(s, src),
                _ => false,
            };
            if !deleted {
                return false;
            }
        }
        self.nodes[c].served = self.clock as i64;
        self.nodes[c].flags |= REACTIVE_MISSED_WAKE;
        true
    }

    // Solid: core.ts:2106-2447 (no snapshot, strict-read or dev tier)
    pub(super) fn read_node(&mut self, el: NodeId) -> Result<Value, Error> {
        let mut c = self.context;
        if let Some(r) = c {
            if self.nodes[r].kind == Kind::Root {
                c = self.parent_computed(r);
            }
        }
        self.tr(|| {
            let n = &self.nodes[el];
            format!(
                "RD {} c{} s{} p{} by {}",
                self.label(el),
                n.config,
                n.status,
                n.pending.is_some() as u8,
                c.map_or("-".to_string(), |c| self.label(c).to_string())
            )
        });
        if self.verdict {
            return self.verdict_value(el, c);
        }
        if self.nodes[el].fn_.is_some() {
            self.prepare_computed(el, false);
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
                    return Ok(self.nodes[el].value.clone());
                }
            }
            let Some(c) = c.filter(|c| self.nodes[*c].config & CONFIG_CHILDREN_FORBIDDEN == 0)
            else {
                return Ok(self.nodes[el].value.clone());
            };
            let Some(pending) = self.nodes[el].pending.clone() else {
                return Ok(self.nodes[el].value.clone());
            };
            // D-8: writes that netted; lane work over a folded lane reads
            // the screen (`stagedScreen`; no verdict readers here).
            let netted = pending == self.nodes[el].value;
            if netted
                || (self.pass_lane.is_some_and(|l| self.txs[l].folded)
                    && self.staged_screen(c, Some(el)))
            {
                return Ok(self.nodes[el].value.clone());
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
                    // F-6 (`REACTIVE_AHEAD`, the verdict posture): `el` is
                    // never a verdict memo here, so neither mark applies.
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
                self.served_as_value(el);
                return Ok(v);
            }
        }
        let status = self.nodes[el].status;
        if status & STATUS_PENDING != 0
            && !committed
            && self.nodes[el].config & CONFIG_OVERRIDE == 0
            && status & STATUS_UNINITIALIZED == 0
        {
            if c.is_some_and(|c| self.nodes[c].config & CONFIG_VERDICT != 0) {
                panic!("observeFlight (a verdict reader's read of a flight) is not ported");
            } else if self.pass_lane.is_some()
                && c.is_none_or(|c| self.nodes[c].status & STATUS_UNINITIALIZED == 0)
            {
                committed = true;
            }
        }
        if status & STATUS_PENDING != 0 && !committed {
            if let Some(c) = c {
                if self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN == 0
                    || status & STATUS_UNINITIALIZED != 0
                {
                    if self.serves_staged(c, el, el) {
                        return Ok(self.nodes[el].pending.clone().expect("a staging"));
                    }
                    // `spectating` is never set here.
                    if !self.tracking && el != c {
                        self.link(el, c);
                    }
                    return Err(self.thrown_error(el));
                }
            } else if status & STATUS_UNINITIALIZED != 0 {
                return Err(self.thrown_error(el));
            }
        }
        if self.nodes[el].fn_.is_some() && self.nodes[el].status & STATUS_ERROR != 0 {
            if self.tracking && self.nodes[el].time < self.clock {
                self.recompute(el, false);
                return self.read_node(el);
            }
            if !committed && self.nodes[el].config & CONFIG_STAGED_ERROR != 0 {
                self.serve(el, c)?;
            }
            return Err(self.thrown_error(el));
        }
        if committed || c.is_none() {
            self.throw_shown(el)?;
        }
        let value = self.serve(el, if committed { None } else { c })?;
        if c.is_none()
            && self.nodes[el].fn_.is_some()
            && self.nodes[el].config & CONFIG_AUTO_DISPOSE != 0
            && self.nodes[el].status & STATUS_PENDING == 0
            && self.nodes[el].subs.is_none()
        {
            panic!("the dormant-node sweep (core.ts:2430-2445) is not ported");
        }
        Ok(value)
    }

    /// A lane read served `laneValueOf(el)`, which is `_pendingValue` for a
    /// derivation: with a staged error there (D-41), Solid hands the
    /// `StatusError` object to the reader as a value, and the reader's
    /// arithmetic turns it into a string. Values here are integers: fail
    /// closed.
    pub(super) fn served_as_value(&self, el: NodeId) {
        let n = &self.nodes[el];
        if n.config & CONFIG_GUESS == 0 && n.pending_err.is_some() {
            panic!("a staged error served as a lane value (truth.ts:24) is not ported");
        }
    }

    /// `throw owner._x?._error` (a thrown `undefined` is not reached).
    fn thrown_error(&self, el: NodeId) -> Error {
        self.nodes[el]
            .error
            .clone()
            .expect("a pending or errored node carries its error")
    }

    // Solid: core.ts:2452-2457
    fn throw_shown(&self, el: NodeId) -> Result<(), Error> {
        match &self.nodes[el].shown_error {
            Some(e) => Err(e.clone()),
            None => Ok(()),
        }
    }

    // Solid: core.ts:2469-2523 (no verdict reader: `stagedScreen` is not
    // asked; `spectating` is never set)
    fn serve(&mut self, el: NodeId, c: Option<NodeId>) -> Result<Value, Error> {
        let forbidden = c.is_some_and(|c| self.nodes[c].config & CONFIG_CHILDREN_FORBIDDEN != 0);
        if self.nodes[el].pending.is_some()
            && self.nodes[el].status & STATUS_UNINITIALIZED != 0
            && (c.is_none() || forbidden)
        {
            return Err(error::not_ready(None));
        }
        let u = if c.is_some() && self.unflushed_staged {
            self.unflushed_value(el)
        } else {
            None
        };
        if let Some(u) = u {
            self.mark_late_linker(c.unwrap());
            return Ok(u);
        }
        if self.reader_sees_committed(el, c) {
            return Ok(self.nodes[el].value.clone());
        }
        // Prod: `!(__DEV__ && strictRead)` always holds.
        self.staged_read(c.unwrap(), Some(el));
        if self.nodes[el].config & CONFIG_STAGED_ERROR != 0 {
            return Err(self.nodes[el]
                .pending_err
                .clone()
                .expect("a staged error carries its error"));
        }
        Ok(self.nodes[el].pending.clone().expect("a staging"))
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
    pub(super) fn is_same(&self, el: NodeId, a: &Value, b: &Value) -> bool {
        self.equals(el, a, b)
    }

    /// `el._equals && el._equals(a, b)` (`this` is the node).
    pub(super) fn equals(&self, el: NodeId, a: &Value, b: &Value) -> bool {
        match self.nodes[el].eq {
            Equals::Never => false,
            Equals::IsEqual => a == b,
            Equals::Slot => self.slot_node_equals(el, a, b),
            Equals::Container => self.container_equals(el, a, b),
            // A user comparator (it never throws here: `isSame`'s A3 catch
            // is not reached).
            Equals::User(i) => (self.comparators[i].clone())(a, b),
        }
    }
    /// `!!el._equals`.
    // Solid: core.ts:2680-2691 (`!!el._equals`)
    pub(super) fn has_equals(&self, el: NodeId) -> bool {
        self.nodes[el].eq != Equals::Never
    }
    /// `el._equals && el._equals(a, b)` where either side may be
    /// NOT_PENDING (`None`, an object equal only to itself).
    // Solid: core.ts:2680-2691; constants.ts:267 (NOT_PENDING is an object)
    pub(super) fn equals_slot(&self, el: NodeId, a: &Slot, b: &Slot) -> bool {
        match (a, b) {
            (Some(a), Some(b)) => self.equals(el, a, b),
            (None, None) => self.has_equals(el),
            _ => false,
        }
    }

    /// `el._pendingValue = v` (a value or NOT_PENDING): any staged error
    /// object it held is replaced.
    pub(super) fn set_pending(&mut self, el: NodeId, v: Slot) {
        self.nodes[el].pending = v;
        self.nodes[el].pending_err = None;
    }

    // Solid: core.ts:2693-2797 (default equality; no write hook, snapshot,
    // or promoted write)
    pub(super) fn set_signal(&mut self, el: NodeId, v: Value) {
        let _ = self.set_signal_fn(el, &mut |_, _| Ok(v.clone()));
    }

    /// `setSignal(el, prev => …)`: the updater composes on the staging,
    /// else the committed value.
    pub(super) fn set_signal_fn(
        &mut self,
        el: NodeId,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
    ) -> Result<(), Error> {
        let current = self.nodes[el]
            .pending
            .clone()
            .unwrap_or(self.nodes[el].value.clone());
        let v = f(self, current.clone())?;
        self.tr(|| format!("SS {}", self.label(el)));
        if self.nodes[el].config & CONFIG_OVERRIDE != 0 {
            self.lane_write(el, v);
            return Ok(());
        }
        if self.nodes[el].config & CONFIG_HELD != 0 {
            let t = self.tx_of(el);
            self.join_future(Some(t));
        }
        // `custom`: the node carries a comparator of its own (a store slot's)
        // — the verdict engine is installed. A staged error is an object
        // no value equals.
        let custom = self.nodes[el].eq != Equals::IsEqual;
        let value_changed = self.nodes[el].status & STATUS_UNINITIALIZED != 0
            || self.nodes[el].shown_error.is_some()
            || self.nodes[el].pending_err.is_some()
            || if custom {
                !self.is_same(el, &current, &v)
            } else {
                current != v
            };
        if !value_changed {
            return Ok(());
        }
        let was_staged = self.nodes[el].pending.is_some();
        if !was_staged {
            self.queue_pending_node(el);
        } else if self.nodes[el].config & CONFIG_HELD != 0 && !self.running {
            self.stash_flushed(el);
        }
        // D-8 (#4483): a staged rewrite the comparator calls equal to the
        // committed value nets to it.
        let netted = custom
            && was_staged
            && !(self.nodes[el].status & STATUS_UNINITIALIZED != 0
                || self.nodes[el].shown_error.is_some())
            && self.is_same(el, &self.nodes[el].value.clone(), &v);
        let staged = if netted {
            self.nodes[el].value.clone()
        } else {
            v
        };
        self.set_pending(el, Some(staged));
        if self.context.is_some() {
            self.note_promoted_write(el);
        }
        if self.nodes[el].fn_.is_some() {
            self.nodes[el].time = self.clock;
        }
        if was_staged && self.nodes[el].notified_at == self.notify_epoch as i64 {
            return Ok(());
        }
        self.insert_subs(el);
        self.schedule();
        Ok(())
    }

    // Solid: core.ts:2915-2952
    pub(super) fn mark_refresh(&mut self, node: NodeId) {
        if self.nodes[node].fn_.is_some() && self.nodes[node].flags & REACTIVE_DISPOSED == 0 {
            let flags = self.nodes[node].flags;
            self.nodes[node].flags = (flags & !REACTIVE_CHECK)
                | REACTIVE_DIRTY
                | if flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP) != 0 {
                    0
                } else {
                    REACTIVE_REASK
                };
            self.insert_into_heap(node);
            self.schedule();
        }
    }
}
