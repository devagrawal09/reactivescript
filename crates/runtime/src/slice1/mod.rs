//! Slices 1, 2a, 2b and 2c: a structural port of the Solid 2 signals paths
//! that the scalar action/optimistic slice (1), the async-memo slice (2a),
//! the store slice (2b) and the list slice (2c) reach: signals, optimistic
//! signals, memos, render/user effects, actions, transactions and lanes;
//! async memos over host flights, their pending and error status,
//! `refresh`, and the untracked `latest`/`isPending` windows; stores; and
//! `mapArray`, owners with `onCleanup` lists, children built inside
//! computations, parked frames and zombies, and CONFIG_SYNC.
//!
//! Reference: solid `2105ffb8`, rc.21, `packages/signals/src/*.ts`.
//! Each submodule mirrors one Solid file and each function carries a
//! `// Solid: file.ts:lines` correspondence comment. The reached paths were
//! measured with V8 coverage; see docs/SLICE1-PARITY.md and
//! docs/SLICE2{A,B,C}-COVERAGE.md. Machinery no slice reaches (tracked
//! verdict readers, boundaries, snapshots, iterators, `repeat`) is not
//! ported: every test of it in Solid is constant there, and the port says
//! so where it drops one.
//!
//! The M1 graph in `lib.rs` is not used here: its scheduler semantics differ.
mod action;
mod r#async;
mod boundaries;
mod core;
mod effect;
mod error;
pub mod events;
mod flatten;
mod flow;
mod function;
mod graph;
mod heap;
mod lanes;
mod map;
mod owner;
mod scheduler;
mod signals;
mod store;
mod truth;
mod universal;
mod value;
mod verdict;

pub use action::{ActionBody, ActionStep, Resume};
pub use effect::EffectOptions;
pub use error::thrown_string;
pub use error::user as user_error;
pub use error::{Error, Thrown};
pub use flatten::FlattenOptions;
pub use flow::{Component, ForProps, Getter, ShowProps};
pub use function::FnBody;
pub use map::{FallbackFn, KeyFn, Keyed, ListFn, MapArg, MapFn};
use std::{collections::VecDeque, rc::Rc};
pub use store::StoreKey;
pub use universal::{Disposer, InsertOptions, Marker, OnUpdate, Universal};
pub use value::{from_json, new_host_fn, Builtin, JsObj, Key, Obj, Value};
use value::{FamId, TargetId};

pub type NodeId = usize;
pub type TxId = usize;
pub type ActionId = usize;
/// Compatibility name used by the plan evaluator.
pub type SourceId = NodeId;
type LinkId = usize;
/// A staging slot; `None` is Solid's `NOT_PENDING`.
type Slot = Option<Value>;
/// A synchronous compute body over integers (the plan evaluator's and the
/// slice-1 tests' API; `None` is `undefined`, a first pass's `prev`).
pub type ComputeFn = Rc<dyn Fn(&mut Runtime, Option<i64>) -> Result<i64, String>>;
/// A compute body that may return a host flight (a promise) and throws
/// Solid's error objects, so a read's `NotReadyError` keeps its identity.
pub type BodyFn = Rc<dyn Fn(&mut Runtime, Value) -> Result<Out, Error>>;
/// An effect's apply function over integers (the slice-1 API).
pub type EffectFn = Rc<dyn Fn(&mut Runtime, i64, Option<i64>) -> Option<Cleanup>>;
/// An effect's apply function: the value and the previous one.
pub type ValueEffectFn = Rc<dyn Fn(&mut Runtime, Value, Value) -> Option<Cleanup>>;
/// A user effect's `error` handler (effect.ts:212-230), given the unwrapped error.
pub type ErrorFn = Rc<dyn Fn(&mut Runtime, &Error)>;
pub type Cleanup = Box<dyn FnOnce(&mut Runtime)>;
/// What a compute body returns: a value, or a promise (a host flight by name).
#[derive(Clone, Debug)]
pub enum Out {
    Value(Value),
    Flight(String),
}
type FlightId = usize;
type SetId = usize;

/// A computed's `_fn`: user code, or a `refresh()` waiter's body
/// (signals.ts:972-984 inside `watch`, signals.ts:817-848).
#[derive(Clone)]
enum Body {
    User(BodyFn),
    Waiter {
        target: NodeId,
        own: Option<TxId>,
    },
    /// A derived store's derive (projection.ts:421-424 around
    /// `runProjectionComputed`): the store's root target, the user derive
    /// and the family's key option.
    Projection {
        root: TargetId,
        derive: BodyFn,
        key: Option<Rc<str>>,
    },
    /// `updateKeyedMap.bind(data)` (map.ts:102-105): a `mapArray`'s
    /// computed, by its `MapData`.
    Map(map::MapId),
}

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
const REACTIVE_WINDOW: u32 = 1 << 21;
const REACTIVE_RELEASE_AFTER: u32 = 1 << 22;
// Solid: constants.ts:89-237 (the `_config` bits used here)
const CONFIG_OWNED_WRITE: u32 = 1 << 0;
const CONFIG_CHILDREN_FORBIDDEN: u32 = 1 << 4;
const CONFIG_AUTO_DISPOSE: u32 = 1 << 5;
const CONFIG_SYNC: u32 = 1 << 6;
const CONFIG_STAGED: u32 = 1 << 7;
const CONFIG_HELD: u32 = 1 << 8;
const CONFIG_INPUTS_PUBLISHED: u32 = 1 << 10;
const CONFIG_OVERRIDE: u32 = 1 << 11;
const CONFIG_SLOT_NODE: u32 = 1 << 12;
const CONFIG_MANUAL_WRITE: u32 = 1 << 18;
const CONFIG_GUESS: u32 = 1 << 13;
const CONFIG_REDERIVE: u32 = 1 << 14;
const CONFIG_VERDICT: u32 = 1 << 15;
const CONFIG_FRESH_READ: u32 = 1 << 16;
const CONFIG_AUTHORITATIVE: u32 = 1 << 17;
const CONFIG_LAGS: u32 = 1 << 19;
const CONFIG_HELD_FRAME: u32 = 1 << 20;
const CONFIG_STAGED_ERROR: u32 = 1 << 21;
const CONFIG_PROMOTED: u32 = 1 << 22;
const CONFIG_FRAME: u32 = 1 << 23;
const CONFIG_ASYNC: u32 = 1 << 29;
// Solid: constants.ts:249-265
const STATUS_PENDING: u32 = 1 << 0;
const STATUS_ERROR: u32 = 1 << 1;
const STATUS_UNINITIALIZED: u32 = 1 << 2;
const STATUS_NO_VALUE: u32 = 1 << 3;
pub const EFFECT_RENDER: u32 = 1;
pub const EFFECT_USER: u32 = 2;
/// Solid: constants.ts:265 (`createTrackedEffect`; no op creates one).
const EFFECT_TRACKED: u32 = 3;
/// Solid: lanes.ts:116-118
const LEFT_SHOWN: i64 = -2;
/// Solid: scheduler.ts:757
const MAINLINE_QUESTION: u64 = 0x7fff_ffff;

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
/// A node's `_equals`: `isEqual`, an effect's `false` (core.ts:1523), a
/// store slot's `slotNodeEquals` or a container's `containerEquals`
/// (store.ts:252-296).
/// A user comparator (`options.equals`) is `User(i)`, an index into
/// `Runtime::comparators`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Equals {
    Never,
    IsEqual,
    Slot,
    Container,
    User(usize),
}

/// A user comparator (`options.equals`, `(a, b) => boolean`).
pub type EqualsFn = Rc<dyn Fn(&Value, &Value) -> bool>;

struct Node {
    kind: Kind,
    eq: Equals,
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
    fn_: Option<Body>,
    /// `_loading`: a `loadingValue` node before its first real answer.
    loading: bool,
    height: i32,
    next_heap: Option<NodeId>,
    prev_heap: NodeId,
    deps: Option<LinkId>,
    deps_tail: Option<LinkId>,
    dep_gen: u64,
    // Effect.
    effect_type: u32,
    effect_fn: Option<ValueEffectFn>,
    error_fn: Option<ErrorFn>,
    modified: bool,
    prev_value: Value,
    cleanup: Option<Cleanup>,
    // Owner.
    parent: Option<NodeId>,
    first_child: Option<NodeId>,
    next_sibling: Option<NodeId>,
    prev_sibling: Option<NodeId>,
    /// `_disposal`: the `onCleanup` list (owner.ts:338-344); empty is null.
    /// Run last-registered first (`runDisposal`), so a single entry and an
    /// array of one behave alike.
    disposal: Vec<Cleanup>,
    /// A root's `_parentComputed` (owner.ts:399/421, map.ts:410).
    parent_computed: Option<NodeId>,
    /// The parked frame (`_x._pendingFirstChild` / `_x._pendingDisposal`,
    /// core.ts:1436-1444); an empty list is null.
    pending_first_child: Option<NodeId>,
    pending_disposal: Vec<Cleanup>,
    // NodeExtension.
    transaction: Option<TxId>,
    lane: Slot,
    q: u64,
    error: Option<Error>,
    flushed: Slot,
    flushed_at: i64,
    /// `_inFlight`: the promise the last pass returned (async.ts:515).
    in_flight: Option<FlightId>,
    /// `_pendingSources`: a JS `Set` (shared by reference, see `JsSet`).
    pending_sources: Option<SetId>,
    blocked: bool,
    reask: bool,
    shown_error: Option<Error>,
    served: i64,
    /// `_pendingValue` holding a `StatusError` (CONFIG_STAGED_ERROR, D-41):
    /// `pending` is then `Some(None)` and this is the staged error object.
    pending_err: Option<Error>,
    // A store slot node (core.ts:1668-1724 `slotSignal`): its target, key,
    // accessor verdict and wrap cache.
    host: Option<TargetId>,
    key: store::SlotKey,
    acc: bool,
    px: Value,
    pxv: Value,
    /// A derived store's derive: `(node as any)._fam`.
    fam: Option<FamId>,
}

impl Node {
    fn new(kind: Kind, value: Value, id: NodeId, clock: u64) -> Self {
        Node {
            kind,
            eq: Equals::IsEqual,
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
            loading: false,
            height: 0,
            next_heap: None,
            prev_heap: id,
            deps: None,
            deps_tail: None,
            dep_gen: 0,
            effect_type: 0,
            effect_fn: None,
            error_fn: None,
            modified: false,
            prev_value: Value::Undef,
            cleanup: None,
            parent: None,
            first_child: None,
            next_sibling: None,
            prev_sibling: None,
            disposal: vec![],
            parent_computed: None,
            pending_first_child: None,
            pending_disposal: vec![],
            transaction: None,
            lane: None,
            q: 0,
            error: None,
            flushed: None,
            flushed_at: -1,
            in_flight: None,
            pending_sources: None,
            blocked: false,
            reask: false,
            shown_error: None,
            served: -1,
            pending_err: None,
            host: None,
            key: store::SlotKey::Track,
            acc: false,
            px: Value::Undef,
            pxv: Value::Undef,
            fam: None,
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

/// Solid: scheduler.ts:266-327 `Transaction`. `_verdict`, `_marks` and
/// `latest` stay null/unset here (tracked verdict readers and `affects()`
/// are not ported), so they are omitted and their tests are constant
/// false. `_links` is an index into `Runtime::link_groups` (the shared JS
/// array). `folded` is set only to `foldedRead` (store/optimistic.ts).
struct Transaction {
    /// `folded`: a current truth folded beneath a keyed arrangement guess.
    folded: bool,
    /// `over`: the derive's transaction a lane was re-based over (#4525).
    over: Option<TxId>,
    links: Option<usize>,
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
    /// An async memo's flight reaction (async.ts:855-893): the node and the
    /// promise it registered on.
    Landing(NodeId, FlightId, Option<usize>),
    /// `refresh()`'s deferred waiter (signals.ts:961-998).
    Waiter(NodeId, Option<TxId>),
    /// A waiter's `queueMicrotask(() => onValue(v))` / `onError` (signals.ts:845-847):
    /// both dispose the waiter (signals.ts:985-992).
    Deliver(NodeId),
}

/// A host flight: the JS promise `flight(id).promise` of fuzz/solid.mjs.
/// Reactions are queued in registration order when it settles, or at once
/// when it already has (a `.then` on a settled promise).
struct Flight {
    name: String,
    result: Option<Result<Value, Error>>,
    reactions: Vec<Reaction>,
}

#[derive(Clone, Copy)]
enum Reaction {
    Action(ActionId),
    /// An async memo's reaction; a derive's carries its pass (`setter`).
    Memo(NodeId, Option<usize>),
}

/// A JS `Set` of nodes, shared by reference: insertion order, and an
/// iteration that skips entries deleted before it reaches them and visits
/// entries added during it (tombstones).
#[derive(Default)]
struct JsSet {
    items: Vec<Option<NodeId>>,
    size: usize,
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
    pass_tx: Option<TxId>,
    // core.ts
    context: Option<NodeId>,
    tracking: bool,
    unflushed_staged: bool,
    lane_root: Option<TxId>,
    /// `verdict`: `verdictValue` while a `latest`/`isPending` window is open.
    verdict: bool,
    // verdict.ts
    latest_active: bool,
    probing: bool,
    probe_found: bool,
    // truth.ts installed by the first `watch` with CONFIG_AUTHORITATIVE
    truth: bool,
    // lanes.ts
    lanes: Vec<TxId>,
    pending_guesses: Vec<(NodeId, Value, u64)>,
    guessed: bool,
    judged: usize,
    revealing: Vec<TxId>,
    link_groups: Vec<Vec<TxId>>,
    // action.ts and the host's promise reactions
    actions: Vec<action::Action>,
    microtasks: VecDeque<Microtask>,
    flights: Vec<Flight>,
    sets: Vec<JsSet>,
    errors: Vec<String>,
    /// core.ts:2005 `promotedWrites` (CONFIG_PROMOTED).
    promoted_writes: Vec<NodeId>,
    /// lanes.ts:166-170 `kept` (node, guess, lane, question, taker) and
    /// `reverted` (a WeakSet of lanes).
    kept: Vec<(NodeId, Slot, Option<TxId>, u64, TxId)>,
    reverted: Vec<TxId>,
    /// lanes.ts:509 `reverting`.
    reverting: bool,
    /// The store tier's module state (store/*.ts).
    store: store::StoreState,
    /// Each derive pass's closure state, by registration.
    passes: Vec<store::projection::ProjPass>,
    /// scheduler.ts:605 `deferredZombies`.
    deferred_zombies: Vec<NodeId>,
    /// graph.ts:95 `deferredReleases`.
    deferred_releases: Option<Vec<NodeId>>,
    /// Each `mapArray`'s `MapData` (map.ts:88-101), by creation.
    maps: Vec<map::MapData>,
    /// User comparators (`options.equals`), by registration.
    comparators: Vec<EqualsFn>,
    /// Host-made function values (function.rs), by identity.
    functions: std::collections::HashMap<u64, function::JsFunction>,
    /// Debugging aid: `SLICE1_TRACE` prints scheduler events to stderr in
    /// the format of the instrumented Solid copy (docs/slice2a-fuzz).
    trace: bool,
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
            pass_tx: None,
            context: None,
            tracking: false,
            unflushed_staged: false,
            lane_root: None,
            verdict: false,
            latest_active: false,
            probing: false,
            probe_found: false,
            truth: false,
            lanes: vec![],
            pending_guesses: vec![],
            guessed: false,
            judged: 0,
            revealing: vec![],
            link_groups: vec![],
            actions: vec![],
            microtasks: VecDeque::new(),
            flights: vec![],
            sets: vec![],
            errors: vec![],
            promoted_writes: vec![],
            kept: vec![],
            reverted: vec![],
            reverting: false,
            store: store::StoreState::default(),
            passes: vec![],
            deferred_zombies: vec![],
            deferred_releases: None,
            maps: vec![],
            comparators: vec![],
            functions: Default::default(),
            trace: std::env::var_os("SLICE1_TRACE").is_some(),
        }
    }
}

/// An integer-or-undefined value as the slice-1 API sees it.
fn legacy_int(v: &Value) -> Option<i64> {
    match v {
        Value::Undef => None,
        Value::Int(i) => Some(*i),
        other => panic!("a non-integer value ({other:?}) reached the integer API"),
    }
}

/// Wraps an integer `EffectFn` as a value effect.
fn legacy_effect(f: EffectFn) -> ValueEffectFn {
    Rc::new(move |rt: &mut Runtime, v: Value, p: Value| {
        let v = legacy_int(&v).expect("an integer effect value");
        f(rt, v, legacy_int(&p))
    })
}

/// Wraps a synchronous `ComputeFn` as a body: its `Err` is a user error.
fn sync_body(f: ComputeFn) -> BodyFn {
    Rc::new(
        move |rt: &mut Runtime, prev: Value| match f(rt, legacy_int(&prev)) {
            Ok(v) => Ok(Out::Value(Value::Int(v))),
            Err(e) => Err(error::user(e)),
        },
    )
}

impl Runtime {
    /// A node's label in traces: its index among non-root nodes (Solid's
    /// creation order of signals and computeds).
    fn label(&self, n: NodeId) -> usize {
        self.nodes[..n]
            .iter()
            .filter(|x| x.kind != Kind::Root)
            .count()
    }
    fn tr(&self, f: impl FnOnce() -> String) {
        if self.trace {
            eprintln!("{}", f());
        }
    }
    fn add_node(&mut self, kind: Kind, value: Value) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(Node::new(kind, value, id, self.clock));
        id
    }
    /// `createSignal(value)` (signals.ts:413-429).
    pub fn signal(&mut self, value: i64) -> NodeId {
        self.signal_node(Value::Int(value))
    }
    /// `createOptimistic(value)` (signals.ts:458-475): a plain signal whose
    /// setter is `optimisticWrite`.
    pub fn optimistic_value(&mut self, value: i64) -> NodeId {
        self.signal_node(Value::Int(value))
    }
    /// `createOptimistic(fn)` (signals.ts:462-470): a computed with
    /// CONFIG_AUTO_DISPOSE cleared, written through `optimisticWrite`.
    pub fn optimistic(&mut self, f: ComputeFn) -> NodeId {
        let n = self.computed(sync_body(f), None);
        self.nodes[n].config &= !CONFIG_AUTO_DISPOSE;
        n
    }
    /// `createMemo(fn)` (signals.ts:519-524, eager, default equality).
    pub fn memo(&mut self, f: ComputeFn) -> NodeId {
        self.computed(sync_body(f), None)
    }
    /// `createMemo(fn, { loadingValue })` over a body that may return a
    /// host flight (signals.ts:519-524 → core.ts:1144-1253).
    pub fn memo_async(&mut self, f: BodyFn, loading: Option<Value>) -> NodeId {
        self.computed(f, loading)
    }
    /// `createMemo(fn, { equals, sync })` (signals.ts:519-524 →
    /// core.ts:1144-1253): a user comparator and CONFIG_SYNC.
    pub fn memo_with(&mut self, f: BodyFn, equals: Option<EqualsFn>, sync: bool) -> NodeId {
        let eq = match equals {
            Some(f) => {
                self.comparators.push(f);
                Equals::User(self.comparators.len() - 1)
            }
            None => Equals::IsEqual,
        };
        self.computed_with(Body::User(f), None, if sync { CONFIG_SYNC } else { 0 }, eq)
    }
    /// `verdict !== null` (core.ts, exported live binding): a
    /// `latest`/`isPending` window is open.
    pub fn verdict_open(&self) -> bool {
        self.verdict
    }
    /// The node's accessor (`read`, signals.ts:140-144). Untracked outside a
    /// computation, tracked inside one.
    pub fn read(&mut self, id: NodeId) -> Result<i64, String> {
        match self.read_node(id) {
            Ok(Value::Int(v)) => Ok(v),
            Ok(_) => Err("read of a non-integer".into()),
            Err(e) if e.is_not_ready() => Err("NotReadyError".into()),
            Err(e) => Err(e.message()),
        }
    }
    /// `read` with Solid's thrown objects: `Err` is the error a JS read throws.
    pub fn read_value(&mut self, id: NodeId) -> Result<Value, Error> {
        self.read_node(id)
    }
    /// `latest(() => read(id))` (verdict.ts:338-350).
    pub fn latest(&mut self, id: NodeId) -> Result<Value, Error> {
        self.latest_window(|rt| rt.read_node(id))
    }
    /// `isPending(() => read(id))` (verdict.ts:384-411).
    pub fn is_pending(&mut self, id: NodeId) -> Result<bool, Error> {
        self.is_pending_window(|rt| rt.read_node(id).map(|_| ()))
    }
    /// The node passed in; kept so callers can treat a source and its node
    /// alike (the old slice API distinguished them).
    pub fn node(&self, id: NodeId) -> NodeId {
        id
    }
    /// `createOptimistic`'s setter (lanes.ts:186-200) with a value.
    pub fn optimistic_write(&mut self, n: NodeId, v: impl Into<Value>) {
        self.optimistic_write_value(n, v.into());
    }
    /// A host flight settles with an integer (the slice-1/2a API).
    pub fn settle_flight(&mut self, flight: &str, result: Result<i64, String>) {
        self.settle_flight_value(flight, result.map(Value::Int));
    }
    /// `createSignal(value)` with any value.
    pub fn signal_value(&mut self, value: Value) -> NodeId {
        self.signal_node(value)
    }
    /// `createOptimistic(fn, { loadingValue })` (signals.ts:462-470) over a body.
    pub fn optimistic_memo(&mut self, f: BodyFn, loading: Option<Value>) -> NodeId {
        let n = self.computed(f, loading);
        self.nodes[n].config &= !CONFIG_AUTO_DISPOSE;
        n
    }
    /// `setSignal(el, v)` with any value.
    pub fn write_value(&mut self, id: NodeId, value: Value) {
        self.set_signal(id, value);
    }
    /// `setSignal(el, prev => f(prev))`: the updater composes on the
    /// staging, else the committed value (core.ts:2716-2718).
    pub fn write_with(
        &mut self,
        id: NodeId,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
    ) -> Result<(), Error> {
        self.set_signal_fn(id, f)
    }
    /// `optimisticWrite(n, prev => f(prev))` (lanes.ts:186-200): the
    /// updater composes on `guessedValueOf(n)`.
    pub fn optimistic_write_with(
        &mut self,
        id: NodeId,
        f: &mut dyn FnMut(&mut Runtime, Value) -> Result<Value, Error>,
    ) -> Result<(), Error> {
        self.optimistic_write_fn(id, f)
    }
    /// `untrack(fn)` (core.ts:1848-1873).
    pub fn untrack<T>(&mut self, f: impl FnOnce(&mut Runtime) -> T) -> T {
        let prev = self.tracking;
        self.tracking = false;
        let r = f(self);
        self.tracking = prev;
        r
    }
    /// `latest(fn)` (verdict.ts:338-350).
    pub fn latest_of(
        &mut self,
        f: impl FnOnce(&mut Runtime) -> Result<Value, Error>,
    ) -> Result<Value, Error> {
        self.latest_window(f)
    }
    /// `isPending(fn)` (verdict.ts:384-411).
    pub fn is_pending_of(
        &mut self,
        f: impl FnOnce(&mut Runtime) -> Result<(), Error>,
    ) -> Result<bool, Error> {
        self.is_pending_window(f)
    }
    /// `createSignal`'s setter (`setSignal`, core.ts:2693-2797).
    pub fn write(&mut self, id: NodeId, value: i64) {
        self.set_signal(id, Value::Int(value));
    }
    /// What an optimistic updater composes on (lanes.ts:147-152).
    pub fn current(&self, id: NodeId) -> Result<i64, String> {
        self.guessed_value_of(id)
            .as_int()
            .ok_or_else(|| "updater read of a non-integer".into())
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
                Microtask::Landing(el, f, pass) => self.flight_reaction(el, f, pass),
                Microtask::Waiter(node, own) => self.refresh_waiter(node, own),
                Microtask::Deliver(waiter) => self.dispose(waiter),
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
