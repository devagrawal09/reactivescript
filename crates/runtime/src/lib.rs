//! Single-threaded reactive graph. Explicit flush is the host's microtask boundary.
pub mod plan;
pub mod plan_v2;
pub mod renderer;
pub mod scenario;
pub mod slice1;
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
    rc::{Rc, Weak},
};

pub type NodeId = usize;
pub type OwnerId = usize;
pub type FlightId = String;
pub type Cleanup = Box<dyn FnOnce()>;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadError {
    Pending,
    Failed(String),
    Disposed,
}
pub type ReadResult<T> = Result<T, ReadError>;
#[derive(Clone, Debug)]
pub enum Computation<T> {
    Ready(T),
    Await(FlightId),
}
pub type Compute<T> = Rc<dyn Fn(&Runtime<T>, Option<T>) -> ReadResult<Computation<T>>>;
pub type Apply<T> = Rc<dyn Fn(T, Option<T>) -> Option<Cleanup>>;
pub type Equals<T> = Rc<dyn Fn(&T, &T) -> bool>;
pub type ErrorHandler = Rc<dyn Fn(String)>;
#[derive(Clone)]
pub struct MemoOptions<T> {
    pub lazy: bool,
    pub equals: Option<Equals<T>>,
    pub loading_value: Option<T>,
}
impl<T> Default for MemoOptions<T> {
    fn default() -> Self {
        Self {
            lazy: false,
            equals: None,
            loading_value: None,
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EffectKind {
    Render,
    User,
}
#[derive(Clone)]
pub struct Runtime<T>(Rc<RefCell<State<T>>>);
#[derive(Clone)]
pub struct Signal<T> {
    runtime: Weak<RefCell<State<T>>>,
    id: NodeId,
}
impl<T: Clone + PartialEq + 'static> Signal<T> {
    pub fn id(&self) -> NodeId {
        self.id
    }
    pub fn get(&self) -> ReadResult<T> {
        Runtime(self.runtime.upgrade().ok_or(ReadError::Disposed)?).read(self.id)
    }
    pub fn set(&self, value: T) {
        if let Some(r) = self.runtime.upgrade() {
            Runtime(r).write(self.id, value);
        }
    }
}
struct Owner {
    parent: Option<OwnerId>,
    children: Vec<OwnerId>,
    node: Option<NodeId>,
    cleanups: Vec<Cleanup>,
    error: Option<ErrorHandler>,
    disposed: bool,
}
struct Node<T> {
    value: Option<T>,
    error: Option<ReadError>,
    shown_error: Option<String>,
    compute: Option<Compute<T>>,
    equals: Equals<T>,
    deps: Vec<(NodeId, u64, u64)>,
    subs: Vec<NodeId>,
    revision: u64,
    status_revision: u64,
    propagated: bool,
    height: usize,
    initialized: bool,
    dirty: bool,
    running: bool,
    lazy: bool,
    refresh_watched: bool,
    pulled_before_flush: bool,
    disposed: bool,
    owner: OwnerId,
    kind: Option<EffectKind>,
    apply: Option<Apply<T>>,
    error_handler: Option<ErrorHandler>,
    applied: Option<T>,
    modified: bool,
    apply_cleanup: Option<Cleanup>,
    flight: Option<FlightId>,
    optimistic: bool,
    loading_seed: bool,
    held: Option<usize>,
}
struct Transaction<T> {
    parent: usize,
    open: usize,
    writes: BTreeMap<NodeId, T>,
    guesses: BTreeMap<NodeId, T>,
}
pub enum ActionStep {
    Yield(FlightId),
    Done,
    Fail(String),
}
pub type ActionBody<T> = Box<dyn FnMut(&Runtime<T>, ReadResult<Option<T>>) -> ActionStep>;
struct Action<T> {
    tx: usize,
    body: Option<ActionBody<T>>,
    waiting: Option<FlightId>,
    done: bool,
}
struct State<T> {
    nodes: Vec<Rc<RefCell<Node<T>>>>,
    owners: Vec<Owner>,
    owner: Option<OwnerId>,
    observer: Option<NodeId>,
    reads: Vec<NodeId>,
    flushing: bool,
    writes: BTreeMap<NodeId, T>,
    queue: VecDeque<NodeId>,
    queued: BTreeMap<NodeId, bool>,
    effects: Vec<NodeId>,
    flights: BTreeMap<FlightId, ReadResult<T>>,
    memo_ready: VecDeque<(NodeId, FlightId)>,
    transactions: Vec<Transaction<T>>,
    actions: Vec<Action<T>>,
    active_tx: Option<usize>,
    tick_tx: Option<usize>,
    ready: VecDeque<(usize, ReadResult<Option<T>>)>,
    pub_errors: Vec<String>,
    action_results: Vec<(usize, Result<(), String>)>,
}
impl<T: Clone + PartialEq + 'static> Default for Runtime<T> {
    fn default() -> Self {
        Self::new()
    }
}
impl<T: Clone + PartialEq + 'static> Runtime<T> {
    pub fn new() -> Self {
        Self(Rc::new(RefCell::new(State {
            nodes: vec![],
            owners: vec![],
            owner: None,
            observer: None,
            reads: vec![],
            flushing: false,
            writes: BTreeMap::new(),
            queue: VecDeque::new(),
            queued: BTreeMap::new(),
            effects: vec![],
            flights: BTreeMap::new(),
            memo_ready: VecDeque::new(),
            transactions: vec![],
            actions: vec![],
            active_tx: None,
            tick_tx: None,
            ready: VecDeque::new(),
            pub_errors: vec![],
            action_results: vec![],
        })))
    }
    fn node(&self, id: NodeId) -> Rc<RefCell<Node<T>>> {
        self.0.borrow().nodes[id].clone()
    }
    pub fn create_owner(&self, parent: Option<OwnerId>, error: Option<ErrorHandler>) -> OwnerId {
        let mut s = self.0.borrow_mut();
        let id = s.owners.len();
        s.owners.push(Owner {
            parent,
            children: vec![],
            node: None,
            cleanups: vec![],
            error,
            disposed: false,
        });
        if let Some(p) = parent {
            s.owners[p].children.push(id);
        }
        id
    }
    pub fn current_owner(&self) -> Option<OwnerId> {
        self.0.borrow().owner
    }
    pub fn with_owner<R>(&self, owner: OwnerId, f: impl FnOnce() -> R) -> R {
        let old = self.0.borrow_mut().owner.replace(owner);
        let result = f();
        self.0.borrow_mut().owner = old;
        result
    }
    pub fn on_cleanup(&self, f: impl FnOnce() + 'static) {
        let mut s = self.0.borrow_mut();
        if let Some(o) = s.owner {
            s.owners[o].cleanups.push(Box::new(f));
        }
    }
    fn clear_owner(&self, id: OwnerId) {
        let (children, cleanups) = {
            let mut s = self.0.borrow_mut();
            (
                std::mem::take(&mut s.owners[id].children),
                std::mem::take(&mut s.owners[id].cleanups),
            )
        };
        for c in children.into_iter().rev() {
            self.dispose(c)
        }
        for c in cleanups.into_iter().rev() {
            c()
        }
    }
    pub fn dispose(&self, id: OwnerId) {
        let node = {
            let mut s = self.0.borrow_mut();
            if s.owners[id].disposed {
                return;
            }
            s.owners[id].disposed = true;
            s.owners[id].node
        };
        self.clear_owner(id);
        if let Some(n) = node {
            let cell = self.node(n);
            let (cleanup, deps) = {
                let mut node = cell.borrow_mut();
                // Plain sources are not tied to an owner lifetime in Solid.
                if node.compute.is_none() && node.kind.is_none() {
                    return;
                }
                node.disposed = true;
                node.compute = None;
                node.apply = None;
                (node.apply_cleanup.take(), std::mem::take(&mut node.deps))
            };
            for (d, _, _) in deps {
                self.node(d).borrow_mut().subs.retain(|x| *x != n);
            }
            if let Some(c) = cleanup {
                c()
            }
        }
    }
    fn add_node(
        &self,
        value: Option<T>,
        compute: Option<Compute<T>>,
        options: MemoOptions<T>,
        optimistic: bool,
    ) -> NodeId {
        let owner = self.create_owner(self.current_owner(), None);
        let mut s = self.0.borrow_mut();
        let id = s.nodes.len();
        s.owners[owner].node = Some(id);
        let initialized = compute.is_none();
        let loading_seed = options.loading_value.is_some();
        s.nodes.push(Rc::new(RefCell::new(Node {
            value: value.or(options.loading_value),
            error: None,
            shown_error: None,
            compute,
            equals: options.equals.unwrap_or_else(|| Rc::new(|a, b| a == b)),
            deps: vec![],
            subs: vec![],
            revision: 0,
            status_revision: 0,
            propagated: false,
            height: 0,
            initialized,
            dirty: !initialized,
            running: false,
            lazy: options.lazy,
            refresh_watched: false,
            pulled_before_flush: false,
            disposed: false,
            owner,
            kind: None,
            apply: None,
            error_handler: None,
            applied: None,
            modified: false,
            apply_cleanup: None,
            flight: None,
            optimistic,
            loading_seed,
            held: None,
        })));
        id
    }
    pub fn signal(&self, value: T) -> Signal<T> {
        self.signal_with(value, None, false)
    }
    pub fn signal_with(&self, value: T, equals: Option<Equals<T>>, optimistic: bool) -> Signal<T> {
        let id = self.add_node(
            Some(value),
            None,
            MemoOptions {
                equals,
                ..Default::default()
            },
            optimistic,
        );
        Signal {
            runtime: Rc::downgrade(&self.0),
            id,
        }
    }
    pub fn memo(&self, compute: Compute<T>, options: MemoOptions<T>) -> NodeId {
        let lazy = options.lazy;
        let id = self.add_node(None, Some(compute), options, false);
        if !lazy {
            self.update(id)
        }
        id
    }
    pub fn effect(
        &self,
        compute: Compute<T>,
        apply: Apply<T>,
        kind: EffectKind,
        error: Option<ErrorHandler>,
        defer: bool,
    ) -> NodeId {
        let id = self.add_node(None, Some(compute), MemoOptions::default(), false);
        {
            let c = self.node(id);
            let mut n = c.borrow_mut();
            n.kind = Some(kind);
            n.apply = Some(apply);
            n.error_handler = error;
            n.equals = Rc::new(|_, _| false);
        }
        self.update(id);
        if defer {
            let c = self.node(id);
            let mut n = c.borrow_mut();
            n.modified = false;
        } else if kind == EffectKind::Render {
            self.apply(id)
        }
        id
    }
    pub fn untrack<R>(&self, f: impl FnOnce() -> R) -> R {
        let old = self.0.borrow_mut().observer.take();
        let v = f();
        self.0.borrow_mut().observer = old;
        v
    }
    pub fn read(&self, id: NodeId) -> ReadResult<T> {
        let pull = {
            let s = self.0.borrow();
            s.observer.is_some() && !s.flushing && s.queued.get(&id) == Some(&true)
        };
        if pull {
            let c = self.node(id);
            let mut n = c.borrow_mut();
            if !n.pulled_before_flush {
                n.dirty = true;
                n.pulled_before_flush = true;
            }
        }
        if self.0.borrow().observer.is_some() {
            let c = self.node(id);
            let retry = {
                let n = c.borrow();
                n.loading_seed && matches!(n.error, Some(ReadError::Failed(_)))
            };
            if retry {
                c.borrow_mut().dirty = true;
            }
        }
        self.update(id);
        let observer = self.0.borrow().observer;
        if observer.is_some() {
            self.0.borrow_mut().reads.push(id)
        }
        let c = self.node(id);
        let n = c.borrow();
        if n.disposed {
            return Err(ReadError::Disposed);
        }
        if observer.is_none() {
            if let Some(e) = &n.shown_error {
                return Err(ReadError::Failed(e.clone()));
            }
        }
        if let Some(e) = &n.error {
            if observer.is_some() || !matches!(e, ReadError::Pending) {
                return Err(e.clone());
            }
        }
        n.value
            .clone()
            .ok_or_else(|| n.error.clone().unwrap_or(ReadError::Pending))
    }
    pub fn latest(&self, id: NodeId) -> ReadResult<T> {
        self.update(id);
        let c = self.node(id);
        let n = c.borrow();
        if let Some(t) = n.held {
            let t = self.tx_root(t);
            if let Some(v) = self.0.borrow().transactions[t].writes.get(&id) {
                return Ok(v.clone());
            }
        }
        if let Some(ReadError::Failed(e)) = &n.error {
            return Err(ReadError::Failed(e.clone()));
        }
        n.value.clone().ok_or(ReadError::Pending)
    }
    pub fn is_pending(&self, id: NodeId) -> bool {
        self.update(id);
        let c = self.node(id);
        let n = c.borrow();
        n.value.is_some() && (n.held.is_some() || n.error == Some(ReadError::Pending))
    }
    pub fn is_loading(&self, id: NodeId) -> bool {
        self.update(id);
        let c = self.node(id);
        let n = c.borrow();
        n.value.is_none() && n.error == Some(ReadError::Pending)
    }
    fn enqueue(&self, id: NodeId, force: bool) {
        if force {
            self.node(id).borrow_mut().pulled_before_flush = false;
        }
        if force && self.0.borrow().flushing {
            self.node(id).borrow_mut().dirty = true;
        }
        let mut s = self.0.borrow_mut();
        if let Some(old) = s.queued.get_mut(&id) {
            *old |= force;
        } else {
            s.queue.push_back(id);
            s.queued.insert(id, force);
        }
    }
    fn notify(&self, id: NodeId, force: bool) {
        let subs = self.node(id).borrow().subs.clone();
        for sub in subs {
            self.enqueue(sub, force)
        }
    }
    pub fn write(&self, id: NodeId, value: T) {
        let c = self.node(id);
        let previous = self
            .0
            .borrow()
            .writes
            .get(&id)
            .cloned()
            .or_else(|| c.borrow().value.clone());
        if previous
            .as_ref()
            .is_some_and(|p| (c.borrow().equals)(p, &value))
        {
            return;
        }
        self.0.borrow_mut().writes.insert(id, value);
        self.notify(id, true);
    }
    pub fn refresh(&self, id: NodeId) {
        self.node(id).borrow_mut().refresh_watched = true;
        self.enqueue(id, true)
    }
    fn deps_now(&self, deps: &[(NodeId, u64, u64)]) -> Vec<(NodeId, u64, u64)> {
        deps.iter()
            .map(|(d, _, _)| {
                let c = self.node(*d);
                let n = c.borrow();
                (*d, n.revision, n.status_revision)
            })
            .collect()
    }
    fn update(&self, id: NodeId) {
        let c = self.node(id);
        let (deps, dirty, init, skip) = {
            let n = c.borrow();
            (
                n.deps.clone(),
                n.dirty,
                n.initialized,
                n.disposed || n.running || n.compute.is_none(),
            )
        };
        if skip {
            return;
        }
        for (d, _, _) in &deps {
            self.update(*d)
        }
        let current = self.deps_now(&deps);
        if !dirty && init && deps == current {
            return;
        }
        let value_changed = deps.iter().zip(&current).any(|(a, b)| a.1 != b.1);
        let dependency_error = deps
            .iter()
            .find_map(|(d, _, _)| self.node(*d).borrow().error.clone());
        if init && !dirty && !value_changed {
            if let Some(e) = dependency_error {
                c.borrow_mut().deps = current;
                c.borrow_mut().propagated = true;
                self.publish(id, Err(e));
                return;
            }
            if c.borrow().propagated {
                let value = c.borrow().value.clone();
                {
                    let mut n = c.borrow_mut();
                    n.deps = current;
                    n.propagated = false;
                }
                if value.is_some() {
                    {
                        let mut n = c.borrow_mut();
                        n.error = None;
                        n.status_revision += 1;
                    }
                    self.notify(id, false);
                }
                return;
            }
        }
        let (compute, previous, owner, old_flight) = {
            let mut n = c.borrow_mut();
            n.running = true;
            n.dirty = false;
            n.propagated = false;
            (
                n.compute.clone().unwrap(),
                n.value.clone(),
                n.owner,
                n.flight.clone(),
            )
        };
        self.clear_owner(owner);
        let (old_owner, old_observer, old_reads) = {
            let mut s = self.0.borrow_mut();
            (
                s.owner.replace(owner),
                s.observer.replace(id),
                std::mem::take(&mut s.reads),
            )
        };
        let result = compute(self, previous.clone());
        let reads = {
            let mut s = self.0.borrow_mut();
            s.owner = old_owner;
            s.observer = old_observer;
            std::mem::replace(&mut s.reads, old_reads)
        };
        let mut new_deps = vec![];
        for d in reads {
            if !new_deps.iter().any(|(x, _, _)| *x == d) {
                let node = self.node(d);
                let mut n = node.borrow_mut();
                if !n.subs.contains(&id) {
                    n.subs.push(id)
                }
                new_deps.push((d, n.revision, n.status_revision));
            }
        }
        for (d, _, _) in deps {
            if !new_deps.iter().any(|(x, _, _)| *x == d) {
                self.node(d).borrow_mut().subs.retain(|x| *x != id)
            }
        }
        {
            let mut n = c.borrow_mut();
            n.running = false;
            n.initialized = true;
            n.height = new_deps
                .iter()
                .filter_map(|(d, _, _)| {
                    let c = self.node(*d);
                    let dep = c.borrow();
                    dep.compute.as_ref().map(|_| dep.height + 1)
                })
                .max()
                .unwrap_or(0)
                .max(n.height);
            n.deps = new_deps;
            n.flight = None;
        }
        match result {
            Ok(Computation::Ready(v)) => self.publish(id, Ok(v)),
            Ok(Computation::Await(f)) => {
                c.borrow_mut().flight = Some(f.clone());
                let ready = self.0.borrow().flights.get(&f).cloned();
                let cached = old_flight.as_ref() == Some(&f)
                    && ready.is_some()
                    && (c.borrow().error.is_none() || !c.borrow().loading_seed);
                if !cached {
                    if ready.is_some() {
                        self.0.borrow_mut().memo_ready.push_back((id, f));
                    }
                    if c.borrow().loading_seed {
                        if let Some(value) = previous {
                            self.publish(id, Ok(value));
                        }
                    } else {
                        self.publish(id, Err(ReadError::Pending));
                    }
                }
            }
            Err(e) => self.publish(id, Err(e)),
        }
    }
    fn publish(&self, id: NodeId, result: ReadResult<T>) {
        let c = self.node(id);
        let (changed, status, effect) = {
            let mut n = c.borrow_mut();
            let old_error = n.error.clone();
            let changed = match result {
                Ok(v) => {
                    let changed = matches!(old_error, Some(ReadError::Failed(_)))
                        || n.value.as_ref().is_none_or(|old| !(n.equals)(old, &v));
                    n.error = None;
                    n.shown_error = None;
                    if changed {
                        n.value = Some(v)
                    }
                    changed
                }
                Err(e) => {
                    if let ReadError::Failed(message) = &e {
                        n.shown_error = Some(message.clone());
                    }
                    n.error = Some(e);
                    false
                }
            };
            let status = old_error != n.error;
            if changed {
                n.revision += 1
            }
            if status {
                n.status_revision += 1
            }
            let effect =
                n.kind.is_some() && (changed || matches!(n.error, Some(ReadError::Failed(_))));
            if effect {
                n.modified = true
            }
            (changed, status, effect)
        };
        if changed || status {
            self.notify(id, false)
        }
        if effect {
            let mut s = self.0.borrow_mut();
            if !s.effects.contains(&id) {
                s.effects.push(id)
            }
        }
    }
    fn apply(&self, id: NodeId) {
        let c = self.node(id);
        let (f, v, p, cleanup, error, handler, owner) = {
            let mut n = c.borrow_mut();
            if n.disposed || !n.modified || n.error == Some(ReadError::Pending) {
                return;
            }
            n.modified = false;
            (
                n.apply.clone(),
                n.value.clone(),
                n.applied.clone(),
                if n.error.is_none() {
                    n.apply_cleanup.take()
                } else {
                    None
                },
                n.error.clone(),
                n.error_handler.clone(),
                n.owner,
            )
        };
        if let Some(cleanup) = cleanup {
            cleanup()
        }
        if let Some(ReadError::Failed(e)) = error {
            if let Some(h) = handler {
                h(e)
            } else {
                self.report(owner, e)
            }
            return;
        }
        if let (Some(f), Some(v)) = (f, v) {
            let cleanup = self.untrack(|| f(v.clone(), p));
            let mut n = c.borrow_mut();
            n.applied = Some(v);
            n.apply_cleanup = cleanup;
        }
    }
    fn report(&self, mut owner: OwnerId, error: String) {
        loop {
            let (handler, parent) = {
                let s = self.0.borrow();
                (s.owners[owner].error.clone(), s.owners[owner].parent)
            };
            if let Some(h) = handler {
                h(error);
                return;
            }
            if let Some(p) = parent {
                owner = p
            } else {
                self.0.borrow_mut().pub_errors.push(error);
                return;
            }
        }
    }
    pub fn take_errors(&self) -> Vec<String> {
        std::mem::take(&mut self.0.borrow_mut().pub_errors)
    }
    pub fn flush(&self) {
        {
            let mut s = self.0.borrow_mut();
            if s.flushing {
                return;
            }
            s.flushing = true;
        }
        self.release_idle();
        for c in self.0.borrow().nodes.iter() {
            c.borrow_mut().pulled_before_flush = false;
        }
        for _ in 0..1000 {
            self.stage_writes();
            self.commit_transactions();
            let forced = self
                .0
                .borrow()
                .queued
                .iter()
                .filter(|(_, force)| **force)
                .map(|(id, _)| *id)
                .collect::<Vec<_>>();
            for id in forced {
                self.node(id).borrow_mut().dirty = true;
            }
            loop {
                let item = {
                    let mut s = self.0.borrow_mut();
                    let position = s
                        .queue
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, id)| s.nodes[**id].borrow().height)
                        .map(|(i, _)| i);
                    position
                        .and_then(|i| s.queue.remove(i))
                        .map(|id| (id, s.queued.remove(&id).unwrap_or(false)))
                };
                let Some((id, _force)) = item else { break };
                self.update(id);
            }
            let effects = std::mem::take(&mut self.0.borrow_mut().effects);
            for kind in [EffectKind::Render, EffectKind::User] {
                for id in &effects {
                    if self.node(*id).borrow().kind == Some(kind) {
                        self.apply(*id)
                    }
                }
            }
            if self.0.borrow().writes.is_empty() {
                break;
            }
        }
        self.release_idle();
        let mut s = self.0.borrow_mut();
        s.flushing = false;
        s.tick_tx = None;
    }
    fn release_idle(&self) {
        let nodes = self.0.borrow().nodes.clone();
        for (id, c) in nodes.iter().enumerate().rev() {
            let release = {
                let n = c.borrow();
                n.lazy && n.initialized && n.subs.is_empty() && !n.disposed && !n.refresh_watched
            };
            if release {
                let (owner, deps) = {
                    let mut n = c.borrow_mut();
                    n.initialized = false;
                    n.dirty = true;
                    // Keep the last committed value for the next compute prev.
                    n.error = None;
                    n.flight = None;
                    (n.owner, std::mem::take(&mut n.deps))
                };
                {
                    let mut s = self.0.borrow_mut();
                    s.queued.remove(&id);
                    s.queue.retain(|x| *x != id);
                }
                self.clear_owner(owner);
                for (d, _, _) in deps {
                    self.node(d).borrow_mut().subs.retain(|x| *x != id)
                }
            }
        }
    }
    fn tx_root(&self, mut id: usize) -> usize {
        loop {
            let p = self.0.borrow().transactions[id].parent;
            if p == id {
                return id;
            }
            id = p
        }
    }
    fn merge(&self, a: usize, b: usize) -> usize {
        let a = self.tx_root(a);
        let b = self.tx_root(b);
        if a == b {
            return a;
        }
        let mut s = self.0.borrow_mut();
        s.transactions[b].parent = a;
        let open = s.transactions[b].open;
        let writes = std::mem::take(&mut s.transactions[b].writes);
        let guesses = std::mem::take(&mut s.transactions[b].guesses);
        s.transactions[a].open += open;
        s.transactions[a].writes.extend(writes);
        s.transactions[a].guesses.extend(guesses);
        a
    }
    fn stage_writes(&self) {
        let writes = std::mem::take(&mut self.0.borrow_mut().writes);
        let mut tick = self.0.borrow().tick_tx;
        for id in writes.keys() {
            if let Some(h) = self.node(*id).borrow().held {
                tick = Some(if let Some(t) = tick {
                    self.merge(t, h)
                } else {
                    self.tx_root(h)
                })
            }
        }
        for (id, v) in writes {
            let c = self.node(id);
            if c.borrow().optimistic {
                if let Some(t) = tick {
                    let t = self.tx_root(t);
                    let old = c.borrow().value.clone().unwrap();
                    self.0.borrow_mut().transactions[t]
                        .guesses
                        .entry(id)
                        .or_insert(old);
                    self.publish(id, Ok(v));
                }
            } else if let Some(t) = tick {
                let t = self.tx_root(t);
                self.0.borrow_mut().transactions[t].writes.insert(id, v);
                c.borrow_mut().held = Some(t);
            } else {
                self.publish(id, Ok(v))
            }
        }
    }
    fn commit_transactions(&self) {
        let len = self.0.borrow().transactions.len();
        for t in 0..len {
            let ready = {
                let s = self.0.borrow();
                s.transactions[t].parent == t && s.transactions[t].open == 0
            };
            if ready {
                let (writes, guesses) = {
                    let mut s = self.0.borrow_mut();
                    (
                        std::mem::take(&mut s.transactions[t].writes),
                        std::mem::take(&mut s.transactions[t].guesses),
                    )
                };
                for (id, v) in guesses {
                    self.publish(id, Ok(v))
                }
                for (id, v) in writes {
                    self.node(id).borrow_mut().held = None;
                    self.publish(id, Ok(v))
                }
            }
        }
    }
    pub fn action(&self, body: ActionBody<T>) -> usize {
        let mut s = self.0.borrow_mut();
        let t = s.transactions.len();
        s.transactions.push(Transaction {
            parent: t,
            open: 1,
            writes: BTreeMap::new(),
            guesses: BTreeMap::new(),
        });
        let prev = s.tick_tx;
        s.tick_tx = Some(t);
        let a = s.actions.len();
        s.actions.push(Action {
            tx: t,
            body: Some(body),
            waiting: None,
            done: false,
        });
        drop(s);
        if let Some(p) = prev {
            let t = self.merge(p, t);
            self.0.borrow_mut().tick_tx = Some(t)
        }
        self.step_action(a, Ok(None));
        a
    }
    fn step_action(&self, id: usize, input: ReadResult<Option<T>>) {
        let (tx, mut body) = {
            let mut s = self.0.borrow_mut();
            let a = &mut s.actions[id];
            if a.done {
                return;
            }
            (a.tx, a.body.take().unwrap())
        };
        let tx = self.tx_root(tx);
        {
            let tick = self.0.borrow().tick_tx;
            if let Some(t) = tick {
                self.merge(tx, t);
            }
            let mut s = self.0.borrow_mut();
            s.tick_tx = Some(tx);
            s.active_tx = Some(tx);
        }
        let step = body(self, input);
        {
            let mut s = self.0.borrow_mut();
            s.active_tx = None;
            s.actions[id].body = Some(body);
        }
        match step {
            ActionStep::Yield(f) => {
                self.0.borrow_mut().actions[id].waiting = Some(f.clone());
                let result = self.0.borrow().flights.get(&f).cloned();
                if let Some(r) = result {
                    self.0.borrow_mut().ready.push_back((id, r.map(Some)))
                }
            }
            ActionStep::Done => self.finish_action(id, Ok(())),
            ActionStep::Fail(e) => self.finish_action(id, Err(e)),
        }
    }
    fn finish_action(&self, id: usize, result: Result<(), String>) {
        let tx = self.tx_root(self.0.borrow().actions[id].tx);
        let mut s = self.0.borrow_mut();
        s.transactions[tx].open -= 1;
        s.actions[id].done = true;
        s.actions[id].waiting = None;
        s.action_results.push((id, result));
    }
    pub fn settle(&self, flight: FlightId, result: ReadResult<T>) {
        {
            let mut s = self.0.borrow_mut();
            if s.flights.contains_key(&flight) {
                return;
            }
            s.flights.insert(flight.clone(), result.clone());
            let ids = s
                .actions
                .iter()
                .enumerate()
                .filter(|(_, a)| !a.done && a.waiting.as_ref() == Some(&flight))
                .map(|(id, _)| id)
                .collect::<Vec<_>>();
            for id in ids {
                s.actions[id].waiting = None;
                s.ready.push_back((id, result.clone().map(Some)));
            }
        }
        let nodes = self.0.borrow().nodes.clone();
        for (id, n) in nodes.iter().enumerate() {
            if !n.borrow().disposed && n.borrow().flight.as_ref() == Some(&flight) {
                self.0
                    .borrow_mut()
                    .memo_ready
                    .push_back((id, flight.clone()));
            }
        }
    }
    /// Drain controlled promise continuations. A completed flight is still asynchronous.
    pub fn drain(&self) {
        for c in self.0.borrow().nodes.iter() {
            c.borrow_mut().refresh_watched = false;
        }
        self.flush();
        loop {
            let memos = std::mem::take(&mut self.0.borrow_mut().memo_ready);
            for (id, flight) in memos {
                let node = self.node(id);
                let current = {
                    let n = node.borrow();
                    !n.disposed && n.flight.as_ref() == Some(&flight)
                };
                if current {
                    let result = self.0.borrow().flights[&flight].clone();
                    if result.is_ok() {
                        node.borrow_mut().loading_seed = false;
                    }
                    self.publish(id, result);
                }
            }
            loop {
                let next = self.0.borrow_mut().ready.pop_front();
                if let Some((id, result)) = next {
                    self.step_action(id, result);
                    self.flush()
                } else {
                    break;
                }
            }
            self.flush();
            if self.0.borrow().memo_ready.is_empty() && self.0.borrow().ready.is_empty() {
                break;
            }
        }
    }
    /// A native host schedules one main-thread drain when this becomes true.
    pub fn has_work(&self) -> bool {
        let s = self.0.borrow();
        !s.writes.is_empty()
            || !s.queue.is_empty()
            || !s.effects.is_empty()
            || !s.ready.is_empty()
            || !s.memo_ready.is_empty()
    }
    pub fn take_action_results(&self) -> Vec<(usize, Result<(), String>)> {
        std::mem::take(&mut self.0.borrow_mut().action_results)
    }
}
