//! Solid: boundaries.ts — the display consumers between a frame reader and
//! the root: `createLoadingBoundary` (`<Loading>`) and `createErrorBoundary`
//! (`<Errored>`), and the boundary hooks the scheduler calls
//! (`installBoundaryHooks`, boundaries.ts:1078-1088).
//!
//! A boundary is an owner whose context names it (`BOUNDARY`: a node's
//! `boundary` field, inherited at creation), a `tree` (the content,
//! flattened) and an `output` that shows the tree or the fallback. The
//! output is a frame reader (CONFIG_REDERIVE): status reaching it from its
//! content re-derives it, and its pass decides.
//!
//! Constant here, and noted at each site:
//! - `on` (a Loading's re-arm: `arm`, `flip`, `armedOver` true, the arm
//!   lane, `reportOutsideHold`): plan v2.1 refuses `Loading on(…)`, so
//!   `_armed` is always false and `_lane`/`_armLane` always null;
//! - reveal order (reveal.ts): its hooks are installed (solid-js imports
//!   `createRevealOrder`), so a boundary's content context gets `REVEAL:
//!   null`, but no `<Reveal>` exists: every boundary's controller is null,
//!   `_reveal` is null and `_gated`/`_collapsed` are false;
//! - the dev and observe tiers (`__DEV__`, `__OBSERVE__`, `__TEST__`).
//!
//! `reportClientError` (error-hooks.ts:51-69) records the error in
//! `reported` and finds no hook (none is configured; the universal
//! renderer's root sets none): it returns there.
use super::*;

/// A boundary, by arena index (`Runtime::boundaries`).
pub type BoundaryId = usize;

/// A JS `Map<Computed, Computed>` (`_readers`): insertion order; `set` of a
/// present key keeps its place; an iteration skips entries deleted before
/// it reaches them and visits entries added during it (tombstones).
#[derive(Default, Clone)]
pub(super) struct JsMap {
    items: Vec<Option<(NodeId, NodeId)>>,
    size: usize,
}

impl JsMap {
    fn get(&self, k: NodeId) -> Option<NodeId> {
        self.items
            .iter()
            .flatten()
            .find(|(r, _)| *r == k)
            .map(|(_, s)| *s)
    }
    fn set(&mut self, k: NodeId, v: NodeId) {
        if let Some(e) = self.items.iter_mut().flatten().find(|(r, _)| *r == k) {
            e.1 = v;
            return;
        }
        self.items.push(Some((k, v)));
        self.size += 1;
    }
    fn delete(&mut self, k: NodeId) -> bool {
        match self
            .items
            .iter()
            .position(|x| x.is_some_and(|(r, _)| r == k))
        {
            Some(i) => {
                self.items[i] = None;
                self.size -= 1;
                true
            }
            None => false,
        }
    }
    fn at(&self, i: usize) -> Option<Option<(NodeId, NodeId)>> {
        self.items.get(i).copied()
    }
    fn entries(&self) -> Vec<(NodeId, NodeId)> {
        self.items.iter().flatten().copied().collect()
    }
    fn clear(&mut self) {
        self.items.clear();
        self.size = 0;
    }
}

/// boundaries.ts:167 `collecting`, a JS `Set` of boundaries (tombstones,
/// as `JsSet`).
#[derive(Default)]
pub(super) struct Collecting {
    items: Vec<Option<BoundaryId>>,
    size: usize,
}

impl Collecting {
    fn add(&mut self, b: BoundaryId) {
        if !self.items.contains(&Some(b)) {
            self.items.push(Some(b));
            self.size += 1;
        }
    }
    fn delete(&mut self, b: BoundaryId) {
        if let Some(i) = self.items.iter().position(|x| *x == Some(b)) {
            self.items[i] = None;
            self.size -= 1;
        }
    }
}

/// `b._show(b)`: the fallback's builder — Loading's `() => fallback()`,
/// Errored's `b => fallback(accessor(b._error), () => reset(b))`.
pub(super) type ShowFn = Rc<dyn Fn(&mut Runtime, BoundaryId) -> Result<Value, Error>>;

/// Solid: boundaries.ts:95-139 `Boundary`.
pub(super) struct Boundary {
    /// `_type`: STATUS_PENDING (loading) or STATUS_ERROR.
    ty: u32,
    parent: Option<BoundaryId>,
    owner: NodeId,
    tree: Option<NodeId>,
    /// Null during the output's first pass.
    output: Option<NodeId>,
    readers: JsMap,
    initialized: bool,
    /// `_armed`: always false (no `on`).
    armed: bool,
    fallback: bool,
    /// `_runs`: user effects (and render updates) held behind the fallback,
    /// a JS `Set`; null is `None`.
    runs: Option<Vec<NodeId>>,
    /// `_error`: the error signal of an error boundary.
    error: Option<NodeId>,
    show: ShowFn,
    /// `_fb`: the fallback's own computed while it shows.
    fb: Option<NodeId>,
}

/// `hiddenBy`'s answer: a boundary showing its fallback on the chain, or
/// (through a CONFIG_REDERIVE output) hidden with none to name, or not
/// hidden.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Hidden {
    No,
    By(BoundaryId),
    Yes,
}

impl Hidden {
    pub(super) fn truthy(self) -> bool {
        self != Hidden::No
    }
}

impl Runtime {
    /// `boundaryOf(node)` (boundaries.ts:169-170).
    fn boundary_of(&self, node: NodeId) -> Option<BoundaryId> {
        self.nodes[node].boundary
    }

    // Solid: boundaries.ts:174-175
    fn behind_error(&self, b: Option<BoundaryId>) -> bool {
        match b {
            None => false,
            Some(b) => {
                let x = &self.boundaries[b];
                (x.ty == STATUS_ERROR && x.fallback) || self.behind_error(x.parent)
            }
        }
    }

    // Solid: boundaries.ts:182-183
    fn is_collecting(&self, b: BoundaryId) -> bool {
        let x = &self.boundaries[b];
        x.ty == STATUS_ERROR || !x.initialized || x.armed || self.behind_error(x.parent)
    }

    // Solid: boundaries.ts:186-189
    fn record(&mut self, b: BoundaryId, node: NodeId, source: NodeId) {
        self.boundaries[b].readers.set(node, source);
        self.collecting.add(b);
    }

    // Solid: boundaries.ts:194-225
    fn caught(&mut self, b: BoundaryId, node: NodeId, error: Option<Error>) {
        let mut source = node;
        if self.boundaries[b].ty == STATUS_ERROR {
            // `error ??= node._x?._error`; `source = error?.source ?? node`.
            let error = error.or_else(|| self.nodes[node].error.clone());
            if let Some(Some(s)) = error.as_ref().and_then(|e| e.source()) {
                source = s;
            }
            if self.nodes[source].flags & REACTIVE_DISPOSED != 0 {
                source = node;
            }
            let caught = error.as_ref().map(error::unwrap_status_error);
            let signal = self.boundaries[b]
                .error
                .expect("an error boundary's signal");
            self.set_signal(signal, caught.clone().map_or(Value::Undef, Value::Error));
            // `reportClientError(caught, b._owner, source)`: recorded, and no
            // hook is configured on the owner chain (`hookFor(b._owner)`).
            let _owner = self.boundaries[b].owner;
            if let Some(e) = caught {
                if !self.reported.iter().any(|r| Rc::ptr_eq(r, &e)) {
                    self.reported.push(e);
                }
            }
        } else {
            self.boundaries[b].initialized = false;
        }
        self.record(b, node, source);
        // `if (b._armed) flip(b)`: never armed (no `on`).
        if !self.boundaries[b].fallback {
            self.redraw(b);
        }
        // Reveal: `b._reveal` is null.
    }

    // Solid: boundaries.ts:232-239 (`flip`) is reached only through `on`.

    // Solid: boundaries.ts:241-246
    pub(super) fn redraw(&mut self, b: BoundaryId) {
        if let Some(o) = self.boundaries[b].output {
            if self.nodes[o].flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE) == 0 {
                self.enqueue_sub(o);
                self.schedule();
            }
        }
    }

    /// `catchHook` (boundaries.ts:251-299): status from a frame reader,
    /// nearest boundary first. 0 false, 1 caught, CAUGHT_REARMED.
    pub(super) fn catch_status(&mut self, node: NodeId, flags: u32, error: Option<Error>) -> u32 {
        if flags == 0 {
            if self.collecting.size != 0 {
                let mut b = self.boundary_of(node);
                while let Some(x) = b {
                    let ty = self.boundaries[x].ty;
                    let kept = self.boundaries[x]
                        .readers
                        .get(node)
                        .is_some_and(|s| self.nodes[s].status & (ty | STATUS_PENDING) != 0);
                    if !kept
                        && self.boundaries[x].readers.delete(node)
                        && self.prune(x, Some(false)) == 0
                        && self.boundaries[x].fallback
                    {
                        self.redraw(x);
                    }
                    b = self.boundaries[x].parent;
                }
            }
            return 0;
        }
        let mut b = self.boundary_of(node);
        while let Some(x) = b {
            let ty = self.boundaries[x].ty;
            if ty & flags == 0 {
                if self.boundaries[x].fallback && ty > flags {
                    self.record(x, node, node);
                }
                b = self.boundaries[x].parent;
                continue;
            }
            if self.is_collecting(x) {
                self.caught(x, node, error);
                return if self.boundaries[x].armed {
                    CAUGHT_REARMED
                } else {
                    1
                };
            }
            self.record(x, node, node);
            b = self.boundaries[x].parent;
        }
        0
    }

    // Solid: boundaries.ts:303-306 (`on` never arms a boundary here: the
    // nearest collecting loading boundary's `_armed` is false)
    fn armed_over(&self, node: NodeId) -> bool {
        let mut b = self.boundary_of(node);
        while let Some(x) = b {
            if self.boundaries[x].ty & STATUS_PENDING != 0 && self.is_collecting(x) {
                return self.boundaries[x].armed;
            }
            b = self.boundaries[x].parent;
        }
        false
    }

    /// `freshHook` (boundaries.ts:1080-1085): 0 false, 1 true, CAUGHT_REARMED.
    pub(super) fn fresh_hook_value(&mut self, node: NodeId, held: bool) -> u32 {
        if held {
            return 0;
        }
        if self.nodes[node].status & STATUS_UNINITIALIZED != 0 {
            self.catch_status(node, STATUS_PENDING, None)
        } else {
            self.armed_over(node) as u32
        }
    }

    // Solid: boundaries.ts:1080-1085 (`freshHook`), as a truth value
    pub(super) fn fresh_hook(&mut self, node: NodeId, held: bool) -> bool {
        self.fresh_hook_value(node, held) != 0
    }

    /// `hiddenHook` (boundaries.ts:310-334): the nearest boundary on `r`'s
    /// chain showing its fallback; else, through a CONFIG_REDERIVE output,
    /// hidden when every reader it reaches is.
    pub(super) fn hidden_by(&self, r: NodeId, seen: &mut Option<Vec<NodeId>>) -> Hidden {
        let mut b = self.boundary_of(r);
        while let Some(x) = b {
            if self.boundaries[x].fallback {
                return Hidden::By(x);
            }
            b = self.boundaries[x].parent;
        }
        let mut h = Hidden::No;
        let mut s = self.nodes[r].subs;
        if seen.is_some() || self.nodes[r].config & CONFIG_REDERIVE != 0 {
            seen.get_or_insert_with(Vec::new);
            h = if self.nodes[r].effect_type != EFFECT_RENDER {
                Hidden::Yes
            } else {
                Hidden::No
            };
            while let Some(l) = s {
                let sub = self.links[l].sub;
                let set = seen.as_mut().unwrap();
                h = if set.contains(&sub) {
                    Hidden::Yes
                } else {
                    set.push(sub);
                    self.hidden_by(sub, seen)
                };
                if !h.truthy() {
                    break;
                }
                s = self.links[l].next_sub;
            }
        }
        h
    }

    /// `heldRunHook` (boundaries.ts:347-352).
    pub(super) fn held_run(&mut self, node: NodeId) -> bool {
        let Hidden::By(b) = self.hidden_by(node, &mut None) else {
            return false;
        };
        let runs = self.boundaries[b].runs.get_or_insert_with(Vec::new);
        if !runs.contains(&node) {
            runs.push(node);
        }
        true
    }

    // Solid: boundaries.ts:357-369
    fn release(&mut self, b: BoundaryId) {
        let Some(runs) = self.boundaries[b].runs.take() else {
            return;
        };
        for n in runs {
            let ty = self.nodes[n].effect_type;
            // EFFECT_TRACKED's `_run`: no op creates a tracked effect.
            let ty = if ty == EFFECT_TRACKED {
                EFFECT_USER
            } else {
                ty
            };
            let lane = self.pass_lane;
            self.enqueue(ty, QueueCallback::RunEffect(n), lane);
        }
    }

    // Solid: boundaries.ts:377-382
    fn caught_below(&self, b: BoundaryId, r: NodeId, s: NodeId) -> bool {
        if !(self.nodes[s].status & (STATUS_ERROR | STATUS_PENDING) != 0
            || self.nodes[r].status & STATUS_ERROR != 0)
        {
            let mut l = self.boundary_of(r);
            while let Some(x) = l {
                if x == b {
                    break;
                }
                if self.boundaries[x].ty & STATUS_PENDING != 0 && self.is_collecting(x) {
                    let o = self.boundaries[x].output.expect("a boundary's output");
                    return self.nodes[o].config & CONFIG_HELD == 0;
                }
                l = self.boundaries[x].parent;
            }
        }
        false
    }

    // Solid: boundaries.ts:388-392
    fn reads(&self, n: NodeId, s: NodeId, seen: &mut Option<Vec<NodeId>>) -> bool {
        let mut l = self.nodes[n].deps;
        while let Some(link) = l {
            let h = self.links[link].dep;
            if h == s {
                return true;
            }
            let set = seen.get_or_insert_with(Vec::new);
            if !set.contains(&h) {
                set.push(h);
                if self.reads(h, s, seen) {
                    return true;
                }
            }
            l = self.links[link].next_dep;
        }
        false
    }

    /// `prune(b, pass)` (boundaries.ts:417-460): `pass` is `None` (absent),
    /// `Some(true)`, or `Some(false)` for `0`.
    pub(super) fn prune(&mut self, b: BoundaryId, pass: Option<bool>) -> usize {
        let mask = self.boundaries[b].ty | STATUS_PENDING;
        let mut i = 0;
        while let Some(entry) = self.boundaries[b].readers.at(i) {
            i += 1;
            let Some((r, s)) = entry else { continue };
            if (self.nodes[r].flags | self.nodes[s].flags) & REACTIVE_DISPOSED == 0 {
                let keep = ((self.nodes[r].status & mask != 0
                    || (self.nodes[s].status & mask != 0 && self.reads(r, s, &mut None)))
                    && !(mask & STATUS_ERROR != 0 && self.caught_below(b, r, s)))
                    || (mask & STATUS_ERROR != 0
                        && self.nodes[s].config & CONFIG_STAGED_ERROR != 0)
                    || (self.nodes[r].config & CONFIG_VERDICT != 0
                        && self.nodes[r].flags & REACTIVE_IN_HEAP != 0);
                if keep {
                    if pass == Some(false) {
                        break;
                    }
                    continue;
                }
                let tree = self.boundaries[b].tree;
                if (Some(s) != tree || self.boundaries[b].armed)
                    && self.nodes[s].config & (CONFIG_HELD | CONFIG_OVERRIDE) == CONFIG_HELD
                {
                    if pass != Some(true) || !self.boundaries[b].initialized {
                        continue;
                    }
                    let t = self.tx_of(s);
                    self.join_future(Some(t));
                }
            }
            self.boundaries[b].readers.delete(r);
        }
        self.boundaries[b].readers.size
    }

    // Solid: boundaries.ts:465-475 (`ready`) is reveal.ts's: no reveal
    // order exists here.

    /// `boundarySeamHook` (boundaries.ts:480-539): at the seam's end.
    pub(super) fn boundary_seam(&mut self) {
        let mut i = 0;
        while let Some(entry) = self.collecting.items.get(i).copied() {
            i += 1;
            let Some(b) = entry else { continue };
            let o = self.boundaries[b]
                .output
                .expect("a collecting boundary has its output");
            let flags = self.nodes[o].flags;
            if flags & REACTIVE_DISPOSED != 0 {
                self.collecting.delete(b);
                continue;
            }
            if flags & REACTIVE_ZOMBIE != 0 {
                continue;
            }
            if !self.boundaries[b].initialized {
                let mut j = 0;
                while let Some(e) = self.boundaries[b].readers.at(j) {
                    j += 1;
                    let Some((r, _)) = e else { continue };
                    let ns: Vec<NodeId> = if self.nodes[r].status & STATUS_PENDING != 0 {
                        match self.nodes[r].pending_sources {
                            Some(ps) => self.set_values(ps),
                            None => vec![],
                        }
                    } else {
                        vec![r]
                    };
                    for n in ns {
                        if self.nodes[n].config & CONFIG_HELD != 0 {
                            continue;
                        }
                        let mut d = self.nodes[n].deps;
                        while let Some(l) = d {
                            let h = self.links[l].dep;
                            if self.nodes[h].config & CONFIG_HELD != 0 && {
                                n == r || {
                                    let t = self.tx_of(h);
                                    self.txs[t].open == 0
                                }
                            } {
                                self.record(b, h, h);
                            }
                            d = self.links[l].next_dep;
                        }
                    }
                }
            }
            self.prune(b, None);
            let o = self.boundaries[b].output.expect("output");
            if self.boundaries[b].ty & STATUS_PENDING != 0
                && !self.boundaries[b].initialized
                && self.nodes[o].config & CONFIG_HELD != 0
            {
                let to = self.tx_of(o);
                let all = self.boundaries[b]
                    .readers
                    .entries()
                    .into_iter()
                    .all(|(_, s)| {
                        self.nodes[s].status & STATUS_PENDING == 0
                            && self.nodes[s].config & CONFIG_HELD != 0
                            && self.tx_of(s) == to
                    });
                if all {
                    self.boundaries[b].readers.clear();
                    self.boundaries[b].initialized = true;
                }
            }
            self.boundaries[b].armed = false;
            if self.boundaries[b].readers.size == 0 {
                self.collecting.delete(b);
                if self.boundaries[b].fallback {
                    self.redraw(b);
                }
            }
        }
    }

    // Solid: boundaries.ts:698-930 (`createBoundary`; no `on`, no reveal
    // controller, prod)
    fn create_boundary(&mut self, ty: u32, f: Getter, show: ShowFn) -> NodeId {
        let owner = self.create_owner();
        let b = self.boundaries.len();
        let error = (ty == STATUS_ERROR).then(|| {
            // `signal(undefined, { ownedWrite: true, _noSnapshot: true })`
            let s = self.signal_node(Value::Undef);
            self.nodes[s].config |= CONFIG_OWNED_WRITE | CONFIG_NO_SNAPSHOT;
            s
        });
        self.boundaries.push(Boundary {
            ty,
            parent: self.boundary_of(owner),
            owner,
            tree: None,
            output: None,
            readers: JsMap::default(),
            initialized: ty == STATUS_ERROR,
            armed: false,
            fallback: false,
            runs: None,
            error,
            show,
            fb: None,
        });
        // `if (getOwner()) cleanup(() => { collecting.delete(b); … })`
        if let Some(o) = self.context {
            self.cleanup(
                Box::new(move |rt: &mut Runtime| rt.collecting.delete(b)),
                Some(o),
            );
        }
        // The context names the boundary; `REVEAL: null` (reveal hooks are
        // installed).
        self.nodes[owner].boundary = Some(b);
        let tree = self.with_owner(Some(owner), |rt| {
            let c = rt.computed(
                Rc::new(move |rt: &mut Runtime, _| f(rt).map(Out::Value)),
                None,
            );
            rt.computed(
                Rc::new(move |rt: &mut Runtime, _| {
                    let v = rt.read_node(c)?;
                    rt.flatten(v, FlattenOptions::default()).map(Out::Value)
                }),
                None,
            )
        });
        self.boundaries[b].tree = Some(tree);
        // `computed(…, { _noSnapshot: true })`.
        let output = self.computed_node(
            Body::User(Rc::new(move |rt: &mut Runtime, _| {
                rt.output_pass(b).map(Out::Value)
            })),
            None,
            CONFIG_NO_SNAPSHOT,
        );
        self.nodes[output].config |= CONFIG_REDERIVE;
        self.nodes[tree].config |= CONFIG_FRAME;
        self.boundaries[b].output = Some(output);
        output
    }

    // Solid: boundaries.ts:668-673 (`reset`): re-run what threw, then
    // schedule.
    fn reset(&mut self, b: BoundaryId) {
        // A snapshot of the sources (`new Set(b._readers.values())`).
        let mut sources: Vec<NodeId> = vec![];
        for (_, s) in self.boundaries[b].readers.entries() {
            if !sources.contains(&s) {
                sources.push(s);
            }
        }
        for r in sources {
            if self.nodes[r].fn_.is_some() && self.nodes[r].flags & REACTIVE_DISPOSED == 0 {
                self.recompute(r, false);
            }
        }
        self.schedule();
    }

    // Solid: boundaries.ts:787-924 (the output's pass)
    fn output_pass(&mut self, b: BoundaryId) -> Result<Value, Error> {
        let this = self.context.expect("the output's pass");
        let ty = self.boundaries[b].ty;
        let tree = self.boundaries[b].tree.expect("tree");
        if !self.boundaries[b].armed && self.nodes[this].config & CONFIG_HELD == 0 {
            self.nodes[this].config |= CONFIG_FRAME;
        }
        // `b._gated`: no reveal order.
        let status = self.nodes[tree].status & (STATUS_PENDING | STATUS_ERROR);
        if status != 0 {
            self.link(tree, this);
            if status & ty != 0 {
                if self.is_collecting(b) {
                    self.caught(b, tree, None);
                    return self.show_fallback(b);
                }
                self.record(b, tree, tree);
            }
            return Err(self.nodes[tree]
                .error
                .clone()
                .expect("a pending or errored tree carries its error"));
        }
        if self.is_collecting(b) {
            if self.boundaries[b].readers.size != 0
                && self.nodes[this].status & STATUS_UNINITIALIZED != 0
                && self.nodes[this].config & CONFIG_HELD == 0
            {
                return self.show_fallback(b);
            }
            if self.prune(b, Some(true)) != 0 {
                return self.show_fallback(b);
            }
        }
        let value = match self.read_node(tree) {
            Ok(v) => v,
            Err(e) => {
                if if e.is_not_ready() {
                    ty == STATUS_PENDING
                } else {
                    ty == STATUS_ERROR
                } {
                    if self.is_collecting(b) {
                        self.caught(b, tree, Some(e));
                        return self.show_fallback(b);
                    }
                    self.record(b, tree, tree);
                }
                return Err(e);
            }
        };
        if self.is_collecting(b) && self.boundaries[b].readers.size != 0 {
            return self.show_fallback(b);
        }
        self.boundaries[b].initialized = true;
        self.boundaries[b].fallback = false;
        if let Some(fb) = self.boundaries[b].fb {
            let output = self.boundaries[b].output.expect("output");
            if self.nodes[output].value != self.nodes[fb].value {
                self.drop_fallback(b, fb);
            } else {
                let lane = self.pass_lane;
                self.enqueue(EFFECT_RENDER, QueueCallback::DropFallback(b, fb), lane);
            }
        }
        self.release(b);
        // Reveal: `b._reveal` is null.
        Ok(value)
    }

    /// The output's `drop` closure (boundaries.ts:898-907), over the
    /// fallback computed it was made for.
    pub(super) fn drop_fallback(&mut self, b: BoundaryId, fb: NodeId) {
        if !self.boundaries[b].fallback && self.boundaries[b].fb == Some(fb) {
            if self.nodes[fb].status & STATUS_ERROR != 0 {
                self.schedule();
            }
            self.dispose(fb);
            self.boundaries[b].fb = None;
        }
    }

    // Solid: boundaries.ts:932-992 (`fallback`; `b._lane` is null: no `on`)
    fn show_fallback(&mut self, b: BoundaryId) -> Result<Value, Error> {
        let out = self.context.expect("the output's pass");
        self.boundaries[b].fallback = true;
        if self.boundaries[b].fb.is_none() {
            // `runWithOwner(out._parent, () => computed(() => b._show(b), { id:
            // out.id, lazy: 1 }))`: ids are not ported.
            let parent = self.nodes[out].parent;
            let fb = self.with_owner(parent, |rt| {
                let show = rt.boundaries[b].show.clone();
                rt.computed_lazy(Rc::new(move |rt: &mut Runtime, _| {
                    show(rt, b).map(Out::Value)
                }))
            });
            self.boundaries[b].fb = Some(fb);
        }
        let p = self.pass_lane;
        let f = self.nodes[out].flags;
        let fb = self.boundaries[b].fb.expect("fb");
        let v = self.read_node(fb);
        self.pass_lane = p;
        let now = self.nodes[out].flags;
        self.nodes[out].flags ^= (now ^ f) & (REACTIVE_PROBED | REACTIVE_LANE_READ);
        v
    }

    /// `createLoadingBoundary(fn, fallback)` (boundaries.ts:1038-1044): its
    /// output node (the accessor's node).
    pub fn loading_boundary(&mut self, f: Getter, fallback: Getter) -> NodeId {
        self.create_boundary(
            STATUS_PENDING,
            f,
            Rc::new(move |rt: &mut Runtime, _| fallback(rt)),
        )
    }

    /// `createLoadingBoundary(fn, fallback)`: its accessor.
    pub(super) fn create_loading_boundary(&mut self, f: Getter, fallback: Getter) -> Value {
        let o = self.loading_boundary(f, fallback);
        self.accessor(o)
    }

    /// `createErrorBoundary(fn, fallback)` (boundaries.ts:1069-1074): the
    /// fallback is called with the error's accessor and `() => reset(b)`; its
    /// output node.
    pub fn error_boundary(&mut self, f: Getter, fallback: Value) -> NodeId {
        self.create_boundary(
            STATUS_ERROR,
            f,
            Rc::new(move |rt: &mut Runtime, b| {
                let signal = rt.boundaries[b].error.expect("an error boundary's signal");
                let err = rt.accessor(signal);
                let reset = rt.function(
                    0,
                    Rc::new(move |rt: &mut Runtime, _: &[Value]| {
                        rt.reset(b);
                        Ok(Value::Undef)
                    }),
                );
                // Errored's fallback (flow.ts:446-460): a function fallback is
                // called here, whatever its arity.
                if matches!(fallback, Value::Func(_)) {
                    rt.call(&fallback, &[err, reset])
                } else {
                    Ok(fallback.clone())
                }
            }),
        )
    }

    /// `createErrorBoundary(fn, fallback)`: its accessor.
    pub(super) fn create_error_boundary(&mut self, f: Getter, fallback: Value) -> Value {
        let o = self.error_boundary(f, fallback);
        self.accessor(o)
    }
}
