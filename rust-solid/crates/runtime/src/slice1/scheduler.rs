//! Solid: scheduler.ts — transactions, the flush and its seam (`settle`),
//! landings, the effect queues and the commit of staged nodes.
//!
//! Not ported (constant in these slices): `affects()` marks, the boundary
//! hooks beyond `boundaries.rs` (no boundary), and tracked verdict readers.
//! The store hooks are store/store.rs (`storePark`, `storeCommit`).
use super::*;

impl Runtime {
    // Solid: scheduler.ts:330-348
    pub(super) fn new_transaction(&mut self, lane: bool, parent: Option<TxId>) -> TxId {
        let t = self.txs.len();
        self.txs.push(Transaction {
            folded: false,
            over: None,
            nodes: vec![],
            queues: [vec![], vec![]],
            reruns: vec![],
            into: None,
            parent,
            lane,
            links: None,
            open: 0,
            acted: false,
            shown: false,
            held: false,
        });
        if !lane {
            self.transactions.push(t);
        }
        t
    }

    // Solid: scheduler.ts:405-407. A node with no transaction here is
    // `resolveTx(null)`, a TypeError in Solid: the suspected bug of a slot
    // `take` keeps held (docs/SLICE1.md) — fail closed.
    pub(super) fn tx_of(&mut self, n: NodeId) -> TxId {
        let t = self.resolve_tx(self.nodes[n].transaction.expect(
            "txOf of a node with no transaction (Solid: resolveTx(null) throws a TypeError) is not ported",
        ));
        self.nodes[n].transaction = Some(t);
        t
    }

    // Solid: scheduler.ts:410-413
    pub(super) fn live_tx(&self, t: TxId) -> Option<TxId> {
        let t = self.resolve_tx(t);
        self.transactions.contains(&t).then_some(t)
    }

    // Solid: scheduler.ts:414-417
    pub(super) fn resolve_tx(&self, mut t: TxId) -> TxId {
        while let Some(i) = self.txs[t].into {
            t = i;
        }
        t
    }

    // Solid: scheduler.ts:421-429
    pub(super) fn join_future(&mut self, t: Option<TxId>) {
        self.tr(|| {
            let f = |x: Option<TxId>| match x {
                Some(x) => self.resolve_tx(x).to_string(),
                None => "null".into(),
            };
            format!("J {} f={}", f(t), f(self.flush_transaction))
        });
        if let Some(t) = t {
            if self.txs[t].lane {
                return;
            }
        }
        match self.flush_transaction {
            None => {
                self.flush_transaction = Some(match t {
                    None => self.new_transaction(false, None),
                    Some(t) => self.resolve_tx(t),
                })
            }
            Some(f) => {
                if let Some(t) = t {
                    let t = self.resolve_tx(t);
                    self.merge(t, f)
                }
            }
        }
        if !self.running {
            self.schedule();
        }
    }

    // Solid: scheduler.ts:433-449
    pub(super) fn merge(&mut self, t: TxId, f: TxId) {
        let t = self.resolve_tx(t);
        let f = self.resolve_tx(f);
        if t == f || self.txs[t].lane || self.txs[f].lane {
            return;
        }
        self.txs[t].into = Some(f);
        self.txs[f].open += self.txs[t].open;
        self.txs[f].acted |= self.txs[t].acted;
        let nodes = self.txs[t].nodes.clone();
        self.txs[f].nodes.extend(nodes);
        for i in 0..2 {
            let q = self.txs[t].queues[i].clone();
            self.txs[f].queues[i].extend(q);
        }
        let reruns = self.txs[t].reruns.clone();
        self.txs[f].reruns.extend(reruns);
        if let Some(k) = self.transactions.iter().position(|x| *x == t) {
            self.transactions.remove(k);
        }
    }

    // Solid: scheduler.ts:466-476
    pub(super) fn blocked(&mut self, t: TxId) -> bool {
        let prev = self.judge;
        self.judge = self.judge.or(Some(t));
        let r = self.txs[t].open != 0 || self.blocked_by(t, false) || self.lanes_blocked(t);
        self.judge = prev;
        r
    }

    // Solid: scheduler.ts:501-503
    pub(super) fn own_flights(&mut self, t: TxId) -> bool {
        self.blocked_by(t, true)
    }

    // Solid: scheduler.ts:507-515
    fn own_source(&mut self, n: NodeId, t: TxId) -> bool {
        let Some(sources) = self.nodes[n].pending_sources else {
            return true;
        };
        let mut i = 0;
        while let Some(entry) = self.set_at(sources, i) {
            i += 1;
            let Some(s) = entry else { continue };
            match self.nodes[s].transaction {
                None => return true,
                Some(u) if self.resolve_tx(u) == t => return true,
                _ => {}
            }
        }
        false
    }

    // Solid: scheduler.ts:516-568 (`blockedBy(t._nodes, t, own)`; no verdict
    // reader carries CONFIG_AHEAD)
    fn blocked_by(&mut self, owner: TxId, own: bool) -> bool {
        let mut i = 0;
        while i < self.txs[owner].nodes.len() {
            let n = self.txs[owner].nodes[i];
            i += 1;
            if self.nodes[n].status & STATUS_PENDING == 0
                || self.nodes[n].flags & REACTIVE_DISPOSED != 0
                || self.nodes[n].config & CONFIG_GUESS != 0
                || (self.nodes[n].transaction.is_some() && self.tx_of(n) != owner)
                || (own && !self.own_source(n, owner))
            {
                continue;
            }
            let judge = self.judge.unwrap_or(owner);
            if self.nodes[n].effect_type == EFFECT_RENDER {
                if self.on_screen(n, judge) {
                    return true;
                }
                continue;
            }
            let mut s = self.nodes[n].subs;
            while let Some(l) = s {
                let r = self.links[l].sub;
                let rn = &self.nodes[r];
                if ((rn.effect_type == EFFECT_RENDER && rn.status & STATUS_PENDING != 0)
                    || rn.flags & REACTIVE_FRAME_READ != 0
                    || (rn.config & CONFIG_REDERIVE != 0 && rn.status == STATUS_PENDING))
                    && (self.links[l].gen == rn.dep_gen || rn.error.is_some())
                    && rn.flags & REACTIVE_DISPOSED == 0
                    && self.on_screen(r, judge)
                {
                    return true;
                }
                s = self.links[l].next_sub;
            }
        }
        false
    }

    // Solid: scheduler.ts:577-579
    fn on_screen(&mut self, r: NodeId, t: TxId) -> bool {
        if self.nodes[r].flags & REACTIVE_ZOMBIE != 0 && self.removal_staged_by(r, t) {
            return false;
        }
        !self.hidden_by(r, &mut None)
    }

    // Solid: scheduler.ts:586-592
    fn removal_staged_by(&mut self, r: NodeId, t: TxId) -> bool {
        let mut o = Some(r);
        while let Some(x) = o {
            if self.nodes[x].flags & REACTIVE_ZOMBIE == 0 {
                break;
            }
            o = self.nodes[x].parent;
        }
        let Some(o) = o else {
            return false;
        };
        self.nodes[o].config & CONFIG_HELD != 0
            && self.nodes[o].transaction.is_some()
            && self.tx_of(o) == self.resolve_tx(t)
    }

    // Solid: scheduler.ts:599-601
    pub(super) fn held_trim(&mut self, el: NodeId) {
        self.held_trims.push(el);
    }

    // Solid: scheduler.ts:608-612
    pub(super) fn defer_zombie(&mut self, el: NodeId) {
        self.delete_from_heap(el);
        self.nodes[el].flags &= !(REACTIVE_DIRTY | REACTIVE_CHECK);
        self.deferred_zombies.push(el);
    }

    // Solid: scheduler.ts:616-619
    pub(super) fn hold_node(&mut self, n: NodeId, t: TxId) {
        self.tr(|| format!("H {} {}", self.label(n), self.resolve_tx(t)));
        self.nodes[n].config |= CONFIG_HELD;
        self.list(n, t);
    }

    // Solid: scheduler.ts:624-629
    pub(super) fn list(&mut self, n: NodeId, t: TxId) {
        if self.nodes[n].transaction == Some(t) {
            return;
        }
        self.nodes[n].transaction = Some(t);
        self.txs[t].nodes.push(n);
    }

    // Solid: scheduler.ts:644-653
    fn hold_frame(&mut self, owner: NodeId, t: TxId) {
        let mut c = self.nodes[owner].first_child;
        while let Some(n) = c {
            if self.nodes[n].transaction.is_some_and(|x| self.txs[x].lane) {
                c = self.nodes[n].next_sibling;
                continue;
            }
            if self.nodes[n].fn_.is_some() {
                if self.nodes[n].config & CONFIG_HELD == 0 {
                    self.hold_node(n, t);
                }
                self.nodes[n].config |= CONFIG_HELD_FRAME;
            }
            self.hold_frame(n, t);
            c = self.nodes[n].next_sibling;
        }
    }

    // Solid: scheduler.ts:735-740
    pub(super) fn enter_action(&mut self) {
        self.action_depth += 1;
    }
    pub(super) fn exit_action(&mut self) {
        self.action_depth -= 1;
    }

    // Solid: scheduler.ts:751-756
    pub(super) fn set_question(&mut self, q: u64) {
        self.question = q;
    }
    pub(super) fn next_question(&mut self) -> u64 {
        self.questions += 1;
        self.questions
    }

    // Solid: scheduler.ts:777-787 (no halt; `syncDepth` is always 0 here)
    pub(super) fn schedule(&mut self) {
        if self.scheduled {
            return;
        }
        self.scheduled = true;
        if !self.running {
            self.microtasks.push_back(Microtask::Flush);
        }
    }

    // Solid: scheduler.ts:935-974 (`GlobalQueue.flush`)
    fn global_flush(&mut self) {
        if self.running {
            return;
        }
        self.running = true;
        self.resync_unflushed_companions();
        self.pass_lane = None;
        self.pass_tx = None;
        // `sweepDormant`: no untracked read of an unobserved auto-dispose
        // memo queues one in this slice.
        self.run_heap();
        self.settle();
        self.clock += 1;
        self.scheduled =
            self.dirty_queue.max >= self.dirty_queue.min || !self.pending_nodes.is_empty();
        self.run(EFFECT_RENDER);
        self.run(EFFECT_USER);
        self.running = false;
        self.pass_tx = None;
    }

    // Solid: scheduler.ts:981-1168 (`GlobalQueue.settle`)
    fn settle(&mut self) {
        if !self.lanes.is_empty() && self.lane_corrections() {
            self.run_heap();
        }
        // `latestOpened`: only a tracked `latest()` opens one.
        let joined = self.flush_transaction.take();
        self.apply_guesses_at(joined);
        let t = joined
            .filter(|j| !self.txs[*j].lane)
            .map(|j| self.resolve_tx(j));
        self.tr(|| {
            let ids: Vec<String> = self
                .pending_nodes
                .iter()
                .map(|n| self.label(*n).to_string())
                .collect();
            let t = t.map_or("null".to_string(), |t| t.to_string());
            format!("S {t} [{}]", ids.join(","))
        });
        if let Some(t) = t {
            let count = self.pending_nodes.len();
            for i in 0..count {
                let n = self.pending_nodes[i];
                let nn = &self.nodes[n];
                if nn.config & (CONFIG_HELD | CONFIG_OVERRIDE) == 0
                    && nn.transaction.is_none_or(|x| !self.txs[x].lane)
                {
                    if nn.pending.is_none()
                        && nn.status & STATUS_UNINITIALIZED != 0
                        && nn.effect_type != EFFECT_RENDER
                    {
                        continue;
                    }
                    if let Some(p) = nn.pending.clone() {
                        if nn.status & (STATUS_PENDING | STATUS_UNINITIALIZED) == 0
                            && nn.pending_first_child.is_none()
                            && nn.pending_disposal.is_empty()
                            && nn.pending_err.is_none()
                            && self.is_same(n, &nn.value, &p)
                        {
                            self.set_pending(n, None);
                            self.nodes[n].config &= !CONFIG_STAGED;
                            continue;
                        }
                    }
                    self.hold_node(n, t);
                }
                // A held pass's frame is held with it (ruling A, O2).
                if self.nodes[n].config & CONFIG_STAGED != 0 {
                    self.hold_frame(n, t);
                }
            }
            self.pending_nodes.clear();
            // `storeParkHook` (store/store.ts `storePark`).
            self.store_park(t);
            // The batch joins: the deferred zombies are cancelled. A
            // verdict reader among them re-runs (`observeFlightHook` is
            // installed; no node here is CONFIG_VERDICT).
            let mut zombies = std::mem::take(&mut self.deferred_zombies);
            zombies.sort_by_key(|z| self.nodes[*z].height);
            for z in zombies {
                if self.nodes[z].flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE) == REACTIVE_ZOMBIE
                    && self.nodes[z].config & CONFIG_VERDICT != 0
                {
                    self.recompute(z, false);
                }
            }
        } else {
            self.commit_pending_nodes();
            for i in 0..self.held_trims.len() {
                let h = self.held_trims[i];
                if self.nodes[h].error.is_none() && !self.nodes[h].modified {
                    self.trim_stale_deps(h);
                }
            }
        }
        self.held_trims.clear();
        let own = std::mem::take(&mut self.queues);
        // laneSeamsHook is installed (lanes.ts imported): it collects the
        // lanes' reveal runs into their own queue pair.
        self.lane_seams(t);
        self.staged_readers.clear();
        let lanes = std::mem::take(&mut self.queues);
        let mut k = self.transactions.len() as isize - 1;
        while k >= 0 {
            let u = self.transactions[k as usize];
            if self.blocked(u) {
                k -= 1;
                continue;
            }
            self.transactions.remove(k as usize);
            self.end_lanes(u);
            self.land(u);
            k = self.transactions.len() as isize;
            k -= 1;
        }
        // `storeCommitHook` (store/store.ts: `drainFolds`, `sweepOverlaid`).
        self.store_commit();
        let live = t.and_then(|t| self.live_tx(t));
        let parked = live.is_some();
        for i in 0..2 {
            if let Some(l) = live {
                let o = own[i].clone();
                self.txs[l].queues[i].extend(o);
            }
            if parked || !lanes[i].is_empty() || !self.queues[i].is_empty() {
                let mut q = lanes[i].clone();
                if !parked {
                    q.extend(own[i].iter().copied());
                }
                q.extend(self.queues[i].iter().copied());
                self.queues[i] = q;
            } else {
                self.queues[i] = own[i].clone();
            }
        }
        if !self.deferred_zombies.is_empty() {
            // Survivors are the displayed frame of a held pass: they rerun
            // for the live write, parents before children.
            let mut zombies = std::mem::take(&mut self.deferred_zombies);
            zombies.sort_by_key(|z| self.nodes[*z].height);
            for z in zombies {
                if self.nodes[z].flags & REACTIVE_DISPOSED == 0 {
                    self.recompute(z, false);
                }
            }
        }
        // `boundarySeamHook`: no boundary.
    }

    // Solid: scheduler.ts:1169-1175
    fn run(&mut self, ty: u32) {
        let i = (ty - 1) as usize;
        if !self.queues[i].is_empty() {
            let effects = std::mem::take(&mut self.queues[i]);
            self.run_queue(effects, ty);
        }
    }

    // Solid: scheduler.ts:1176-1184
    pub(super) fn enqueue(&mut self, ty: u32, f: QueueCallback, lane: Option<TxId>) {
        if ty != 0 {
            let i = (ty - 1) as usize;
            match lane.filter(|l| self.txs[*l].lane) {
                Some(l) => self.txs[l].queues[i].push(f),
                None => self.queues[i].push(f),
            }
        }
        self.schedule();
    }

    // Solid: scheduler.ts:1235-1289
    pub(super) fn reruns(&mut self, u: TxId) -> bool {
        let mut frame = false;
        let mut i = 0;
        while i < self.txs[u].reruns.len() {
            let r = self.txs[u].reruns[i];
            i += 1;
            let s = self.nodes[r].error.as_ref().and_then(|e| e.source());
            // `(s?._statusFlags ?? STATUS_ERROR) & STATUS_ERROR`: a null or
            // missing source reads as errored.
            let s_errored = match s {
                Some(Some(n)) => self.nodes[n].status & STATUS_ERROR != 0,
                _ => true,
            };
            let s_is_r = s == Some(Some(r));
            if self.nodes[r].flags & REACTIVE_DISPOSED != 0
                || (self.nodes[r].status & STATUS_ERROR != 0
                    && (self.nodes[r].effect_type != 0 || self.nodes[r].config & CONFIG_FRAME == 0)
                    && !s_is_r
                    && s_errored)
            {
                continue;
            }
            // `observeFlightHook && CONFIG_VERDICT`: no verdict readers.
            if self.nodes[r].flags & REACTIVE_FRAME_READ != 0 {
                frame = frame
                    || self.nodes[r].effect_type != 0
                    || s_is_r
                    || self.nodes[r].config & CONFIG_HELD != 0;
                if !self.txs[u].lane {
                    self.nodes[r].flags &= !REACTIVE_FRAME_READ;
                }
                self.nodes[r].modified = false;
                // A run one of its children queued this flush is for the
                // frame being replaced: void too (#3404).
                let mut c = self.nodes[r].first_child;
                while let Some(ch) = c {
                    if self.nodes[ch].kind != Kind::Root && self.nodes[ch].effect_type != 0 {
                        self.nodes[ch].modified = false;
                    }
                    c = self.nodes[ch].next_sibling;
                }
                // `laneAdoptHook` (lanes.ts `adoptParked`) adopts only a
                // flight `laneSeams` parked: none is.
                self.enqueue_sub(r);
            }
        }
        self.txs[u].reruns.clear();
        frame
    }

    // Solid: scheduler.ts:1292-1321
    fn land(&mut self, u: TxId) {
        self.tr(|| format!("L {u}"));
        let frame = self.reruns(u);
        let mut i = 0;
        while i < self.txs[u].nodes.len() {
            let n = self.txs[u].nodes[i];
            i += 1;
            if self.nodes[n].transaction.is_none() || self.tx_of(n) != u {
                continue;
            }
            self.nodes[n].transaction = None;
            self.commit_pending_node(n);
        }
        if self.flush_transaction == Some(u) {
            self.flush_transaction = None;
        }
        if frame {
            self.queues[1].push(QueueCallback::ReleaseQueues(u));
        } else {
            self.release_queues(u);
        }
    }

    // Solid: scheduler.ts:1327-1332
    pub(super) fn release_queues(&mut self, u: TxId) {
        for i in 0..2 {
            let q = std::mem::take(&mut self.txs[u].queues[i]);
            self.queues[i].extend(q);
        }
    }

    // Solid: scheduler.ts:1351-1356
    pub(super) fn stale_reader(&mut self, c: NodeId, t: TxId) {
        if self.nodes[c].flags & REACTIVE_FRAME_READ == 0 {
            self.nodes[c].flags |= REACTIVE_FRAME_READ;
            self.txs[t].reruns.push(c);
        }
    }

    // Solid: scheduler.ts:1358-1362
    pub(super) fn queue_pending_node(&mut self, node: NodeId) {
        self.pending_nodes.push(node);
        if !self.running {
            self.unflushed_staged = true; // markUnflushedStaged (A28)
        }
    }

    // Solid: scheduler.ts:1374-1376
    pub(super) fn bump_notify_epoch(&mut self) {
        self.notify_epoch += 1;
    }

    // Solid: scheduler.ts:1378-1412 (no snapshots)
    pub(super) fn insert_subs(&mut self, node: NodeId) {
        self.tr(|| format!("IS {}", self.label(node)));
        self.nodes[node].notified_at = self.notify_epoch as i64;
        let mut s = self.nodes[node].subs;
        while let Some(l) = s {
            let link = self.links[l];
            let sub = link.sub;
            if self.nodes[sub].flags & REACTIVE_RECOMPUTING_DEPS != 0
                && link.gen == self.nodes[sub].dep_gen
                && Some(l) != self.nodes[sub].deps_tail
            {
                self.nodes[sub].flags |= REACTIVE_MISSED_WAKE;
            }
            self.enqueue_sub(sub);
            s = self.links[l].next_sub;
        }
    }

    // Solid: scheduler.ts:1431-1465 (no verdict memo: `node` never carries
    // CONFIG_VERDICT)
    pub(super) fn lane_dirty(&mut self, node: NodeId, l: TxId) {
        self.insert_subs(node);
        let mut s = self.nodes[node].subs;
        while let Some(link) = s {
            let c = self.links[link].sub;
            let mut t = self.nodes[c].transaction;
            if let Some(tc) = t {
                if self.nodes[c].effect_type == 0
                    && self.nodes[c].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                    && self.nodes[c].status & (STATUS_PENDING | STATUS_UNINITIALIZED)
                        == STATUS_PENDING
                    && (self.resolve_tx(tc) == self.resolve_tx(self.txs[l].parent.unwrap())
                        || match self.nodes[c].pending_sources {
                            Some(ps) => self.set_values(ps).iter().all(|p| self.nodes[*p].reask),
                            None => self.nodes[c].reask,
                        })
                {
                    t = Some(l);
                    self.list(c, l);
                }
            }
            let mark = match t {
                Some(t) if self.txs[t].lane => self.same_lane(t, l),
                _ => self.nodes[c].effect_type != 0,
            };
            if mark {
                self.nodes[c].flags |= REACTIVE_LANE_DIRTY;
            }
            s = self.links[link].next_sub;
        }
    }

    // Solid: scheduler.ts:1199-1225 (`GlobalQueue.notify`; `catchHook` is
    // boundaries.ts `catchStatus`)
    pub(super) fn notify(&mut self, node: NodeId, mask: u32, flags: u32) -> bool {
        if self.catch_status(node, flags & mask) {
            return true;
        }
        if mask & STATUS_PENDING != 0 {
            if flags & STATUS_PENDING != 0 && self.pass_lane.is_none() {
                self.join_future(None);
            }
            return true;
        }
        false
    }

    // Solid: scheduler.ts:1468-1474
    pub(super) fn queue_effect_run(&mut self, node: NodeId) {
        self.nodes[node].modified = true;
        let ty = self.nodes[node].effect_type;
        let lane = self.pass_lane;
        self.enqueue(ty, QueueCallback::RunEffect(node), lane);
    }

    // Solid: scheduler.ts:1477-1479
    pub(super) fn same_lane(&self, a: TxId, b: TxId) -> bool {
        a == b || (self.txs[a].links.is_some() && self.txs[a].links == self.txs[b].links)
    }

    // Solid: scheduler.ts:1482-1487
    pub(super) fn apply_staged(&mut self, n: NodeId) -> bool {
        if self.nodes[n].pending_err.is_some() {
            panic!("applying a staged error as a value is not ported");
        }
        match self.nodes[n].pending.take() {
            Some(v) => {
                self.nodes[n].value = v;
                true
            }
            None => false,
        }
    }

    // Solid: scheduler.ts:1489-1560
    pub(super) fn commit_pending_node(&mut self, n: NodeId) {
        self.tr(|| format!("C {}", self.label(n)));
        if self.nodes[n].fn_.is_none() {
            self.nodes[n].config &= !(CONFIG_STAGED | CONFIG_HELD);
            self.apply_staged(n);
            return;
        }
        let in_flight =
            self.nodes[n].pending.is_none() && self.nodes[n].status & STATUS_PENDING != 0;
        let err = self.nodes[n].config & CONFIG_STAGED_ERROR;
        if !in_flight {
            self.nodes[n].shown_error = None;
        }
        self.nodes[n].config = if in_flight {
            (self.nodes[n].config & !(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_INPUTS_PUBLISHED
        } else {
            self.nodes[n].config
                & !(CONFIG_HELD
                    | CONFIG_HELD_FRAME
                    | CONFIG_STAGED
                    | CONFIG_INPUTS_PUBLISHED
                    | CONFIG_STAGED_ERROR)
        };
        if err != 0 {
            let e = self.nodes[n].pending_err.take();
            self.nodes[n].pending = None;
            self.nodes[n].time = self.clock + 1;
            self.notify_status(n, STATUS_ERROR, e);
        } else if self.apply_staged(n) {
            self.nodes[n].status &= !STATUS_UNINITIALIZED;
            self.nodes[n].reask = false;
            self.nodes[n].flushed = None;
            if self.nodes[n].effect_type != 0 {
                self.queue_effect_run(n);
            }
        }
        self.nodes[n].loading = false;
        self.nodes[n].flags &= !REACTIVE_MANUAL_WRITE;
        if self.nodes[n].error.is_none() {
            self.trim_stale_deps(n);
        }
        if self.nodes[n].status & STATUS_PENDING == 0 {
            self.nodes[n].status &= !STATUS_UNINITIALIZED;
        }
        // The children this commit publishes are the frame's now: the frame
        // they replace, parked by the pass, goes.
        if !in_flight
            && (self.nodes[n].pending_first_child.is_some()
                || !self.nodes[n].pending_disposal.is_empty())
        {
            self.dispose_children(n, false, true);
        }
    }

    // Solid: scheduler.ts:1562-1571
    fn commit_pending_nodes(&mut self) {
        let mut i = 0;
        while i < self.pending_nodes.len() {
            let n = self.pending_nodes[i];
            i += 1;
            if self.nodes[n].config & (CONFIG_OVERRIDE | CONFIG_HELD) == 0 {
                self.commit_pending_node(n);
            }
        }
        self.pending_nodes.clear();
    }

    // Solid: scheduler.ts:1608-1687 (`flush()` without a callback)
    pub(super) fn flush_all(&mut self) {
        if self.action_depth > 0 || self.running {
            return;
        }
        while self.scheduled {
            self.global_flush();
        }
    }

    // Solid: scheduler.ts:1695-1707
    fn run_queue(&mut self, queue: Vec<QueueCallback>, ty: u32) {
        for f in queue {
            match f {
                QueueCallback::RunEffect(n) => self.run_effect(n, ty),
                QueueCallback::ReleaseQueues(u) => self.release_queues(u),
            }
        }
    }
}
