//! Slice 1: a structural port of the Solid 2 signals scheduler paths that the
//! scalar action/optimistic slice reaches (signals, optimistic signals,
//! memos, render/user effects, actions, transactions and lanes).
//!
//! Reference: solid `2105ffb8`, rc.21, `packages/signals/src/core/*.ts`.
//! Each submodule mirrors one Solid file and each function carries a
//! `// Solid: file.ts:lines` correspondence comment. The reached paths were
//! measured with V8 coverage; see docs/SLICE1-PARITY.md. Machinery the slice
//! never reaches (async flights / STATUS_PENDING, verdict windows, boundaries,
//! stores, snapshots, zombies, linked lanes) is not ported: every test of it
//! in Solid is constant there, and the port says so where it drops one.
//!
//! The M1 graph in `lib.rs` is not used here: its scheduler semantics differ.
mod action;
mod core;
mod effect;
mod graph;
mod heap;
mod lanes;
mod owner;
mod scheduler;

pub use action::{ActionBody, ActionStep, Resume};
use std::{collections::VecDeque, rc::Rc};

pub type NodeId = usize;
pub type TxId = usize;
pub type ActionId = usize;
/// Compatibility name used by the plan evaluator.
pub type SourceId = NodeId;
type LinkId = usize;
/// A node value; `None` is JS `undefined` (an effect's first previous value).
pub type Value = Option<i64>;
/// A staging slot; `None` is Solid's `NOT_PENDING`.
type Slot = Option<Value>;
pub type ComputeFn = Rc<dyn Fn(&mut Runtime, Value) -> Result<i64, String>>;
pub type EffectFn = Rc<dyn Fn(&mut Runtime, i64, Value) -> Option<Cleanup>>;
pub type Cleanup = Box<dyn FnOnce(&mut Runtime)>;

// Solid: constants.ts:1-86 (the `_flags` bits used here)
const REACTIVE_NONE: u32 = 0;
const REACTIVE_CHECK: u32 = 1 << 0;
const REACTIVE_DIRTY: u32 = 1 << 1;
const REACTIVE_RECOMPUTING_DEPS: u32 = 1 << 2;
const REACTIVE_IN_HEAP: u32 = 1 << 3;
const REACTIVE_IN_HEAP_HEIGHT: u32 = 1 << 4;
const REACTIVE_ZOMBIE: u32 = 1 << 5;
const REACTIVE_DISPOSED: u32 = 1 << 6;
const REACTIVE_JOINED: u32 = 1 << 7;
const REACTIVE_SNAPSHOT_STALE: u32 = 1 << 8;
const REACTIVE_LAZY: u32 = 1 << 9;
const REACTIVE_MANUAL_WRITE: u32 = 1 << 10;
const REACTIVE_FRAME_READ: u32 = 1 << 11;
const REACTIVE_MISSED_WAKE: u32 = 1 << 12;
const REACTIVE_REASK: u32 = 1 << 13;
const REACTIVE_STAGED_READ: u32 = 1 << 14;
const REACTIVE_LANE_DIRTY: u32 = 1 << 16;
const REACTIVE_LANE_READ: u32 = 1 << 17;
const REACTIVE_SCREEN_READ: u32 = 1 << 18;
const REACTIVE_PROBE_UNANSWERED: u32 = 1 << 19;
// Solid: constants.ts:89-237 (the `_config` bits used here)
const CONFIG_CHILDREN_FORBIDDEN: u32 = 1 << 4;
const CONFIG_AUTO_DISPOSE: u32 = 1 << 5;
const CONFIG_STAGED: u32 = 1 << 7;
const CONFIG_HELD: u32 = 1 << 8;
const CONFIG_INPUTS_PUBLISHED: u32 = 1 << 10;
const CONFIG_OVERRIDE: u32 = 1 << 11;
const CONFIG_GUESS: u32 = 1 << 13;
const CONFIG_VERDICT: u32 = 1 << 15;
const CONFIG_LAGS: u32 = 1 << 19;
const CONFIG_HELD_FRAME: u32 = 1 << 20;
const CONFIG_STAGED_ERROR: u32 = 1 << 21;
const CONFIG_FRAME: u32 = 1 << 23;
// Solid: constants.ts:249-265
const STATUS_ERROR: u32 = 1 << 1;
const STATUS_UNINITIALIZED: u32 = 1 << 2;
pub const EFFECT_RENDER: u32 = 1;
pub const EFFECT_USER: u32 = 2;
/// Solid: lanes.ts:116-118
const LEFT_SHOWN: i64 = -2;

/// Solid: graph.ts:131-150, the alien-signals link record.
#[derive(Clone, Copy)]
struct Link {
    dep: NodeId,
    sub: NodeId,
    next_dep: Option<LinkId>,
    prev_sub: Option<LinkId>,
    next_sub: Option<LinkId>,
    gen: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// `createRoot` owner (owner.ts:381-431).
    Root,
    /// `signal()` (core.ts:1618-1662).
    Signal,
    /// `computed()` / `createEffectNode` (core.ts:1144-1253, 1452-1566).
    Computed,
}

/// Solid: types.ts `Signal` / `Computed` / `Owner` and the cold
/// `NodeExtension` (core.ts:1259-1279), flattened: an absent extension and
/// a default one are indistinguishable on every path ported here.
struct Node {
    kind: Kind,
    /// `_equals`: `isEqual` (true) or an effect's `false` (core.ts:1523).
    equals: bool,
    config: u32,
    flags: u32,
    status: u32,
    value: Value,
    pending: Slot,
    time: u64,
    notified_at: i64,
    subs: Option<LinkId>,
    subs_tail: Option<LinkId>,
    // Computed.
    fn_: Option<ComputeFn>,
    height: i32,
    next_heap: Option<NodeId>,
    prev_heap: NodeId,
    deps: Option<LinkId>,
    deps_tail: Option<LinkId>,
    dep_gen: u64,
    // Effect.
    effect_type: u32,
    effect_fn: Option<EffectFn>,
    modified: bool,
    prev_value: Value,
    cleanup: Option<Cleanup>,
    // Owner.
    parent: Option<NodeId>,
    first_child: Option<NodeId>,
    next_sibling: Option<NodeId>,
    prev_sibling: Option<NodeId>,
    // NodeExtension.
    transaction: Option<TxId>,
    lane: Slot,
    q: u64,
    error: Option<String>,
    flushed: Slot,
    flushed_at: i64,
}

impl Node {
    fn new(kind: Kind, value: Value, id: NodeId, clock: u64) -> Self {
        Node {
            kind,
            equals: true,
            config: 0,
            flags: REACTIVE_NONE,
            status: 0,
            value,
            pending: None,
            time: clock,
            notified_at: -1,
            subs: None,
            subs_tail: None,
            fn_: None,
            height: 0,
            next_heap: None,
            prev_heap: id,
            deps: None,
            deps_tail: None,
            dep_gen: 0,
            effect_type: 0,
            effect_fn: None,
            modified: false,
            prev_value: None,
            cleanup: None,
            parent: None,
            first_child: None,
            next_sibling: None,
            prev_sibling: None,
            transaction: None,
            lane: None,
            q: 0,
            error: None,
            flushed: None,
            flushed_at: -1,
        }
    }
}

/// Solid: scheduler.ts:266-315 `QueueCallback`, as data: the bound
/// `runEffect` of a node, or a landing's deferred `releaseQueues` closure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueueCallback {
    RunEffect(NodeId),
    ReleaseQueues(TxId),
}

/// Solid: scheduler.ts:266-327 `Transaction`. `_verdict`, `_links`,
/// `_marks`, `folded`, `latest` and `over` stay null/unset in this slice
/// (verdict windows, linked lanes, `affects()` and optimistic stores are not
/// ported), so they are omitted and their tests are constant false.
struct Transaction {
    nodes: Vec<NodeId>,
    queues: [Vec<QueueCallback>; 2],
    reruns: Vec<NodeId>,
    into: Option<TxId>,
    parent: Option<TxId>,
    lane: bool,
    open: i32,
    acted: bool,
    shown: bool,
    held: bool,
}

/// Microtasks the runtime and its host share, in JS order (FIFO).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Microtask {
    /// `queueMicrotask(flush)` (scheduler.ts:777-787).
    Flush,
    /// A promise reaction resuming an action (action.ts:213-227).
    Resume(ActionId),
    /// The action promise's settlement reaching its `.then` (action.ts:160-164).
    Settled(ActionId),
}

/// Solid: heap.ts:24-29 `Heap`.
struct Heap {
    heap: Vec<Option<NodeId>>,
    marked: bool,
    min: i32,
    max: i32,
}

/// Every module-level `let` of the Solid files ported here, gathered on one
/// struct (Rust has no module-level mutable state without `unsafe`).
pub struct Runtime {
    nodes: Vec<Node>,
    links: Vec<Link>,
    free_links: Vec<LinkId>,
    txs: Vec<Transaction>,
    // scheduler.ts
    transactions: Vec<TxId>,
    pass_lane: Option<TxId>,
    flush_transaction: Option<TxId>,
    dirty_queue: Heap,
    clock: u64,
    scheduled: bool,
    action_depth: u32,
    question: u64,
    questions: u64,
    guessing: bool,
    pending_nodes: Vec<NodeId>,
    staged_readers: Vec<NodeId>,
    held_trims: Vec<NodeId>,
    notify_epoch: u64,
    running: bool,
    queues: [Vec<QueueCallback>; 2],
    judge: Option<TxId>,
    // core.ts
    context: Option<NodeId>,
    tracking: bool,
    unflushed_staged: bool,
    lane_root: Option<TxId>,
    // lanes.ts
    lanes: Vec<TxId>,
    pending_guesses: Vec<(NodeId, i64, u64)>,
    guessed: bool,
    judged: usize,
    revealing: Vec<TxId>,
    // action.ts and the host's promise reactions
    actions: Vec<action::Action>,
    microtasks: VecDeque<Microtask>,
    flight_results: std::collections::BTreeMap<String, Resume>,
    errors: Vec<String>,
}

impl Default for Runtime {
    fn default() -> Self {
        Runtime {
            nodes: vec![],
            links: vec![],
            free_links: vec![],
            txs: vec![],
            transactions: vec![],
            pass_lane: None,
            flush_transaction: None,
            dirty_queue: Heap {
                heap: vec![None; 64],
                marked: false,
                min: 0,
                max: 0,
            },
            clock: 0,
            scheduled: false,
            action_depth: 0,
            question: 0,
            questions: 0,
            guessing: false,
            pending_nodes: vec![],
            staged_readers: vec![],
            held_trims: vec![],
            notify_epoch: 0,
            running: false,
            queues: [vec![], vec![]],
            judge: None,
            context: None,
            tracking: false,
            unflushed_staged: false,
            lane_root: None,
            lanes: vec![],
            pending_guesses: vec![],
            guessed: false,
            judged: 0,
            revealing: vec![],
            actions: vec![],
            microtasks: VecDeque::new(),
            flight_results: Default::default(),
            errors: vec![],
        }
    }
}

impl Runtime {
    fn add_node(&mut self, kind: Kind, value: Value) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(Node::new(kind, value, id, self.clock));
        id
    }
    /// `createSignal(value)` (signals.ts:413-429).
    pub fn signal(&mut self, value: i64) -> NodeId {
        self.signal_node(Some(value))
    }
    /// `createOptimistic(value)` (signals.ts:458-475): a plain signal whose
    /// setter is `optimisticWrite`.
    pub fn optimistic_value(&mut self, value: i64) -> NodeId {
        self.signal_node(Some(value))
    }
    /// `createOptimistic(fn)` (signals.ts:462-470): a computed with
    /// CONFIG_AUTO_DISPOSE cleared, written through `optimisticWrite`.
    pub fn optimistic(&mut self, f: ComputeFn) -> NodeId {
        let n = self.computed(f);
        self.nodes[n].config &= !CONFIG_AUTO_DISPOSE;
        n
    }
    /// `createMemo(fn)` (signals.ts:519-560, eager, default equality).
    pub fn memo(&mut self, f: ComputeFn) -> NodeId {
        self.computed(f)
    }
    /// The node's accessor (`read`, signals.ts:140-144). Untracked outside a
    /// computation, tracked inside one.
    pub fn read(&mut self, id: NodeId) -> Result<i64, String> {
        match self.read_node(id)? {
            Some(v) => Ok(v),
            None => Err("read of undefined".into()),
        }
    }
    /// The node passed in; kept so callers can treat a source and its node
    /// alike (the old slice API distinguished them).
    pub fn node(&self, id: NodeId) -> NodeId {
        id
    }
    /// `createSignal`'s setter (`setSignal`, core.ts:2693-2797).
    pub fn write(&mut self, id: NodeId, value: i64) {
        self.set_signal(id, value);
    }
    /// What an optimistic updater composes on (lanes.ts:147-152).
    pub fn current(&self, id: NodeId) -> Result<i64, String> {
        self.guessed_value_of(id)
            .ok_or_else(|| "updater read of undefined".into())
    }
    /// `flush()` (scheduler.ts:1608-1687).
    pub fn flush(&mut self) {
        self.flush_all();
    }
    /// Runs queued microtasks in FIFO order until none is left. Host
    /// reactions (`Resume`, `Settled`) are handled by `action.rs`.
    pub fn run_microtasks(&mut self, on_settled: &mut dyn FnMut(ActionId, Result<(), String>)) {
        while let Some(m) = self.microtasks.pop_front() {
            match m {
                Microtask::Flush => self.flush_all(),
                Microtask::Resume(a) => self.resume_action(a),
                Microtask::Settled(a) => {
                    let r = self.actions[a]
                        .outcome
                        .clone()
                        .expect("settled action has an outcome");
                    on_settled(a, r)
                }
            }
        }
    }
    pub fn take_errors(&mut self) -> Vec<String> {
        std::mem::take(&mut self.errors)
    }
    /// The lane/transaction a node is listed in, for tests.
    pub fn is_held(&self, id: NodeId) -> bool {
        self.nodes[id].config & CONFIG_HELD != 0
    }
}
