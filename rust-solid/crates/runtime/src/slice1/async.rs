//! Solid: async.ts — flights (`handleAsync`, its landing and rejection),
//! pending sources and the status walks (`notifyStatus`, `propagateStatus`,
//! `settlePendingSource`), staged errors (D-41).
//!
//! Not ported (unreached by the slices): async iterators and the flattening
//! of a promise that resolves to one (`consumeIterator`; a flight's value is
//! plain data, never an async iterable), synchronously settled thenables (a
//! JS promise never calls `.then` back synchronously), `onSupersede`/flight
//! teardowns, and a `NotReadyError` rejection (host rejections are plain
//! errors). A derived store's derive registers its flight with its pass's
//! `commit`/`onError` (store/projection.rs).
use super::error::{self, Thrown};
use super::*;

/// laneStage's `errored`: no answer (`true`), a pending propagation from a
/// source node (async.ts `propagateStatus`), or an answer (`false`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Errored {
    No,
    Yes,
    Node(NodeId),
}

impl Errored {
    pub(super) fn truthy(self) -> bool {
        self != Errored::No
    }
}

impl Runtime {
    // A JS `Set` of nodes (the `_pendingSources` container): insertion
    // order, deletion during iteration skips, addition visits.
    pub(super) fn set_new(&mut self) -> SetId {
        self.sets.push(JsSet::default());
        self.sets.len() - 1
    }
    pub(super) fn set_has(&self, s: Option<SetId>, n: NodeId) -> bool {
        s.is_some_and(|s| self.sets[s].items.contains(&Some(n)))
    }
    pub(super) fn set_add(&mut self, s: SetId, n: NodeId) {
        if !self.sets[s].items.contains(&Some(n)) {
            self.sets[s].items.push(Some(n));
            self.sets[s].size += 1;
        }
    }
    pub(super) fn set_delete(&mut self, s: SetId, n: NodeId) -> bool {
        match self.sets[s].items.iter().position(|x| *x == Some(n)) {
            Some(i) => {
                self.sets[s].items[i] = None;
                self.sets[s].size -= 1;
                true
            }
            None => false,
        }
    }
    /// `set.values().next().value`.
    pub(super) fn set_first(&self, s: Option<SetId>) -> Option<NodeId> {
        s.and_then(|s| self.sets[s].items.iter().flatten().next().copied())
    }
    /// The entry at iteration cursor `i` (`None` past the end); deleted
    /// entries are `Some(None)`.
    pub(super) fn set_at(&self, s: SetId, i: usize) -> Option<Option<NodeId>> {
        self.sets[s].items.get(i).copied()
    }
    pub(super) fn set_values(&self, s: SetId) -> Vec<NodeId> {
        self.sets[s].items.iter().flatten().copied().collect()
    }

    // Solid: async.ts:69-73
    pub(super) fn add_pending_source(&mut self, el: NodeId, source: NodeId) -> bool {
        self.nodes[el].x = true; // `ext(el)._pendingSources`
        if self.set_has(self.nodes[el].pending_sources, source) {
            return false;
        }
        let s = match self.nodes[el].pending_sources {
            Some(s) => s,
            None => {
                let s = self.set_new();
                self.nodes[el].pending_sources = Some(s);
                s
            }
        };
        self.set_add(s, source);
        true
    }

    // Solid: async.ts:75-80
    pub(super) fn remove_pending_source(&mut self, el: NodeId, source: NodeId) -> bool {
        let Some(s) = self.nodes[el].pending_sources else {
            return false;
        };
        if !self.set_delete(s, source) {
            return false;
        }
        if self.sets[s].size == 0 {
            self.nodes[el].pending_sources = None;
        }
        true
    }

    // Solid: async.ts:84-86
    pub(super) fn clear_in_flight(&mut self, el: NodeId) {
        self.nodes[el].in_flight = None;
    }

    // Solid: async.ts:88-92
    fn clear_pending_sources(&mut self, el: NodeId) {
        self.nodes[el].pending_sources = None;
    }

    // Solid: async.ts:99-105
    pub(super) fn retry_reaches(&self, el: NodeId, source: NodeId) -> bool {
        let mut d = self.nodes[el].deps;
        while let Some(l) = d {
            let dep = self.links[l].dep;
            if dep == source || self.set_has(self.nodes[dep].pending_sources, source) {
                return true;
            }
            d = self.links[l].next_dep;
        }
        false
    }

    // Solid: async.ts:114-122
    pub(super) fn park_loading_window(&mut self, el: NodeId, e: &Error) {
        self.nodes[el].x = true;
        self.nodes[el].blocked = true;
        let source = e.source().flatten();
        if let Some(s) = source {
            self.add_pending_source(el, s);
        }
        if self.nodes[el].status & STATUS_ERROR == 0 {
            self.set_pending_error(el, source, Some(e.clone()));
        }
    }

    // Solid: async.ts:124-136
    pub(super) fn set_pending_error(
        &mut self,
        el: NodeId,
        source: Option<NodeId>,
        error: Option<Error>,
    ) {
        let Some(source) = source else {
            self.nodes[el].error = None;
            return;
        };
        let names = |e: &Option<Error>| {
            e.as_ref()
                .is_some_and(|e| matches!(**e, Thrown::NotReady(Some(s)) if s == source))
        };
        let current = if names(&error) {
            error
        } else {
            self.nodes[el].error.clone()
        };
        self.nodes[el].error = Some(if names(&current) {
            current.unwrap()
        } else {
            error::not_ready(Some(source))
        });
    }

    // Solid: async.ts:149-162 (`walkDependents`; `forEachDependent`
    // 138-143 is its loop). `f` returns false to leave a node unmarked.
    fn walk_dependents(
        &mut self,
        el: NodeId,
        f: &mut dyn FnMut(&mut Runtime, NodeId, bool) -> bool,
    ) {
        let mut visited: Vec<NodeId> = vec![];
        self.walk_from(el, &mut visited, f);
    }
    fn walk_from(
        &mut self,
        el: NodeId,
        visited: &mut Vec<NodeId>,
        f: &mut dyn FnMut(&mut Runtime, NodeId, bool) -> bool,
    ) {
        let mut s = self.nodes[el].subs;
        while let Some(l) = s {
            let node = self.links[l].sub;
            // Solid: async.ts:154-160 (`visit`)
            let seen = visited.contains(&node);
            if f(self, node, seen) && !seen {
                visited.push(node);
                self.walk_from(node, visited, f);
            }
            s = self.links[l].next_sub;
        }
    }

    // Solid: async.ts:179-188
    pub(super) fn release_if_settled_unobserved(&mut self, node: NodeId) {
        let n = &self.nodes[node];
        if n.fn_.is_some()
            && n.config & CONFIG_AUTO_DISPOSE != 0
            && n.subs.is_none()
            && n.flags & REACTIVE_ZOMBIE == 0
            && n.status & STATUS_PENDING == 0
        {
            if n.flags & REACTIVE_IN_HEAP != 0 {
                self.nodes[node].flags |= REACTIVE_RELEASE_AFTER;
            } else {
                self.unobserved(node);
            }
        }
    }

    // Solid: async.ts:194-200
    fn release_settled_dependents(&mut self, el: NodeId) {
        let mut candidates: Vec<NodeId> = vec![];
        self.walk_dependents(el, &mut |rt, node, seen| {
            if !seen
                && rt.nodes[node].subs.is_none()
                && rt.nodes[node].config & CONFIG_AUTO_DISPOSE != 0
            {
                candidates.push(node);
            }
            true
        });
        for node in candidates {
            self.release_if_settled_unobserved(node);
        }
    }

    // Solid: async.ts:225-256 (no projection derive: `_fam` is undefined)
    pub(super) fn stage_error(&mut self, el: NodeId, error: Error, in_pass: bool) -> bool {
        let n = &self.nodes[el];
        if !(n.config & CONFIG_HELD != 0
            || (in_pass && n.flags & REACTIVE_STAGED_READ != 0 && self.running && n.fam.is_none()))
            || self.pass_lane.is_some()
        {
            return false;
        }
        self.clear_pending_sources(el);
        self.nodes[el].blocked = false;
        self.nodes[el].status &= STATUS_ERROR | STATUS_UNINITIALIZED;
        if self.nodes[el].status & STATUS_ERROR == 0 {
            self.set_pending_error(el, None, None);
        }
        let staged = if matches!(*error, Thrown::Status { .. }) {
            error
        } else {
            error::status_error(el, error)
        };
        self.nodes[el].pending = Some(Value::Undef);
        self.nodes[el].pending_err = Some(staged);
        self.nodes[el].config |= CONFIG_STAGED | CONFIG_STAGED_ERROR;
        self.settle_pending_source(el, el);
        self.schedule();
        true
    }

    // Solid: async.ts:258-267
    pub(super) fn settle_errored_dependents(&mut self, el: NodeId, error: Error) {
        let mut scheduled = false;
        let e = Some(error);
        self.walk_dependents(el, &mut |rt, node, seen| {
            if !seen && error::same(&rt.nodes[node].error, &e) {
                rt.enqueue_sub(node);
                scheduled = true;
            }
            true
        });
        if scheduled {
            self.schedule();
        }
    }

    // Solid: async.ts:273-406 (prod: the dev diagnostic is folded away)
    pub(super) fn settle_pending_source(&mut self, el: NodeId, source: NodeId) {
        self.tr(|| format!("P {} {}", self.label(el), self.label(source)));
        self.remove_pending_source(el, source);
        let mut scheduled = false;
        let mut released: Vec<NodeId> = vec![];
        self.walk_dependents(el, &mut |rt, node, seen| {
            if seen
                || (source != el && rt.retry_reaches(node, source))
                || !rt.remove_pending_source(node, source)
            {
                // `holdWorkHook` is installed (verdict.ts).
                if rt.nodes[node].config & CONFIG_VERDICT != 0 {
                    rt.enqueue_sub(node);
                } else {
                    rt.stage_mark(node, el);
                }
                return false;
            }
            rt.nodes[node].time = rt.clock;
            let remaining = rt.set_first(rt.nodes[node].pending_sources);
            let errored = rt.nodes[node].status & STATUS_ERROR != 0;
            if let Some(r) = remaining {
                if !errored {
                    rt.set_pending_error(node, Some(r), None);
                }
            } else {
                rt.nodes[node].status &= !STATUS_PENDING;
                if !errored {
                    rt.set_pending_error(node, None, None);
                }
                if rt.nodes[node].config & CONFIG_HELD != 0 {
                    let t = rt.tx_of(node);
                    rt.join_future(Some(t));
                }
                if rt.nodes[node].blocked {
                    rt.enqueue_sub(node);
                    scheduled = true;
                } else if let Some(f) = rt.nodes[node].fam {
                    // `storeParkHook` is installed: a derived store's derive
                    // settles its family (`familyStatus`, no status).
                    rt.family_status(f, 0, None);
                }
                rt.nodes[node].blocked = false;
                if rt.nodes[node].subs.is_none() && rt.nodes[node].config & CONFIG_AUTO_DISPOSE != 0
                {
                    released.push(node);
                }
                rt.stage_mark(node, el);
            }
            true
        });
        for node in released {
            self.release_if_settled_unobserved(node);
        }
        if scheduled {
            self.schedule();
        }
    }

    /// Interns a host flight by name: `flight(id)` of fuzz/solid.mjs.
    pub(super) fn flight_id(&mut self, name: &str) -> FlightId {
        if let Some(i) = self.flights.iter().position(|f| f.name == name) {
            return i;
        }
        self.flights.push(Flight {
            name: name.to_owned(),
            result: None,
            reactions: vec![],
        });
        self.flights.len() - 1
    }

    /// `promise.then(...)`: a settled promise queues the reaction now.
    pub(super) fn on_flight(&mut self, f: FlightId, r: Reaction) {
        if self.flights[f].result.is_some() {
            self.queue_reaction(f, r);
        } else {
            self.flights[f].reactions.push(r);
        }
    }

    fn queue_reaction(&mut self, f: FlightId, r: Reaction) {
        match r {
            Reaction::Memo(el, pass) => self.microtasks.push_back(Microtask::Landing(el, f, pass)),
            Reaction::Action(a) => {
                let input = match self.flights[f].result.clone().unwrap() {
                    Ok(v) => Resume::Value(v),
                    Err(e) => Resume::Error(e.message()),
                };
                self.actions[a].input = Some(input);
                self.microtasks.push_back(Microtask::Resume(a));
            }
        }
    }

    /// A host flight settles once (`resolve`/`reject` of its promise): its
    /// reactions are queued in registration order. A second settlement is
    /// a no-op, as for a JS promise. A rejection's `Error` is one object
    /// shared by every reaction.
    pub fn settle_flight_value(&mut self, flight: &str, result: Result<Value, String>) {
        let f = self.flight_id(flight);
        if self.flights[f].result.is_some() {
            return;
        }
        self.flights[f].result = Some(result.map_err(error::user));
        let reactions = std::mem::take(&mut self.flights[f].reactions);
        for r in reactions {
            self.queue_reaction(f, r);
        }
    }

    // Solid: async.ts:458-934. A promise result is a host flight (the
    // thenable arm, 850-915, and the shared tail 919-924): it settles in a
    // later microtask (`flight_reaction`). Any other object is probed for
    // `Symbol.asyncIterator` and `then` (a store proxy answers through its
    // traps) and returned. `pass`: a derive's `setter`/`onError`.
    pub(super) fn handle_async_result(
        &mut self,
        el: NodeId,
        result: Out,
        pass: Option<store::projection::ProjPass>,
    ) -> Result<Value, Error> {
        let flight = match result {
            Out::Flight(f) => f,
            Out::Value(v) => {
                if v.is_object() {
                    self.untrack(|rt| {
                        let iterator = rt.js_get(&v, &Key::Sym("asyncIterator"))?;
                        assert!(iterator.is_undef(), "an async iterable is not ported");
                        let then = rt.js_get(&v, &Key::name("then"))?;
                        assert!(
                            !matches!(then, Value::Func(_)),
                            "a thenable that is not a host flight is not ported"
                        );
                        Ok::<(), Error>(())
                    })?;
                }
                self.nodes[el].in_flight = None;
                // `holdWorkHook` is installed.
                self.nodes[el].config &= !CONFIG_ASYNC;
                self.nodes[el].loading = false;
                return Ok(v);
            }
        };
        let pass = pass.map(|p| {
            self.passes.push(p);
            self.passes.len() - 1
        });
        self.handle_async(el, &flight, pass)
    }

    // Solid: async.ts:493-532, 850-934 (the thenable arm and the shared tail)
    fn handle_async(
        &mut self,
        el: NodeId,
        flight: &str,
        pass: Option<usize>,
    ) -> Result<Value, Error> {
        // `untrack(() => isThenable(result))` (core.ts:1848-1874): a promise
        // has no traps.
        let f = self.flight_id(flight);
        self.nodes[el].x = true; // `ext(el)._inFlight`
        self.nodes[el].in_flight = Some(f);
        // `holdWorkHook` is installed (verdict.ts).
        if self.nodes[el].flags & REACTIVE_WINDOW == 0 {
            self.nodes[el].config |= CONFIG_ASYNC;
        }
        self.nodes[el].q = if self.question != 0 {
            self.question
        } else {
            MAINLINE_QUESTION
        };
        self.nodes[el].pending_sources = None;
        self.on_flight(f, Reaction::Memo(el, pass));
        // `liveLanded = false`: not landed synchronously.
        if self.nodes[el].loading {
            return Ok(self.nodes[el].value.clone());
        }
        Err(error::not_ready(self.context))
    }

    // Solid: async.ts:855-892, the reaction `handleAsync` registered.
    pub(super) fn flight_reaction(&mut self, el: NodeId, f: FlightId, pass: Option<usize>) {
        let pass = pass.map(|p| self.passes[p].clone());
        match self.flights[f].result.clone().expect("a settled flight") {
            Ok(v) => {
                // `flattenIfIterable(v, el)`: `v[Symbol.asyncIterator]` of
                // plain data (no traps) is undefined.
                if self.nodes[el].in_flight == Some(f)
                    && self.nodes[el].flags & REACTIVE_DISPOSED == 0
                {
                    assert!(
                        !matches!(v, Value::Proxy(_) | Value::Draft(_)),
                        "a flight answering a store proxy is not ported"
                    );
                }
                self.async_write(el, f, v, pass.as_ref());
                self.settle_autodispose(el);
            }
            Err(e) => {
                self.handle_error(el, f, e, pass.as_ref());
                self.settle_autodispose(el);
            }
        }
    }

    // Solid: async.ts:539-593 (`handleError`)
    fn handle_error(
        &mut self,
        el: NodeId,
        f: FlightId,
        error: Error,
        pass: Option<&store::projection::ProjPass>,
    ) {
        if self.nodes[el].in_flight != Some(f) {
            return;
        }
        let still_pending = error.is_not_ready();
        self.tr(|| format!("E {}", self.label(el)));
        if still_pending && self.nodes[el].loading {
            panic!("a NotReadyError rejection of a loading node (async.ts:562-571) is not ported");
        }
        if still_pending || !self.stage_error(el, error.clone(), false) {
            self.notify_status(
                el,
                if still_pending {
                    STATUS_PENDING
                } else {
                    STATUS_ERROR
                },
                Some(error.clone()),
            );
            if !still_pending {
                self.dispose_children(el, false, true);
            }
        }
        if still_pending {
            self.settle_pending_source(el, el);
        }
        self.nodes[el].time = self.clock;
        if !still_pending {
            self.release_settled_dependents(el);
        }
        if let Some(pass) = pass {
            self.projection_on_error(el, pass, error, still_pending);
        }
    }

    // Solid: async.ts:595-683 (`asyncWrite`; `then` is unset: no stream)
    fn async_write(
        &mut self,
        el: NodeId,
        f: FlightId,
        value: Value,
        pass: Option<&store::projection::ProjPass>,
    ) {
        if self.nodes[el].in_flight != Some(f) {
            return;
        }
        // `holdWorkHook` is installed: an uninitialized node lands anyway.
        if self.nodes[el].flags & REACTIVE_DIRTY != 0
            && self.nodes[el].status & STATUS_UNINITIALIZED == 0
        {
            return;
        }
        let carried = self
            .pending_nodes
            .iter()
            .any(|n| self.nodes[*n].pending.is_some());
        let was_uninitialized = self.nodes[el].status & STATUS_UNINITIALIZED != 0;
        self.tr(|| format!("W {}", self.label(el)));
        self.land_status(el, false);
        if let Some(pass) = pass {
            // The setter: the derive's `commit` (projection.ts:301-330).
            if let Err(error) = self.projection_commit(el, pass, value, true) {
                self.handle_error(el, f, error, Some(pass));
                return;
            }
            if self.nodes[el].config & CONFIG_HELD == 0 {
                self.nodes[el].shown_error = None;
                self.nodes[el].config &= !CONFIG_INPUTS_PUBLISHED;
            }
            if was_uninitialized {
                self.land_status(el, true);
            }
        } else {
            self.set_signal(el, value);
        }
        if self.nodes[el].pending.is_none() {
            self.nodes[el].loading = false;
            self.trim_stale_deps(el);
        }
        self.settle_pending_source(el, el);
        self.schedule();
        if !carried {
            self.flush_all();
        }
    }

    // Solid: async.ts:692-698
    fn settle_autodispose(&mut self, el: NodeId) -> bool {
        let n = &self.nodes[el];
        if n.config & CONFIG_AUTO_DISPOSE != 0 && n.subs.is_none() && n.status & STATUS_PENDING == 0
        {
            self.unobserved(el);
            return true;
        }
        false
    }

    // Solid: async.ts:936-943
    pub(super) fn clear_status(&mut self, el: NodeId, clear_uninitialized: bool) {
        if self.nodes[el].pending_sources.is_some() {
            self.clear_pending_sources(el);
        }
        if self.nodes[el].blocked {
            self.nodes[el].blocked = false;
        }
        let n = &mut self.nodes[el];
        n.status = if clear_uninitialized {
            0
        } else {
            n.status & STATUS_UNINITIALIZED
        };
        if self.nodes[el].error.is_some() {
            self.set_pending_error(el, None, None);
        }
        // `statusNotifierOf(el)`: effects only.
        if self.nodes[el].effect_type != 0 {
            self.notify_effect_status(el);
        }
    }

    // Solid: async.ts:970-978
    pub(super) fn land_status(&mut self, el: NodeId, clear_uninitialized: bool) {
        if let Some(s) = self.nodes[el].pending_sources {
            self.set_delete(s, el);
            if self.sets[s].size != 0 {
                self.nodes[el].blocked = false;
                if clear_uninitialized {
                    self.nodes[el].status = STATUS_PENDING;
                }
                let first = self.set_first(Some(s));
                self.set_pending_error(el, first, None);
                return;
            }
        }
        self.clear_status(el, clear_uninitialized);
    }

    // Solid: async.ts:980-1036
    pub(super) fn notify_status(&mut self, el: NodeId, status: u32, error: Option<Error>) {
        self.tr(|| format!("N {} {}", self.label(el), status));
        let mut error = error;
        if status == STATUS_ERROR {
            if let Some(e) = &error {
                if !matches!(**e, Thrown::Status { .. } | Thrown::NotReady(_)) {
                    error = Some(error::status_error(el, e.clone()));
                }
            }
        }
        let pending_source = if status == STATUS_PENDING {
            error.as_ref().and_then(|e| match **e {
                Thrown::NotReady(s) => s,
                _ => None,
            })
        } else {
            None
        };
        if let Some(ps) = pending_source {
            if self.nodes[el].status & STATUS_ERROR != 0 {
                self.nodes[el].shown_error = self.nodes[el].error.clone();
            }
            self.add_pending_source(el, ps);
        } else {
            self.clear_pending_sources(el);
        }
        let flags = self.nodes[el].status;
        self.nodes[el].status = status
            | if status == STATUS_ERROR {
                if flags & (STATUS_UNINITIALIZED | STATUS_NO_VALUE) != 0 {
                    STATUS_NO_VALUE
                } else {
                    0
                }
            } else if status == STATUS_PENDING && flags & STATUS_NO_VALUE != 0 {
                STATUS_UNINITIALIZED
            } else {
                flags & STATUS_UNINITIALIZED
            };
        if pending_source.is_some() {
            self.set_pending_error(el, pending_source, error.clone());
        } else {
            self.nodes[el].x = true; // `ext(el)._error`
            self.nodes[el].error = error.clone();
        }
        if self.guessing && status == STATUS_PENDING && self.nodes[el].config & CONFIG_GUESS != 0 {
            if self.pass_lane.is_none() {
                let t = if self.nodes[el].flags & REACTIVE_REASK != 0 {
                    None
                } else {
                    let t = self.tx_of(el);
                    self.txs[t].parent
                };
                self.join_future(t);
            }
            return;
        }
        if self.nodes[el].effect_type != 0 {
            self.notify_effect_status(el);
            return;
        }
        self.propagate_status(el, status, error);
    }

    // Solid: async.ts:1043-1143
    pub(super) fn propagate_status(&mut self, el: NodeId, status: u32, error: Option<Error>) {
        let pending_source = if status == STATUS_PENDING {
            error.as_ref().and_then(|e| match **e {
                Thrown::NotReady(s) => s,
                _ => None,
            })
        } else {
            None
        };
        let mut s = self.nodes[el].subs;
        while let Some(link) = s {
            let sub = self.links[link].sub;
            self.nodes[sub].time = self.clock;
            let config = self.nodes[sub].config;
            if config & CONFIG_REDERIVE != 0
                || ((config & CONFIG_VERDICT != 0
                    || (pending_source.is_some() && config & CONFIG_STAGED_ERROR != 0))
                    && !(pending_source.is_some() && self.hold_work(sub, el)))
                || (status == STATUS_PENDING && self.links[link].gen != self.nodes[sub].dep_gen)
            {
                if status != STATUS_PENDING {
                    self.remove_pending_source(sub, el);
                }
                self.enqueue_sub(sub);
                self.schedule();
                s = self.links[link].next_sub;
                continue;
            }
            if let Some(ps) = pending_source {
                if self.set_has(self.nodes[sub].pending_sources, ps) {
                    if self.pass_lane.is_none()
                        && self.nodes[sub].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                        && self.running
                        && !self.fresh_hook(sub, self.nodes[ps].time == self.clock)
                    {
                        let t = self.tx_of(sub);
                        self.join_future(Some(t));
                    }
                    s = self.links[link].next_sub;
                    continue;
                }
            }
            if pending_source.is_some()
                || (status != STATUS_PENDING
                    && (!error::same(&self.nodes[sub].error, &error)
                        || self.nodes[sub].pending_sources.is_some()))
            {
                // `laneStageHook` is installed (lanes.ts).
                if let Some(l) = self.pass_lane {
                    self.lane_stage(sub, l, true, Errored::Node(el));
                } else {
                    self.queue_pending_node(sub);
                    if status == STATUS_PENDING
                        && self.nodes[sub].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                        && self.nodes[sub].effect_type == 0
                    {
                        let t = self.tx_of(sub);
                        self.join_future(Some(t));
                    }
                }
                self.notify_status(sub, status, error.clone());
                // A derived store's derive: marked, not re-run — the family
                // walks its leaves' readers (store/projection.ts).
                if let Some(f) = self.nodes[sub].fam {
                    self.family_status(f, status, error.clone());
                }
            }
            s = self.links[link].next_sub;
        }
    }
}
