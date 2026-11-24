var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../rx-store-proto-features/ref/compile/prims-solid.ts
function primsSolid(s) {
  return {
    createToggle: (initial) => {
      const [get2, set2] = s.createSignal(initial);
      return [get2, (v) => {
        set2(v);
      }];
    },
    createShout: (src) => s.createMemo(() => `${src()}!`)
  };
}

// ../store-proto-features/packages/signals/dist/select/core/error.js
var NotReadyError = class extends Error {
  constructor(r) {
    const o = Error;
    const t = o.stackTraceLimit;
    if (t) o.stackTraceLimit = 0;
    super();
    if (t) o.stackTraceLimit = t;
    this.source = r;
  }
};
var StatusError = class extends Error {
  constructor(r, o) {
    try {
      var t = String(o instanceof Error ? o.message : o);
    } catch {
    }
    super(t, {
      cause: o
    });
    this.source = r;
  }
};
function unwrapStatusError(r) {
  return r instanceof StatusError ? r.cause : r;
}
var TimeoutError = class extends Error {
  constructor(r = "Timed out waiting for condition") {
    super(r);
    this.name = "TimeoutError";
  }
};
var NoOwnerError = class extends Error {
  constructor() {
    super("");
  }
};
var ContextNotFoundError = class extends Error {
  constructor() {
    super("");
  }
};

// ../store-proto-features/packages/signals/dist/select/core/constants.js
var REACTIVE_NONE = 0;
var REACTIVE_CHECK = 1 << 0;
var REACTIVE_DIRTY = 1 << 1;
var REACTIVE_RECOMPUTING_DEPS = 1 << 2;
var REACTIVE_IN_HEAP = 1 << 3;
var REACTIVE_IN_HEAP_HEIGHT = 1 << 4;
var REACTIVE_ZOMBIE = 1 << 5;
var REACTIVE_DISPOSED = 1 << 6;
var REACTIVE_JOINED = 1 << 7;
var REACTIVE_SNAPSHOT_STALE = 1 << 8;
var REACTIVE_LAZY = 1 << 9;
var REACTIVE_MANUAL_WRITE = 1 << 10;
var REACTIVE_FRAME_READ = 1 << 11;
var REACTIVE_MISSED_WAKE = 1 << 12;
var REACTIVE_REASK = 1 << 13;
var REACTIVE_STAGED_READ = 1 << 14;
var REACTIVE_PROBED = 1 << 15;
var REACTIVE_LANE_DIRTY = 1 << 16;
var REACTIVE_LANE_READ = 1 << 17;
var REACTIVE_SCREEN_READ = 1 << 18;
var REACTIVE_PROBE_UNANSWERED = 1 << 19;
var REACTIVE_WINDOW = 1 << 21;
var REACTIVE_AHEAD = 1 << 20;
var REACTIVE_RELEASE_AFTER = 1 << 22;
var REACTIVE_OWNER_READS = 1 << 23;
var WINDOW_KINDS = 24;
var CONFIG_OWNED_WRITE = 1 << 0;
var CONFIG_NO_SNAPSHOT = 1 << 1;
var CONFIG_TRANSPARENT = 1 << 2;
var CONFIG_IN_SNAPSHOT_SCOPE = 1 << 3;
var CONFIG_CHILDREN_FORBIDDEN = 1 << 4;
var CONFIG_AUTO_DISPOSE = 1 << 5;
var CONFIG_SYNC = 1 << 6;
var CONFIG_STAGED = 1 << 7;
var CONFIG_HELD = 1 << 8;
var CONFIG_HELD_FRAME = 1 << 20;
var CONFIG_INPUTS_PUBLISHED = 1 << 10;
var CONFIG_OVERRIDE = 1 << 11;
var CONFIG_SLOT_NODE = 1 << 12;
var CONFIG_MANUAL_WRITE = 1 << 18;
var CONFIG_STAGED_ERROR = 1 << 21;
var CONFIG_GUESS = 1 << 13;
var CONFIG_VERDICT = 1 << 15;
var CONFIG_REDERIVE = 1 << 14;
var CONFIG_LAGS = 1 << 19;
var CONFIG_AUTHORITATIVE = 1 << 17;
var CONFIG_HAS_SNAPSHOT = 1 << 9;
var CONFIG_FRESH_READ = 1 << 16;
var CONFIG_PROMOTED = 1 << 22;
var CONFIG_FRAME = 1 << 23;
var CONFIG_MOUNT_AHEAD = 1 << 24;
var CONFIG_ASYNC = 1 << 29;
var CONFIG_OWN_PROBE = REACTIVE_WINDOW << 9;
var CONFIG_AHEAD = REACTIVE_AHEAD << 11;
var STATUS_NONE = 0;
var STATUS_PENDING = 1 << 0;
var STATUS_ERROR = 1 << 1;
var STATUS_UNINITIALIZED = 1 << 2;
var STATUS_NO_VALUE = 1 << 3;
var CAUGHT_REARMED = 2;
var EFFECT_RENDER = 1;
var EFFECT_USER = 2;
var EFFECT_TRACKED = 3;
var NOT_PENDING = {};
var NO_SNAPSHOT = {};
var SUPPORTS_PROXY = typeof Proxy === "function";
var defaultContext = {};
var $REFRESH = /* @__PURE__ */ Symbol("refresh");
var NewSet = Set;

// ../store-proto-features/packages/signals/dist/select/core/owner.js
function markDisposal(e) {
  let n = e.he;
  while (n) {
    n._ |= REACTIVE_ZOMBIE;
    markDisposal(n);
    n = n.He;
  }
}
function dispose(e) {
  e.l &= ~CONFIG_AUTO_DISPOSE;
  unobserved(e);
}
var cleanupError;
function runCleanup(e) {
  try {
    e();
  } catch (e2) {
    cleanupError ||= [e2];
    schedule();
  }
}
function rethrowCleanupError(e) {
  const n = cleanupError;
  cleanupError = void 0;
  if (n && !e) throw n[0];
}
function disposeChildren(e, n = false, r) {
  const t = e._;
  if (t & REACTIVE_DISPOSED) return;
  if (n) {
    if (!r && e.I !== null && (e.I.xe !== null || e.I.ye !== null)) disposeChildren(e, false, true);
    e._ = t | REACTIVE_DISPOSED;
    if (e.re) {
      clearInFlight(e);
      if (e.O & STATUS_PENDING && e.I?.v != null || t & REACTIVE_FRAME_READ || pendingNodes.length) schedule();
    }
  }
  let l = r ? e.I.xe : e.he;
  if (r) e.I.xe = null;
  else e.he = null;
  while (l) {
    l.l &= ~CONFIG_AUTO_DISPOSE;
    deleteFromHeap(l, dirtyQueue);
    clearDeps(l);
    l.Ye = l;
    disposeChildren(l, true);
    l = l.He;
  }
  if (!r) e.Me = 0;
  if (n && !r && !(t & REACTIVE_ZOMBIE) && e._parent !== null && !(e._parent._ & REACTIVE_DISPOSED)) {
    const n2 = e.Ye;
    const r2 = e.He;
    if (n2 !== null) n2.He = r2;
    else e._parent.he = r2;
    if (r2 !== null) r2.Ye = n2;
    e.Ye = null;
  }
  runDisposal(e, r);
  if (n && e.nt) {
    const n2 = e.nt;
    e.nt = void 0;
    runCleanup(n2);
  }
}
function linkChild(e, n) {
  const r = e.he;
  n.Ye = null;
  n.He = r;
  if (r !== null) r.Ye = n;
  e.he = n;
}
function runDisposal(e, n) {
  const r = n ? e.I.ye : e.Ue;
  if (!r) return;
  if (n) e.I.ye = null;
  else e.Ue = null;
  if (Array.isArray(r)) {
    for (let e2 = r.length - 1; e2 >= 0; e2--) {
      runCleanup(r[e2]);
    }
  } else {
    runCleanup(r);
  }
}
function childId(e, n) {
  while (e.l & CONFIG_TRANSPARENT && e._parent) e = e._parent;
  if (e.id != null) return formatId(e.id, n ? e.Me++ : e.Me);
  throw new Error();
}
function getNextChildId(e) {
  return childId(e, true);
}
function inheritId(e, n, r) {
  return e?.id ?? (n ? r?.id : r?.id != null ? getNextChildId(r) : void 0);
}
function peekNextChildId(e) {
  return childId(e, false);
}
function formatId(e, n) {
  const r = n.toString(36), t = r.length - 1;
  return e + (t ? String.fromCharCode(64 + t) : "") + r;
}
function getObserver() {
  return tracking ? context : null;
}
function getOwner() {
  return context;
}
function cleanup(e, n = context) {
  if (!n) return e;
  if (!n.Ue) n.Ue = e;
  else if (Array.isArray(n.Ue)) n.Ue.push(e);
  else n.Ue = [n.Ue, e];
  return e;
}
function isDisposed(e) {
  return !!(e._ & REACTIVE_DISPOSED);
}
function disposeRootSelf(e = true) {
  disposeChildren(this, e);
  if (cleanupError && !globalQueue.ee) rethrowCleanupError();
}
function createOwner(e) {
  const n = context;
  const r = e?.transparent ?? false;
  const t = {
    id: inheritId(e, r, n),
    l: r ? CONFIG_TRANSPARENT : 0,
    // Present from birth: disposeChildren marks death here on roots too, and
    // a first store of a missing property is a shape transition plus a
    // properties-store allocation per root — on a 100×4 table teardown that
    // was 12 KB and most of disposal's time.
    _: REACTIVE_NONE,
    ze: true,
    Xe: n?.ze ? n.Xe : n,
    he: null,
    He: null,
    Ye: null,
    Ue: null,
    D: n?.D || defaultContext,
    Me: 0,
    I: null,
    _parent: n,
    dispose: disposeRootSelf
  };
  if (n) linkChild(n, t);
  return t;
}
function createRoot(e, n) {
  const r = createOwner(n);
  return runWithOwner(r, () => e(disposeRootSelf.bind(r, true)));
}

// ../store-proto-features/packages/signals/dist/select/core/scheduler.js
var laneReadHook = null;
var laneStageHook = null;
var laneOutcomeHook = null;
var laneWriteHook = null;
var applyGuessesHook = null;
var laneSeamsHook = null;
var laneCorrectionsHook = null;
var endLanesHook = null;
var lanesBlockedHook = null;
var laneAdoptHook = null;
var r5Hook = null;
var laneServedHook = null;
var guessing = false;
function armGuessing() {
  guessing = true;
}
function installLaneHooks(e, o, n, t, l, s, u) {
  laneReadHook = e;
  laneStageHook = o;
  laneWriteHook = n;
  laneSeamsHook = t;
  endLanesHook = l;
  lanesBlockedHook = (e2) => {
    const o2 = judge;
    judge ??= e2;
    const n2 = s(e2);
    judge = o2;
    return n2;
  };
  laneServedHook = u;
}
function installGuessHooks(e, o, n) {
  laneOutcomeHook = e;
  applyGuessesHook = o;
  laneCorrectionsHook = n;
}
var catchHook = null;
var freshHook = null;
var hiddenHook = null;
var boundarySeamHook = null;
var heldRunHook = null;
function installBoundaryHooks(e, o, n, t, l) {
  catchHook = e;
  freshHook = o;
  hiddenHook = n;
  boundarySeamHook = t;
  heldRunHook = l;
}
var swapHook = null;
var storeParkHook = null;
var storeCommitHook = null;
function installStoreHooks(e, o) {
  storeParkHook = e;
  storeCommitHook = o;
}
var releaseMarksHook = null;
var releaseAmbientMarksHook = null;
function installMarkHooks(e, o) {
  releaseMarksHook = e;
  releaseAmbientMarksHook = o;
}
var observeFlightHook = null;
var holdWorkHook = null;
var stageMarkHook = null;
var keepReadersHook = null;
var attachHook = null;
var holdStagingHook = null;
var revertHook = null;
var passHook = null;
function installVerdictHooks(e, o, n, t, l, s, u, r, a, i) {
  revertHook = a;
  passHook = i;
  observeFlightHook = e;
  holdWorkHook = o;
  stageMarkHook = n;
  keepReadersHook = t;
  attachHook = l;
  holdStagingHook = s;
  laneAdoptHook = u;
  r5Hook = r;
}
var wireExternalSourceHook = void 0;
var externalUntrackHook = void 0;
var transactions = [];
function newTransaction(e, o = null) {
  const n = {
    ts: [],
    ft: [[], []],
    rn: [],
    eo: null,
    _parent: o,
    L: e,
    Ve: null,
    $: 0,
    tt: false,
    nn: null,
    Je: false,
    sn: false,
    m: null
  };
  if (!e) transactions.push(n);
  return n;
}
var passLane = null;
function setPassLane(e) {
  passLane = e;
}
var flushTransaction = null;
var passTx = null;
function joinPassTx(e, o) {
  if (globalQueue.ee && !o || flushTransaction !== null) return joinFuture(e);
  if (passTx === null) passTx = resolveTx(e);
  else merge(resolveTx(e), passTx);
  schedule();
}
function txOf(e) {
  return e.I.v = resolveTx(e.I.v);
}
function liveTx(e) {
  e = resolveTx(e);
  return transactions.indexOf(e) !== -1 ? e : null;
}
function resolveTx(e) {
  while (e.eo !== null) e = e.eo;
  return e;
}
function dropFlushTx() {
  for (let e = adopted.length - 2; e >= 0; e -= 2) {
    const o = adopted[e], n = o.eo;
    o.eo = null;
    n.$ -= o.$;
    n.tt = adopted[e + 1];
    unappend(n.ts, o.ts);
    unappend(n.ft[0], o.ft[0]);
    unappend(n.ft[1], o.ft[1]);
    unappend(n.rn, o.rn);
    unappend(n.m, o.m);
    transactions.push(o);
  }
  adopted.length = 0;
  flushTransaction = null;
}
function unappend(e, o) {
  if (o) for (let n = o.length; n--; ) e.splice(e.lastIndexOf(o[n]) >>> 0, 1);
}
function joinFuture(e) {
  if (laneStageHook && e?.L) return;
  const o = e && liveTx(e), n = flushTransaction;
  if (n === null) {
    if (e === null || o) flushTransaction = o || newTransaction(false);
  } else if (o) merge(o, n);
  if (!globalQueue.ee) schedule();
}
var adopted = [];
function merge(e, o) {
  e = resolveTx(e);
  o = resolveTx(o);
  if (e === o || e.L || o.L) return;
  if (observeFlightHook && adopter) adopted.push(e, o.tt);
  e.eo = o;
  o.$ += e.$;
  o.tt ||= e.tt;
  append(o.ts, e.ts);
  append(o.ft[0], e.ft[0]);
  append(o.ft[1], e.ft[1]);
  append(o.rn, e.rn);
  if (e.m !== null) append(o.m ??= [], e.m);
  transactions.splice(transactions.indexOf(e), 1);
}
function blocked(e) {
  return e.$ !== 0 || blockedBy(e.ts, e) || !!lanesBlockedHook?.(e);
}
var judge = null;
function ownFlights(e) {
  return blockedBy(e.ts, e, ownSource);
}
function ownSource(e, o) {
  const n = e.I?.X;
  if (n === void 0) return true;
  for (const e2 of n) {
    const n2 = e2.I?.v;
    if (n2 == null || resolveTx(n2) === o) return true;
  }
  return false;
}
function blockedBy(e, o, n) {
  for (let t = 0; t < e.length; t++) {
    const l = e[t];
    if (!(l.O & STATUS_PENDING) || l._ & REACTIVE_DISPOSED || l.l & CONFIG_GUESS || l.I.v !== null && txOf(l) !== o || n && !n(l, o) || // A guess lane's member waiting on re-asks only (`reasks`) keeps what
    // it shows, and a `refresh()` holds nothing new (D-34 ¶3): it does not
    // keep the lane's other work off the screen (#4834: a memo over the
    // shown guess and a fresh answer stayed on its stale committed value).
    guessing && o.L && l.I.X && reasks(l)) continue;
    if (l.i === EFFECT_RENDER) {
      if (!(observeFlightHook && l.l & CONFIG_AHEAD && !o.L) && onScreen(l, judge ?? o)) return true;
      continue;
    }
    for (let e2 = l.o; e2 !== null; e2 = e2.t) {
      const n2 = e2.u;
      if ((n2.i === EFFECT_RENDER && n2.O & STATUS_PENDING && !(observeFlightHook && n2.l & CONFIG_AHEAD && !o.L) || n2._ & REACTIVE_FRAME_READ || n2.l & CONFIG_REDERIVE && n2.O === STATUS_PENDING) && (e2.Ae === n2.Re || n2.I?.P != null) && !(n2._ & REACTIVE_DISPOSED) && onScreen(n2, judge ?? o)) return true;
    }
  }
  return false;
}
function onScreen(e, o) {
  return !hiddenHook?.(e) && !(e._ & REACTIVE_ZOMBIE && removalStagedBy(e, o));
}
function removalStagedBy(e, o) {
  while (e?._ & REACTIVE_ZOMBIE) e = e._parent;
  return e?.l & CONFIG_HELD && e.I?.v != null && txOf(e) === resolveTx(o);
}
var heldTrims = [];
function heldTrim(e) {
  heldTrims.push(e);
}
var deferredZombies = [];
function deferZombie(e) {
  deleteFromHeap(e, dirtyQueue);
  e._ &= -4;
  deferredZombies.push(e);
}
function holdNode(e, o) {
  e.l |= CONFIG_HELD;
  list(e, o);
}
function list(e, o) {
  const n = ext(e);
  if (n.v === o) return;
  n.v = o;
  o.ts.push(e);
}
function holdFrame(e, o) {
  for (let n = e.he; n !== null; n = n.He) {
    if (n.I?.v?.L) continue;
    if (n.re !== void 0) {
      if (!(n.l & CONFIG_HELD)) holdNode(n, o);
      n.l |= CONFIG_HELD_FRAME;
    }
    holdFrame(n, o);
  }
}
function heldUnder(e, o, n) {
  for (let t = e.he; t !== null; t = t.He) {
    if ((t.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD && txOf(t) !== o) n(t);
    heldUnder(t, o, n);
  }
}
function unhold(e) {
  e.I.v = null;
  e.l &= ~CONFIG_HELD;
}
var dirtyQueue = {
  It: new Array(2e3).fill(void 0),
  N: false,
  ke: 0,
  it: 0
};
var clock = 0;
var scheduled = false;
var halted = false;
var haltNotified = false;
var syncDepth = 0;
var actionDepth = 0;
function enterAction() {
  actionDepth++;
}
function exitAction() {
  actionDepth--;
}
var question = 0;
var questions = 0;
function setQuestion(e) {
  question = e;
}
function nextQuestion() {
  return ++questions;
}
var MAINLINE_QUESTION = 2147483647;
function schedule() {
  if (halted) {
    notifyHalted();
    return;
  }
  if (scheduled) return;
  scheduled = true;
  if (!syncDepth && !globalQueue.ee) {
    queueMicrotask(flush);
  }
}
var ROOT_ERROR_HOOK = /* @__PURE__ */ Symbol.for("solid-js/root-error-hook");
var HALTED = "[REACTIVITY_HALTED]";
function haltReactivity(e) {
  if (halted) return;
  halted = true;
  rethrowCleanupError(true);
  let o = HALTED;
  const n = e !== void 0 && globalThis.reportError;
  n || e === void 0 ? console.error(o) : console.error(o, e);
  n && n(e);
}
function notifyHalted() {
  if (haltNotified) return;
  haltNotified = true;
  console.error(HALTED);
}
var GlobalQueue = class _GlobalQueue {
  ft = [[], []];
  ee = false;
  flush() {
    if (this.ee) return;
    this.ee = true;
    resyncUnflushedCompanions();
    passLane = null;
    passTx = null;
    try {
      sweepDormant();
      if (revertHook) revertHook();
      runHeap(dirtyQueue, _GlobalQueue.Ce);
      this.settle();
      clock++;
      scheduled = dirtyQueue.it >= dirtyQueue.ke || pendingNodes.length !== 0;
      this.run(EFFECT_RENDER);
      this.run(EFFECT_USER);
      if (false) ;
      if (false) ;
      if (false) ;
    } finally {
      this.ee = false;
      passTx = null;
    }
  }
  /** L2 — the seam: end of the pure phase. Commit this flush's staged nodes,
   * or park them with the transaction the flush joined; then land every
   * transaction no frame is waiting on. The landing flush is an ordinary
   * flush: the settle walk (async.ts) re-ran the parked readers in its pure
   * phase, and here no flight the transaction holds has a frame deriving
   * from it (`blocked`). */
  settle() {
    if (laneCorrectionsHook?.()) runHeap(dirtyQueue, _GlobalQueue.Ce);
    const e = flushTransaction;
    flushTransaction = null;
    applyGuessesHook?.(e);
    const o = e !== null && !e.L ? resolveTx(e) : null;
    if (o !== null) {
      const e2 = pendingNodes.length;
      for (let n3 = 0; n3 < e2; n3++) {
        const e3 = pendingNodes[n3];
        if (!(e3.l & (CONFIG_HELD | CONFIG_OVERRIDE)) && (e3.I === null || e3.I.v === null || !e3.I.v.L)) {
          if (e3.ce === NOT_PENDING && e3.O & STATUS_UNINITIALIZED && e3.i !== EFFECT_RENDER) continue;
          if (e3.ce !== NOT_PENDING && !(e3.O & (STATUS_PENDING | STATUS_UNINITIALIZED)) && e3.I?.xe == null && e3.I?.ye == null && // A recovery to the last good value is a change of answer
          // (D-41): the error it replaces stays the display until it
          // commits, so it is held, not netted.
          !e3.I?.Te && // The comparator last: a pass that created children (an object
          // owning a fresh async memo, #4111) must not have it read them.
          // A NotReady read there is a change (`isSame`).
          isSame(e3, e3.ue, e3.ce)) {
            e3.ce = NOT_PENDING;
            e3.l &= ~CONFIG_STAGED;
            continue;
          }
          holdNode(e3, o);
        }
        if (e3.l & CONFIG_STAGED) holdFrame(e3, o);
      }
      pendingNodes.length = 0;
      storeParkHook?.(o);
      const n2 = deferredZombies.splice(0);
      if (observeFlightHook) {
        n2.sort((e3, o2) => e3.Pe - o2.Pe);
        for (let e3 = 0; e3 < n2.length; e3++) if ((n2[e3]._ & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE)) === REACTIVE_ZOMBIE && n2[e3].l & CONFIG_VERDICT) recompute(n2[e3]);
      }
    } else {
      commitPendingNodes();
      for (let e2 = 0; e2 < heldTrims.length; e2++) {
        const o2 = heldTrims[e2];
        if (o2.I?.P == null && !o2.Oe) trimStaleDeps(o2);
      }
    }
    if (heldTrims.length) heldTrims.length = 0;
    const n = this.ft;
    let t = null;
    if (laneSeamsHook) {
      this.ft = t = [[], []];
      laneSeamsHook(o);
      if (stagedReaders.length) stagedReaders.length = 0;
    }
    this.ft = [[], []];
    for (let e2 = transactions.length - 1; e2 >= 0; e2--) {
      const o2 = transactions[e2];
      if (blocked(o2)) continue;
      transactions.splice(e2, 1);
      endLanesHook?.(o2);
      land(o2);
      e2 = transactions.length;
    }
    storeCommitHook?.();
    const l = o && liveTx(o);
    releaseAmbientMarksHook?.(l);
    const s = l !== null;
    for (let e2 = 0; e2 < 2; e2++) {
      if (s) append(l.ft[e2], n[e2]);
      this.ft[e2] = s || t?.[e2].length || this.ft[e2].length ? (t ? t[e2] : []).concat(s ? [] : n[e2], this.ft[e2]) : n[e2];
    }
    if (deferredZombies.length !== 0) {
      const e2 = deferredZombies.splice(0).sort((e3, o2) => e3.Pe - o2.Pe);
      for (let o2 = 0; o2 < e2.length; o2++) {
        if (!(e2[o2]._ & REACTIVE_DISPOSED)) recompute(e2[o2]);
      }
    }
    boundarySeamHook?.();
  }
  run(e) {
    const o = this.ft[e - 1];
    if (o.length) {
      this.ft[e - 1] = [];
      runQueue(o, e);
    }
  }
  enqueue(e, o, n = passLane) {
    if (e) (n?.L ? n : this).ft[e - 1].push(o);
    schedule();
  }
  /** Status reaching the root: pending is absorbed (the root mount defers —
   * dev records it for the ASYNC_OUTSIDE_LOADING_BOUNDARY FYI); an error is
   * unhandled (`false` → the caller halts).
   *
   * L2: this is where a transaction is registered. Pending that reaches an
   * observer (a render effect: the frame) is a frame that cannot show — the
   * flush parks, and the transaction waits on the flight while a frame
   * derives from it (`blocked`). Pending nobody observes holds nothing: a
   * memo in flight that no frame reads is not a frame waiting. (Base: the
   * queue's `_asyncReporters`, INV-3's one registration site.)
   *
   * A boundary between the observer and the root (boundaries.ts) is asked
   * first: a fallback catches what is not ready under it, and the root
   * never hears of it. */
  notify(e, o, n, t) {
    if (catchHook?.(e, n & o, t)) return true;
    if (o & STATUS_PENDING) {
      if (n & STATUS_PENDING) {
        if (passLane === null) joinFuture(null);
      }
      return true;
    }
    return false;
  }
};
function reruns(e) {
  let o;
  for (let n = 0; n < e.rn.length; n++) {
    const t = e.rn[n];
    const l = t.I?.P?.source;
    if (t._ & REACTIVE_DISPOSED || t.O & STATUS_ERROR && (t.i || !(t.l & CONFIG_FRAME)) && l !== t && (l?.O ?? STATUS_ERROR) & STATUS_ERROR) continue;
    if (t._ & REACTIVE_FRAME_READ || observeFlightHook && t.l & CONFIG_VERDICT) {
      o = 1;
      if (!e.L) t._ &= ~REACTIVE_FRAME_READ;
      t.Oe = false;
      for (let e2 = t.he; e2 !== null; e2 = e2.He) if (e2.i) e2.Oe = false;
      laneAdoptHook?.(t);
      enqueueSub(t);
    }
  }
  e.rn.length = 0;
  return o;
}
function land(e) {
  const o = reruns(e);
  if (releaseMarksHook && e.m !== null) releaseMarksHook(e.m);
  for (let o2 = 0; o2 < e.ts.length; o2++) {
    const n = e.ts[o2];
    if (n.I.v === null || txOf(n) !== e) continue;
    n.I.v = null;
    commitPendingNode(n);
  }
  if (o) globalQueue.ft[1].push(() => releaseQueues(e));
  else releaseQueues(e);
}
function releaseQueues(e) {
  for (let o = 0; o < 2; o++) {
    append(globalQueue.ft[o], e.ft[o]);
    e.ft[o] = [];
  }
}
function append(e, o) {
  for (let n = 0; n < o.length; n++) e.push(o[n]);
}
var pendingNodes = [];
var heldRewrites = [];
var stagedReaders = [];
function staleReader(e, o) {
  o.rn.push(e);
  e._ |= REACTIVE_FRAME_READ;
}
function queuePendingNode(e) {
  pendingNodes.push(e);
  if (!globalQueue.ee) markUnflushedStaged();
}
var notifyEpoch = 0;
function bumpNotifyEpoch() {
  notifyEpoch++;
}
function insertSubs(e) {
  e.je = notifyEpoch;
  const o = e.l;
  const n = (o & CONFIG_HAS_SNAPSHOT) !== 0 && e.I?.Fe !== void 0;
  for (let o2 = e.o; o2 !== null; o2 = o2.t) {
    const t = o2.u;
    if (t._ & REACTIVE_RECOMPUTING_DEPS && o2.Ae === t.Re && (o2 !== t.C || !e.re)) t._ |= REACTIVE_MISSED_WAKE;
    if (n && t.l & CONFIG_IN_SNAPSHOT_SCOPE) {
      t._ |= REACTIVE_SNAPSHOT_STALE;
      continue;
    }
    enqueueSub(t);
    if (t._ & REACTIVE_OWNER_READS) markNode(t._parent, REACTIVE_CHECK);
  }
}
function reasks(e, o = new NewSet()) {
  return [...e.I.X ?? [e]].every((n) => n === e ? n.I.Le : o.has(n) || (o.add(n), reasks(n, o)));
}
function laneDirty(e, o) {
  insertSubs(e);
  if (e.l & CONFIG_SLOT_NODE) GlobalQueue.oo?.(e, o);
  for (let n = e.o; n !== null; n = n.t) {
    const t = n.u;
    let l = t.I?.v, s = t.i === EFFECT_RENDER;
    if ((t.O & (STATUS_PENDING | STATUS_UNINITIALIZED)) === STATUS_PENDING && !(t.l & CONFIG_OVERRIDE) && (reasks(t) || !t.i && l && !l.L && resolveTx(l) === resolveTx(o._parent))) list(t, l = o);
    if (s && e.l & CONFIG_VERDICT) t.l |= CONFIG_VERDICT, t._ &= ~REACTIVE_LANE_DIRTY;
    if (l?.L ? sameLane(l, o) || t._ & REACTIVE_ZOMBIE : t.i) t._ |= REACTIVE_LANE_DIRTY;
  }
}
function queueEffectRun(e) {
  e.Oe = true;
  globalQueue.enqueue(e.i, e.q ??= GlobalQueue.K.bind(null, e));
}
function sameLane(e, o) {
  return e === o || e.nn !== null && e.nn === o.nn;
}
function applyStaged(e) {
  return e.ce !== NOT_PENDING && (e.ue = e.ce, e.ce = NOT_PENDING);
}
function superseded(e) {
  return !(e.O & STATUS_UNINITIALIZED) && !!e.I?.Se && !e.I.Le && (e.ce = NOT_PENDING, true);
}
function commitPendingNode(e) {
  if (!e.re) {
    e.l &= -385;
    applyStaged(e);
    return;
  }
  const o = (e.O & STATUS_PENDING) !== 0 && (e.ce === NOT_PENDING || superseded(e));
  const n = e.l & CONFIG_STAGED_ERROR;
  if (!o && e.I) e.I.Te = null;
  e.l = o ? e.l & -1048833 | CONFIG_INPUTS_PUBLISHED : e.l & -3147137;
  if (n) {
    const o2 = e.ce;
    e.ce = NOT_PENDING;
    e.Ie = clock + 1;
    notifyStatus(e, STATUS_ERROR, o2);
  } else if (applyStaged(e)) {
    e.O &= ~STATUS_UNINITIALIZED;
    if (e.I != null) e.I.Le = false, e.I.Ke = NOT_PENDING;
    if (e.i && e.i !== EFFECT_TRACKED) queueEffectRun(e);
  }
  e.Ne = false;
  e._ &= ~REACTIVE_MANUAL_WRITE;
  if (e.I?.P == null) trimStaleDeps(e);
  if (!(e.O & STATUS_PENDING)) e.O &= ~STATUS_UNINITIALIZED;
  if (!o && e.I != null && (e.I.xe !== null || e.I.ye !== null)) GlobalQueue.pe(e, false, true);
}
function commitPendingNodes() {
  for (let e = 0; e < pendingNodes.length; e++) {
    const o = pendingNodes[e];
    if (!(o.l & (CONFIG_OVERRIDE | CONFIG_HELD))) commitPendingNode(o);
  }
  pendingNodes.length = 0;
}
var globalQueue = new GlobalQueue();
function flush(e) {
  if (actionDepth > 0) {
    return e ? e() : void 0;
  }
  if (e) {
    syncDepth++;
    try {
      return e();
    } finally {
      try {
        flush();
      } finally {
        syncDepth--;
      }
    }
  }
  if (globalQueue.ee) {
    return;
  }
  if (halted) return;
  while (scheduled) {
    globalQueue.flush();
  }
  rethrowCleanupError();
}
function runQueue(e, o) {
  for (let n = 0; n < e.length; n++) e[n](o);
}

// ../store-proto-features/packages/signals/dist/select/core/heap.js
function enqueueSub(e) {
  if (dirtyQueue.ke > e.Pe) dirtyQueue.ke = e.Pe;
  insertIntoHeap(e, dirtyQueue);
}
function actualInsertIntoHeap(e, t) {
  const E = (e._parent?.ze ? e._parent.Xe?.Pe : e._parent?.Pe) ?? -1;
  if (E >= e.Pe) e.Pe = E + 1;
  const n = e.Pe;
  const I = t.It[n];
  if (I === void 0) t.It[n] = e;
  else {
    const t2 = I.we;
    t2.Ze = e;
    e.we = t2;
    I.we = e;
  }
  if (n > t.it) t.it = n;
}
function insertIntoHeap(e, t) {
  let E = e._;
  if (E & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS)) return;
  if (E & REACTIVE_CHECK) {
    e._ = E & -4 | REACTIVE_DIRTY | REACTIVE_IN_HEAP;
  } else {
    e._ = E | REACTIVE_IN_HEAP;
    if (t.N) markNode(e);
  }
  if (!(E & REACTIVE_IN_HEAP_HEIGHT)) actualInsertIntoHeap(e, t);
}
function insertIntoHeapHeight(e, t) {
  let E = e._;
  if (E & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS | REACTIVE_IN_HEAP_HEIGHT)) return;
  e._ = E | REACTIVE_IN_HEAP_HEIGHT;
  actualInsertIntoHeap(e, t);
}
function deleteFromHeap(e, t) {
  const E = e._;
  if (!(E & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT))) return;
  e._ = E & -25;
  const n = e.Pe;
  if (e.we === e) t.It[n] = void 0;
  else {
    const E2 = e.Ze;
    const I = t.It[n];
    const i = E2 ?? I;
    if (e === I) t.It[n] = E2;
    else e.we.Ze = E2;
    i.we = e.we;
  }
  e.we = e;
  e.Ze = void 0;
}
function markHeap(e) {
  if (e.N) return;
  e.N = true;
  for (let t = 0; t <= e.it; t++) {
    for (let E = e.It[t]; E !== void 0; E = E.Ze) {
      if (E._ & REACTIVE_IN_HEAP) markNode(E);
    }
  }
}
function markNode(e, t = REACTIVE_DIRTY) {
  const E = e._;
  if ((E & (REACTIVE_CHECK | REACTIVE_DIRTY)) >= t) return;
  e._ = E & -4 | t;
  for (let t2 = e.o; t2 !== null; t2 = t2.t) {
    markNode(t2.u, REACTIVE_CHECK);
  }
}
function runHeap(e, t) {
  e.N = false;
  for (e.ke = 0; e.ke <= e.it; e.ke++) {
    let E = e.It[e.ke];
    while (E !== void 0) {
      if (E._ & REACTIVE_IN_HEAP) t(E);
      else adjustHeight(E, e);
      E = e.It[e.ke];
    }
  }
  e.it = 0;
}
function adjustHeight(e, t) {
  deleteFromHeap(e, t);
  let E = e.Pe;
  for (let t2 = e.G; t2; t2 = t2.S) {
    const e2 = t2.p;
    if (e2.re && e2.Pe >= E) E = e2.Pe + 1;
  }
  if (e.Pe !== E) {
    e.Pe = E;
    liftOwned(e, E);
    for (let E2 = e.o; E2 !== null; E2 = E2.t) if (E2.u !== e._parent) insertIntoHeapHeight(E2.u, t);
  }
}
function liftOwned(e, t) {
  for (let E = e.he; E; E = E.He) if (E.ze) liftOwned(E, t);
  else if (E.Pe <= t) {
    const e2 = E._ & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
    deleteFromHeap(E, dirtyQueue);
    E.Pe = t + 1;
    if (e2) (e2 & REACTIVE_IN_HEAP ? insertIntoHeap : insertIntoHeapHeight)(E, dirtyQueue);
    liftOwned(E, t + 1);
  }
}

// ../store-proto-features/packages/signals/dist/select/core/graph.js
var slotUnobservedHook;
function setSlotUnobserved(e) {
  slotUnobservedHook = e;
}
function unlinkSubs(e) {
  const n = e.p;
  const l = e.S;
  const o = e.t;
  const s = e.en;
  if (o !== null) o.en = s;
  else n.Be = s;
  if (s !== null) s.t = o;
  else {
    n.o = o;
    if (o === null) {
      if (n.l & CONFIG_SLOT_NODE) slotUnobservedHook(n);
      else if (n.I?.Qe) runCleanup(n.I.Qe);
      n.re && n.l & CONFIG_AUTO_DISPOSE && !(n._ & REACTIVE_ZOMBIE) && !(n.O & STATUS_PENDING) && (deferredReleases ? deferredReleases.push(n) : unobserved(n));
    }
  }
  return l;
}
function trimStaleDeps(e) {
  const n = e.C;
  let l = n !== null ? n.S : e.G;
  if (l !== null) {
    do {
      l = unlinkSubs(l);
    } while (l !== null);
    if (n !== null) n.S = null;
    else e.G = null;
  }
}
function clearDeps(e) {
  if (e.G) {
    e.C = null;
    trimStaleDeps(e);
  }
}
var deferredReleases = null;
var deferReleases = (e) => deferredReleases = e;
function unobserved(e) {
  deleteFromHeap(e, dirtyQueue);
  clearDeps(e);
  disposeChildren(e, true);
}
var dormantNodes = new NewSet();
function sweepDormant() {
  if (dormantNodes.size === 0) return;
  for (const e of dormantNodes) {
    if (!e.o && e.l & CONFIG_AUTO_DISPOSE && !(e.O & STATUS_PENDING) && !(e._ & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE))) {
      unobserved(e);
    }
  }
  dormantNodes.clear();
}
function link(e, n) {
  const l = n.C;
  if (l !== null && l.p === e) return;
  let o = null;
  const s = n._ & REACTIVE_RECOMPUTING_DEPS;
  if (s) {
    o = l !== null ? l.S : n.G;
    if (o !== null && o.p === e) {
      o.Ae = n.Re;
      return n.C = o;
    }
  }
  const r = e.Be;
  if (r !== null && r.u === n && (!s || r.Ae === n.Re)) return;
  const t = n.C = e.Be = {
    p: e,
    u: n,
    S: o,
    en: r,
    t: null,
    Ae: n.Re
  };
  if (l !== null) l.S = t;
  else n.G = t;
  if (r !== null) r.t = t;
  else e.o = t;
  bumpNotifyEpoch();
}

// ../store-proto-features/packages/signals/dist/select/core/async.js
function addPendingSource(e, n) {
  if (e.I?.X?.has(n)) return false;
  (ext(e).X ??= new NewSet()).add(n);
  return true;
}
function removePendingSource(e, n) {
  const t = e.I?.X;
  if (!t?.delete(n)) return false;
  if (!t.size) e.I.X = void 0;
  return true;
}
function clearInFlight(e) {
  if (e.I !== null) e.I.Se = null;
}
function clearPendingSources(e) {
  if (e.I !== null) e.I.X = void 0;
}
function retryReaches(e, n) {
  for (let t = e.G; t; t = t.S) {
    const e2 = t.p;
    if (!(e2._ & REACTIVE_DISPOSED) && (e2 === n ? e2.O & STATUS_PENDING : e2.I?.X?.has(n))) return true;
  }
  return false;
}
function parkLoadingWindow(e, n) {
  ext(e).Ee = true;
  if (n.source) addPendingSource(e, n.source);
  if (!(e.O & STATUS_ERROR)) setPendingError(e, n.source, n);
}
function setPendingError(e, n, t) {
  if (!n) {
    if (e.I !== null) e.I.P = null;
    return;
  }
  const r = t instanceof NotReadyError && t.source === n ? t : e.I?.P;
  ext(e).P = r instanceof NotReadyError && r.source === n ? r : new NotReadyError(n);
}
function forEachDependent(e, n) {
  for (let t = e.o; t !== null; t = t.t) n(t.u, t);
}
function walkDependents(e, n) {
  const t = new NewSet();
  const visit = (e2) => {
    const r = t.has(e2);
    if (n(e2, r) !== false && !r) {
      t.add(e2);
      forEachDependent(e2, visit);
    }
  };
  forEachDependent(e, visit);
}
function releaseIfSettledUnobserved(e) {
  if (e.re && e.l & CONFIG_AUTO_DISPOSE && !e.o && !(e._ & REACTIVE_ZOMBIE) && !(e.O & STATUS_PENDING)) e._ & REACTIVE_IN_HEAP ? e._ |= REACTIVE_RELEASE_AFTER : unobserved(e);
}
function releaseSettledDependents(e) {
  let n;
  walkDependents(e, (e2, t) => {
    if (!t && !e2.o && e2.l & CONFIG_AUTO_DISPOSE) (n ??= []).push(e2);
  });
  if (n) for (const e2 of n) releaseIfSettledUnobserved(e2);
}
function stageError(e, n, t) {
  if (!(e.l & CONFIG_HELD || t && e._ & REACTIVE_STAGED_READ && globalQueue.ee && !e.T) || passLane) return false;
  clearPendingSources(e);
  if (e.I) e.I.Ee = false;
  if (!((e.O &= STATUS_ERROR | STATUS_UNINITIALIZED) & STATUS_ERROR)) setPendingError(e);
  e.ce = n instanceof StatusError ? n : new StatusError(e, n);
  e.l |= CONFIG_STAGED | CONFIG_STAGED_ERROR;
  settlePendingSource(e);
  schedule();
  return true;
}
function settleErroredDependents(e, n) {
  let t = false;
  walkDependents(e, (e2, r) => {
    if (!r && e2.I?.P === n) {
      enqueueSub(e2);
      t = true;
    }
  });
  if (t) schedule();
}
function settlePendingSource(e, n = e) {
  removePendingSource(e, n);
  let t = false;
  let r;
  walkDependents(e, (o, s) => {
    if (s || // Another dependency may still carry the source. Not marked visited: that
    // dependency may be a later branch of this walk.
    n !== e && retryReaches(o, n) || !removePendingSource(o, n))
      return holdWorkHook && (o.l & CONFIG_VERDICT ? enqueueSub(o) : stageMarkHook(o, e)), false;
    o.Ie = clock;
    const i = o.I?.X?.values().next().value;
    const f = o.O & STATUS_ERROR;
    if (i) {
      if (!f) setPendingError(o, i);
    } else {
      o.O &= ~STATUS_PENDING;
      if (!f) setPendingError(o);
      if (o.l & CONFIG_HELD && !(n.O & STATUS_PENDING)) joinFuture(txOf(o));
      if (o.I?.Ee) {
        enqueueSub(o);
        t = true;
      } else if (storeParkHook) o.T?.st();
      if (o.I !== null) o.I.Ee = false;
      if (!o.o && o.l & CONFIG_AUTO_DISPOSE) (r ??= []).push(o);
      stageMarkHook?.(o, e);
    }
  });
  if (r) for (const e2 of r) releaseIfSettledUnobserved(e2);
  if (t) schedule();
}
function isThenable(e) {
  return e != null && typeof e === "object" && typeof e.then === "function";
}
function releaseFlightTeardown(e) {
  const n = e.I?.de;
  if (n != null) {
    e.I.de = null;
    n();
  }
}
function handleAsync(e, n, t, r) {
  let o = false;
  let s = false;
  if (typeof n === "object" && n !== null) {
    untrack(() => {
      o = n[Symbol.asyncIterator];
      s = !o && isThenable(n);
    });
  }
  if (!s && !o) {
    if (e.I !== null) {
      e.I.Se = null;
      if (holdWorkHook) e.l &= ~CONFIG_ASYNC;
    }
    e.Ne = false;
    return n;
  }
  ext(e).Se = n;
  if (holdWorkHook) e.l |= CONFIG_ASYNC;
  e.I._e = question || MAINLINE_QUESTION;
  e.I.X = void 0;
  let i;
  const handleError = (t2) => {
    if (e.I?.Se !== n) return;
    let o2 = t2 instanceof NotReadyError;
    if (o2 && e.Ne) {
      clearInFlight(e);
      parkLoadingWindow(e, t2);
      e.Ie = clock;
      return;
    }
    if (o2 || !stageError(e, t2)) {
      notifyStatus(e, o2 ? STATUS_PENDING : STATUS_ERROR, t2);
      if (!o2) disposeChildren(e, false, true);
    }
    if (o2) settlePendingSource(e);
    e.Ie = clock;
    if (!o2) releaseSettledDependents(e);
    r?.(t2, o2);
  };
  const asyncWrite = (r2, o2) => {
    if (e.I?.Se !== n) return;
    if (e._ & REACTIVE_DIRTY && !(holdWorkHook && e.O & STATUS_UNINITIALIZED)) return;
    const s2 = holdWorkHook && pendingNodes.some((e2) => e2.ce !== NOT_PENDING);
    const i2 = e.O & STATUS_UNINITIALIZED;
    landStatus(e);
    if (t) {
      if (!t(r2, i2, handleError)) return;
    } else {
      setSignal(e, () => r2);
    }
    if (e.ce === NOT_PENDING) {
      e.Ne = false;
      trimStaleDeps(e);
    }
    settlePendingSource(e);
    schedule();
    if (o2 || !s2) flush();
    o2?.();
  };
  const settleAutodispose = () => {
    if (e.l & CONFIG_AUTO_DISPOSE && !e.o && !(e.O & STATUS_PENDING)) {
      unobserved(e);
      return true;
    }
    return false;
  };
  const consumeIterator = (t2, r2) => {
    const o2 = t2[Symbol.asyncIterator]();
    let s2 = false;
    let f2 = false;
    let u = !r2;
    const close = () => {
      if (f2) return;
      f2 = true;
      try {
        const e2 = o2.return?.();
        if (isThenable(e2)) e2.then(void 0, () => {
        });
      } catch {
      }
    };
    cleanup(close, r2);
    ext(e).de = close;
    const iterateOrRelease = () => {
      try {
        if (!settleAutodispose()) iterate();
      } catch (e2) {
        handleError(e2);
      }
    };
    const iterate = () => {
      let t3, r3, l2 = false, a = false, S = true;
      const E = o2.next();
      const c = isThenable(E) ? E : {
        then: (e2) => void e2(E)
      };
      c.then((r4) => {
        if (S && u) {
          t3 = r4;
          l2 = true;
          if (r4.done) f2 = true;
        } else if (e.I?.Se !== n) {
          return;
        } else if (!r4.done) {
          s2 = true;
          asyncWrite(r4.value, iterateOrRelease);
        } else {
          f2 = true;
          if (s2) {
            schedule();
            flush();
          } else {
            asyncWrite(void 0);
          }
          settleAutodispose();
        }
      }, (t4) => {
        if (S && u) {
          r3 = t4;
          a = true;
        } else if (e.I?.Se === n) {
          f2 = true;
          handleError(t4);
          settleAutodispose();
        }
      });
      S = false;
      if (a) {
        f2 = true;
        handleError(r3);
        if (u) throw r3;
        return true;
      }
      if (l2 && !t3.done) {
        i = t3.value;
        s2 = true;
        return iterate();
      }
      return l2 && t3.done;
    };
    const l = iterate();
    u = false;
    return s2 || l;
  };
  let f = null;
  const flattenIfIterable = (e2, n2) => {
    let t2 = false;
    if (typeof e2 === "object" && e2 !== null) {
      untrack(() => {
        t2 = e2[Symbol.asyncIterator];
      });
    }
    if (!t2) return false;
    i = void 0;
    const r2 = consumeIterator(e2, n2);
    if (!n2) f = r2;
    return true;
  };
  if (s) {
    let t2 = false, r2 = false, o2, s2 = true;
    n.then((r3) => {
      if (s2) {
        i = r3;
        t2 = true;
      } else {
        try {
          if (e.I?.Se === n && !(e._ & REACTIVE_DISPOSED) && flattenIfIterable(r3, e)) return;
          asyncWrite(r3);
        } catch (e2) {
          handleError(e2);
        }
        settleAutodispose();
      }
    }, (e2) => {
      if (s2) {
        o2 = e2;
        r2 = true;
      } else {
        handleError(e2);
        settleAutodispose();
      }
    });
    s2 = false;
    if (r2) {
      handleError(o2);
      throw o2;
    } else if (!t2) {
      f = false;
    } else if (!flattenIfIterable(i)) {
      e.Ne = false;
    }
  }
  if (o) flattenIfIterable(n);
  if (f !== null) {
    if (!f) {
      if (e.Ne) return e.ue;
      throw new NotReadyError(context);
    }
    e.Ne = false;
  }
  return i;
}
function clearStatus(e, n = false) {
  if (e.I?.X) clearPendingSources(e);
  if (e.I?.Ee) e.I.Ee = false;
  e.O = n ? 0 : e.O & STATUS_UNINITIALIZED;
  if (e.I?.P) setPendingError(e);
  const t = statusNotifierOf(e);
  if (t) t.call(e);
}
function landStatus(e, n = false) {
  const t = e.I?.X;
  if (t && (t.delete(e), t.size)) {
    e.I.Ee = false;
    if (n) e.O = STATUS_PENDING;
    setPendingError(e, t.values().next().value);
  } else clearStatus(e, n);
}
function notifyStatus(e, n, t) {
  if (n === STATUS_ERROR && !(t instanceof StatusError) && !(t instanceof NotReadyError)) t = new StatusError(e, t);
  const r = n === STATUS_PENDING && t instanceof NotReadyError && t.source;
  if (r) {
    if (e.O & STATUS_ERROR) e.I.Te = e.I.P;
    addPendingSource(e, r);
  } else clearPendingSources(e);
  e.O = n | (n === STATUS_ERROR ? e.O & (STATUS_UNINITIALIZED | STATUS_NO_VALUE) ? STATUS_NO_VALUE : 0 : n === STATUS_PENDING && e.O & STATUS_NO_VALUE ? STATUS_UNINITIALIZED : e.O & STATUS_UNINITIALIZED);
  if (r) setPendingError(e, r, t);
  else ext(e).P = t;
  if (guessing && n === STATUS_PENDING && e.l & CONFIG_GUESS) {
    if (passLane === null) joinFuture(e._ & REACTIVE_REASK ? null : txOf(e)._parent);
    return;
  }
  const o = statusNotifierOf(e);
  if (o) {
    o.call(e);
    return;
  }
  propagateStatus(e, n, t);
}
function propagateStatus(e, n, t) {
  const r = n === STATUS_PENDING && t instanceof NotReadyError && t.source;
  forEachDependent(e, (o, s) => {
    o.Ie = clock;
    if (o.l & CONFIG_REDERIVE || holdWorkHook && (o.l & CONFIG_VERDICT || r && o.l & CONFIG_STAGED_ERROR) && !(r && holdWorkHook(o, e)) || n === STATUS_PENDING && s.Ae !== o.Re) {
      if (n !== STATUS_PENDING && removePendingSource(o, e)) settlePendingSource(o, e);
      enqueueSub(o);
      schedule();
      return;
    }
    if (r && o.I?.X?.has(r)) {
      if (passLane === null && (o.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD && globalQueue.ee && !freshHook?.(o, r.Ie === clock)) joinFuture(txOf(o));
      return;
    }
    if (r || n !== STATUS_PENDING && (o.I?.P !== t || o.I?.X)) {
      if (laneStageHook && passLane !== null) laneStageHook(o, passLane, true, e);
      else {
        queuePendingNode(o);
        if (n === STATUS_PENDING && (o.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD && !o.i) if (guessing && o.O & STATUS_PENDING && reasks(o))
          unhold(o);
        else joinFuture(txOf(o));
      }
      notifyStatus(o, n, t);
      o.T?.st(n, t);
    }
  });
}

// ../store-proto-features/packages/signals/dist/select/core/truth.js
var covers = /* @__PURE__ */ new WeakMap();
function latestOf(r) {
  if (r.l & CONFIG_GUESS) return covers.has(r) ? covers.get(r) : r.ue;
  return r.ce !== NOT_PENDING ? r.ce : r.O & STATUS_UNINITIALIZED ? NOT_PENDING : r.ue;
}
function covered(r) {
  return r.I.Je ? r.ce : r.ue;
}
function underOf(r) {
  return r.ce !== NOT_PENDING ? r.ce : covered(r);
}
function landed(r) {
  return r.ce !== NOT_PENDING && !r.I.me;
}
function truthRead(r) {
  if (truth(r)) return latestOf(r);
  if (!(r.l & CONFIG_GUESS)) throw new NotReadyError(null);
  return underOf(r);
}
function truthConfirmed(r) {
  for (let e = 0; e < r.ts.length; e++) for (let t = r.ts[e].o; t !== null; t = t.t) if (t.u.l & CONFIG_AUTHORITATIVE) enqueueSub(t.u);
}
function truth(r) {
  if (r.l & CONFIG_GUESS) return landed(r) && r.We && r.We(latestOf(r), r.ce);
  if (r.l & CONFIG_OVERRIDE) {
    for (let e = r.G; e; e = e.S) if (!truth(e.p)) return;
    return 1;
  }
  return r.ce === NOT_PENDING ? 1 : void 0;
}

// ../store-proto-features/packages/signals/dist/select/core/lanes.js
var lanes = [];
var LEFT_SHOWN = -2;
function newLane(e) {
  const n = newTransaction(true, e);
  lanes.push(n);
  return n;
}
function setLaneValue(e, n, s, t) {
  if (e.l & CONFIG_GUESS) {
    covers.set(e, s);
    if (!t && (n.Je || e.I.Je)) reveal(e);
  } else if (n.Je || e.I.Je) {
    e.ue = s;
    e.I.Je = true;
    if (e.O & STATUS_UNINITIALIZED) e.O &= ~STATUS_UNINITIALIZED;
  } else e.ce = s;
}
function reveal(e) {
  const n = covers.get(e);
  covers.delete(e);
  if (e.ce === NOT_PENDING) e.ce = e.ue, e.I.me = true;
  e.ue = n;
  e.I.Je = true;
  if (e.O & STATUS_UNINITIALIZED) e.O &= ~STATUS_UNINITIALIZED;
}
function screenOf(e) {
  return e.O & STATUS_UNINITIALIZED ? NOT_PENDING : e.ue;
}
function landBeneath(e, n) {
  e.ce = n;
  e.I.me = false;
  e.l |= CONFIG_HELD;
}
var guessed = false;
function armGuessed() {
  guessed = true;
}
var guessWriteHook = null;
function installGuessLayer(e) {
  guessWriteHook = e;
}
var marked = /* @__PURE__ */ new WeakSet();
function keptGuess(e) {
  return guessed && marked.has(e);
}
function inFlight(e) {
  return e.O & STATUS_PENDING || e.l & CONFIG_SLOT_NODE && GlobalQueue.k?.(e);
}
function enterLane(e, n) {
  const s = n._ |= REACTIVE_LANE_READ, t = passLane;
  if (t === null) {
    const t2 = isVerdict(e);
    let r;
    if (!(t2 && (creatorReads(n, n.i || s) || (r = resolveTx(e._parent), (n.l & (CONFIG_HELD | CONFIG_VERDICT | CONFIG_FRAME | CONFIG_LAGS | CONFIG_OVERRIDE)) === CONFIG_HELD && txOf(n) !== r) || n.l & CONFIG_HELD_FRAME && bornInto(n, r)))) {
      setPassLane(e);
      if (s & REACTIVE_STAGED_READ && (guessed || t2 || s & REACTIVE_JOINED)) stagedRead(n);
    }
  } else if (sameLane(t, e)) setPassLane(e);
  else {
    linkLanes(t, e);
    setPassLane(e);
  }
}
function isVerdict(e) {
  return e?._parent?.Ve === e;
}
function linkLanes(e, n) {
  const s = e.nn ?? (e.nn = [e]);
  const t = n.nn;
  if (t === s) return;
  if (t === null) {
    s.push(n);
    n.nn = s;
  } else for (let e2 = 0; e2 < t.length; e2++) {
    s.push(t[e2]);
    t[e2].nn = s;
  }
}
function linkBlocked(e) {
  const n = e.nn;
  if (n !== null) for (let s = 0; s < n.length; s++) {
    const t = n[s];
    if (t !== e && (t.$ !== 0 || ownFlights(t) || nestedBlocked(t))) return true;
  }
  return false;
}
function unlink(e) {
  const n = e.nn;
  if (n === null) return;
  const s = n.indexOf(e);
  if (s !== -1) n.splice(s, 1);
  e.nn = null;
}
function verdictLane(e) {
  return e.Ve ??= newLane(e);
}
function laneStage(e, n, s, t) {
  if (!s && e.O & STATUS_PENDING && e._ & REACTIVE_STAGED_READ) {
    if (!(e._ & REACTIVE_LANE_READ) && !(e.l & CONFIG_ASYNC)) t = false;
    else laneWait(e, n);
  }
  if (!(s || t || e._ & REACTIVE_LANE_READ || e.l & CONFIG_GUESS)) {
    const s2 = e.I;
    if (s2 !== null) {
      const n2 = s2.v;
      if (n2?.L) {
        if (n2.Je && !(e.O & STATUS_PENDING) && (!flushTransaction || !blocked(resolveTx(n2._parent)))) {
          e.je = LEFT_SHOWN;
        }
        s2.Je = false;
        s2.v = null;
      }
      if (e.ce !== NOT_PENDING) insertSubs(e);
      e.ce = NOT_PENDING;
    }
    e.l &= -1050881;
    if (guessed) for (let s3 = 0; s3 < n.ts.length; s3++) {
      const t2 = n.ts[s3];
      if (t2.R?.T?.node === e && t2.I.v === n) {
        const e2 = t2.ce;
        laneStage(t2, n, false, false);
        if (e2 !== NOT_PENDING) queuePendingNode(t2), t2.ce = e2;
      }
    }
    return false;
  }
  if (!e.i) {
    if (!(e.l & CONFIG_OVERRIDE)) {
      if (e.l & CONFIG_HELD && e.ce !== NOT_PENDING && n._parent.Ve !== n) insertSubs(e);
      e.ce = NOT_PENDING;
      e.l = e.l & -1048833 | CONFIG_OVERRIDE;
      ext(e);
    }
    if (guessed && e.l & CONFIG_GUESS && e.I.v?.L && resolveTx(e.I.v._parent) !== resolveTx(n._parent)) {
      const s2 = resolveTx(e.I.v._parent);
      merge(resolveTx(n._parent), s2);
      n.over = resolveTx(s2);
      n.sn = true;
      return false;
    } else if (!t) {
      if (guessed && e.l & CONFIG_GUESS) {
        covers.delete(e);
        if (e.I.me) e.ce = NOT_PENDING, e.I.me = false;
      }
      e.l &= ~CONFIG_GUESS;
    }
  } else if (t) {
    if (t !== true && (e.l & CONFIG_HELD || !(t.O & STATUS_UNINITIALIZED) && e._ & REACTIVE_RECOMPUTING_DEPS) && !e.I?.v?.L) {
      queuePendingNode(e);
      return false;
    }
    e._ |= REACTIVE_LANE_DIRTY;
  }
  list(e, n);
  return true;
}
function dissolveLane(e, n, s) {
  const t = lanes.indexOf(e);
  if (t !== -1) lanes.splice(t, 1);
  unlink(e);
  const r = e.Ve;
  if (r !== null) {
    e.Ve = null;
    if (lanes.indexOf(r) !== -1) dissolveLane(r, null);
  }
  for (let t2 = 0; t2 < e.ts.length; t2++) {
    const r2 = e.ts[t2];
    const l = r2.I;
    if (r2 === s || l.v !== e || r2._ & REACTIVE_DISPOSED) continue;
    const i = r2.i;
    const o = r2.l & CONFIG_GUESS;
    const u = r2.ue;
    const E = o ? underOf(r2) : NOT_PENDING;
    r2.l &= -10241;
    r2.I.Je = r2.I.me = false;
    covers.delete(r2);
    if (n === null) {
      l.v = null;
      if (o) r2.ce = E;
      commitPendingNode(r2);
      if (!i) {
        if (r2._ & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK) || r2.O & STATUS_PENDING) r2.l |= CONFIG_INPUTS_PUBLISHED;
        if (!r2.We || !r2.We(u, r2.ue)) insertSubs(r2);
      }
      if (r2._ & REACTIVE_FRAME_READ && r2.O & STATUS_ERROR && l.P.source === r2) enqueueSub(r2);
    } else if (o || guessed && r2.l & CONFIG_SLOT_NODE && r2.ce !== NOT_PENDING) {
      if (o) r2.ce = E;
      if (e.Je && guessed) marked.add(r2);
      holdNode(r2, n);
      insertSubs(r2);
    } else {
      l.v = null;
      if (!i) {
        if (!e.sn && r2.ce !== NOT_PENDING) insertSubs(r2);
        r2.ce = NOT_PENDING;
        r2.l &= ~CONFIG_STAGED_ERROR;
        if (r2.O & STATUS_PENDING) {
          l.Se = null;
          enqueueSub(r2);
        }
      }
      if (e.Je) {
        const n2 = !i && r2.O & STATUS_UNINITIALIZED;
        commitPendingNode(r2);
        if (!i) {
          r2.l |= CONFIG_INPUTS_PUBLISHED;
          if (n2) enqueueSub(r2);
        } else if (e.sn && r2.be === void 0) enqueueSub(r2);
      } else {
        if (l.xe !== null || l.ye !== null) GlobalQueue.pe(r2, false, true);
        r2.l &= -1048961;
      }
    }
  }
  if (n === null || e.Je && !e.sn) releaseQueues(e);
  else e.ft[0].length = e.ft[1].length = 0;
}
var readGuesses = [];
function laneRead(e, n) {
  const s = n.l & CONFIG_GUESS;
  const t = txOf(n);
  const r = e !== null && t.folded;
  if (r) {
    const s2 = r(e, n);
    if (s2 !== NOT_PENDING) {
      return s2;
    }
  }
  if (e !== null && e.l & CONFIG_AUTHORITATIVE) {
    return GlobalQueue.tn(n);
  }
  const l = n.O;
  if (!s && l & STATUS_ERROR) {
    if (e !== null && tracking && !(e.l & CONFIG_CHILDREN_FORBIDDEN)) enterLane(t, e);
    return NOT_PENDING;
  }
  if (e === null) {
    if (s && actionDepth && !(n.l & CONFIG_SLOT_NODE)) readGuesses.push(t, question);
    return latestOf(n);
  }
  const i = !s && l & STATUS_PENDING;
  if (!tracking || e.l & CONFIG_CHILDREN_FORBIDDEN) {
    if (passLane === null || e.l & CONFIG_CHILDREN_FORBIDDEN) {
      return screenOf(n);
    }
  } else if (e.i === EFFECT_RENDER) {
    const r2 = i && !n.I.Je && !reasks(n);
    const l2 = passLane;
    const o = isVerdict(l2);
    if (o && (r2 || l2 !== t)) setPassLane(null);
    if (passLane === null || !sameLane(passLane, t)) {
      if (r2 && t.Je) return NOT_PENDING;
      if (!s && t.Je && isVerdict(t) && n.ce !== NOT_PENDING && e.l & CONFIG_HELD && flushTransaction !== null && resolveTx(flushTransaction) === txOf(e)) {
        return n.ce;
      }
      if (t.sn || i) {
        if (i && e.l & CONFIG_MOUNT_AHEAD && e.O & STATUS_UNINITIALIZED) return NOT_PENDING;
        if (!(e._ & REACTIVE_SCREEN_READ) && (t.sn || !t.Je)) {
          e._ |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
          t.rn.push(e);
        }
        const s2 = screenOf(n);
        if (s2 === NOT_PENDING) throw new NotReadyError(null);
        return s2;
      }
      if (e.l & CONFIG_VERDICT && !isVerdict(t)) entered.push(e);
    }
  }
  enterLane(t, e);
  return i && !(guessed && !(e.i > EFFECT_RENDER) && reasks(n)) && !(e.l & CONFIG_FRAME && !e.i && n.I.Je) ? NOT_PENDING : latestOf(n);
}
function guessFlights(e) {
  for (let n = 0; n < e.ts.length; n++) {
    const s = e.ts[n];
    if (s.l & CONFIG_GUESS && s.I.v === e && inFlight(s)) return true;
  }
  return false;
}
function laneSeam(e, n) {
  if (n || blocked(e) || e.over && blocked(liveTx(e.over) || e)) {
    e.sn = true;
    return;
  }
  e.sn = false;
  e.Je = true;
  const s = resolveTx(e._parent), t = s.rn.filter((n2) => n2.Oe && n2.I?.v === e);
  if (reruns(e)) revealing.push(s);
  else if (e.ft[0].length > t.length) e.ft[0].unshift(() => t.forEach((e2) => e2.Oe = true));
  for (let n2 = 0; n2 < e.ts.length; n2++) {
    const s2 = e.ts[n2];
    if (s2.je === LEFT_SHOWN) insertSubs(s2);
    const t2 = s2.I;
    if (t2.v !== e) continue;
    if (!s2.i) {
      if (s2.l & CONFIG_GUESS) {
        if (covers.has(s2)) reveal(s2);
      } else if (s2.ce !== NOT_PENDING) {
        commitPendingNode(s2);
        s2.I.Je = true;
      }
    }
    if (t2.xe !== null || t2.ye !== null) GlobalQueue.pe(s2, false, true);
    s2.l &= ~CONFIG_STAGED;
  }
  releaseQueues(e);
}
function endLanes(e) {
  if (guessed) for (const n of e.ts) marked.delete(n);
  for (let n = lanes.length - 1; n >= 0; n--) {
    const s = lanes[n];
    if (resolveTx(s._parent) !== e) continue;
    endLanes(s);
    dissolveLane(s, null);
  }
}
function lanesBlocked(e) {
  if (guessed && !e.L && e.ts.some((e2) => marked.has(e2) && inFlight(e2))) return true;
  if (!e.L) for (let n = 0; n < lanes.length; n++) {
    const s = lanes[n];
    if (s.waits !== void 0 && s.over !== void 0 && liveTx(s.over) === e && s.waits.some((e2) => e2.O & STATUS_PENDING)) return true;
  }
  if (e.L && e._parent.Ve === e && (e.lt && holdsOn(resolveTx(e._parent)) || heldMountUnder(null, e))) return true;
  if (!e.L && r5Hook && r5Hook(null, e)) return true;
  return e.L && linkBlocked(e) || nestedBlocked(e);
}
var aheadMounts = [];
function collectMounts() {
  for (let e = 0; e < transactions.length; e++) {
    const n = transactions[e], s = n.ts;
    for (let e2 = n.scanned ?? 0; e2 < s.length; e2++) {
      const n2 = s[e2];
      if (n2.l & CONFIG_MOUNT_AHEAD) aheadMounts.push(n2);
    }
    n.scanned = s.length;
  }
}
function holdsOn(e) {
  return e.$ !== 0 || e.ts.some((e2) => !e2.i && e2.O & STATUS_PENDING && !(e2._ & REACTIVE_DISPOSED));
}
function shownBy(e) {
  for (let n = e.o; n !== null; n = n.t) if (n.u.i === EFFECT_RENDER && !hiddenHook?.(n.u)) return 1;
}
function heldMountUnder(e, n) {
  collectMounts();
  for (let s = aheadMounts.length - 1; s >= 0; s--) {
    const t = aheadMounts[s];
    if (!(t.O & STATUS_UNINITIALIZED) || !(t.l & CONFIG_HELD) || t._ & REACTIVE_DISPOSED) {
      aheadMounts.splice(s, 1);
      continue;
    }
    const r = resolveTx(t.I.v);
    const l = holdsOn(r);
    if (
      // A memo mount is on screen through the render effect that reads it
      // (#4806: a fragment, text beside a hole, returned to the slot). One
      // a memo reads is that memo's: a boundary the mount builds around it
      // shows its fallback (#3851).
      (t.i ? hiddenHook?.(t) : !shownBy(t)) || !(t.O & STATUS_PENDING || l) || // Pending only on `l`'s reveal (a node born in `l`): it waits on `l`, not `l` on it (S-30).
      n !== null && !l && !t.I.X?.size && (n.nn || [n]).some((e2) => e2.rn.indexOf(t) !== -1)
    ) continue;
    for (let s2 = t._parent; s2 !== null; s2 = s2._parent) if (n !== null ? s2.I?.v === n : s2 === e) return true;
  }
  return false;
}
function laneWait(e, n) {
  if (!globalQueue.ee || n._parent.Ve === n) return;
  const s = flushTransaction;
  if (s !== null && resolveTx(n._parent) === s) return;
  const t = n.over && liveTx(n.over);
  if (t && t !== s) return;
  joinFuture(null);
  n.over = flushTransaction;
  (n.waits ??= []).push(e);
  const r = stagedReaders.indexOf(e);
  if (r !== -1) stagedReaders.splice(r, 1);
}
var revealing = [];
function nestedBlocked(e) {
  if (revealing.indexOf(e) !== -1) return true;
  for (let n = 0; n < lanes.length; n++) {
    const s = lanes[n];
    if (resolveTx(s._parent) !== e) continue;
    if (blocked(s) || guessFlights(s)) return true;
  }
  return false;
}
function laneWrite(e, n) {
  if (e.l & CONFIG_GUESS) return guessWriteHook(e, n), n;
  const s = txOf(e);
  if (e.We && e.We(latestOf(e), n)) return n;
  e.ce = n;
  if (e.re !== void 0) e.Ie = clock;
  laneDirty(e, s);
  schedule();
  return n;
}
var judged = 0;
function markJudged() {
  judged = lanes.length;
}
var waiting = null;
function landing(e) {
  walk(e);
  endLanes(e);
}
function walk(e) {
  if (!e.rn.some((e2) => !e2.i && e2._ & REACTIVE_FRAME_READ) || !e.rn.some((e2) => (e2._ & REACTIVE_FRAME_READ || e2.l & CONFIG_VERDICT) && (e2.i || e2.l & CONFIG_HELD))) return;
  if (!waiting) waiting = /* @__PURE__ */ new Set(), globalQueue.ft[1].push(() => waiting = null);
  const n = e.ts.filter((e2) => !(e2.l & CONFIG_VERDICT));
  for (let e2; e2 = n.pop(); ) for (let s = e2.o; s; s = s.t) {
    const e3 = s.u;
    if (waiting.has(e3) || e3.l & CONFIG_VERDICT || e3.I?.v?.L) continue;
    waiting.add(e3);
    if (!e3.i) n.push(e3);
  }
}
function readsHeld(e) {
  for (let n = e.G; n; n = n.S) if (n.p.l & CONFIG_HELD) return true;
  return false;
}
var laneSeams = (e) => {
  if (revealing.length) revealing.length = 0;
  for (const n2 of ahead.splice(0)) n2._ & REACTIVE_FRAME_READ && (n2._ ^= REACTIVE_FRAME_READ, e?.rn.splice(e.rn.indexOf(n2) >>> 0, 1));
  const n = [];
  if (e !== null) for (let s = 0; s < stagedReaders.length; s++) {
    const t = stagedReaders[s], r = t.I?.v || (t._ & REACTIVE_STAGED_READ ? e : null);
    if (t._ & REACTIVE_DISPOSED || (r?.L ? isVerdict(r) && (t.l & CONFIG_VERDICT ? !(t._ & REACTIVE_PROBE_UNANSWERED) : !blocked(e)) || (r.nn || [r]).some((n2) => n2.over && liveTx(n2.over) == e) : r && !(t._ & REACTIVE_PROBE_UNANSWERED || (t._ & REACTIVE_STAGED_READ || readsHeld(t)) && blocked(r) && !bornInto(t, r)))) continue;
    if (r?.L && t.i) t._ |= REACTIVE_LANE_DIRTY;
    else if (!r?.L && t._ & REACTIVE_PROBE_UNANSWERED) {
      if (r5Hook(t, e)) continue;
      if (e?.Ve && n.indexOf(e.Ve) === -1) n.push(e.Ve);
    }
    enqueueSub(t);
    if (r?.L && n.indexOf(r) === -1) n.push(r);
  }
  for (let e2 = lanes.length - 1; e2 >= 0; e2--) if (e2 < judged && lanes[e2].es !== clock || isVerdict(lanes[e2])) laneSeam(lanes[e2], n.indexOf(lanes[e2]) !== -1);
  for (let e2; e2 = entered.pop(); ) if (e2.I.v?.sn) {
    e2._ &= ~REACTIVE_LANE_DIRTY;
    enqueueSub(e2);
  }
  if (r5Hook) r5Hook(null, null);
};
var served = /* @__PURE__ */ new WeakMap();
var laneServed = (e, n, s) => {
  if (n === null) {
    const n2 = served.get(e);
    if (n2 && n2[1] === e.Re && n2[0].O & STATUS_PENDING) {
      if (s) return true;
      throw n2[0].I.P;
    }
    return;
  }
  if (s) {
    if (e._ & REACTIVE_STAGED_READ) return false;
    const s2 = n.I?.v || flushTransaction;
    if (s2) staleReader(e, resolveTx(s2));
    served.set(e, [n, e.Re]);
    return true;
  }
  const t = n.I?.X;
  if (t && e.I?.X) {
    for (const n2 of t) if (removePendingSource(e, n2)) settlePendingSource(e, n2);
  }
};
var ahead = [];
var entered = [];
installLaneHooks(laneRead, laneStage, laneWrite, laneSeams, landing, lanesBlocked, laneServed);
GlobalQueue.ne = verdictLane;

// ../store-proto-features/packages/signals/dist/select/core/core.js
GlobalQueue.Ce = (e) => {
  if (e.i === EFFECT_TRACKED) {
    deleteFromHeap(e, dirtyQueue);
    e.Oe = true;
    globalQueue.enqueue(EFFECT_USER, e.Y);
  } else if (e._ & REACTIVE_ZOMBIE && !(e._ & REACTIVE_LANE_DIRTY)) deferZombie(e);
  else if (laneStageHook && e._ & REACTIVE_ZOMBIE && laneFrameMember(e)) {
    deleteFromHeap(e, dirtyQueue);
    e._ &= -65540;
  } else if (!(laneAdoptHook && e.I?.De && laneAdoptHook(e, 1))) recompute(e);
};
function laneFrameMember(e) {
  let t = e._parent;
  while (t._ & REACTIVE_ZOMBIE) t = t._parent;
  return (t.l & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE || t.i && t.I?.v?.L;
}
GlobalQueue.pe = disposeChildren;
var tracking = false;
var context = null;
var snapshotCaptureActive = false;
var laneRoot;
var snapshotSources = null;
function ownerInSnapshotScope(e) {
  while (e) {
    if (e.Ge) return true;
    e = e._parent;
  }
  return false;
}
function setSnapshotCapture(e) {
  snapshotCaptureActive = e;
  if (e && !snapshotSources) snapshotSources = new NewSet();
}
function markSnapshotScope(e, t) {
  if (arguments.length < 2) e.Ge = true;
  else if (snapshotCaptureActive && e.I?.Fe === void 0) takeSnapshot(e, t);
}
function releaseSnapshotScope(e) {
  e.Ge = false;
  releaseSubtree(e);
  schedule();
}
function releaseSubtree(e) {
  let t = e.he;
  while (t) {
    if (t.Ge) {
      t = t.He;
      continue;
    }
    if (t.re) {
      const e2 = t;
      e2.l &= ~CONFIG_IN_SNAPSHOT_SCOPE;
      if (e2._ & REACTIVE_SNAPSHOT_STALE) {
        e2._ &= ~REACTIVE_SNAPSHOT_STALE;
        e2._ |= REACTIVE_DIRTY;
        if (dirtyQueue.ke > e2.Pe) dirtyQueue.ke = e2.Pe;
        insertIntoHeap(e2, dirtyQueue);
      }
    }
    releaseSubtree(t);
    t = t.He;
  }
}
function clearSnapshots() {
  if (snapshotSources) {
    for (const e of snapshotSources) {
      const t = e.I;
      if (t != null) t.Fe = void 0;
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}
function recompute(e, t = false) {
  bumpNotifyEpoch();
  const n = e.i;
  let o;
  let E = NOT_PENDING;
  const s = passLane;
  const l = laneRoot;
  const r = laneStageHook && (laneRoot = t && (s || l));
  if (laneAdoptHook && !t && e.I) {
    const t2 = e.I.De;
    if (t2 ? t2 !== e.I.Se && (e.I.De = void 0, 1) : e.l & CONFIG_OVERRIDE && !(e._ & REACTIVE_LANE_DIRTY)) laneAdoptHook(e, 2);
  }
  if (laneStageHook) {
    const n2 = t ? creatorPass(context) : null;
    const o2 = n2?._ | 0;
    if (o2 & REACTIVE_PROBED || n2 && (n2.l & CONFIG_MOUNT_AHEAD && n2.O & STATUS_UNINITIALIZED || n2.i === EFFECT_RENDER && n2.C && hasDep(n2, (e2) => e2.l & CONFIG_VERDICT, n2.C))) e.l |= CONFIG_MOUNT_AHEAD;
    setPassLane((e._ & REACTIVE_LANE_DIRTY || (e.l & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) && e.I?.v?.L ? e.I.v : (
      // Loose `!=`: false with no creator lane (undefined == null).
      s?._parent.Ve != s && o2 & REACTIVE_RECOMPUTING_DEPS ? s : null
    ));
  }
  const a = e.l & CONFIG_STAGED_ERROR;
  let i;
  if (!t) {
    deleteFromHeap(e, dirtyQueue);
    if (laneStageHook && !n && (e.O & STATUS_PENDING || (e.l & (CONFIG_ASYNC | CONFIG_OWN_PROBE | CONFIG_HELD)) === (CONFIG_ASYNC | CONFIG_HELD))) e.l &= ~CONFIG_VERDICT;
    if (e.I !== null) {
      e.I.Se = null;
      releaseFlightTeardown(e);
    }
    if (e.l & CONFIG_HELD) {
      const t2 = txOf(e);
      if (t2.L || e.l & CONFIG_LAGS) ;
      else if (!(e.l & (CONFIG_VERDICT | EFFECT_RENDER << 23)) || observeFlightHook && !(e.l & EFFECT_RENDER << 23) && bornInto(e, t2)) joinPassTx(t2, freshHook?.(e, e.O & STATUS_UNINITIALIZED));
      else if (t2 !== flushTransaction && !(e.O & STATUS_UNINITIALIZED || e.l & CONFIG_HELD_FRAME)) {
        if ((E = e.ce) !== NOT_PENDING) insertSubs(e);
        e.ce = NOT_PENDING;
        e.l &= ~CONFIG_HELD;
      }
    }
    if (n === EFFECT_TRACKED || e.l & CONFIG_STAGED) {
      const t2 = deferredReleases;
      deferReleases(o = []);
      disposeChildren(e);
      deferReleases(t2);
    } else if (e.he !== null || e.Ue !== null) parkChildren(e);
    if (passHook) {
      i = e.G !== null;
      if (e.I !== null && (e.l & CONFIG_STAGED_ERROR || e.I.ge !== void 0)) passHook(e);
    }
    if (e.l & CONFIG_STAGED_ERROR) {
      e.ce = NOT_PENDING;
      e.l ^= CONFIG_STAGED_ERROR;
    }
  }
  const I = e.O & STATUS_UNINITIALIZED;
  const _ = e.O & STATUS_ERROR && e.I?.P;
  const N = (e.O & STATUS_PENDING) !== 0;
  const u = N && e.I?.X;
  const f = e.I?.X?.has(e);
  let T = false;
  let S = (e._ & REACTIVE_REASK) !== 0 && !(e.I !== null && !e.I.Le && (e.O & STATUS_PENDING || e.ce !== NOT_PENDING && !e.I.me && !(e._ & REACTIVE_MANUAL_WRITE)));
  const A = context;
  context = e;
  e.C = null;
  e.Re++;
  const c = e._ & REACTIVE_RELEASE_AFTER;
  e._ = REACTIVE_RECOMPUTING_DEPS | e._ & (REACTIVE_ZOMBIE | REACTIVE_REASK);
  e.Ie = clock;
  let R = e.ce !== NOT_PENDING ? e.ce : e.ue;
  let C = e.Pe;
  let O = false;
  let d = false;
  let D = tracking;
  tracking = true;
  try {
    if (e.l & CONFIG_SYNC) {
      R = e.re(R);
      if (e.I !== null) e.I.Se = null;
      e.Ne = false;
    } else {
      const t2 = e.I?.Se;
      const n2 = e.re(R);
      const o2 = typeof n2 === "object" && n2 !== null;
      const E2 = e.I?.Se !== t2;
      if (false) ;
      R = E2 || !o2 ? n2 : handleAsync(e, n2);
      if (!E2 && !o2) {
        if (e.I !== null) {
          e.I.Se = null;
          if (holdWorkHook) e.l &= ~CONFIG_ASYNC;
        }
        e.Ne = false;
      }
    }
    if ((e.O !== 0 || e.I !== null) && !(laneServedHook && e.O & STATUS_PENDING && laneServedHook(e, null, true))) clearStatus(e, t);
  } catch (t2) {
    const n2 = t2 instanceof NotReadyError;
    if (holdWorkHook && (!n2 || e.Ne)) e.l &= ~CONFIG_ASYNC;
    if (n2 && e.Ne) {
      parkLoadingWindow(e, t2);
    } else {
      if (n2 || !(T = stageError(e, t2, true))) {
        if (n2) ext(e).Ee = true;
        notifyStatus(e, n2 ? STATUS_PENDING : STATUS_ERROR, t2);
        if (n2 && f && !e.I?.Se) settlePendingSource(e);
      }
      if ((n2 || T) && u) {
        for (const t3 of u) if (t3 !== e && !(e.I?.X?.has(t3) && (t3.O & STATUS_PENDING || retryReaches(e, t3)))) settlePendingSource(e, t3);
      }
    }
  } finally {
    tracking = D;
    if (laneStageHook) laneRoot = l;
    O = (e._ & REACTIVE_MISSED_WAKE) !== 0;
    d = !!(e._ & (r ? s || n || !(e.O & STATUS_PENDING) ? REACTIVE_JOINED | REACTIVE_STAGED_READ : 0 : REACTIVE_JOINED));
    if (observeFlightHook) e.l = e.l & 1073709055 | e._ & REACTIVE_PROBED | (e._ & REACTIVE_WINDOW) << 9 | (e._ & REACTIVE_AHEAD) << 11;
    e._ = e._ & (REACTIVE_ZOMBIE | REACTIVE_DISPOSED | REACTIVE_FRAME_READ | REACTIVE_STAGED_READ | REACTIVE_LANE_READ | REACTIVE_SCREEN_READ | REACTIVE_PROBE_UNANSWERED) | (t ? e._ & REACTIVE_SNAPSHOT_STALE : 0);
    context = A;
    if (o) for (const e2 of o) releaseIfSettledUnobserved(e2);
    if (i && !S && e.O & STATUS_PENDING) S = !!passHook(e, 1);
    if (e.I !== null) e.I.Le = S && (e.O & STATUS_PENDING) !== 0;
  }
  if (e._ & REACTIVE_DISPOSED) {
    clearDeps(e);
    clearInFlight(e);
    if (laneStageHook) setPassLane(s);
    return;
  }
  let p = !laneStageHook ? null : passLane;
  const G = !!e.I?.P || T;
  if (laneStageHook && p !== null) {
    if (laneStageHook(e, p, t, G)) setPassLane(p);
    else p = null;
  }
  if (!G) {
    const o2 = e.ce === NOT_PENDING;
    const E2 = !o2 ? e.ce : e.ue;
    const s2 = flushTransaction ?? passTx;
    const l2 = o2 && I && !n || !!e.I?.Te || // In a flush that joined a hold, a recovery to the last good value is a
    // change of answer (D-41, S-53).
    !!(_ && s2) || !!a || // Lane work on a node a held pass created has no screen: its value is a
    // change (F-11, #3835).
    p !== null && e._parent?.l & CONFIG_HELD || !isSame(e, E2, R);
    if (n && l2 && // A stale lane reader that computed what it last applied owes no run.
    !(e._ & REACTIVE_SCREEN_READ && !e.Oe && Object.is(e.be, R)) && // A re-staging pass owes no run: the commit replays the effect (#3802).
    o2) {
      e.Oe = !e.I?.P;
      if (!t) globalQueue.enqueue(n, e.q ??= GlobalQueue.K.bind(null, e), p);
    }
    if (laneOutcomeHook && !t && p === null && e.l & CONFIG_GUESS && laneOutcomeHook(e, R, G)) ;
    else if (G) ;
    else if (l2) {
      if (p !== null) {
        if (n && e.ce === NOT_PENDING) e.ue = R;
        else e.ce = R;
        if (t && !n) e.O |= STATUS_UNINITIALIZED;
      } else if (t ? !(s2 !== null && (d || creatorPass(A)?._ & REACTIVE_JOINED)) : n && e.ce === NOT_PENDING) {
        e.ue = R;
      } else {
        e.ce = R;
        if (_) e.I.Te = _;
        if (t) {
          holdNode(e, s2);
          e.O |= STATUS_UNINITIALIZED;
          freshHook?.(e, !r && flushTransaction);
        }
      }
      if (e.o !== null) p !== null ? laneDirty(e, p) : insertSubs(e);
    } else if (e.Pe != C) {
      for (let t2 = e.o; t2 !== null; t2 = t2.t) insertIntoHeapHeight(t2.u, dirtyQueue);
    }
    if (!l2 && !e.I?.P) {
      if (_) settleErroredDependents(e, _);
      if (u) {
        for (const t2 of u) if (t2 !== e) settlePendingSource(e, t2);
      }
    }
    if (f && !(e.O & (STATUS_PENDING | STATUS_UNINITIALIZED))) settlePendingSource(e);
  }
  if (t && p === null && d && e.O & STATUS_PENDING) {
    const t2 = flushTransaction ?? passTx;
    t2 && !t2.L && (n && freshHook?.(e) === CAUGHT_REARMED || holdNode(e, t2));
  }
  if (!e.I?.P && (p !== null || e.ce === NOT_PENDING) && !(n && e.Oe)) {
    if (t || n === EFFECT_TRACKED) trimStaleDeps(e);
    else heldTrim(e);
  }
  if (e.ce !== NOT_PENDING || e.I !== null && (e.I.xe !== null || e.I.ye !== null) || (e.O & (STATUS_PENDING | STATUS_UNINITIALIZED)) !== 0 && (!t || (e.O & STATUS_PENDING) !== 0)) {
    e.l |= CONFIG_STAGED;
    if (p === null) queuePendingNode(e);
  }
  if (laneStageHook) setPassLane(s);
  if (O) {
    enqueueSub(e);
    schedule();
  }
  if (keepReadersHook && E !== NOT_PENDING && Object.is(R, E)) keepReadersHook(e);
  if (c) releaseIfSettledUnobserved(e);
}
function updateIfNecessary(e) {
  if (e._ & (REACTIVE_RECOMPUTING_DEPS | REACTIVE_DISPOSED)) return;
  if (e._ & REACTIVE_CHECK) {
    for (let t = e.G; t; t = t.S) {
      const n = t.p;
      if (n.re) {
        updateIfNecessary(n);
      }
      if (e._ & REACTIVE_DIRTY) {
        break;
      }
    }
  }
  if (e._ & REACTIVE_DIRTY || e.I?.P && e.Ie < clock && !e.I?.Se) {
    recompute(e);
  }
  e._ = e._ & (REACTIVE_SNAPSHOT_STALE | REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT | REACTIVE_ZOMBIE | REACTIVE_DISPOSED | REACTIVE_MANUAL_WRITE | REACTIVE_FRAME_READ | REACTIVE_STAGED_READ | REACTIVE_LANE_READ | REACTIVE_SCREEN_READ | REACTIVE_PROBE_UNANSWERED);
}
function computed(e, t) {
  const n = t?.transparent ?? false;
  const o = t !== null && typeof t === "object" && "loadingValue" in t;
  const E = {
    id: inheritId(t, n, context),
    l: (n ? CONFIG_TRANSPARENT : 0) | (t?.ownedWrite ? CONFIG_OWNED_WRITE : 0) | (!context || t?.lazy ? CONFIG_AUTO_DISPOSE : 0) | (t?.sync ? CONFIG_SYNC : 0) | (t?.fe ? CONFIG_NO_SNAPSHOT : 0) | (t?.ve ?? 0) | (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
    We: t?.equals ?? isEqual,
    Ue: null,
    D: context?.D ?? defaultContext,
    Me: 0,
    re: e,
    ue: o ? t.loadingValue : void 0,
    Pe: 0,
    Ze: void 0,
    we: null,
    G: null,
    C: null,
    Re: 0,
    o: null,
    Be: null,
    _parent: context,
    He: null,
    Ye: null,
    he: null,
    _: t?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
    O: o ? 0 : STATUS_UNINITIALIZED,
    Ie: clock,
    ce: NOT_PENDING,
    je: -1,
    Ne: o,
    // Cold fields live in `_x`: past ~39 in-object fields creation cost ~4x (§12).
    I: null
  };
  if (t?.unobserved) ext(E).Qe = t.unobserved;
  setupComputedNode(E, t);
  return E;
}
function ext(e) {
  return e.I ??= {
    Se: null,
    de: null,
    P: void 0,
    Ee: void 0,
    X: void 0,
    Qe: void 0,
    Fe: void 0,
    xe: null,
    ye: null,
    v: null,
    Le: false,
    Ke: NOT_PENDING,
    qe: -1,
    _e: 0,
    Je: false,
    m: 0,
    Te: null
  };
}
var adopter = null;
function setAdopter(e) {
  adopter = e;
}
function joinPass(e, t) {
  if (observeFlightHook && !flushTransaction) adopter = e, adopted.length = 0;
  e._ |= REACTIVE_JOINED;
  if (t.O & STATUS_UNINITIALIZED || e.i !== EFFECT_RENDER) joinPassTx(txOf(t), !e.i && e.O & STATUS_UNINITIALIZED || freshHook?.(e));
}
function frameRead(e, t) {
  const n = observeFlightHook && e.l & CONFIG_VERDICT;
  const o = laneStageHook && passLane !== null;
  if (laneStageHook && e.l & CONFIG_MOUNT_AHEAD && e.O & STATUS_UNINITIALIZED && (!o || t.O & STATUS_PENDING)) {
    joinPass(e, t);
    return false;
  }
  if (!(n && holdStagingHook(e, t)) && !((!o || e.O & STATUS_UNINITIALIZED && t.O & STATUS_PENDING) && !n && (!(e.l & EFFECT_RENDER << 23) || t.l & CONFIG_INPUTS_PUBLISHED))) {
    const E = txOf(t);
    if (o && passLane.over && resolveTx(passLane.over) === E && !n) return false;
    if (!(!o && E === flushTransaction && !n || bornInto(e, E))) {
      staleReader(e, E);
      if (o || n) laneServedHook(e, t);
      return true;
    }
  }
  joinPass(e, t);
  return false;
}
function bornInto(e, t) {
  return (e.O & STATUS_UNINITIALIZED || e.l & CONFIG_HELD_FRAME) && e.l & CONFIG_HELD && txOf(e) === t;
}
function hasDep(e, t, n) {
  for (let o = e.G; o !== null; o = o === n ? null : o.S) if (t(o.p)) return 1;
}
var fresh;
function readsFresh(e, t) {
  return t.ce !== NOT_PENDING && e.l & CONFIG_VERDICT && !hasDep(e, (e2) => e2 === t);
}
function creatorPass(e) {
  return e !== null && e.ze ? e.Xe : e;
}
function creatorReads(e, t) {
  return (e = creatorPass(e._parent))?._ & REACTIVE_RECOMPUTING_DEPS ? creatorReads(e, t | e._) : t & (REACTIVE_JOINED | REACTIVE_STAGED_READ);
}
function parkChildren(e) {
  markDisposal(e);
  const t = ext(e);
  t.ye = e.Ue;
  t.xe = e.he;
  e.Ue = null;
  e.he = null;
  e.Me = 0;
}
function createEffectNode(e, t, n, o, E) {
  const s = E?.transparent ?? false;
  const l = {
    id: inheritId(E, s, context),
    l: (
      // CONFIG_FRAME for a render effect.
      o << 23 | (s ? CONFIG_TRANSPARENT : 0) | (E?.ownedWrite ? CONFIG_OWNED_WRITE : 0) | (E?.sync ? CONFIG_SYNC : 0) | (E?.ve ?? 0) | (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0)
    ),
    We: false,
    Ue: null,
    D: context?.D ?? defaultContext,
    Me: 0,
    re: e,
    ue: void 0,
    Pe: 0,
    Ze: void 0,
    we: null,
    G: null,
    C: null,
    Re: 0,
    o: null,
    Be: null,
    _parent: context,
    He: null,
    Ye: null,
    he: null,
    _: REACTIVE_LAZY,
    O: STATUS_UNINITIALIZED,
    Ie: clock,
    ce: NOT_PENDING,
    je: -1,
    Ne: false,
    Oe: false,
    be: void 0,
    $e: t,
    et: n,
    nt: void 0,
    i: o,
    I: null
  };
  if (E?.unobserved) ext(l).Qe = E.unobserved;
  setupComputedNode(l, lazyOptions);
  return l;
}
var effectStatusNotify = null;
function setEffectStatusNotify(e) {
  effectStatusNotify = e;
}
function statusNotifierOf(e) {
  return e.i ? effectStatusNotify : null;
}
var lazyOptions = {
  lazy: true
};
function setupComputedNode(e, t) {
  e.we = e;
  const n = context?.ze ? context.Xe : context;
  if (context) linkChild(context, e);
  if (n) e.Pe = n.Pe + 1;
  wireExternalSourceHook?.(e);
  !t?.lazy && recompute(e, true);
  if (snapshotCaptureActive && !t?.lazy) {
    if (!(e.O & STATUS_PENDING) && !(e.l & CONFIG_NO_SNAPSHOT)) takeSnapshot(e, e.ue);
  }
}
function signal(e, t) {
  const n = {
    We: t?.equals ?? isEqual,
    l: (t?.ownedWrite ? CONFIG_OWNED_WRITE : 0) | (t?.fe ? CONFIG_NO_SNAPSHOT : 0),
    ue: e,
    o: null,
    Be: null,
    Ie: clock,
    ce: NOT_PENDING,
    // No `_time`/`_fn`/`_statusFlags`: stores make one signal per touched leaf,
    // so signal bytes are store bytes. Missing reads falsy on shared paths (§12e).
    je: -1,
    I: null
  };
  if (t?.unobserved) ext(n).Qe = t.unobserved;
  if (snapshotCaptureActive && !(n.l & CONFIG_NO_SNAPSHOT)) takeSnapshot(n, e);
  return n;
}
function isEqual(e, t) {
  return e === t;
}
function slotSignal(e, t, n, o, E) {
  const s = {
    We: t,
    l: CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE,
    ue: e,
    o: null,
    Be: null,
    Ie: clock,
    ce: NOT_PENDING,
    je: -1,
    I: null,
    R: n,
    ot: o,
    acc: E,
    px: void 0,
    pxv: void 0
  };
  return s;
}
var verdict = null;
function setVerdict(e) {
  verdict = e;
}
function untrack(e, t) {
  const n = tracking;
  tracking = false;
  try {
    if (externalUntrackHook) return externalUntrackHook(e);
    return e();
  } finally {
    tracking = n;
  }
}
var refCallbackDepth = 0;
var spectating = false;
function prepareComputed(e, t) {
  if (e._ & REACTIVE_LAZY) {
    e._ &= ~REACTIVE_LAZY;
    recompute(e, true);
  } else if (e._ & REACTIVE_DISPOSED) {
    if (e.l & CONFIG_AUTO_DISPOSE) {
      const t2 = e._parent;
      if (t2 !== null) {
        if (t2._ & REACTIVE_DISPOSED) {
          e.l &= ~CONFIG_AUTO_DISPOSE;
          return;
        }
        if (!(e._ & REACTIVE_ZOMBIE)) linkChild(t2, e);
      }
      recompute(e, true);
    }
  } else ;
}
function readerSeesCommitted(e, t) {
  return !t || e.ce === NOT_PENDING || t.l & CONFIG_CHILDREN_FORBIDDEN;
}
var unflushedStaged = false;
function markUnflushedStaged() {
  unflushedStaged = true;
}
function unflushedValue(e) {
  if (globalQueue.ee || e.ce === NOT_PENDING || e.l & CONFIG_PROMOTED) return NOT_PENDING;
  if (e.l & CONFIG_HELD) return e.I.qe === clock ? e.I.Ke : NOT_PENDING;
  return e.ue;
}
function tickBase(e) {
  return e.l & CONFIG_HELD && e.I?.qe === clock ? e.I.Ke : e.ue;
}
function stashFlushed(e) {
  const t = e.I;
  if (t.qe !== clock) {
    if (revertHook) heldRewrites.push(e);
    t.Ke = e.ce;
    t.qe = clock;
    unflushedStaged = true;
  }
}
var promotedWrites = [];
function markLateLinker(e) {
  e._ |= REACTIVE_MISSED_WAKE;
  return true;
}
function resyncUnflushedCompanions() {
  unflushedStaged = false;
  if (promotedWrites.length !== 0) {
    for (const e of promotedWrites) e.l &= ~CONFIG_PROMOTED;
    promotedWrites.length = 0;
  }
}
function pullComputed(e, t) {
  if (e.Pe >= dirtyQueue.ke || e._ & REACTIVE_CHECK) {
    markNode(t);
    markHeap(dirtyQueue);
    updateIfNecessary(e);
  } else if (t.l & CONFIG_FRESH_READ) updateIfNecessary(e);
  const n = e.Pe;
  if (e._parent === t) e._ |= REACTIVE_OWNER_READS;
  else if (n >= t.Pe) liftOwned(t, t.Pe = n + 1);
}
function servesStaged(e, t, n) {
  return passLane === null && e.O & n.O & STATUS_UNINITIALIZED && t.ce !== NOT_PENDING && !(t.l & (CONFIG_HELD | CONFIG_STAGED_ERROR)) && !e.i && (e._ & REACTIVE_MISSED_WAKE || e.ce === NOT_PENDING && e.I?.Et !== clock && (!(e.O & STATUS_PENDING) || e.I?.X?.delete(n.I.P.source)) && (ext(e).Et = clock, e._ |= REACTIVE_MISSED_WAKE));
}
function read(e) {
  let t = context;
  if (t?.ze) t = t.Xe;
  if (verdict !== null) {
    return verdict(e, t);
  }
  if (typeof e.re === "function") prepareComputed(e);
  if (!e.re && e.I?.Fe === void 0 && !snapshotCaptureActive && (!unflushedStaged || e.ce === NOT_PENDING) && // F-10, see readNodeFast
  !(e.l & CONFIG_OVERRIDE) && // lanes: the slow path's one arm
  true) {
    if (t) {
      if (laneStageHook) fresh = tracking && readsFresh(t, e);
      if (tracking) link(e, t);
      if (e.l & CONFIG_HELD && !(t.l & CONFIG_CHILDREN_FORBIDDEN)) {
        if (frameRead(t, e)) {
          return e.ue;
        }
      }
    }
    if (!t || e.ce === NOT_PENDING || t.l & CONFIG_CHILDREN_FORBIDDEN) {
      return e.ue;
    }
    const n2 = e.ce === e.ue && Object.is(e.ce, e.ue);
    if (n2 || (observeFlightHook && t.l & CONFIG_VERDICT || laneStageHook && passLane?.folded) && stagedScreen(t, e)) {
      return e.ue;
    }
    stagedRead(t);
    return e.ce;
  }
  let n = false;
  let o;
  if (t) {
    if (laneStageHook) fresh = tracking && readsFresh(t, e);
    if (tracking) {
      o = link(e, t);
      if (e.re) {
        pullComputed(e, t);
        if (observeFlightHook && (t.O & STATUS_UNINITIALIZED ? t.l & CONFIG_HELD || flushTransaction : t.l & CONFIG_HELD_FRAME)) {
          if (t.i === EFFECT_RENDER && e.l & CONFIG_VERDICT && !(e.O & (STATUS_PENDING | STATUS_UNINITIALIZED))) t._ |= REACTIVE_AHEAD;
          if ((e.l & (CONFIG_VERDICT | CONFIG_FRAME | CONFIG_ASYNC | CONFIG_OWN_PROBE)) === CONFIG_VERDICT && !(t.l & CONFIG_ASYNC)) {
            const n2 = resolveTx(t.l & CONFIG_HELD ? txOf(t) : flushTransaction), o2 = ext(e);
            if (o2.st !== n2) {
              o2.st = n2;
              recompute(e);
            }
          }
        }
        if (observeFlightHook && !t.i) t._ |= e.l & CONFIG_VERDICT & (e.O & STATUS_PENDING && (t.l & CONFIG_STAGED || t.O & STATUS_UNINITIALIZED) ? t.l : -1);
      }
    }
    if (e.l & CONFIG_HELD && !(e.l & CONFIG_OVERRIDE) && !(t.l & CONFIG_CHILDREN_FORBIDDEN)) {
      if (e.O & STATUS_UNINITIALIZED) joinPass(t, e);
      else n = frameRead(t, e);
    }
  }
  if (laneReadHook && e.l & CONFIG_OVERRIDE) {
    const n2 = laneReadHook(t, e);
    if (n2 !== NOT_PENDING) return n2;
  }
  if (snapshotCaptureActive && t && t.l & CONFIG_IN_SNAPSHOT_SCOPE) {
    const n2 = e.I?.Fe;
    if (n2 !== void 0 && !(e.O & STATUS_ERROR)) {
      const o2 = n2 === NO_SNAPSHOT ? void 0 : n2;
      const E2 = e.ce !== NOT_PENDING ? e.ce : e.ue;
      if (E2 !== o2) t._ |= REACTIVE_SNAPSHOT_STALE;
      return o2;
    }
  }
  if (laneStageHook && e.O & STATUS_PENDING && !n && !(e.l & CONFIG_OVERRIDE) && !(e.O & STATUS_UNINITIALIZED)) {
    if (t !== null && t.l & CONFIG_VERDICT && !(t.l & CONFIG_MOUNT_AHEAD && t.O & STATUS_UNINITIALIZED)) n = observeFlightHook(t, e);
    else if (passLane !== null && (!(t?.O & STATUS_UNINITIALIZED) || bornOfLaneRerun(t)))
      n = laneServedHook(t, e, true);
  }
  if (e.O & STATUS_PENDING && !n) {
    if (t) {
      if (!(t.l & CONFIG_CHILDREN_FORBIDDEN || refCallbackDepth && !tracking) || e.O & STATUS_UNINITIALIZED) {
        if (observeFlightHook && servesStaged(t, e, e)) {
          return e.ce;
        }
        if (!tracking && !spectating && e !== t) link(e, t);
        throw e.I?.P;
      }
    } else if (e.O & STATUS_UNINITIALIZED) {
      throw e.I?.P;
    }
  }
  if (e.re && e.O & STATUS_ERROR) {
    if (o && e.Ie < clock && !(e._ & REACTIVE_ZOMBIE)) {
      recompute(e);
      return read(e);
    }
    if (!n && e.l & CONFIG_STAGED_ERROR) serve(e, t);
    throw e.I?.P;
  }
  if (n || !t) throwShown(e);
  const E = serve(e, n ? null : t);
  if (!t && typeof e.re === "function" && e.l & CONFIG_AUTO_DISPOSE && !(e.O & STATUS_PENDING) && !e.o) {
    dormantNodes.add(e);
    schedule();
  }
  return E;
}
function bornOfLaneRerun(e) {
  const t = e._parent;
  return passLane._parent?.Ve !== passLane && t?.re && !(t.O & STATUS_UNINITIALIZED | t.l & CONFIG_FRAME);
}
function throwShown(e) {
  if (e.I?.Te) {
    throw e.I.Te;
  }
}
function serve(e, t) {
  if (e.ce !== NOT_PENDING && e.O & STATUS_UNINITIALIZED && (!t || spectating || t.l & CONFIG_CHILDREN_FORBIDDEN)) {
    if (refCallbackDepth > 0) {
      const t2 = creatorPass(context);
      if (t2 && e.l & CONFIG_HELD && bornInto(t2, txOf(e))) {
        return e.ce;
      }
    }
    throw new NotReadyError(null);
  }
  const n = t && unflushedStaged ? unflushedValue(e) : NOT_PENDING;
  if (n !== NOT_PENDING) {
    markLateLinker(t);
    return n;
  }
  if (readerSeesCommitted(e, t) || observeFlightHook && t.l & CONFIG_VERDICT && !(e.O & STATUS_UNINITIALIZED) && stagedScreen(t, e) && !throwShown(e)) {
    return e.ue;
  }
  stagedRead(t, e);
  if (e.l & CONFIG_STAGED_ERROR) {
    throw e.ce;
  }
  return e.ce;
}
function stagedRead(e, t) {
  if (!(t?.O & STATUS_UNINITIALIZED)) {
    if (laneServedHook && passLane !== null) laneServedHook(e, null);
    e._ |= REACTIVE_STAGED_READ;
    if (laneSeamsHook && (passLane !== null || e.i && e.l & CONFIG_VERDICT)) stagedReaders.push(e);
  }
}
function stagedScreen(e, t) {
  if (flushTransaction === null || bornInto(e, flushTransaction) || (t?.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD || // This flush's own write read by a pass with an inherited posture is the
  // frame's derivation (D-25, #4544).
  observeFlightHook && holdStagingHook(e, t)) return false;
  if (laneStageHook && t && fresh && passLane && e._ >> WINDOW_KINDS != 1) passLane.lt = 1;
  staleReader(e, flushTransaction);
  return true;
}
function notePromotedWrite(e) {
  if (globalQueue.ee || e.l & CONFIG_PROMOTED) return;
  e.l |= CONFIG_PROMOTED;
  promotedWrites.push(e);
}
function captureWriteSnapshot(e, t) {
  if (e.l & CONFIG_NO_SNAPSHOT || e.re !== void 0 || e.I?.Fe !== void 0) return;
  takeSnapshot(e, t);
}
function takeSnapshot(e, t) {
  ext(e).Fe = t === void 0 ? NO_SNAPSHOT : t;
  e.l |= CONFIG_HAS_SNAPSHOT;
  snapshotSources.add(e);
}
var writeHook = null;
function isSame(e, t, n) {
  if (e.We === isEqual) return t === n;
  try {
    return e.We && e.We(t, n);
  } catch (t2) {
    if (!(t2 instanceof NotReadyError)) return notifyStatus(e, STATUS_ERROR, t2), true;
  }
}
function setSignal(e, t) {
  if (writeHook !== null) writeHook(e);
  const n = e.ce === NOT_PENDING ? e.ue : e.ce;
  if (typeof t === "function") t = t(n);
  if (laneWriteHook && e.l & CONFIG_OVERRIDE) return laneWriteHook(e, t);
  if (e.l & CONFIG_HELD) joinFuture(txOf(e));
  const o = observeFlightHook ? e.We !== isEqual : null;
  const E = !!(e.O & STATUS_UNINITIALIZED) || !!e.I?.Te || (o === false ? n !== t : !isSame(e, n, t));
  if (!E) return t;
  if (snapshotCaptureActive) captureWriteSnapshot(e, n);
  const s = e.ce !== NOT_PENDING;
  if (!s) queuePendingNode(e);
  else if (e.l & CONFIG_HELD && !globalQueue.ee) stashFlushed(e);
  e.ce = o && s && !(e.O & STATUS_UNINITIALIZED || e.I?.Te) && isSame(e, e.ue, t) ? e.ue : t;
  if (context !== null) notePromotedWrite(e);
  if (e.re !== void 0) e.Ie = clock;
  if (s && e.je === notifyEpoch) return t;
  insertSubs(e);
  schedule();
  return t;
}
function setMemo(e, t) {
  const n = e.l & CONFIG_HELD && !(e._ & REACTIVE_MANUAL_WRITE) && txOf(e) !== flushTransaction;
  if (n && typeof t === "function") {
    const n2 = t(e.ue);
    t = () => n2;
  }
  if (e.O & STATUS_ERROR) {
    e.I.Te = e.I.P;
    notifyStatus(e, STATUS_NONE);
  }
  t = setSignal(e, t);
  e.l &= ~CONFIG_STAGED_ERROR;
  if (n) {
    e._ = e._ & ~REACTIVE_CHECK | REACTIVE_DIRTY;
    insertIntoHeap(e, dirtyQueue);
    schedule();
  } else if (e.ce !== NOT_PENDING) e._ |= REACTIVE_MANUAL_WRITE;
  return t;
}
function runWithOwner(e, t) {
  const n = context;
  const o = tracking;
  context = e;
  tracking = false;
  try {
    return t();
  } finally {
    context = n;
    tracking = o;
  }
}
function staleValues(e, t = true) {
  try {
    return e();
  } finally {
  }
}
function markRefresh(e, t) {
  if (!t && typeof e.re === "function" && !(e._ & REACTIVE_DISPOSED)) {
    e._ = e._ & ~REACTIVE_CHECK | REACTIVE_DIRTY | (e._ & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP) ? 0 : REACTIVE_REASK);
    insertIntoHeap(e, dirtyQueue);
    schedule();
  }
}

// ../store-proto-features/packages/signals/dist/select/core/verdict.js
function watchVerdict(e, t = false) {
  if (t) e._ |= REACTIVE_PROBE_UNANSWERED;
  stagedReaders.push(e);
}
function route(e, t) {
  if (!passLane && !(e._ & (REACTIVE_JOINED | REACTIVE_STAGED_READ)) && !(e.l & CONFIG_HELD_FRAME && bornInto(e, resolveTx(t)))) setPassLane(verdictLane(t));
  e._ |= REACTIVE_LANE_READ;
}
function observeFlight(e, t) {
  if (t.l & CONFIG_INPUTS_PUBLISHED || t.l & CONFIG_HELD && bornInto(e, txOf(t))) return false;
  if (globalQueue.ee && e.T?.live.size !== 0) {
    joinFuture(null);
    if (!(t.l & CONFIG_HELD)) queuePendingNode(t);
    ahead.splice(ahead.indexOf(e) >>> 0, 1);
    verdictRead(e, flushTransaction, true);
  }
  return true;
}
var latestActive = false;
var probing = false;
var probeFound = false;
function verdictRead(e, t, r) {
  route(e, t);
  if (r) staleReader(e, t);
  else if (probing && t.rn[t.rn.length - 1] !== e) t.rn.push(e);
}
function provisionalVerdict(e, t) {
  if (flushTransaction) {
    if (probing && t) probeFound = true;
    verdictRead(e, flushTransaction);
    if (probing && e._ & REACTIVE_STAGED_READ) watchVerdict(e);
    return;
  }
  watchVerdict(e, !probing || t);
}
function quietPending(e) {
  const t = e.I;
  if (!t) return false;
  if (t.X) {
    for (const e2 of t.X) if (!e2.I?.Le) return false;
    return true;
  }
  return t.Le;
}
function heldNotFinal(e) {
  if ((e.O & STATUS_PENDING) !== 0 && (!quietPending(e) || heldBeneath(e))) return true;
  return e.ce !== NOT_PENDING && !latestActive && !e.I.Le && (e.I.Te || !e.We || !e.We(e.ue, e.ce));
}
function aheadError(e) {
  const t = e.O & STATUS_PENDING && (e.I?.ge || e.I?.Te);
  if (t) throw t;
}
function heldBeneath(e) {
  for (let t = e.G; t !== null; t = t.S) {
    const e2 = t.p;
    if (e2.l & CONFIG_HELD && e2.ce !== NOT_PENDING && !e2.I?.Le && !isSame(e2, e2.ue, e2.ce)) return true;
  }
  return false;
}
function pendingVerdict(e, t) {
  if (probing && (!quietPending(t) || heldBeneath(t))) probeFound = true;
  if (e && tracking) {
    if (t.l & CONFIG_HELD) verdictRead(e, txOf(t));
    else if (globalQueue.ee) {
      if (!probing) {
        e._ & REACTIVE_LANE_READ || ahead.push(e);
        flushTransaction || (joinFuture(null), flushTransaction.latest = 1);
      } else if (flushTransaction?.latest) return route(e, flushTransaction);
      provisionalVerdict(e, false);
    }
  }
}
function markVerdictReader(e) {
  const t = creatorPass(context);
  if (t && tracking) {
    if (left.has(t)) return watchVerdict(t, true), 1;
    const r = t === adopter && flushTransaction && t._ & REACTIVE_JOINED && !(t.l & CONFIG_VERDICT) && !(t.O & STATUS_UNINITIALIZED);
    t._ |= REACTIVE_PROBED | REACTIVE_WINDOW | e << WINDOW_KINDS | (creatorReads(t, 0) || (t.l |= CONFIG_VERDICT, 0));
    if (r && t.l & CONFIG_VERDICT) {
      setAdopter(null);
      dropFlushTx();
      t._ |= REACTIVE_MISSED_WAKE;
      t.Ne = true;
      throw new NotReadyError(null);
    }
  }
}
function latest(e) {
  if (markVerdictReader(2)) return e();
  const t = latestActive, r = verdict;
  latestActive = true;
  setVerdict(verdictValue);
  try {
    return e();
  } finally {
    latestActive = t;
    setVerdict(r);
  }
}
function isPending(e) {
  const t = markVerdictReader(1);
  const r = probing;
  const n = probeFound;
  const i = verdict;
  probing = !t;
  probeFound = false;
  if (!t) setVerdict(verdictValue);
  try {
    e();
    return probeFound;
  } catch (e2) {
    if (e2 instanceof NotReadyError && !probeFound && context !== null) throw e2;
    return probeFound;
  } finally {
    probing = r;
    probeFound = n;
    setVerdict(i);
  }
}
function staged(e) {
  if (e.l & CONFIG_STAGED_ERROR) throw e.ce;
  return e.ce;
}
function heldLatest(e, t) {
  const r = unflushedValue(e);
  if (r === NOT_PENDING) return staged(e);
  if (t) markLateLinker(t);
  return r;
}
function verdictValue(e, t) {
  const r = e;
  const n = !!t && !(t.l & CONFIG_CHILDREN_FORBIDDEN);
  const i = n && tracking;
  const a = probing;
  const s = latestActive;
  probing = false;
  latestActive = false;
  setVerdict(null);
  prepareComputed(r);
  if (t && tracking) {
    link(e, t);
    if (e.ce !== NOT_PENDING) ext(e).rt = e.l & CONFIG_HELD ? txOf(e) : flushTransaction || clock;
    if (e.re) pullComputed(r, t);
  }
  setVerdict(verdictValue);
  latestActive = s;
  probing = a;
  const o = snapshotCaptureActive && t && t.l & CONFIG_IN_SNAPSHOT_SCOPE ? e.I?.Fe : void 0, E = o !== void 0 && !(r.O & STATUS_ERROR);
  if (E) {
    const r2 = o === NO_SNAPSHOT ? void 0 : o;
    if ((e.ce !== NOT_PENDING ? e.ce : e.ue) !== r2) t._ |= REACTIVE_SNAPSHOT_STALE;
    return r2;
  }
  if (probing && GlobalQueue.N?.(r)) {
    probeFound = true;
    if (i && flushTransaction) verdictRead(t, flushTransaction);
  }
  if (e.l & CONFIG_OVERRIDE && !(r.O & STATUS_ERROR && !(e.l & CONFIG_GUESS))) {
    const n2 = txOf(e), a2 = (r.O & STATUS_PENDING) !== 0 && !quietPending(r), s2 = e.l & CONFIG_GUESS, o2 = s2 ? 0 : latestActive && !a2 ? latestOf(e) : screenOf(e);
    if (o2 !== NOT_PENDING) {
      const r2 = passLane !== null && sameLane(passLane, n2);
      if (i) verdictRead(t, n2._parent ?? n2);
      if (s2) {
        if (probing && (a2 || landed(e) && (!e.We || !e.We(latestOf(e), e.ce)))) probeFound = true;
        if (latestActive && n2.folded) {
          return n2.folded(null, e);
        }
        return latestOf(e);
      }
      if (probing && (a2 || parkUp(resolveTx(n2._parent ?? n2)))) probeFound = true;
      else if (probing && !r2 && n2.sn && !e.I.Je && e.ce !== NOT_PENDING && (!e.We || !e.We(e.ue, e.ce))) {
        probeFound = true;
        if (i) staleReader(t, n2);
      }
      return o2;
    }
  }
  const u = (r.O & STATUS_UNINITIALIZED) !== 0;
  if (e.l & CONFIG_HELD) {
    if (!u) {
      const a2 = txOf(e);
      if (i && !probing && t.i === EFFECT_RENDER && !passLane && a2.Ve?.sn && flushTransaction !== a2) {
        staleReader(t, a2.Ve);
        return e.ue;
      }
      if (i) verdictRead(t, a2);
      if (probing) if (t?.l & CONFIG_HELD && !t.I.v?.L) {
        if (e.ce !== NOT_PENDING && !blocked(a2)) {
          watchVerdict(t);
          return staged(e);
        }
        if (!t.I._e) staleReader(t, a2);
      } else {
        if (heldNotFinal(r)) probeFound = true;
        if (n && !i && !t.I?._e && !(t.O & STATUS_UNINITIALIZED)) watchVerdict(t);
      }
      if (latestActive && e.ce !== NOT_PENDING) {
        if (keptGuess(e) && blocked(a2)) {
          return e.ue;
        }
        if (!i && flushTransaction && !globalQueue.ee) joinFuture(a2);
        return heldLatest(e, i ? t : null);
      }
      if (latestActive) aheadError(r);
      return e.ue;
    }
    if (e.ce !== NOT_PENDING && (!(r.O & STATUS_PENDING) || latestActive && !probing)) {
      if (probing && n) joinPass(t, e);
      return staged(e);
    }
  } else if (e.ce !== NOT_PENDING) {
    if (r.O & STATUS_PENDING && (!u || probing && !(e.l & CONFIG_STAGED_ERROR))) pendingVerdict(i ? t : null, r);
    else if (i && globalQueue.ee) flushTransaction && !e.re && e.ce === e.ue && Object.is(e.ce, e.ue) ? route(t, flushTransaction) : provisionalVerdict(t, !latestActive && !u);
    else if (i && probing) watchVerdict(t);
    if (latestActive || u || n && !i) {
      if (globalQueue.ee) {
        return staged(e);
      }
      if (t) markLateLinker(t);
    }
    return e.ue;
  }
  if (r.O & STATUS_PENDING) {
    if (!u) {
      pendingVerdict(i ? t : null, r);
      if (latestActive) aheadError(r);
      return e.ue;
    }
    if (t && !tracking && !spectating && e !== t) link(e, t);
    throw r.I?.P;
  }
  if (e.re && r.O & STATUS_ERROR) throw r.I.P;
  return e.ue;
}
function holdWork(e, t) {
  if ((e.l & (CONFIG_ASYNC | CONFIG_OWN_PROBE)) === CONFIG_ASYNC && (!(e.O & STATUS_PENDING) || e.I.v?.L || t._ & REACTIVE_REASK)) return e.l &= ~CONFIG_VERDICT;
}
function stageMark(e, t) {
  if (t.l & CONFIG_STAGED_ERROR && !(e.l & (CONFIG_REDERIVE | CONFIG_STAGED_ERROR | EFFECT_TRACKED << 23))) {
    for (let r = e.G; r; r = r.S) if (r.p.l & CONFIG_STAGED_ERROR && !(e.I?.v?.L && (!(r.p.l & CONFIG_GUESS) || r.p.I.v === e.I.v))) {
      e.ce = t.ce;
      e.l |= CONFIG_STAGED_ERROR;
      queuePendingNode(e);
      e.T?.st(STATUS_ERROR);
      return settlePendingSource(e);
    }
  }
}
function keepReaders(e) {
  for (let t = e.o; t !== null; t = t.t) {
    const r = t.u;
    if ((r.l & (CONFIG_HELD | CONFIG_STAGED)) !== (CONFIG_HELD | CONFIG_STAGED) || r.i) continue;
    let n = r.G;
    while (n !== null && (n.p === e || !(n.p.l & CONFIG_HELD))) n = n.S;
    if (n !== null) continue;
    if (heldMountUnder(r, null)) continue;
    deleteFromHeap(r, dirtyQueue);
    r._ &= -4;
    r.l &= ~CONFIG_HELD;
    queuePendingNode(r);
    insertSubs(r);
  }
}
function attachWaits(e) {
  if (waiting?.has(e)) return globalQueue.enqueue(e.i, e.q ??= GlobalQueue.K.bind(null, e)), true;
  return false;
}
function holdStaging(e, t) {
  const r = e.I?.st, n = t?.I?.rt, i = t && resolveTx(t.l & CONFIG_HELD ? t.I.v : flushTransaction);
  if (t && !e.i && !passLane && t.re && (t.l & (CONFIG_VERDICT | CONFIG_ASYNC | CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_VERDICT) return true;
  return r && !(e.l & (CONFIG_OWN_PROBE | CONFIG_FRAME) || e._ & (REACTIVE_WINDOW | REACTIVE_PROBE_UNANSWERED)) && (!t || t.ce !== NOT_PENDING && !(t.l & (CONFIG_ASYNC | CONFIG_OVERRIDE)) && n !== clock && !(typeof n == "object" && resolveTx(n) === i) && resolveTx(r) === i) && (!passLane || passLane._parent.Ve === passLane && (setPassLane(null), true));
}
var armed = [];
var parks = [];
function park(e, t) {
  const r = e.I.De = e.I.Se, done = () => {
    const t2 = parks.indexOf(e);
    if (t2 !== -1 && e.I.De === r) parks.splice(t2, 1), schedule();
  };
  if (t.ts.some((t2) => {
    if (t2.O & STATUS_PENDING && (t2 === e || t2.I.X?.has(e))) {
      if (t2.i === EFFECT_RENDER) return true;
      for (let e2 = t2.o; e2; e2 = e2.t) {
        const t3 = e2.u;
        if (t3.i === EFFECT_RENDER ? t3.O & STATUS_PENDING || t3._ & REACTIVE_FRAME_READ : t3.l & CONFIG_REDERIVE && t3.O === STATUS_PENDING) return true;
      }
    }
  })) {
    parks.indexOf(e) === -1 && parks.push(e);
    r.then(done, done);
  }
}
function parkUp(e) {
  for (let t = parks.length - 1; t >= 0; t--) {
    const r = parks[t].I, n = r.v;
    if (!r.De || parks[t]._ & REACTIVE_DISPOSED) parks.splice(t, 1);
    else if (n?.L && resolveTx(n._parent) === e) return true;
  }
  return false;
}
var left = /* @__PURE__ */ new Map();
function reask(e, t, r) {
  if (left.has(e)) return;
  const n = parks.indexOf(e);
  if (n === -1) {
    if (!e.i && e.I?.v === t) for (let n2 = e.o; n2; n2 = n2.t) reask(n2.u, t, r);
    return;
  }
  parks.splice(n, 1);
  leave(e, t, r);
}
function seat(e, t) {
  list(e, verdictLane(t));
  e._ |= REACTIVE_LANE_DIRTY;
}
function leave(e, t, r) {
  const n = e.I;
  left.set(e, !n.Je && e.O & STATUS_PENDING);
  n.Je = false;
  n.v = null;
  n.De = void 0;
  e.ce = NOT_PENDING;
  e.l &= -34817;
  if (e !== r) e._ |= REACTIVE_DIRTY, enqueueSub(e);
  for (let n2 = e.G; n2; n2 = n2.S) {
    const e2 = n2.p;
    if (e2.re && e2.I?.v === t && !left.has(e2)) leave(e2, t, r);
  }
}
var adoptParked = (e, t) => {
  if (t === 2) {
    const t2 = e.I.v;
    if (parks.length && isVerdict(t2)) reask(e, t2, e);
    return false;
  }
  if (t) {
    const t2 = armed.indexOf(e);
    if (t2 < 0) return false;
    armed.splice(t2, 1);
    const r = e.I.De;
    deleteFromHeap(e, dirtyQueue);
    e._ &= -4;
    e.I.De = void 0;
    releaseFlightTeardown(e);
    try {
      handleAsync(e, r.then());
    } catch {
    }
    e.I.Ee = true;
    notifyStatus(e, STATUS_PENDING, new NotReadyError(e));
    return true;
  }
  if (!(e.i || e.l & CONFIG_ASYNC)) for (let t2 = e.o; t2 !== null; t2 = t2.t) {
    const e2 = t2.u;
    if (e2.i && e2.Oe) {
      e2.Oe = false;
      enqueueSub(e2);
    }
    arm(e2);
  }
  arm(e);
  return false;
};
var arm = (e) => e.I?.De && !(e._ & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP)) && !armed.includes(e) && armed.push(e);
function r5(e, t) {
  if (!e) {
    if (t) return parkUp(t);
    armed.length = 0;
    left.clear();
    return;
  }
  if (isThenable(e.I?.Se)) {
    if (!blocked(t)) return 1;
    park(e, t);
    seat(e, t);
  } else if (blocked(t)) {
    if (left.has(e)) seat(e, t);
    for (let r = e.o, n; r; r = r.t) if (isThenable((n = r.u).I?.Se) && n.I.X?.has(n) && n.l & CONFIG_HELD && txOf(n) === t && // A flight asked over the screen is no frame question.
    !(n._ & REACTIVE_FRAME_READ)) {
      park(n, t);
      if (left.get(n)) seat(n, t), enqueueSub(n);
    }
  }
}
function revert() {
  for (const e of pendingNodes)
    if (e.ce === e.ue && (!e.re || e._ & REACTIVE_MANUAL_WRITE)) unwake(e);
  if (heldRewrites.length !== 0) for (const e of heldRewrites.splice(0)) unwake(e);
}
function unwake(e) {
  if (e.ce === NOT_PENDING || !isSame(e, tickBase(e), e.ce)) return;
  for (let t = e.o; t !== null; t = t.t) {
    const e2 = t.u;
    if (!(e2._ & REACTIVE_IN_HEAP) || e2._ & REACTIVE_MISSED_WAKE || e2.l & CONFIG_VERDICT) continue;
    let r = true;
    for (let t2 = e2.G; t2 !== null && r; t2 = t2.S) {
      const e3 = t2.p;
      const n = e3.re !== void 0;
      r = !(n && e3._ & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK)) && (e3.ce === NOT_PENDING || n && !(e3._ & REACTIVE_MANUAL_WRITE) || isSame(e3, tickBase(e3), e3.ce));
    }
    if (r) {
      deleteFromHeap(e2, dirtyQueue);
      e2._ &= -4;
    }
  }
}
function pass(e, t) {
  if (!t) {
    e.I.ge = (e.l & (CONFIG_STAGED_ERROR | CONFIG_HELD)) === (CONFIG_STAGED_ERROR | CONFIG_HELD) ? e.ce : void 0;
    return false;
  }
  if (guessing || passLane !== null || e.O & STATUS_UNINITIALIZED) return false;
  for (let t2 = e.G; t2 !== null; t2 = t2.S) {
    const r = t2.p;
    if (r.ce !== NOT_PENDING ? !isSame(r, r.ue, r.ce) : r.re && r.O & STATUS_PENDING) return false;
    if (t2 === e.C) break;
  }
  return true;
}
installVerdictHooks(observeFlight, holdWork, stageMark, keepReaders, attachWaits, holdStaging, adoptParked, r5, revert, pass);
GlobalQueue.ut = () => {
  if (probing) probeFound = true;
};

// ../store-proto-features/packages/signals/dist/select/core/action.js
function inTransaction(t, n, e) {
  const i = question;
  setQuestion(n);
  joinFuture(t);
  const o = e();
  if (actionDepth === 0) flush();
  setQuestion(i);
  return o;
}
function action(t) {
  return (...n) => new Promise((e, i) => {
    const o = t(...n);
    const r = newTransaction(false);
    r.$ = 1;
    r.tt = true;
    const s = nextQuestion();
    const done = (t2, n2, o2 = false) => {
      resolveTx(r).$--;
      schedule();
      o2 ? i(n2) : e(t2);
    };
    const step = (t2, n2) => {
      let e2;
      enterAction();
      try {
        e2 = n2 ? o.throw(t2) : o.next(t2);
      } catch (t3) {
        exitAction();
        return done(void 0, t3, true);
      }
      exitAction();
      if (isThenable(e2)) return void e2.then(run, (t3) => done(void 0, t3, true));
      run(e2);
    };
    const run = (t2) => {
      if (t2.done) return done(t2.value);
      let n2 = false;
      try {
        if (isThenable(t2.value)) return void t2.value.then((t3) => {
          if (n2) return;
          n2 = true;
          inTransaction(r, s, () => step(t3));
        }, (t3) => {
          if (n2) return;
          n2 = true;
          inTransaction(r, s, () => step(t3, true));
        });
      } catch (t3) {
        if (n2) return;
        n2 = true;
        return void inTransaction(r, s, () => step(t3, true));
      }
      inTransaction(r, s, () => step(t2.value));
    };
    joinFuture(r);
    const u = question;
    setQuestion(s);
    step();
    setQuestion(u);
  });
}

// ../store-proto-features/packages/signals/dist/select/core/identities.js
var signalHook = null;

// ../store-proto-features/packages/signals/dist/select/core/context.js
function getContext(e, t = getOwner()) {
  let r;
  if (t) r = t.D[e.id];
  if (r === void 0) r = e.defaultValue;
  if (r === void 0) {
    throw new ContextNotFoundError();
  }
  return r;
}
function setContext(e, t, r = getOwner()) {
  if (!r) {
    throw new NoOwnerError();
  }
  r.D = {
    ...r.D,
    [e.id]: t === void 0 ? e.defaultValue : t
  };
}

// ../store-proto-features/packages/signals/dist/select/core/effect.js
function effect(e, t, E, f) {
  const u = !!f?.user;
  const o = createEffectNode(e, t, E, u ? EFFECT_USER : EFFECT_RENDER, f);
  recompute(o, true);
  f?.defer ? applyStaged(o) : o.ce === NOT_PENDING && (o.I?.v?.L || o.i === EFFECT_USER || f?.schedule ? globalQueue.enqueue(o.i, runEffect.bind(null, o), o.I?.v) : (
    // Type 0: the synchronous first render, not a queued run (D-19).
    runEffect(o, 0)
  ));
}
function notifyEffectStatus() {
  const e = this.O;
  const t = this.I?.P;
  if (e & STATUS_ERROR) {
    globalQueue.notify(this, STATUS_PENDING, 0);
    if (this.i === EFFECT_USER) {
      if (this.O & STATUS_ERROR) queueEffectRun(this);
      return;
    }
    escalate(this, unwrapStatusError(t));
  } else if (
    // A user effect's run owed for a pass a new question has since made
    // pending is for a world that will not commit (F-1, F-2): void — the
    // effect re-runs when that question settles (`settlePendingSource`). A
    // quiet re-ask keeps it: the pass still answers the question asked (F-9).
    this.i === EFFECT_USER
  ) {
    if (e & STATUS_PENDING && this.Oe && !t?.source?.I?.Le) ext(this).Ee = !(this.Oe = false);
  } else if (this.i === EFFECT_RENDER) {
    globalQueue.notify(this, STATUS_PENDING | STATUS_ERROR, e, t);
  }
}
function escalate(e, t, E) {
  if (!globalQueue.notify(e, STATUS_ERROR, STATUS_ERROR)) {
    haltReactivity(t);
    throw t;
  }
}
function runEffect(e, t) {
  if (!e.Oe || e._ & REACTIVE_DISPOSED) return;
  if (t && heldRunHook?.(e)) return;
  if (t && attachHook?.(e)) return;
  if (e.O & STATUS_ERROR && e.i === EFFECT_USER) {
    const t2 = unwrapStatusError(e.I?.P);
    e.be = e.ue;
    e.Oe = false;
    try {
      e.et ? e.et(t2, () => {
        const t3 = e.nt;
        e.nt = void 0;
        t3?.();
      }) : console.error(t2);
    } catch (t3) {
      escalate(e, t3);
    }
    return;
  }
  const E = e.I?.P == null;
  const f = e.nt;
  e.nt = void 0;
  try {
    f?.();
    const t2 = e.$e(e.ue, e.be);
    if (false) ;
    e.nt = t2;
  } catch (t2) {
    ext(e).P = new StatusError(e, t2);
    e.O |= STATUS_ERROR;
    escalate(e, t2);
  } finally {
    e.be = e.ue;
    e.Oe = false;
    if (E) trimStaleDeps(e);
  }
}
GlobalQueue.K = runEffect;
function trackedEffect(e, t) {
  let E = false, f;
  const run = () => {
    if (!u.Oe || u._ & REACTIVE_DISPOSED) return;
    if (heldRunHook?.(u)) return;
    const e2 = notifyEpoch;
    E = false;
    try {
      u.Oe = false;
      recompute(u);
    } finally {
    }
    for (let t2 = u.G; t2 !== null; t2 = t2.S) {
      const o = t2.p;
      if (o.ce !== NOT_PENDING && !(o.l & CONFIG_OVERRIDE) && (o.ce !== o.ue || !Object.is(o.ce, o.ue))) {
        if (o.l & CONFIG_HELD) {
          if (!E) {
            E = true;
            txOf(o).ft[EFFECT_USER - 1].push(f ||= () => {
              if (E) {
                u.Oe = true;
                run();
              }
            });
          }
        } else if (o.je <= e2 || o.re) {
          enqueueSub(u);
          schedule();
          break;
        }
      }
    }
  };
  const u = computed(() => {
    const t2 = u.nt;
    u.nt = void 0;
    t2?.();
    const E2 = staleValues(e);
    u.nt = E2;
  }, {
    ...t,
    lazy: true
  });
  u.nt = void 0;
  u.l = u.l & ~CONFIG_AUTO_DISPOSE | CONFIG_CHILDREN_FORBIDDEN;
  u.Oe = true;
  u.i = EFFECT_TRACKED;
  u.Y = run;
  enqueueSub(u);
  schedule();
}
setEffectStatusNotify(notifyEffectStatus);

// ../store-proto-features/packages/signals/dist/select/core/error-hooks.js
var ambientHook;
var reported = /* @__PURE__ */ new WeakSet();
function hookFor(e) {
  for (let n = e; n; n = n._parent) {
    const e2 = n[ROOT_ERROR_HOOK];
    if (e2 !== void 0) return e2;
  }
  return ambientHook;
}
function labels(e) {
  const n = [];
  for (let o = e; o; o = o._parent) {
    const e2 = o._name;
    if (typeof e2 === "string" && e2.length) n.push(e2);
  }
  return n.length ? n.reverse() : void 0;
}
function reportClientError(e, n, o) {
  const r = e !== null && (typeof e === "object" || typeof e === "function");
  if (r) {
    if (reported.has(e)) return;
    reported.add(e);
  }
  const t = hookFor(n);
  if (t === void 0) return;
  const i = {};
  const f = labels(n);
  const c = labels(o) ?? f;
  if (c !== void 0) i.ownerPath = c;
  if (f !== void 0) i.boundaryPath = f;
  try {
    t(e, i);
  } catch (e2) {
    console.error(e2);
  }
}

// ../store-proto-features/packages/signals/dist/select/store/types.js
var $TRACK = /* @__PURE__ */ Symbol(0);
var $PATCH = /* @__PURE__ */ Symbol(0);
var $TARGET = /* @__PURE__ */ Symbol(0);
var $PROXY = /* @__PURE__ */ Symbol(0);
var $RECORD = /* @__PURE__ */ Symbol(0);
var rawValues = /* @__PURE__ */ new WeakSet();
var rawValuesUsed = false;
function isRawValue(e) {
  return rawValuesUsed && rawValues.has(e);
}
var OBJECT_PROTO = Object.prototype;
var wrappableProtos = /* @__PURE__ */ new WeakMap();
function isWrappable(e) {
  if (e == null || typeof e !== "object") return false;
  const a = Object.getPrototypeOf(e);
  if (a === OBJECT_PROTO || a === null) return true;
  if (Array.isArray(e)) return true;
  let r = wrappableProtos.get(a);
  if (r === void 0) {
    r = Object.prototype.toString.call(e) === "[object Object]" && (typeof Node === "undefined" || !(e instanceof Node)) && isWrappable(a);
    wrappableProtos.set(a, r);
  }
  return r;
}
function ownEnumerableKeys(e) {
  return Reflect.ownKeys(e).filter((a) => Object.prototype.propertyIsEnumerable.call(e, a));
}
var writeOverride = false;
var targetList = null;
function installTargetList(e) {
  targetList = e;
}

// ../store-proto-features/packages/signals/dist/select/core/guesses.js
var pendingGuesses = [];
var readFrom = [];
function guessedValueOf(e) {
  let s = pendingGuessOf(e);
  return s !== NOT_PENDING || e.l & CONFIG_OVERRIDE && (s = latestOf(e)) !== NOT_PENDING ? s : e.ue;
}
function pendingGuessOf(e) {
  for (let s = pendingGuesses.length - 3; s >= 0; s -= 3) if (pendingGuesses[s] === e) return pendingGuesses[s + 1];
  return NOT_PENDING;
}
function optimisticWrite(e, s) {
  const n = guessedValueOf(e);
  if (typeof s === "function") s = s(n);
  if (e.We && e.We(n, s) && !(e.l & CONFIG_GUESS)) return s;
  pendingGuesses.push(e, s, question || nextQuestion());
  for (let e2 = 0; e2 < readGuesses.length; e2 += 2) if (readGuesses[e2 + 1] === question) readFrom.push(readGuesses[e2]);
  armGuessing();
  armGuessed();
  schedule();
  return s;
}
function applyGuesses(e) {
  let s = null;
  for (let n = 0; n < pendingGuesses.length; n += 3) {
    const t = pendingGuesses[n];
    const l = pendingGuesses[n + 1];
    let u = true, r = false;
    let i = null;
    if (t.l & CONFIG_OVERRIDE) {
      u = !t.We || !t.We(latestOf(t), l);
      if (!(t.l & CONFIG_GUESS)) {
        t.ce = NOT_PENDING;
        t.l |= CONFIG_GUESS;
      } else if (t.I.Je) r = true;
      if (r) txOf(t).es = clock;
      setLaneValue(t, txOf(t), l, r);
      i = txOf(t)._parent;
    } else {
      let n2;
      if (t.l & CONFIG_HELD) n2 = newLane(i = txOf(t));
      else {
        if (e === null && inFlight(t)) e = newTransaction(false);
        if (e === null) continue;
        n2 = s ??= newLane(e);
      }
      t.l |= CONFIG_OVERRIDE | CONFIG_GUESS;
      list(t, n2);
      setLaneValue(t, n2, l);
    }
    if (e !== null && i !== null) merge(e, i);
    ext(t)._e = pendingGuesses[n + 2];
    if (u) {
      laneDirty(t, txOf(t));
    }
  }
  pendingGuesses.length = 0;
}
var applyGuessesAt = (e) => {
  markJudged();
  if (pendingGuesses.length !== 0) {
    if (e !== null) {
      for (const s2 of readFrom) if (lanes.includes(s2)) merge(e, s2._parent);
    }
    applyGuesses(e);
  }
  let s = 0;
  for (let e2 = 0; e2 < readGuesses.length; e2 += 2) if (lanes.includes(readGuesses[e2])) readGuesses[s++] = readGuesses[e2], readGuesses[s++] = readGuesses[e2 + 1];
  readFrom.length = 0;
  readGuesses.length = s;
};
function supersede(e, s, n) {
  const t = txOf(e);
  const l = resolveTx(t._parent ?? t);
  if (n && e.l & CONFIG_SLOT_NODE && GlobalQueue.ss?.(latestOf(e), s)) n = false;
  if (n) {
    dissolveLane(t, l, e);
    if (t.Je) marked.add(e), e.l &= ~CONFIG_INPUTS_PUBLISHED;
    e.l &= -10241;
    e.I.Je = e.I.me = false;
    covers.delete(e);
    holdNode(e, l);
    e.ce = s;
    for (let s2 = e.o; s2; s2 = s2.t) if (s2.u._ & REACTIVE_ZOMBIE) staleReader(s2.u, l);
    if (e.o !== null) insertSubs(e);
  } else {
    landBeneath(e, s);
    GlobalQueue.ns?.(t);
  }
}
function laneCorrections() {
  let e = false;
  const s = lanes.slice();
  for (let n = 0; n < s.length; n++) {
    const t = s[n];
    if (lanes.indexOf(t) === -1) continue;
    const l = resolveTx(t._parent);
    if (!l.tt || l.$ !== 0 || l.L || ownFlights(l) || guessFlights(t)) continue;
    e = true;
    for (let e2 = 0; e2 < t.ts.length && lanes.indexOf(t) !== -1; e2++) {
      const s2 = t.ts[e2];
      if (s2.l & CONFIG_GUESS && s2.I.v === t) {
        const e3 = underOf(s2);
        supersede(s2, e3, !s2.We || !s2.We(latestOf(s2), e3));
      }
    }
  }
  return e;
}
function guessWrite(e, s) {
  GlobalQueue.ls?.(e);
  const n = stale(e, question);
  if (GlobalQueue.us?.(e, s, n) || n) landBeneath(e, s);
  else supersede(e, s, !e.We || !e.We(latestOf(e), s));
  schedule();
}
function laneOutcome(e, s, n) {
  if (n) return true;
  if (stale(e, answered(e))) {
    landBeneath(e, s);
    return true;
  }
  supersede(e, s, !e.We || !e.We(latestOf(e), s));
  return true;
}
function stale(e, s) {
  return s !== 0 && s < e.I._e;
}
function answered(e) {
  let s = 0;
  for (let n = e.G; n !== null; n = n.S) {
    const e2 = n.p;
    if (e2.I !== null && e2.I._e > s && e2.Ie === clock) s = e2.I._e;
  }
  return s;
}
installGuessLayer(guessWrite);
installGuessHooks(laneOutcome, applyGuessesAt, () => lanes.length !== 0 && laneCorrections());

// ../store-proto-features/packages/signals/dist/select/signals.js
function onCleanup(e) {
  return cleanup(e);
}
function accessor(e) {
  const t = read.bind(null, e);
  t[$REFRESH] = e;
  return t;
}
function createSignal(e, t) {
  if (typeof e === "function") {
    const r2 = computed(e, t);
    r2.l &= ~CONFIG_AUTO_DISPOSE;
    return [accessor(r2), setMemo.bind(null, r2)];
  }
  const r = signal(e, t);
  if (signalHook !== null) signalHook(r);
  return [accessor(r), setSignal.bind(null, r)];
}
function createOptimistic(e, t) {
  if (typeof e === "function") {
    const r2 = computed(e, t);
    r2.l &= ~CONFIG_AUTO_DISPOSE;
    return [accessor(r2), optimisticWrite.bind(null, r2)];
  }
  const r = signal(e, t);
  return [accessor(r), optimisticWrite.bind(null, r)];
}
function createMemo(e, t) {
  return accessor(computed(e, t));
}
function createEffect(e, t, r) {
  effect(e, t.effect || t, t.error, {
    user: true,
    ...r
  });
}
function createRenderEffect(e, t, r) {
  effect(e, t, void 0, r);
}
function watch(e, t, r, n = 0, o, c = flushTransaction) {
  if (n & CONFIG_AUTHORITATIVE) {
    GlobalQueue.tn = truthRead;
    GlobalQueue.ns = truthConfirmed;
  }
  computed(() => {
    let u, i = false;
    try {
      u = e();
    } catch (e2) {
      if (e2 instanceof NotReadyError) throw e2;
      u = unwrapStatusError(e2);
      i = true;
    }
    const s = getOwner();
    const f = n & CONFIG_AUTHORITATIVE && GlobalQueue.er?.(s);
    if (f) throw new NotReadyError(f);
    const a = flushTransaction ?? passTx;
    if (s._ & REACTIVE_JOINED && a !== null && (c === null || resolveTx(c) !== resolveTx(a))) {
      staleReader(s, resolveTx(a));
      return;
    }
    if (i) return void queueMicrotask(() => r(u));
    o?.(u);
    queueMicrotask(() => t(u));
  }, {
    ve: n
  }).l |= CONFIG_REDERIVE;
}
function refresh(e) {
  const t = e?.[$REFRESH];
  if (!t) {
    return Promise.resolve(void 0);
  }
  const r = flushTransaction;
  const n = t.I?.Se;
  const o = !!(r === null && t.O & STATUS_PENDING && !(t._ & (REACTIVE_CHECK | REACTIVE_DIRTY)) && typeof n?.then === "function");
  markRefresh(t, o);
  const c = new Promise((c2, u) => {
    const run = () => {
      if (o && t.I?.Se === n) markRefresh(t);
      let i = null;
      const make = () => watch(() => {
        if (i === null) i = getOwner();
        const e2 = read(t);
        if (t.l & CONFIG_GUESS && t.O & (STATUS_PENDING | STATUS_ERROR)) throw t.I?.P;
        return e2;
      }, (t2) => {
        c2(typeof e === "function" ? t2 : e);
        dispose(i);
      }, (e2) => {
        u(e2);
        dispose(i);
      }, CONFIG_FRESH_READ | CONFIG_AUTHORITATIVE, void 0, r);
      createRoot(make);
    };
    if (o) {
      const re = () => queueMicrotask(run);
      n.then(re, re);
    } else queueMicrotask(run);
  });
  c.catch(() => {
  });
  return c;
}
function until(e, t) {
  return new Promise((r, n) => {
    const o = t?.signal;
    if (o?.aborted) return n(o.reason);
    const c = flushTransaction;
    createRoot((u) => {
      let i;
      let s;
      const settle = (e2) => {
        if (i !== void 0) clearTimeout(i);
        if (s !== void 0) o.removeEventListener("abort", s);
        e2();
        u();
      };
      watch(e, (e2) => {
        if (e2) settle(() => r(e2));
      }, (e2) => settle(() => n(e2)), CONFIG_AUTHORITATIVE, (e2) => {
        if (e2 && c !== null && globalQueue.ee && resolveTx(c).$ !== 0) joinFuture(c);
      });
      if (t?.timeout !== void 0) i = setTimeout(() => settle(() => n(new TimeoutError())), t.timeout);
      if (o !== void 0) {
        s = () => settle(() => n(o.reason));
        o.addEventListener("abort", s, {
          once: true
        });
      }
    });
  });
}
function onSettled(e) {
  const t = getOwner();
  t && !(t.l & CONFIG_CHILDREN_FORBIDDEN) ? trackedEffect(() => untrack(e), void 0) : globalQueue.enqueue(EFFECT_USER, function fire() {
    if (dirtyQueue.it >= dirtyQueue.ke) return globalQueue.enqueue(EFFECT_USER, fire);
    e();
  });
}
function onFlush(e) {
  schedule();
  queueMicrotask(() => {
    e();
    flush();
  });
}

// ../store-proto-features/packages/signals/dist/select/store/target.js
var $OWNER = /* @__PURE__ */ Symbol(0);
var storeLookup = /* @__PURE__ */ new WeakMap();
function setLookup(o, e) {
  (e.T?.map ?? storeLookup).set(o, e);
}
function isOwned(o) {
  return o[$OWNER] !== void 0;
}
function lookupTarget(o, e) {
  const n = o[$OWNER];
  return n !== void 0 && n.T === e ? n : (e?.map ?? storeLookup).get(o);
}
function proxyOf(o) {
  return o.px ??= new Proxy(o.ar ? [] : {}, o);
}
function markDescendants(o) {
  let e = o;
  while (e && !e.d) {
    e.d = true;
    e = e.u;
  }
}

// ../store-proto-features/packages/signals/dist/select/store/hooks.js
var optHooks = null;
var affectsHooks = null;
function installAffectsHooks(o) {
  affectsHooks = o;
}

// ../store-proto-features/packages/signals/dist/select/store/store.js
var $DEEP = /* @__PURE__ */ Symbol(0);
function TargetShape(e, t, n, _) {
  this.v = e;
  this.ch = e[$TARGET] !== void 0;
  this.pb = null;
  this.n = null;
  this.h = null;
  this.k = null;
  this.dk = null;
  this.u = t;
  this.pk = n;
  this.px = null;
  this.ar = Array.isArray(e);
  this.d = false;
  this.a = false;
  this.sc = 0;
  this.kc = 0;
  this.nc = 0;
  this.hc = 0;
  this.T = _;
  this.o = _ !== null && _.opt === true;
  this.s = false;
  this.ovl = false;
  this.del = null;
  this.wk = null;
}
function createTarget(e, t, n, _ = t?.T ?? null) {
  const r = new TargetShape(e, t, n, _);
  setLookup(e, r);
  return r;
}
function isTarget(e) {
  return e instanceof TargetShape;
}
var HANDLE = {};
function served2(e, t) {
  return e !== HANDLE && t !== null && typeof t === "object" && isTarget(t) ? t.px ?? proxyOf(t) : t;
}
function wrapTarget(e, t = null, n = null, _ = t?.T ?? null) {
  if (rawValuesUsed && isRawValue(e)) return e;
  const r = lookupTarget(e, _);
  if (r !== void 0) return r;
  const o = e[$TARGET];
  if (o !== void 0 && o.px === e) {
    if (_ === null || o.T === _) return o;
    return createTarget(e, t, n, _);
  }
  return createTarget(e, t, n, _);
}
function unwrapValue(e) {
  if (e == null || typeof e !== "object") return e;
  const t = e[$TARGET];
  if (t !== void 0 && (t.px === e || lookupTarget(e, t.T) === t) && t.v !== void 0) {
    if (t.ovl) materializePB(t);
    return t.pb ?? t.v;
  }
  return e;
}
var slotNodeEquals = function(e, t) {
  return isEqual(e, t) || sameLogicalSlot(this.R, e, t);
};
function sameKey(e, t) {
  return e === t || e !== e && t !== t;
}
var containerEquals = function(e, t) {
  return e === t;
};
function sameLogicalSlot(e, t, n) {
  if (t === null || typeof t !== "object" || n === null || typeof n !== "object") return false;
  const _ = lookupTarget(t, e.T);
  return _ !== void 0 && _ === lookupTarget(n, e.T);
}
var deferredReleases2 = /* @__PURE__ */ new Set();
function releaseSlot(e) {
  const t = e.R;
  const n = e.ot;
  if (n === $TRACK) {
    if (t.k === e) t.k = null;
  } else if (n === $PATCH) {
    return;
  } else if (n === $DEEP) {
    if (t.dk === e) t.dk = null;
  } else if (t.n?.[n] === e) {
    delete t.n[n];
    if (--t.nc === 0) t.n = null;
  } else if (t.h?.[n] === e) {
    delete t.h[n];
    if (--t.hc === 0) t.h = null;
  }
  if (false) t.T.live.delete(t);
}
function noteNode(e, t, n) {
  if (false) e.T.live.add(e);
  markDescendants(e);
  if (affectsHooks !== null) affectsHooks.io(e, t, n);
}
var slotKept = (e) => e.ce !== NOT_PENDING || e.l & CONFIG_OVERRIDE || e.R.k?.l & CONFIG_HELD;
setSlotUnobserved((e) => {
  if (slotKept(e)) deferredReleases2.add(e);
  else releaseSlot(e);
});
function bornStaged(e, t, n, _) {
  if (t.We && t.We(t.ue, n)) return;
  queuePendingNode(t);
  t.ce = n;
  const r = e.k;
  if (r === null) return;
  if (laneStageHook && (r.l & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) holdWithDerive(e, t, txOf(r));
  else if (r.l & CONFIG_HELD && heldKeyChanged(e, _)) {
    const e2 = txOf(r);
    if (!(r.l & CONFIG_OVERRIDE) || e2.folded) holdNode(t, resolveTx(e2._parent ?? e2));
  }
  if (r.l & CONFIG_PROMOTED) notePromotedWrite(t);
}
function getNode(e, t, n = -1) {
  const _ = e.n ??= /* @__PURE__ */ Object.create(null);
  let r = _[t];
  if (r === void 0) {
    const o = e.pb;
    const i = r = slotSignal(committed(e)[t], slotNodeEquals, e, t, n === -1 ? false : n === 1);
    if (o !== null && true) bornStaged(e, i, false ? void 0 : o[t], t);
    _[t] = r;
    e.nc++;
    noteNode(e, i, t);
  }
  return r;
}
function getHasNode(e, t) {
  const n = e.h ??= /* @__PURE__ */ Object.create(null);
  let _ = n[t];
  if (_ === void 0) {
    const r = _ = slotSignal(t in committed(e), isEqual, e, t, false);
    const o = e.pb;
    if (o !== null) bornStaged(e, r, t in o && true, t);
    n[t] = _;
    e.hc++;
    noteNode(e, r, t);
  }
  return _;
}
function getContainerNode(e) {
  let t = e.k;
  if (t === null) {
    t = e.k = slotSignal(e.v, containerEquals, e, $TRACK, false);
    noteNode(e, t, $TRACK);
    if (e.pb !== null && !directCommit) {
      t.ue = preBatch(e);
      t.ce = e.pb;
      queuePendingNode(t);
    }
  }
  return t;
}
function stageOn(e, t) {
  if (e.k === null && passLane === null && (context === null || globalQueue.ee) && !deriveHolds(e)) return;
  const n = getContainerNode(e);
  if (n.ce === NOT_PENDING) queuePendingNode(n);
  n.ce = t;
  if (context !== null) notePromotedWrite(n);
  if (false) holdWithDerive(e, n);
}
function deriveHolds(e) {
  const t = e.T?.node;
  return t != null && !userWrite && (t.l & CONFIG_HELD) !== 0;
}
var storePark = (e) => {
  for (let t = 0; t < foldList.length; t++) {
    const n = foldList[t];
    if (n.k === null && n.pb !== null) holdNode(getContainerNode(n), e);
  }
  optHooks?.park(e);
};
var deepUsed = false;
function bumpDeep(e) {
  if (e.dk !== null) setSignal(e.dk, 1);
}
function notifyContainer(e, t) {
  if ((e.l & (CONFIG_OVERRIDE | CONFIG_GUESS)) === (CONFIG_OVERRIDE | CONFIG_GUESS)) setSignal(e, t);
  else {
    if (e.l & CONFIG_HELD) joinFuture(txOf(e));
    if (snapshotCaptureActive) captureWriteSnapshot(e, e.ue);
    insertSubs(e);
    schedule();
  }
}
var hasOwn = Object.prototype.hasOwnProperty;
var protoOf = Object.getPrototypeOf;
var setProto = Object.setPrototypeOf;
var lookupGetter = Object.prototype.__lookupGetter__;
var propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
function cloneRaw(e, t) {
  t.sc || scanAccessorsOnce(t);
  if (t.sc === 2) {
    const n2 = {
      ...e
    };
    n2[$OWNER] = t;
    return n2;
  }
  let n;
  if (true)
    n = !Array.isArray(e) ? Object.assign(Object.create(protoOf(e)), e) : t.kc <= e.length + 1 ? e.slice() : Object.assign(e.slice(), e);
  else if (!t.a && t.kc <= e.length + 1 && protoOf(e) === Array.prototype) n = e.slice();
  else {
    const _ = Object.getOwnPropertyDescriptors(e);
    for (const n2 of Reflect.ownKeys(_)) {
      const r = _[n2];
      if (n2 === "length" && Array.isArray(e)) continue;
      r.configurable = true;
      if (!r.get && !r.set) r.writable = true;
      else t.a = true;
    }
    n = Object.defineProperties(Array.isArray(e) ? setProto([], protoOf(e)) : Object.create(protoOf(e)), _);
  }
  n[$OWNER] = t;
  return n;
}
function wideClone(e, t) {
  const n = /* @__PURE__ */ Object.create(null);
  for (const t2 of Reflect.ownKeys(e)) n[t2] = e[t2];
  setProto(n, Object.prototype);
  n[$OWNER] = t;
  return n;
}
function copyOwn(e, t, n) {
  if (true) {
    e[n] = t[n];
    return;
  }
  const _ = Object.getOwnPropertyDescriptor(t, n);
  if (_.get || _.set || !_.enumerable || !_.writable || !_.configurable) Object.defineProperty(e, n, _);
  else e[n] = _.value;
}
function scanAccessorsOnce(e) {
  const t = e.v;
  const n = Reflect.ownKeys(t);
  if (true) {
    e.sc = protoOf(t) === Object.prototype ? 2 : 1;
    e.kc = n.length;
    return true;
  }
  let _ = protoOf(t) === Object.prototype;
  for (const r of n) {
    if (false) {
      e.a = true;
      _ = false;
      break;
    }
    if (_ && !propertyIsEnumerable.call(t, r)) _ = false;
  }
  e.sc = _ ? 2 : 1;
  e.kc = n.length;
  return true;
}
var OVERLAY_MIN_KEYS = 32;
var OVERLAY_REBUILD_MAX_KEYS = 1024;
var OVERLAY_REBUILD_MIN_ADDS = 16;
var WK_ALL = /* @__PURE__ */ new Set();
var plainProto = (e) => {
  const t = protoOf(e);
  return t === Object.prototype || t === Array.prototype || t === null;
};
function overlayRebuilds(e, t) {
  if (e.kc > OVERLAY_REBUILD_MAX_KEYS) return false;
  if (false) return true;
  const n = e.wk;
  if (n !== null && n !== WK_ALL && n.u === void 0 && n.size <= OVERLAY_REBUILD_MIN_ADDS) return false;
  const _ = e.v;
  let r = 0;
  for (const e2 of Reflect.ownKeys(t)) if (!hasOwn.call(_, e2) && ++r > OVERLAY_REBUILD_MIN_ADDS) return true;
  return false;
}
function materializePB(e) {
  const t = e.pb;
  if (!e.ovl) return t;
  const n = overlayOnto(e, e.sc === 2 ? wideClone(e.v, e) : cloneRaw(e.v, e), t);
  e.pb = n;
  if (e.k?.ce === t) e.k.ce = n;
  return n;
}
function ensurePB(e) {
  let t = e.pb;
  if (false) return e.pb = optHooks.draft(e);
  if (t !== null && !isOwned(t)) {
    t = e.pb = cloneRaw(t, e);
    const n = e.k;
    if (n !== null && (!(n.l & CONFIG_HELD) || txOf(n) === flushTransaction)) n.ce = t;
  } else if (t === null) {
    const n = e.v;
    if (!directCommit) queueFold(e);
    if (!Array.isArray(n) && (e.sc !== 0 ? true : scanAccessorsOnce(e)) && e.kc > OVERLAY_MIN_KEYS && isOwned(n)) {
      t = e.pb = Object.create(n);
      e.ovl = true;
    } else try {
      t = e.pb = cloneRaw(n, e);
    } catch (e2) {
      if (!(e2 instanceof NotReadyError)) throw e2;
      return {};
    }
    if (!directCommit) stageOn(e, t);
  }
  return t;
}
function privatizeCommitted(e) {
  if (isOwned(e.v)) return;
  const t = e.v;
  const n = cloneRaw(t, e);
  e.v = n;
  e.ch = false;
  if (e.u) {
    privatizeCommitted(e.u);
    const n2 = e.u.v;
    const _ = parentSlotKey(e, t);
    if (n2[_] === t) n2[_] = e.v;
  }
}
function parentSlotKey(e, t) {
  const n = e.pk;
  const _ = e.u.v;
  if (_[n] === t || _[n] === e.v || !Array.isArray(_)) return n;
  const r = _.indexOf(t);
  if (r === -1) return n;
  e.pk = r;
  return r;
}
function flattenOverlay(e, t) {
  privatizeCommitted(e);
  overlayOnto(e, e.v, t);
}
function overlayOnto(e, t, n) {
  for (const _ of Reflect.ownKeys(n)) e.sc === 2 ? t[_] = n[_] : copyOwn(t, n, _);
  if (e.del !== null) {
    for (const n2 of e.del) delete t[n2];
    e.kc -= e.del.size;
    e.del = null;
  }
  e.ovl = false;
  return t;
}
function adoptPB(e, t, n = true) {
  if (!directCommit) queueFold(e);
  let _;
  if (e.pb !== null) {
    if (e.ovl) materializePB(e);
    _ = e.pb;
  } else _ = e.v;
  if (userWrite && e.k?.l & CONFIG_HELD && !Array.isArray(_)) for (const n2 in {
    ..._,
    ...t
  }) deferredReleases2.add(getNode(e, n2));
  if (directCommit) {
    e.pb = null;
    if (e.k !== null) e.k.ue = t;
  } else {
    e.pb = t;
    stageOn(e, t);
  }
  e.v = t;
  e.ch = t[$TARGET] !== void 0;
  e.ovl = false;
  e.del = null;
  e.sc = 0;
  e.a = false;
  e.wk = null;
  const r = t[$OWNER];
  if (r?.T === e.T) t[$OWNER] = e;
  else setLookup(t, e);
  if (false) optHooks.judge(e, t);
  if (n && _ !== t) notifyFold(e, _, t);
}
var foldList = [];
var foldOlds = [];
var foldSpare = [];
var foldOldsSpare = [];
var foldIndex = null;
function queueFold(e) {
  if (e.pb !== null) return;
  schedule();
  if (foldIndex !== null) foldIndex.set(e, foldList.length);
  foldList.push(e);
  foldOlds.push(e.v);
}
function preBatch(e) {
  if (foldIndex === null) {
    foldIndex = /* @__PURE__ */ new Map();
    for (let e2 = 0; e2 < foldList.length; e2++) foldIndex.set(foldList[e2], e2);
  }
  const t = foldIndex.get(e);
  return t === void 0 ? e.v : foldOlds[t];
}
function drainFolds() {
  if (foldList.length !== 0) {
    const e = foldList;
    const t = foldOlds;
    foldList = foldSpare;
    foldOlds = foldOldsSpare;
    foldSpare = e;
    foldOldsSpare = t;
    foldIndex = null;
    for (let n = 0; n < e.length; n++) {
      const _ = e[n];
      if (_.pb === null) continue;
      const r = _.k;
      if (r !== null && r.ce !== NOT_PENDING) {
        foldList.push(_);
        foldOlds.push(t[n]);
      } else foldTarget(_, t[n]);
    }
    e.length = 0;
    t.length = 0;
  }
  if (deferredReleases2.size !== 0) {
    for (const e of deferredReleases2) {
      if (e.o === null && !slotKept(e)) {
        deferredReleases2.delete(e);
        releaseSlot(e);
      }
    }
  }
}
GlobalQueue.k = (e) => {
  const t = e.R?.T;
  return (t?.node?.O & STATUS_PENDING) !== 0;
};
installStoreHooks(storePark, () => {
  drainFolds();
  optHooks?.sweep();
});
GlobalQueue.so = getNode;
GlobalQueue.ro = isWrappable;
var directCommit = false;
function foldTarget(e, t) {
  {
    {
      const n = e.k;
      const _ = e.pb;
      if (_ !== null) {
        if (_ === e.v) ;
        else if (e.ovl && (e.v !== t || !overlayRebuilds(e, _) && n?.I?.Fe !== t)) {
          flattenOverlay(e, _);
        } else if (e.v !== t) {
          privatizeCommitted(e);
          const n2 = e.v;
          const r = e.wk;
          if (r !== null && r !== WK_ALL) {
            for (let e2 = r; e2 !== void 0; e2 = e2.u) for (const t2 of e2) {
              if (hasOwn.call(_, t2)) copyOwn(n2, _, t2);
              else delete n2[t2];
            }
          } else {
            for (const e2 of Reflect.ownKeys(_)) if (e2 !== $OWNER) copyOwn(n2, _, e2);
            for (const e2 of Reflect.ownKeys(t)) {
              if (e2 !== $OWNER && !hasOwn.call(_, e2)) delete n2[e2];
            }
          }
        } else {
          e.v = e.ovl ? materializePB(e) : _;
          e.ch = e.v[$TARGET] !== void 0;
        }
        e.pb = null;
        e.wk = null;
      }
      if (n !== null) {
        if (n.o === null) e.k = null;
        else n.ue = e.v;
      }
      if (e.v !== t && e.u) {
        const n2 = parentSlotKey(e, t);
        if (e.u.v[n2] === t) {
          privatizeCommitted(e.u);
          e.u.v[n2] = e.v;
        }
      }
    }
  }
}
var userWrite = false;
var draftReadTx = null;
function notifyWrites(e) {
  let t = e.pb;
  if (t === null) return;
  if (false) {
    if (userWrite) {
      e.pb = null;
      e.wk = null;
      e.pb = optHooks.writes(e, t);
      return;
    }
    optHooks.pair(e, t);
    optHooks.judge(e, t);
  }
  const n = e.v;
  const _ = e.n;
  const r = e.wk;
  const o = r === WK_ALL || false || !plainProto(e.ovl ? e.v : t) ? null : r;
  if (false) {
    for (const t2 of o) if (heldDerivation(e, _?.[t2], t2)) {
      heldDerivationHit = true;
      break;
    }
  }
  if (_ !== null) {
    const r2 = o ?? Reflect.ownKeys(_);
    for (const o2 of r2) {
      const r3 = _[o2];
      if (r3 === void 0) continue;
      let i2 = false;
      if ((i2 = hasOwn.call(t, o2)) && lookupGetter.call(t, o2) !== void 0) {
        r3.acc = false;
        const e2 = Object.getOwnPropertyDescriptor(n, o2);
        const _2 = Object.getOwnPropertyDescriptor(t, o2);
        if (!_2 || _2.get || _2.set) {
          if (e2?.get !== _2?.get || e2?.set !== _2?.set || e2?.value !== _2?.value) setSignal(r3, () => FORCE);
          continue;
        }
        if (e2?.get || e2?.set || !isEqual(e2?.value, _2.value)) setSignal(r3, () => _2.value);
        continue;
      }
      const f2 = i2 || !(o2 === "__proto__") ? t[o2] : void 0;
      if (false) {
        coveredSet(r3, f2);
        continue;
      }
      setSignal(r3, () => f2);
      if (false) {
        if (!userWrite) {
          r3.l &= ~CONFIG_MANUAL_WRITE;
          holdWithDerive(e, r3);
        } else r3.l |= CONFIG_MANUAL_WRITE;
      }
    }
  }
  const i = e.h;
  if (i !== null) {
    const n2 = o ?? Reflect.ownKeys(i);
    for (const _2 of n2) {
      const n3 = i[_2];
      if (n3 !== void 0) {
        if (false) {
          coveredSet(n3, _2 in t && true);
          continue;
        }
        setSignal(n3, _2 in t && true);
        if (false) holdWithDerive(e, n3);
      }
    }
  }
  if (deepUsed && e.dk !== null) {
    if (false) bumpDeep(e);
    else for (const _2 of o ?? Reflect.ownKeys(t)) {
      if (_2 === $OWNER) continue;
      const r2 = t[_2];
      const o2 = n[_2];
      if (r2 !== null && typeof r2 === "object" ? !targetsEqual(o2, r2) : !isEqual(o2, r2)) {
        bumpDeep(e);
        break;
      }
    }
  }
  const f = e.k;
  if (f !== null && (f.o !== null || f.l & CONFIG_OVERRIDE)) {
    let _2;
    if (e.ovl) {
      _2 = false;
      if (!_2) {
        for (const e2 of Reflect.ownKeys(t)) {
          if (!hasOwn.call(n, e2)) {
            _2 = true;
            break;
          }
        }
      }
    } else {
      _2 = Array.isArray(t) && Array.isArray(n) ? arrayStructureChanged(n, t) : membershipChanged(n, t);
    }
    if (_2) notifyContainer(f, t);
  }
}
var FORCE = /* @__PURE__ */ Symbol();
function targetsEqual(e, t) {
  if (e === null || typeof e !== "object" || t === null || typeof t !== "object") return false;
  const n = lookupTarget(e, null);
  return n !== void 0 && n === lookupTarget(t, null);
}
function arrayStructureChanged(e, t) {
  if (e.length !== t.length) return true;
  for (let n = 0; n < t.length; n++) {
    const _ = e[n];
    const r = t[n];
    if (!isEqual(_, r) && !targetsEqual(_, r)) return true;
  }
  return false;
}
function membershipChanged(e, t) {
  const n = Reflect.ownKeys(t);
  if (Reflect.ownKeys(e).length - +isOwned(e) !== n.length - +isOwned(t)) return true;
  for (const t2 of n) if (t2 !== $OWNER && !(t2 in e)) return true;
  return false;
}
function leafSet(e, t) {
  const n = e.R;
  if (false) {
    coveredSet(e, typeof t === "function" ? t() : t);
    return;
  }
  setSignal(e, t);
  if (passLane !== null && !userWrite && e.R.T !== null) holdWithDerive(e.R, e);
}
function notifyKeyDiff(e, t, n, _, r = true) {
  if (r && hasOwn.call(_, t) && lookupGetter.call(_, t) !== void 0) {
    e.acc = false;
    const r2 = Object.getOwnPropertyDescriptor(n, t);
    const o = Object.getOwnPropertyDescriptor(_, t);
    if (!o || o.get || o.set) {
      if (r2?.get !== o?.get || r2?.set !== o?.set || r2?.value !== o?.value) leafSet(e, () => FORCE);
      return;
    }
    const i = r2?.value;
    const f = o?.value;
    if (r2?.get || r2?.set || !isEqual(i, f) && !targetsEqual(i, f)) leafSet(e, typeof f === "function" ? () => f : f);
  } else {
    const r2 = n[t];
    const o = _[t];
    if (n[$TARGET] || !isEqual(r2, o) && !targetsEqual(r2, o)) leafSet(e, typeof o === "function" ? () => o : o);
  }
}
function notifyFoldTail(e, t, n) {
  const _ = e.h;
  const r = t[$TARGET];
  if (_ !== null) {
    for (const e2 of Reflect.ownKeys(_)) if (r || e2 in t !== e2 in n) leafSet(_[e2], e2 in n);
  }
  const o = e.k;
  if (o !== null && (o.o !== null || o.l & CONFIG_OVERRIDE)) {
    const e2 = r || (Array.isArray(n) && Array.isArray(t) ? arrayStructureChanged(t, n) : membershipChanged(t, n));
    if (e2) notifyContainer(o, n);
  }
}
function notifyFold(e, t, n) {
  if (deepUsed && e.dk !== null && t !== n) bumpDeep(e);
  const _ = e.n;
  if (_ !== null) {
    for (const e2 of Reflect.ownKeys(_)) notifyKeyDiff(_[e2], e2, t, n);
  }
  notifyFoldTail(e, t, n);
}
var writeScopes = null;
var pendingNotify = /* @__PURE__ */ new Set();
function scopeKey(e) {
  if (false) return e.T;
  let t = e;
  while (t.u !== null) t = t.u;
  return t;
}
function inDraft(e) {
  return writeScopes !== null && writeScopes.has(scopeKey(e));
}
function draftServe(e, t) {
  if (writeScopes !== null && inDraft(e) && isTarget(t) && t.v !== void 0) writeScopes.add(scopeKey(t));
  return t;
}
function committed(e) {
  const t = e.k;
  if (t !== null) return t.ce !== NOT_PENDING ? t.ue : e.v;
  return e.pb !== null ? preBatch(e) : e.v;
}
function stagingReader() {
  let e = context;
  if (e === null) return null;
  if (e.ze) e = e.Xe ?? null;
  return e === null || e.l & CONFIG_CHILDREN_FORBIDDEN ? null : e;
}
function readSource(e, t, n = false) {
  if (false) {
    const t2 = ensurePB(e);
    pendingNotify.add(e);
    return t2;
  }
  const _ = e.pb;
  if (_ === null) return e.v;
  if (inDraft(e) || writeOverride) {
    if (userWrite !== writeOverride) {
      const n2 = t !== void 0 ? e.n?.[t] : void 0;
      const _2 = n2 ?? e.k;
      if (_2 != null && (_2.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD && (n2 !== void 0 || t === void 0 || heldKeyChanged(e, t))) userWrite ? draftReadTx = txOf(_2) : joinPassTx(txOf(_2));
    }
    return _;
  }
  const r = e.k;
  if (t !== void 0) {
    const n2 = e.n?.[t];
    if (n2?.l & CONFIG_OVERRIDE && r?.I?.v !== (n2.I.v || 0)) return committed(e);
  }
  const o = r !== null && (r.l & CONFIG_HELD) !== 0;
  if (o && t !== void 0 && !heldKeyChanged(e, t, n)) return _;
  const i = stagingReader();
  if (i === null) {
    if (getObserver() !== null) return _;
    if (familyAhead(e)) return _;
    if (verdict === null || !o && t !== void 0 && !keyChanged(e, t, n)) return o ? r.ue : e.v;
    return r === null ? committed(e) : read(r);
  }
  if (!o) {
    if (i._ & REACTIVE_STAGED_READ && !(i.l & (CONFIG_VERDICT | CONFIG_CHILDREN_FORBIDDEN))) return _;
    if (t !== void 0 && !keyChanged(e, t, n)) return committed(e);
    if (r === null) {
      if (i.l & CONFIG_VERDICT && stagedScreen(i)) return committed(e);
      stagedRead(i);
      return _;
    }
  }
  return untrack(() => read(r));
}
function heldKeyChanged(e, t, n = true) {
  return changedBetween(e, e.k.ue, e.k.ce, t, n) && !adoptChild(e, t);
}
var frameRaws = /* @__PURE__ */ new WeakMap();
function rawsOf(e) {
  let t = frameRaws.get(e);
  if (t === void 0) frameRaws.set(e, t = new Set(Object.values(e)));
  return t;
}
function sameRow(e, t, n) {
  return e !== null && typeof e === "object" && t !== null && typeof t === "object" && (n === null || sameKey(n(e), n(t)));
}
function adoptChild(e, t) {
  const n = e.k;
  const _ = n.ue;
  const r = _[t];
  const o = n.ce[t];
  const i = Array.isArray(_) ? e.T?.key : null;
  if (i === void 0 || !sameRow(r, o, i) || !isWrappable(r) || !isWrappable(o) || Array.isArray(r) !== Array.isArray(o) || lookupTarget(r, e.T) !== void 0 || lookupTarget(o, e.T) !== void 0 || // A raw in both frames (the same objects swapped or reordered) is its
  // own row: pairing it with another would alias the two after the commit.
  rawsOf(_).has(o) || rawsOf(n.ce).has(r)) return false;
  const f = wrapTarget(r, e, t);
  if (f?.v !== r) return false;
  adoptPB(f, o, false);
  holdNode(getContainerNode(f), txOf(n));
  return true;
}
function familyAhead(e) {
  return false;
}
function keyChanged(e, t, n = true) {
  return changedBetween(e, committed(e), e.pb, t, n);
}
function changedBetween(e, t, n, _, r) {
  if (n[$TARGET] !== void 0 || protoOf(n) !== protoOf(t) || !plainProto(t)) return true;
  if (false) return _ in t;
  const o = hasOwn.call(n, _) || e.ovl && hasOwn.call(e.v, _);
  if (o !== hasOwn.call(t, _)) return true;
  if (!o) return false;
  if ((r || false) && propertyIsEnumerable.call(t, _) !== propertyIsEnumerable.call(n, _)) return true;
  const i = n[_];
  const f = t[_];
  return !isEqual(f, i) && !sameLogicalSlot(e, f, i);
}
function nodeValue(e, t, n) {
  let _;
  if (e.ce !== NOT_PENDING && !(e.l & CONFIG_HELD) && false) {
    if (context !== null && tracking) link(e, context);
    _ = e.ce;
  } else _ = read(e);
  return false ? t : _;
}
function serveDataKey(e, t, n, _, r, o = -1) {
  const i = false;
  let f = n;
  if (!inDraft(e) && !writeOverride) {
    if (r === void 0 && getObserver() !== null) r = getNode(e, t, o);
    if (r !== void 0) {
      const t2 = nodeValue(r, n, e);
      if (i) {
        r.ue = n;
      } else f = t2;
    }
  }
  if (false) f = resolveChainedRaw(e, t, f);
  if (false) return serveShallow(e, t, f);
  if (r !== void 0) {
    if (r.pxv === f && f !== void 0) return draftServe(e, r.px);
    if (!isWrappable(f)) return f;
    const n2 = wrapTarget(f, e, t);
    r.px = n2;
    r.pxv = f;
    return draftServe(e, n2);
  }
  if (!isWrappable(f)) return f;
  return draftServe(e, wrapTarget(f, e, t));
}
function holdWithDerive(e, t, n = passLane) {
  const _ = e.T?.node;
  if (laneStageHook && n !== null && t.ce !== NOT_PENDING && !(t.l & CONFIG_OVERRIDE)) {
    list(t, n);
    t.l |= CONFIG_OVERRIDE;
    return;
  }
  if (_ !== void 0 && _ !== null && _.l & CONFIG_HELD && t.ce !== NOT_PENDING && // A node carrying a guess is the lane's: its staging is the truth beneath
  // the guess (`setSignal` → `laneWrite`), never re-homed by the store.
  !(t.l & (CONFIG_HELD | CONFIG_OVERRIDE))) {
    holdNode(t, txOf(_));
    t.I.Le = _.I.Le;
  }
}
function enumerationSource(e) {
  if (!inDraft(e) && !writeOverride && getObserver() !== null) {
    const t2 = read(getContainerNode(e));
    if (false) {
      const t3 = optHooks.frame(e);
      if (t3 !== NOT_PENDING) return t3;
    }
    return t2;
  }
  const t = readSource(e);
  return optRead(e) ? optHooks.view(e, t) : t;
}
function optRead(e) {
  return false;
}
function touch(e, t) {
  let n = e.wk;
  if (!pendingNotify.has(e)) {
    pendingNotify.add(e);
    if (n !== null && n !== WK_ALL) {
      n = /* @__PURE__ */ new Set();
      n.u = e.wk;
      e.wk = n;
    }
  }
  if (n !== WK_ALL) (e.wk ??= /* @__PURE__ */ new Set()).add(t);
}
var traps = {
  get(e, t, n) {
    const _ = this;
    if (typeof t !== "string") {
      if (t === $TARGET) return _;
      if (t === $PROXY) return n ?? proxyOf(_);
      if (t === $OWNER) return void 0;
      if (t === $RECORD) return void 0;
      if (t === $REFRESH) return _.T?.node ?? void 0;
      if (t === $TRACK) {
        if (false) pullFamily(_);
        if (!inDraft(_) && getObserver() !== null) {
          read(getContainerNode(_));
          if (false) optHooks.frame(_);
          const e2 = readSource(_);
          if (e2[$TARGET] !== void 0) e2[$TRACK];
        }
        return void 0;
      }
    }
    if (verdict !== null && affectsHooks !== null && getObserver() === null) affectsHooks.lo(_, t);
    if (false) pullFamily(_);
    if (false) {
      if (inDraft(_)) optHooks.drafted(_, t);
      else {
        const n2 = optHooks.read(_, t);
        if (n2 !== NOT_PENDING) return served2(e, n2);
      }
    }
    const r = _.n?.[t];
    if (writeScopes === null && !writeOverride) {
      const n2 = r;
      if (n2 !== void 0 && true && true) {
        const r2 = nodeValue(n2, void 0, _);
        if (r2 === null || typeof r2 !== "object") return r2;
        if (false) return served2(e, serveShallow(_, t, r2));
        if (n2.pxv === r2) return served2(e, n2.px);
        if (isWrappable(r2)) {
          const o2 = wrapTarget(r2, _, t);
          n2.px = o2;
          n2.pxv = r2;
          return served2(e, o2);
        }
        return r2;
      }
    }
    const o = readSource(_, t);
    if (o === _.pb && false) {
      if (!inDraft(_) && getObserver() !== null) read(getNode(_, t));
      return void 0;
    }
    let i = -1;
    if (false) {
      let f2;
      if (r !== void 0) f2 = false;
      else if (!inDraft(_) && getObserver() !== null) {
        f2 = false;
        if (o === (_.pb ?? _.v)) i = f2 ? 1 : 0;
      } else f2 = false;
      if (f2) {
        if (!inDraft(_) && getObserver() !== null) read(r ?? getNode(_, t, i));
        const f3 = Reflect.get(o, t, n ?? proxyOf(_));
        if (false) return served2(e, serveShallow(_, t, f3));
        return isWrappable(f3) ? served2(e, draftServe(_, wrapTarget(f3, _, t))) : f3;
      }
    }
    const f = _.ovl && o === _.pb;
    if (false) return void 0;
    let u = o[t];
    if (u === void 0 ? !hasOwn.call(o, t) && !(f && hasOwn.call(_.v, t)) : false) {
      if (false) u = Reflect.get(o, t, n ?? proxyOf(_));
      if (typeof u === "function") return u;
      if (false) return served2(e, serveDataKey(_, t, u, o, r, i));
      if (u === void 0 && !inDraft(_)) {
        if (getObserver() !== null) getNode(_, t, i);
        const n2 = _.n?.[t];
        if (n2) {
          const r2 = nodeValue(n2, void 0, _);
          if (false) return served2(e, serveShallow(_, t, r2));
          return isWrappable(r2) ? served2(e, draftServe(_, wrapTarget(r2, _, t))) : r2;
        }
      }
      if (false) return served2(e, serveShallow(_, t, u));
      return isWrappable(u) ? served2(e, draftServe(_, wrapTarget(u, _, t))) : u;
    }
    if (typeof u === "function" && !hasOwn.call(o, t) && !(f && hasOwn.call(_.v, t))) return u;
    return served2(e, serveDataKey(_, t, u, o, r, i));
  },
  has(e, t) {
    const n = this;
    if (t === $TARGET || t === $PROXY || t === $TRACK) return true;
    if (t === $OWNER || t === $RECORD) return false;
    if (verdict !== null && affectsHooks !== null && getObserver() === null) affectsHooks.lo(n, t);
    if (false) pullFamily(n);
    if (false) optHooks.drafted(n, t, true);
    if (optRead(n)) {
      const e2 = optHooks.has(n, t);
      if (e2 !== void 0) return e2;
    }
    const _ = readSource(n, t);
    if (!inDraft(n) && !writeOverride) {
      if (getObserver() !== null) {
        const e2 = getHasNode(n, t);
        const r = read(e2);
        if (true) return !!r;
        const o = t in _;
        e2.ue = o;
        return o;
      }
    }
    return t in _ && !(_ === n.pb && false);
  },
  ownKeys() {
    const e = this;
    if (verdict !== null && affectsHooks !== null && getObserver() === null) affectsHooks.lo(e, void 0);
    if (false) pullFamily(e);
    if (false) optHooks.drafted(e, void 0, true);
    return visibleKeys(e, enumerationSource(e));
  },
  getOwnPropertyDescriptor(e, t) {
    const n = this;
    if (t === $OWNER || t === $RECORD) return void 0;
    const _ = getObserver();
    if (verdict !== null && affectsHooks !== null && _ === null) affectsHooks.lo(n, t);
    if (false) pullFamily(n);
    const r = _ !== null && !inDraft(n) && !writeOverride;
    const o = r && observerHoldsContainer(n, _);
    if (!o && optRead(n)) {
      const _2 = optHooks.descriptor(n, t, Array.isArray(e));
      if (_2 !== void 0) return _2 === null ? void 0 : _2;
    }
    let i;
    if (o) i = enumerationSource(n);
    else if (r) {
      const e2 = getHasNode(n, t);
      const _2 = read(e2);
      i = readSource(n, t, true);
      if (!_2 && true) return void 0;
    } else i = readSource(n, t, true);
    let f;
    f ??= visibleDescriptor(n, i, t);
    if (f === void 0) return void 0;
    if (t === "length" && Array.isArray(e)) f.writable = true;
    else f.configurable = true;
    return f;
  },
  set(e, t, n) {
    const _ = this;
    const r = inDraft(_);
    if (!r && !writeOverride) {
      return true;
    }
    if (false) return true;
    const o = false ? n : unwrapValue(n);
    const i = ensurePB(_);
    if (userWrite && _.k?.l & CONFIG_HELD) deferredReleases2.add(getNode(_, t));
    if (Array.isArray(i)) {
      touch(_, t);
      if (t === "length") _.wk = WK_ALL;
      else touch(_, "length");
    } else {
      touch(_, t);
      if (!(t in i)) _.kc++;
    }
    const f = false;
    if (f || _.ovl && _.sc !== 2 && !hasOwn.call(i, t)) {
      Object.defineProperty(i, t, {
        value: o,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } else i[t] = o;
    if (false) _.del?.delete(t);
    if (f) return true;
    if (false) markRawOne(o);
    if (!r) notifyWrites(_);
    return true;
  },
  defineProperty(e, t, n) {
    const _ = this;
    const r = inDraft(_);
    if (!r && !writeOverride) {
      return true;
    }
    if (true) return false;
    if (false) return true;
    if (n.get || n.set) _.a = true;
    if ("value" in n) n = {
      ...n,
      value: unwrapValue(n.value)
    };
    const o = ensurePB(_);
    if (!(n.enumerable && n.writable && n.configurable)) _.sc = 1;
    touch(_, t);
    Object.defineProperty(o, t, n);
    _.del?.delete(t);
    if (!r) notifyWrites(_);
    return true;
  },
  deleteProperty(e, t) {
    const n = this;
    const _ = inDraft(n);
    if (!_ && !writeOverride) {
      return true;
    }
    if (true) return false;
    const r = ensurePB(n);
    touch(n, t);
    const o = n.ovl && hasOwn.call(n.v, t);
    if (hasOwn.call(r, t)) {
      delete r[t];
      o || n.kc--;
    }
    if (o) (n.del ??= /* @__PURE__ */ new Set()).add(t);
    if (!_) notifyWrites(n);
    return true;
  },
  // The shell is empty: a store cannot be frozen or re-prototyped. It stays
  // extensible, so the source's prototype may be reported (#4670: instanceof).
  getPrototypeOf() {
    return protoOf(this.v);
  },
  preventExtensions: () => false,
  setPrototypeOf: () => false
};
TargetShape.prototype = traps;
var propKey = (e) => typeof e === "number" ? "" + e : e;
function storeGet(e, t) {
  return traps.get.call(e, HANDLE, propKey(t), void 0);
}
function storeHas(e, t) {
  return traps.has.call(e, HANDLE, propKey(t));
}
function storeSlice(e) {
  const t = storeGet(e, "length") >>> 0;
  const n = new Array(t);
  for (let _ = 0; _ < t; _++) {
    const t2 = "" + _;
    if (traps.has.call(e, HANDLE, t2)) n[_] = traps.get.call(e, HANDLE, t2, void 0);
  }
  return n;
}
installTargetList({
  At: isTarget,
  Rt: storeGet,
  Mt: storeSlice
});
function observerHoldsContainer(e, t) {
  const n = e.k;
  if (n === null) return false;
  const _ = n.Be;
  return _ !== null && _.u === t && (!(t._ & REACTIVE_RECOMPUTING_DEPS) || _.Ae === t.Re);
}
if (false) installShallowView((e) => {
  if (false) return e.T && pullFamily(e), readSource(e);
});
function visibleKeys(e, t) {
  let n;
  if (e.ovl && t === e.pb) {
    n = Reflect.ownKeys(e.v);
    const _ = e.del;
    if (_?.size) n = n.filter((e2) => !_.has(e2));
    for (const _2 of Reflect.ownKeys(t)) {
      if (!hasOwn.call(e.v, _2)) n.push(_2);
    }
  } else n = Reflect.ownKeys(t);
  for (let e2 = n.length - 1; e2 >= 0 && typeof n[e2] === "symbol"; e2--) {
    if (n[e2] === $OWNER) {
      n.splice(e2, 1);
      break;
    }
  }
  return n;
}
function visibleDescriptor(e, t, n) {
  let _ = Object.getOwnPropertyDescriptor(t, n);
  if (e.ovl && t === e.pb) {
    if (false) return void 0;
    if (_ === void 0) _ = Object.getOwnPropertyDescriptor(e.v, n);
  }
  return _;
}

// ../store-proto-features/packages/signals/dist/select/affects-marks.js
var active = 0;
function repoll(e, r = /* @__PURE__ */ new Set(), o = CONFIG_VERDICT | CONFIG_AUTHORITATIVE) {
  for (let t = e.o; t !== null; t = t.t) {
    const e2 = t.u;
    if (r.has(e2)) continue;
    r.add(e2);
    if (e2.l & o) enqueueSub(e2);
    if (!e2.i) repoll(e2, r, o);
    const n = e2.T;
    if (n) {
      for (const e3 of n.live) for (const o2 of [e3.n, e3.h, {
        k: e3.k,
        d: e3.dk
      }]) if (o2) for (const e4 of Reflect.ownKeys(o2)) o2[e4] && repoll(o2[e4], r, CONFIG_VERDICT);
    }
  }
}
function marked2(e, r) {
  if (e.I !== null && e.I.m !== 0) return true;
  const o = e;
  if (o.O & STATUS_ERROR || r.has(e)) return false;
  r.add(e);
  if (o.l & CONFIG_SLOT_NODE) {
    const e2 = o.R?.T?.node;
    return e2 != null && marked2(e2, r);
  }
  const t = o._ & REACTIVE_RECOMPUTING_DEPS ? o.C : void 0;
  if (t !== null) for (let e2 = o.G ?? null; e2 !== null; e2 = e2.S) {
    if (marked2(e2.p, r)) return true;
    if (e2 === t) break;
  }
  return false;
}
function mark(e) {
  ext(e).m++;
  active++;
}
function unmark(e) {
  active--;
  if (--e.I.m !== 0) return false;
  repoll(e);
  return true;
}
GlobalQueue.N = (e) => active !== 0 && marked2(e, /* @__PURE__ */ new Set());
GlobalQueue.A = mark;

// ../store-proto-features/packages/signals/dist/select/store/affects.js
var $AFFECTS = /* @__PURE__ */ Symbol(0);
var scopes = /* @__PURE__ */ new Map();
function scopeOf(e, o) {
  let n = scopes.get(e);
  if (n === void 0) scopes.set(e, n = {
    no: /* @__PURE__ */ new Set(),
    fo: [],
    ot: o
  });
  return n;
}
function storeMarks(e, o) {
  const n = GlobalQueue.so(e, o === void 0 ? $AFFECTS : o);
  const t = scopeOf(n, o);
  if (o === void 0) {
    const o2 = [n];
    walk2(proxyOf(e), t, o2, e.T, /* @__PURE__ */ new Set());
    return o2;
  }
  t.no.add(e.v);
  if (e.pb !== null) t.no.add(e.pb);
  return [n];
}
function walk2(e, o, n, t, f) {
  if (!GlobalQueue.ro(e)) return;
  let s = e[$TARGET];
  if (s !== void 0 && t !== null && s.T !== t && s.px === e) {
    if (f.has(e)) return;
    f.add(e);
    o.no.add(e);
    const r2 = lookupTarget(e, t);
    if (r2 !== void 0) nodesOf(r2, n);
    const i = s.pb ?? s.v;
    for (const e2 of Reflect.ownKeys(i)) {
      const r3 = Object.getOwnPropertyDescriptor(i, e2).value;
      const l = GlobalQueue.ro(r3) ? lookupTarget(r3, s.T) : void 0;
      if (l !== void 0) walk2(proxyOf(l), o, n, t, f);
    }
    return;
  }
  s ??= lookupTarget(e, t);
  let r = s !== void 0 ? s.pb ?? s.v : e;
  if (f.has(r)) return;
  f.add(r);
  o.no.add(r);
  if (s !== void 0) {
    if (s.pb !== null) o.no.add(s.v);
    if (optHooks !== null && s.o) r = optHooks.view(s, r, true);
    nodesOf(s, n);
    t = s.T ?? t;
  }
  for (const e2 of Reflect.ownKeys(r)) if (e2 !== $OWNER) {
    const s2 = Object.getOwnPropertyDescriptor(r, e2);
    if (s2.get === void 0) walk2(s2.value, o, n, t, f);
  }
}
function nodesOf(e, o) {
  const n = e.n;
  if (n !== null) {
    for (const e2 of Reflect.ownKeys(n))
      if (e2 !== $AFFECTS) o.push(n[e2]);
  }
  const t = e.h;
  if (t !== null) for (const e2 of Reflect.ownKeys(t)) o.push(t[e2]);
  if (e.k !== null) o.push(e.k);
  if (e.dk !== null) o.push(e.dk);
}
function covering(e, o, n) {
  for (const [t, f] of scopes) {
    if (t === n || f.ot !== void 0 && f.ot !== o) continue;
    for (let o2 = e.v; ; ) {
      if (f.no.has(o2)) return t;
      const e2 = o2?.[$TARGET];
      if (e2 === void 0) break;
      const n2 = e2.pb ?? e2.v;
      if (n2 === o2) break;
      o2 = n2;
    }
  }
  return null;
}
var hooks = {
  // A node born on a record a live mark covers inherits it (released with
  // the carrier's last registration).
  io(e, o, n) {
    if (scopes.size === 0 || n === $AFFECTS) return;
    const t = covering(e, n, o);
    if (!t) return;
    GlobalQueue.A(o);
    scopes.get(t).fo.push(o);
  },
  // An untracked probe (`isPending(() => s.x)` with no observer) reading a
  // record a live mark covers: no node carries the mark for it — the
  // verdict is told directly.
  lo(e, o) {
    if (e.n?.[$AFFECTS]?.I?.m || covering(e, o)) GlobalQueue.ut();
  }
};
function installStoreAffects() {
  installAffectsHooks(hooks);
}
function releaseMarkScope(e) {
  const o = scopes.get(e);
  if (o === void 0) return;
  scopes.delete(e);
  releaseMarksHook(o.fo);
}

// ../store-proto-features/packages/signals/dist/select/affects.js
var ambient = [];
function release(e) {
  for (let t = 0; t < e.length; t++) {
    const r = e[t];
    if (unmark(r)) releaseMarkScope(r);
  }
  e.length = 0;
}
function register(e) {
  mark(e);
  const t = flushTransaction;
  if (t === null) ambient.push(e);
  else {
    const r = resolveTx(t);
    (r.m ??= []).push(e);
  }
  repoll(e);
}
function affects(e, t) {
  const r = e?.[$TARGET];
  if (r !== void 0) {
    installStoreAffects();
    const e2 = storeMarks(r, t);
    for (let t2 = 0; t2 < e2.length; t2++) register(e2[t2]);
    schedule();
    return;
  }
  const s = e?.[$REFRESH];
  if (!s) {
    return;
  }
  register(s);
  schedule();
}
installMarkHooks((e) => {
  const t = [];
  for (let r = 0; r < e.length; r++) (inFlight2(e[r]) ? ambient : t).push(e[r]);
  e.length = 0;
  release(t);
}, (e) => {
  if (ambient.length === 0) return;
  if (e !== null) {
    const t2 = e.m ??= [];
    for (let e2 = 0; e2 < ambient.length; e2++) t2.push(ambient[e2]);
    ambient.length = 0;
    return;
  }
  let t = 0;
  const r = [];
  for (let e2 = 0; e2 < ambient.length; e2++) {
    const s = ambient[e2];
    if (inFlight2(s)) ambient[t++] = s;
    else r.push(s);
  }
  ambient.length = t;
  if (r.length !== 0) release(r);
});
function inFlight2(e) {
  return (e.O & STATUS_PENDING) !== 0 || (e.l & CONFIG_SLOT_NODE) !== 0 && GlobalQueue.k?.(e) === true;
}

// ../store-proto-features/packages/signals/dist/select/deferred.js
var lagging = /* @__PURE__ */ new Set();
function lagOf(e, r) {
  if (lagging.has(e)) return e;
  if (r.has(e)) return;
  r.add(e);
  if (e.l & CONFIG_SLOT_NODE) return lagOf(e.R?.T?.node ?? e, r);
  const t = e._ & REACTIVE_RECOMPUTING_DEPS ? e.C : void 0;
  if (t !== null) for (let o = e.G ?? null; o !== null; o = o.S) {
    const e2 = lagOf(o.p, r);
    if (e2) return e2;
    if (o === t) break;
  }
}
GlobalQueue.er = (e) => lagging.size !== 0 ? lagOf(e, /* @__PURE__ */ new Set()) : void 0;
function createDeferred(e, r) {
  let t;
  let o = null;
  let n = false;
  let l = false;
  const land2 = (e2, r2) => {
    if (e2 === null || o !== e2) return;
    o = null;
    lagging.delete(t);
    if (r2) {
      for (let e3 = t.G; e3 !== null; e3 = e3.S) if (e3.p.l & CONFIG_HELD) {
        holdNode(t, txOf(e3.p));
        break;
      }
    }
    if (n) {
      n = false;
      unmark(t);
      schedule();
    }
  };
  const ask = (e2) => {
    o = e2;
    lagging.add(t);
    if (!n && !(t._ & REACTIVE_REASK)) {
      n = true;
      mark(t);
      repoll(t);
    }
  };
  const serve2 = (e2) => {
    const r2 = handleAsync(t, e2);
    return t.l & CONFIG_HELD && t.ce !== NOT_PENDING ? t.ce : r2;
  };
  const end = () => t._ & REACTIVE_DISPOSED && land2(o);
  return accessor(computed((r2) => {
    t = getOwner();
    t.l |= CONFIG_REDERIVE;
    cleanup(end);
    const n2 = l ||= !(t.O & STATUS_UNINITIALIZED) && !t.Ne;
    if (n2) t.Ne = true, t.l |= CONFIG_LAGS;
    try {
      const t2 = e(r2);
      if (n2 && typeof t2 === "object" && t2 !== null) {
        if (isThenable(t2)) {
          ask(t2);
          const done = () => land2(t2, true);
          t2.then(done, done);
          return serve2(t2);
        }
        const e2 = t2[Symbol.asyncIterator];
        if (e2) {
          const r3 = e2.call(t2);
          let o2 = true;
          const done = () => land2(n3, true);
          const n3 = {
            // Registered ahead of the engine's own reaction to the same
            // promise, as for a plain flight: verdict and value in one flush.
            next: (e3) => {
              const t3 = r3.next(e3);
              if (o2) {
                o2 = false;
                if (isThenable(t3)) t3.then(done, done);
                else done();
              }
              return t3;
            },
            return: (e3) => r3.return?.(e3) ?? Promise.resolve({
              done: true,
              value: e3
            })
          };
          ask(n3);
          return serve2({
            [Symbol.asyncIterator]: () => n3
          });
        }
      }
      land2(o);
      return t2;
    } catch (e2) {
      if (n2 && e2 instanceof NotReadyError) ask(e2);
      else land2(o);
      throw e2;
    }
  }, r));
}

// ../store-proto-features/packages/signals/dist/select/flatten.js
function flatten(r, t) {
  if (typeof r === "function" && !r.length) {
    if (t?.doNotUnwrap) return r;
    do {
      r = r();
    } while (typeof r === "function" && !r.length);
  }
  if (t?.skipNonRendered && (r == null || r === true || r === false || r === "")) return;
  if (Array.isArray(r)) {
    let e = [];
    if (flattenArray(r, e, t)) {
      return () => {
        let r2 = [];
        flattenArray(e, r2, {
          ...t,
          doNotUnwrap: false
        });
        return r2;
      };
    }
    return e;
  }
  return r;
}
function flattenArray(r, t = [], e) {
  let o = null;
  let f = false;
  for (let n = 0; n < r.length; n++) {
    try {
      let o2 = r[n];
      if (typeof o2 === "function" && !o2.length) {
        if (e?.doNotUnwrap) {
          t.push(o2);
          f = true;
          continue;
        }
        do {
          o2 = o2();
        } while (typeof o2 === "function" && !o2.length);
      }
      if (Array.isArray(o2)) {
        f = flattenArray(o2, t, e) || f;
      } else if (e?.skipNonRendered && (o2 == null || o2 === true || o2 === false || o2 === "")) {
      } else t.push(o2);
    } catch (r2) {
      if (!(r2 instanceof NotReadyError)) throw r2;
      o = r2;
    }
  }
  if (o) throw o;
  return f;
}

// ../store-proto-features/packages/signals/dist/select/boundaries.js
var BOUNDARY = /* @__PURE__ */ Symbol("");
var REVEAL = /* @__PURE__ */ Symbol("");
var revealHooks = null;
var collecting = /* @__PURE__ */ new Set();
var boundaryOf = (e) => e.D[BOUNDARY];
var behindError = (e) => !!e && (e.i === STATUS_ERROR && e.h || behindError(e._parent));
var isCollecting = (e) => e.i === STATUS_ERROR || !e.H || e.U || behindError(e._parent);
var freshAbove = (e) => !!e && (e.i & STATUS_PENDING ? isCollecting(e) : freshAbove(e._parent));
var keeps = (e, n) => e.i | STATUS_PENDING | (behindError(e._parent) && n.D?.[BOUNDARY] === e ? STATUS_ERROR : 0);
function record(e, n, r = n) {
  e.F.set(n, r);
  collecting.add(e);
}
function caught(e, n, r, o = n) {
  if (e.i === STATUS_ERROR) {
    const t = laneStageHook ? passLane ?? (n.I?.v?.L ? txOf(n) : null) : null;
    if (laneStageHook && !e.h) e.L = t;
    r ??= n.I?.P;
    o = r?.source ?? n;
    if (o._ & REACTIVE_DISPOSED) o = n;
    const l = unwrapStatusError(r);
    if (laneStageHook && t) laneStageHook(e.P, t, true, false);
    setSignal(e.P, l);
    reportClientError(l, e.V, o);
  } else e.H = false;
  record(e, n, o);
  if (e.U) flip(e);
  if (!e.h) redraw(e);
  if (revealHooks && e.B !== null) revealHooks.j(e.B);
}
function flip(e) {
  e.H = false;
  e.L = e.M;
  const n = e.Z;
  if (!e.L && n.l & CONFIG_HELD && txOf(n) !== flushTransaction) unhold(n);
  if (laneStageHook && e.L !== null && e.Z !== null) laneStageHook(e.Z, e.L, true, false);
}
function redraw(e) {
  if (e.Z !== null && !(e.Z._ & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE))) {
    enqueueSub(e.Z);
    schedule();
  }
}
function catchStatus(e, n, r) {
  if (n === 0) {
    if (collecting.size) {
      for (let n2 = boundaryOf(e); n2; n2 = n2._parent) if (!(n2.F.get(e)?.O & keeps(n2, e)) && n2.F.delete(e) && !prune(n2, 0)) {
        if (n2.h) redraw(n2);
        if (revealHooks && n2.B !== null) revealHooks.j(n2.B);
      }
    }
    return false;
  }
  for (let o = boundaryOf(e); o; o = o._parent) {
    if (!(o.i & n)) {
      if (o.h && o.i > n) record(o, e);
      continue;
    }
    if (isCollecting(o)) {
      caught(o, e, r);
      return o.U ? CAUGHT_REARMED : true;
    }
    record(o, e);
  }
  return false;
}
function armedOver(e) {
  for (let n = boundaryOf(e); n; n = n._parent) if (n.i & STATUS_PENDING && isCollecting(n)) return n.U;
}
function hiddenBy(e, n) {
  for (let n2 = boundaryOf(e); n2; n2 = n2._parent) if (n2.h) return n2;
  let r, o = e.o;
  if (n || e.l & CONFIG_REDERIVE) for (n ||= /* @__PURE__ */ new Set(), r = e.i != EFFECT_RENDER; o && (r = n.size == n.add(o.u).size || hiddenBy(o.u, n)); ) o = o.t;
  return r;
}
function heldRun(e) {
  const n = hiddenBy(e);
  if (n === void 0 || n.Z.l & (laneStageHook ? CONFIG_HELD | CONFIG_OVERRIDE : CONFIG_HELD)) return false;
  (n.W ??= /* @__PURE__ */ new Set()).add(e);
  return true;
}
function release2(e) {
  if (e.W === null) return;
  for (const n of e.W) {
    const e2 = n.i;
    globalQueue.enqueue(e2 === EFFECT_TRACKED ? EFFECT_USER : e2, e2 === EFFECT_TRACKED ? n.Y : n.q ??= GlobalQueue.K.bind(null, n));
  }
  e.W = null;
}
function caughtBelow(e, n, r) {
  if (!(r.O & (STATUS_ERROR | STATUS_PENDING) || n.O & STATUS_ERROR)) {
    for (let r2 = boundaryOf(n); r2 && r2 !== e; r2 = r2._parent) if (r2.i & STATUS_PENDING && isCollecting(r2)) return !(r2.Z.l & CONFIG_HELD);
  }
  return false;
}
function reads(e, n, r) {
  for (let o = e.G, t; o; o = o.S) if ((t = o.p) === n || (r ||= /* @__PURE__ */ new Set()).size < r.add(t).size && reads(t, n, r)) return 1;
}
function prune(e, n) {
  const r = e.i | STATUS_PENDING;
  for (const [o, t] of e.F) {
    if (!((o._ | t._) & REACTIVE_DISPOSED)) {
      const l = keeps(e, o);
      if ((o.O & l || t.O & l && reads(o, t)) && !(r & STATUS_ERROR && caughtBelow(e, o, t)) || r & STATUS_ERROR && t.l & CONFIG_STAGED_ERROR || o.l & CONFIG_VERDICT && o._ & REACTIVE_IN_HEAP) {
        if (n === 0) break;
        continue;
      }
      if ((t !== e.J || e.U) && (t.l & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD) {
        if (!n || !e.H) continue;
        joinFuture(txOf(t));
      }
    }
    e.F.delete(o);
  }
  return e.F.size;
}
function boundarySeam() {
  for (const e of collecting) {
    const n = e.Z._;
    if (n & REACTIVE_DISPOSED) {
      collecting.delete(e);
      continue;
    }
    if (n & REACTIVE_ZOMBIE) continue;
    if (!e.H) {
      for (const [n2] of e.F) for (const r2 of n2.O & STATUS_PENDING ? n2.I?.X || [] : [n2]) if (!(r2.l & CONFIG_HELD)) for (let o = r2.G; o; o = o.S) {
        const t = o.p;
        if (t.l & CONFIG_HELD && (r2 === n2 || !txOf(t).$)) record(e, t);
      }
    }
    prune(e);
    const r = e.Z;
    if (e.i & STATUS_PENDING && !e.H && r.l & CONFIG_HELD && [...e.F].every(([, e2]) => !(e2.O & STATUS_PENDING) && e2.l & CONFIG_HELD && txOf(e2) === txOf(r))) {
      e.F.clear();
      e.H = true;
    }
    e.U = false;
    if (e.F.size === 0) {
      collecting.delete(e);
      if (e.h) redraw(e);
      if (revealHooks && e.B !== null) revealHooks.j(e.B);
    }
  }
}
function arm2(e) {
  if (!e.H) {
    if (e.h && e.L === null && e.M === null && passLane !== null) {
      e.M = passLane;
      flip(e);
      redraw(e);
    }
    return;
  }
  e.U = true;
  e.Z.l &= ~CONFIG_FRAME;
  let n = passLane;
  if (n === null && globalQueue.ee && getOwner().l & CONFIG_VERDICT) {
    joinFuture(null);
    n = GlobalQueue.ne(flushTransaction);
  }
  e.M = n;
  collecting.add(e);
  const r = e.F.size;
  heldUnder(e.V, flushTransaction, (n2) => record(e, n2));
  for (const [n2] of e.F) {
    if (e.F.size !== r || n2.O & STATUS_PENDING && !(n2._ & REACTIVE_DISPOSED)) {
      for (let n3 = e._parent; n3 !== null; n3 = n3._parent)
        if (n3.i & STATUS_PENDING) for (const [r2] of e.F) n3.F.delete(r2);
      flip(e);
      redraw(e);
      return;
    }
  }
}
function reset(e) {
  for (const n of new Set(e.F.values())) if (n.re !== void 0 && !(n._ & REACTIVE_DISPOSED)) recompute(n);
  schedule();
}
function createBoundary(e, n, r, o) {
  const t = createOwner();
  const l = {
    i: e,
    _parent: boundaryOf(t) ?? null,
    V: t,
    J: null,
    Z: null,
    F: /* @__PURE__ */ new Map(),
    // Loading only: an error boundary has no first-content wait (`prune`).
    H: e === STATUS_ERROR,
    U: false,
    M: null,
    L: null,
    h: false,
    W: null,
    B: null,
    oe: false,
    te: false,
    P: e === STATUS_ERROR ? signal(void 0, ERROR_SIGNAL) : null,
    le: r,
    ae: null
  };
  const a = e === STATUS_PENDING ? t.D[REVEAL] : null;
  if (getOwner()) cleanup(() => {
    collecting.delete(l);
    if (revealHooks && a) revealHooks.ie(a, l);
  });
  if (o) {
    let e2 = false;
    runWithOwner(t, () => computed(() => {
      try {
        const n2 = o();
        if (false) ;
      } catch (e3) {
        if (false) ;
        if (!(e3 instanceof NotReadyError)) {
          if (!globalQueue.notify(getOwner(), STATUS_ERROR, STATUS_ERROR, e3)) {
            if (false) ;
            else haltReactivity(e3);
            throw e3;
          }
          return;
        }
      }
      if (e2) arm2(l);
      else e2 = true;
    })).l |= CONFIG_REDERIVE;
  }
  const i = {
    ...t.D,
    [BOUNDARY]: l
  };
  if (revealHooks !== null) i[REVEAL] = null;
  t.D = i;
  const s = runWithOwner(t, () => {
    const e2 = false ? computed(n, {
      name: "children"
    }) : computed(n);
    return false ? computed(() => flatten(read(e2)), {
      name: "boundary"
    }) : computed(() => flatten(read(e2)));
  });
  l.J = s;
  if (revealHooks && a) revealHooks.se(a, l);
  const u = computed(
    () => {
      const n2 = getOwner();
      if (laneStageHook && l.i === STATUS_ERROR) {
        if (l.h && n2.l & CONFIG_OVERRIDE) l.L ??= txOf(n2);
        if (l.L !== null) {
          setPassLane(l.L);
          n2._ |= REACTIVE_LANE_READ;
          l.L = null;
        }
      }
      if (!l.U && !(n2.l & CONFIG_HELD)) n2.l |= CONFIG_FRAME;
      if (l.oe) {
        link(s, n2);
        if (revealHooks && l.B !== null) revealHooks.j(l.B);
        if (l.oe) {
          if (l.te) {
            l.h = true;
            return void 0;
          }
          return fallback(l);
        }
      }
      const r2 = laneStageHook && !l.H && n2.l & CONFIG_HELD && n2.ue !== l.ae?.ue;
      const o2 = s.O & (STATUS_PENDING | STATUS_ERROR);
      if (o2 !== 0) {
        link(s, n2);
        if (o2 & e) {
          if (isCollecting(l)) {
            caught(l, s, void 0);
            return fallback(l);
          }
          record(l, s);
        }
        if (e === STATUS_ERROR && l.h && !freshAbove(l)) return fallback(l);
        throw s.I.P;
      }
      if (isCollecting(l)) {
        if (l.F.size !== 0 && n2.O & STATUS_UNINITIALIZED && !(n2.l & CONFIG_HELD)) return fallback(l);
        if (prune(l, true) !== 0 && !r2) return fallback(l);
      }
      let t2;
      try {
        t2 = read(s);
        if (l.P) untrack(() => isThenable(t2));
      } catch (n3) {
        if (n3 instanceof NotReadyError ? e === STATUS_PENDING : e === STATUS_ERROR) {
          if (isCollecting(l)) {
            caught(l, s, n3);
            return fallback(l);
          }
          record(l, s);
        }
        throw n3;
      }
      if (isCollecting(l)) {
        if (s.O & e & STATUS_PENDING) caught(l, s);
        if (l.F.size !== 0) return r2 && passLane ? t2 : fallback(l);
      }
      l.H = true;
      if (l.h && swapHook) swapHook();
      l.h = false;
      const a2 = l.ae;
      const drop = () => {
        if (!l.h && l.ae === a2) {
          if (a2.O & STATUS_ERROR) schedule();
          dispose(a2);
          l.ae = null;
        }
      };
      if (a2 !== null) l.Z.ue !== a2.ue ? drop() : globalQueue.enqueue(EFFECT_RENDER, drop);
      release2(l);
      if (revealHooks && l.B !== null) {
        const e2 = l.B;
        l.B = null;
        revealHooks.j(e2);
      }
      return t2;
    },
    // Boundary structure, not a user source: its value is fallback-or-content
    // and legitimately swaps mid-hydration (resume), so it must never be
    // frozen by snapshot capture.
    {
      fe: true
    }
  );
  u.l |= CONFIG_REDERIVE;
  s.l |= CONFIG_FRAME;
  l.Z = u;
  return accessor(u);
}
function fallback(e) {
  const n = getOwner();
  if (e.L !== null) {
    setPassLane(e.L);
    n._ |= REACTIVE_LANE_READ;
    e.L = null;
  }
  if (!e.h && swapHook) swapHook();
  e.h = true;
  if (e.ae === null) e.ae = runWithOwner(n._parent, () => computed(() => e.le(e), {
    id: n.id,
    lazy: 1
  }));
  const r = passLane;
  const o = n._;
  const t = read(e.ae);
  setPassLane(r);
  n._ ^= (n._ ^ o) & (REACTIVE_PROBED | REACTIVE_LANE_READ);
  return t;
}
var ERROR_SIGNAL = {
  ownedWrite: true,
  fe: true
};
function createLoadingBoundary(e, n, r) {
  return createBoundary(STATUS_PENDING, e, () => n(), r?.on);
}
function createErrorBoundary(e, n) {
  return createBoundary(STATUS_ERROR, e, (e2) => n(accessor(e2.P), () => reset(e2)));
}
installBoundaryHooks(catchStatus, (e, n) => !n && (e.O & STATUS_UNINITIALIZED ? catchStatus(e, STATUS_PENDING) : armedOver(e)), hiddenBy, boundarySeam, heldRun);

// ../store-proto-features/packages/signals/dist/select/store/utils.js
function trueFn() {
  return true;
}
var SOURCE_PLAIN = 0;
var SOURCE_OMIT = 1;
var SOURCE_PROXY = 2;
var SOURCE_MEMO = 3;
var SOURCE_MERGE = 4;
var EMPTY = Object.freeze({});
function leafOf(e, n) {
  return n === SOURCE_MEMO ? (e = e()) || EMPTY : e;
}
var OmitView = class {
  source;
  kind;
  hidden;
  /** see `MergeView.table` */
  table = 0;
  /** see `tableOwnKeys` / `tableDescriptor` */
  keys = void 0;
  descs = void 0;
  constructor(e, n, t) {
    this.source = e;
    this.kind = n;
    this.hidden = t;
  }
};
function isHidden(e, n) {
  const t = e.hidden;
  return typeof t === "function" ? t(n) : t.includes(n);
}
function combineHidden(e, n) {
  if (typeof e !== "function" && typeof n !== "function") {
    const t = e.slice();
    for (let e2 = 0; e2 < n.length; e2++) t.push(n[e2]);
    return t;
  }
  return (t) => (typeof e === "function" ? e(t) : e.includes(t)) || (typeof n === "function" ? n(t) : n.includes(t));
}
function viewSource(e) {
  return leafOf(e.source, e.kind);
}
function recordOf(e) {
  return e[$RECORD];
}
function leafKeys(e, n) {
  if (n === SOURCE_PLAIN) return Object.keys(e);
  if (n === SOURCE_PROXY || e[$PROXY] === e) {
    const n2 = e[$TARGET];
    return (n2?.px === e ? n2 : Reflect).ownKeys(e);
  }
  return Object.keys(e);
}
function sourceHas(e, n, t) {
  if (n === SOURCE_OMIT) {
    if (isHidden(e, t)) return false;
    return e.kind === SOURCE_MERGE ? mergeHas(e.source, t) : t in viewSource(e);
  }
  return t in leafOf(e, n);
}
function entryHasStaticKeys(e, n) {
  if (n === SOURCE_PLAIN) return true;
  if (n !== SOURCE_OMIT) return false;
  if (e.kind === SOURCE_PLAIN) return true;
  return e.kind === SOURCE_MERGE && mergeHasStaticKeys(e.source);
}
function mergeHasStaticKeys(e) {
  const n = e.sources, t = e.kinds;
  for (let e2 = 0; e2 < n.length; e2++) if (!entryHasStaticKeys(n[e2], t[e2])) return false;
  return true;
}
function accessorDescriptor(e, n = true) {
  return {
    configurable: true,
    enumerable: n,
    get: e,
    set: trueFn
  };
}
function sourceDescriptor(e, n, t, r = false) {
  if (n === SOURCE_OMIT) {
    if (isHidden(e, t)) return void 0;
    return sourceDescriptor(e.source, e.kind, t, r);
  }
  if (n === SOURCE_MERGE) return mergeDescriptor(e, t);
  if (n === SOURCE_MEMO) {
    return r || t in leafOf(e, n) ? accessorDescriptor(() => leafOf(e, n)[t]) : void 0;
  }
  if (n === SOURCE_PROXY) {
    if (recordOf(e) !== void 0) return Reflect.getOwnPropertyDescriptor(e, t);
    return r || t in e ? accessorDescriptor(() => e[t]) : void 0;
  }
  const i = Reflect.getOwnPropertyDescriptor(e, t);
  if (i === void 0) return void 0;
  if (i.get !== void 0 || i.set !== void 0) return accessorDescriptor(() => e[t], i.enumerable);
  if (i.configurable) return i;
  return {
    configurable: true,
    enumerable: i.enumerable,
    writable: true,
    value: i.value
  };
}
function sourceEnumerableKeys(e, n) {
  {
    if (e.kind === SOURCE_MERGE) return mergeEnumerableKeys(e.source, e);
    const n2 = ownEnumerableKeys(viewSource(e));
    const t = [];
    for (let r = 0; r < n2.length; r++) if (!isHidden(e, n2[r])) t.push(n2[r]);
    return t;
  }
}
function mergeTable(e) {
  let n = e.table;
  if (typeof n !== "object") {
    const t = e.sources, r = e.kinds;
    for (let n2 = 0; n2 < t.length; n2++) {
      if (!entryHasStaticKeys(t[n2], r[n2])) {
        e.table = null;
        return void 0;
      }
    }
    n = /* @__PURE__ */ new Map();
    collectTable(n, e, void 0);
    e.table = n;
  }
  return n === null ? void 0 : n;
}
function collectTable(e, n, t) {
  const r = n.sources, i = n.kinds;
  for (let n2 = 0; n2 < r.length; n2++) {
    const f = r[n2];
    if (i[n2] === SOURCE_OMIT) {
      if (f.kind === SOURCE_MERGE) {
        if (t === void 0) t = [f];
        else t.push(f);
        collectTable(e, f.source, t);
        t.pop();
        continue;
      }
      const n3 = f.source;
      const r2 = Reflect.ownKeys(n3);
      for (let i2 = 0; i2 < r2.length; i2++) {
        const u = r2[i2];
        if (!isHidden(f, u) && !hiddenByAny(t, u)) tableSet(e, u, n3);
      }
    } else {
      const n3 = Reflect.ownKeys(f);
      for (let r2 = 0; r2 < n3.length; r2++) {
        const i2 = n3[r2];
        if (!hiddenByAny(t, i2)) tableSet(e, i2, f);
      }
    }
  }
}
function hiddenByAny(e, n) {
  if (e !== void 0) {
    for (let t = e.length - 1; t >= 0; t--) if (isHidden(e[t], n)) return true;
  }
  return false;
}
function tableSet(e, n, t) {
  if (e.has(n)) e.delete(n);
  e.set(n, t);
}
function omitTable(e) {
  let n = e.table;
  if (typeof n !== "object") {
    const t = e.source;
    if (e.kind === SOURCE_MERGE) {
      if (!mergeHasStaticKeys(t)) {
        e.table = null;
        return void 0;
      }
      n = /* @__PURE__ */ new Map();
      collectTable(n, t, [e]);
    } else if (e.kind === SOURCE_PLAIN) {
      n = /* @__PURE__ */ new Map();
      const r = Reflect.ownKeys(t);
      for (let i = 0; i < r.length; i++) {
        const f = r[i];
        if (!isHidden(e, f)) n.set(f, t);
      }
    } else {
      e.table = null;
      return void 0;
    }
    e.table = n;
  }
  return n === null ? void 0 : n;
}
var propertyIsEnumerable2 = Object.prototype.propertyIsEnumerable;
function tableOwnKeys(e, n) {
  let t = e.keys;
  if (t === void 0) {
    t = e.keys = [];
    for (const [e2, r] of n) if (propertyIsEnumerable2.call(r, e2)) t.push(e2);
  }
  return t;
}
function tableDescriptor(e, n, t) {
  const r = n.get(t);
  if (r === void 0) return void 0;
  let i = e.descs;
  if (i === void 0) i = e.descs = /* @__PURE__ */ new Map();
  let f = i.get(t);
  if (f === void 0) {
    f = sourceDescriptor(r, SOURCE_PLAIN, t);
    if (f === void 0) return void 0;
    i.set(t, f);
    return f;
  }
  if (f.get !== void 0) return f;
  return {
    configurable: true,
    enumerable: f.enumerable,
    writable: f.writable,
    value: r[t]
  };
}
var READS_FOR_TABLE = 16;
function omitReadTable(e) {
  const n = e.table;
  if (typeof n === "object") return n === null ? void 0 : n;
  if (n + 1 < READS_FOR_TABLE) {
    e.table = n + 1;
    return void 0;
  }
  return omitTable(e);
}
function tableOf(e) {
  const n = e.table;
  return typeof n === "object" && n !== null ? n : void 0;
}
var MISSING = /* @__PURE__ */ Symbol();
function mergeLookup(e, n) {
  const t = tableOf(e);
  if (t !== void 0) {
    const e2 = t.get(n);
    return e2 === void 0 ? MISSING : e2[n];
  }
  const r = e.sources, i = e.kinds;
  for (let e2 = r.length - 1; e2 >= 0; e2--) {
    const t2 = i[e2];
    if (t2 === SOURCE_PLAIN) {
      const t3 = r[e2];
      if (n in t3) return t3[n];
      continue;
    }
    if (t2 === SOURCE_OMIT) {
      const t3 = r[e2];
      if (isHidden(t3, n)) continue;
      if (t3.kind === SOURCE_MERGE) {
        const e3 = mergeLookup(t3.source, n);
        if (e3 !== MISSING) return e3;
        continue;
      }
      const i2 = viewSource(t3);
      if (n in i2) return i2[n];
    } else {
      const i2 = leafOf(r[e2], t2);
      if (n in i2) return i2[n];
    }
  }
  return MISSING;
}
function mergeGet(e, n) {
  const t = mergeLookup(e, n);
  return t === MISSING ? void 0 : t;
}
function mergeHas(e, n) {
  const t = tableOf(e);
  if (t !== void 0) return t.has(n);
  const r = e.sources, i = e.kinds;
  for (let e2 = r.length - 1; e2 >= 0; e2--) if (sourceHas(r[e2], i[e2], n)) return true;
  return false;
}
function mergeDescriptor(e, n) {
  const t = tableOf(e);
  if (t !== void 0) return tableDescriptor(e, t, n);
  const r = e.sources, i = e.kinds;
  for (let t2 = r.length - 1; t2 >= 0; t2--) {
    if (!sourceHas(r[t2], i[t2], n)) continue;
    return sourceDescriptor(r[t2], i[t2], n, true) ?? accessorDescriptor(() => mergeGet(e, n));
  }
  return void 0;
}
function mergeKeysOf(e, n, t) {
  const r = [];
  collectKeys(e, t === void 0 ? void 0 : [t], n, r, null);
  return r;
}
function collectKeys(e, n, t, r, i) {
  const f = e.sources, u = e.kinds;
  for (let e2 = 0; e2 < f.length; e2++) {
    let o = f[e2], c = u[e2];
    let s;
    if (c === SOURCE_OMIT) {
      if (o.kind === SOURCE_MERGE) {
        if (n === void 0) n = [o];
        else n.push(o);
        collectKeys(o.source, n, t, r, i);
        n.pop();
        continue;
      }
      s = o;
      c = o.kind;
      o = o.source;
    }
    o = leafOf(o, c);
    const d = t ? ownEnumerableKeys(o) : leafKeys(o, c);
    for (let e3 = 0; e3 < d.length; e3++) {
      const t2 = d[e3];
      if (s !== void 0 && isHidden(s, t2)) continue;
      if (hiddenByAny(n, t2)) continue;
      addKey(r, i, t2, o);
    }
  }
}
function addKey(e, n, t, r) {
  const i = e.indexOf(t);
  if (i !== -1) {
    e.splice(i, 1);
    if (n !== null) n.splice(i, 1);
  }
  e.push(t);
  if (n !== null) n.push(r);
}
function mergeEnumerableKeys(e, n) {
  const t = mergeTable(e);
  if (t === void 0) return mergeKeysOf(e, true, n);
  const r = tableOwnKeys(e, t);
  if (n === void 0) return r;
  const i = [];
  for (let e2 = 0; e2 < r.length; e2++) if (!isHidden(n, r[e2])) i.push(r[e2]);
  return i;
}
var omitTraps = {
  get(e, n, t) {
    if (n === $PROXY) return t;
    if (n === $RECORD) return e;
    if (n === $TARGET) return void 0;
    if (e.kind === SOURCE_MERGE) {
      const t2 = omitReadTable(e);
      if (t2 !== void 0) {
        const e2 = t2.get(n);
        return e2 === void 0 ? void 0 : e2[n];
      }
      if (isHidden(e, n)) return void 0;
      return mergeGet(e.source, n);
    }
    if (isHidden(e, n)) return void 0;
    return viewSource(e)[n];
  },
  has(e, n) {
    if (n === $PROXY) return true;
    if (n === $TARGET || n === $RECORD) return false;
    if (e.kind === SOURCE_MERGE) {
      const t = omitReadTable(e);
      if (t !== void 0) return t.has(n);
      if (isHidden(e, n)) return false;
      return mergeHas(e.source, n);
    }
    if (isHidden(e, n)) return false;
    return n in viewSource(e);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(e, n) {
    if (n === $PROXY || n === $TARGET || n === $RECORD) return void 0;
    if (e.kind === SOURCE_MERGE) {
      const t = omitReadTable(e);
      if (t !== void 0) return tableDescriptor(e, t, n);
    }
    return sourceDescriptor(e, SOURCE_OMIT, n);
  },
  ownKeys(e) {
    if (e.kind === SOURCE_MERGE) {
      const n2 = omitTable(e);
      if (n2 !== void 0) return tableOwnKeys(e, n2);
      return sourceEnumerableKeys(e);
    }
    const n = Reflect.ownKeys(viewSource(e));
    const t = [];
    for (let r = 0; r < n.length; r++) if (!isHidden(e, n[r])) t.push(n[r]);
    return t;
  }
};
function omit(e, ...n) {
  let t = n.length === 1 && typeof n[0] === "function" ? n[0] : n;
  if (SUPPORTS_PROXY) {
    let n2 = e;
    let r2 = SOURCE_PLAIN;
    if (typeof e === "function") r2 = SOURCE_MEMO;
    else if ($PROXY in e) {
      r2 = SOURCE_PROXY;
      const i2 = recordOf(e);
      if (i2 instanceof OmitView) {
        n2 = i2.source;
        r2 = i2.kind;
        t = combineHidden(i2.hidden, t);
      } else if (i2 !== void 0) {
        n2 = i2;
        r2 = SOURCE_MERGE;
      }
    }
    return new Proxy(new OmitView(n2, r2, t), omitTraps);
  }
  const r = {};
  const i = Object.getOwnPropertyNames(e);
  const f = typeof t === "function" ? t : t.length > 4 && i.length > t.length ? /* @__PURE__ */ ((e2) => (n2) => e2.has(n2))(new Set(t)) : (e2) => t.includes(e2);
  for (const n2 of i) {
    if (!f(n2)) {
      const t2 = Object.getOwnPropertyDescriptor(e, n2);
      if (!t2.get && !t2.set && t2.enumerable && t2.writable && t2.configurable) {
        r[n2] = t2.value;
      } else if (t2.get || t2.set) {
        Object.defineProperty(r, n2, {
          enumerable: t2.enumerable,
          configurable: true,
          get: t2.get && t2.get.bind(e),
          set: t2.set && t2.set.bind(e)
        });
      } else Object.defineProperty(r, n2, t2);
    }
  }
  return r;
}

// ../rx-store-proto-features/ref/compile/features.ts
for (const n of ["__RX_STORES__", "__RX_FAMILIES__", "__RX_OPTIMISTIC__"]) globalThis[n] ??= true;

// ../rx-store-proto-features/ref/compile/store-ops.ts
var isT = (v) => false;
var out = (v) => false ? storeProxy(v) : v;
var get = (o, k) => false ? storeGet(o, k) : o?.[k];
var val = (o, k) => {
  const r = false ? storeGet(o, k) : o?.[k];
  return false ? storeProxy(r) : r;
};
var raw = (x) => false ? x.v : x && typeof x === "object" && x[$TARGET] ? x[$TARGET].v : x;
var hacc = (acc) => acc.h ?? acc;
var B = {
  len: (x) => false ? x.ar ? storeGet(x, "length") : storeKeys2(x).length : Array.isArray(x) || typeof x === "string" ? x.length : typeof x === "object" && x ? Object.keys(x).length : 0,
  map: (xs, f) => {
    if (true) return xs.map(f);
    const n = storeGet(xs, "length");
    const r = new Array(n);
    for (let i = 0; i < n; i++) if (storeHas(xs, i)) r[i] = f(storeGet(xs, i), i);
    return r;
  },
  filter: (xs, f) => {
    if (true) return xs.filter(f);
    const n = storeGet(xs, "length");
    const r = [];
    for (let i = 0; i < n; i++) if (storeHas(xs, i)) {
      const x = storeGet(xs, i);
      if (f(x)) r.push(out(x));
    }
    return r;
  },
  every: (xs, f) => {
    if (true) return xs.every(f);
    const n = storeGet(xs, "length");
    for (let i = 0; i < n; i++) if (storeHas(xs, i) && !f(storeGet(xs, i))) return false;
    return true;
  },
  indexOf: (xs, f) => {
    if (true) return xs.findIndex(f);
    const n = storeGet(xs, "length");
    for (let i = 0; i < n; i++) if (f(storeGet(xs, i))) return i;
    return -1;
  },
  sum: (xs) => {
    if (true) return xs.reduce((a, b) => a + b, 0);
    const n = storeGet(xs, "length");
    let s = 0;
    for (let i = 0; i < n; i++) if (storeHas(xs, i)) s += storeGet(xs, i);
    return s;
  }
};

// ../store-proto-features/packages/solid/dist/solid.js
var IS_DEV = false;
function createContext2(defaultValue, options) {
  const id2 = Symbol(options && options.name || "");
  function provider(props) {
    const value = props.value;
    const c = createMemo((p) => (p || setContext(provider, value), props.children), {
      lazy: true
    });
    return createMemo((p) => (p || setContext(provider, value), flatten(c())), {
      lazy: true,
      sync: true
    });
  }
  provider.id = id2;
  provider.defaultValue = defaultValue;
  return provider;
}
function createShadowDraft(realDraft, shallow) {
  const shadow = shallow ? Array.isArray(realDraft) ? realDraft.slice() : {
    ...realDraft
  } : JSON.parse(JSON.stringify(realDraft));
  let useShadow = true;
  return {
    proxy: new Proxy(shadow, {
      get(_, prop) {
        return useShadow ? shadow[prop] : realDraft[prop];
      },
      set(_, prop, value) {
        if (useShadow) {
          shadow[prop] = value;
          return true;
        }
        return Reflect.set(realDraft, prop, value);
      },
      deleteProperty(_, prop) {
        if (useShadow) {
          delete shadow[prop];
          return true;
        }
        return Reflect.deleteProperty(realDraft, prop);
      },
      has(_, prop) {
        return prop in (useShadow ? shadow : realDraft);
      },
      ownKeys() {
        return Reflect.ownKeys(useShadow ? shadow : realDraft);
      },
      getOwnPropertyDescriptor(_, prop) {
        return Object.getOwnPropertyDescriptor(useShadow ? shadow : realDraft, prop);
      }
    }),
    activate() {
      useShadow = false;
    }
  };
}
function quietAnswer(thenable) {
  let step = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (step === 0) {
            step = 1;
            return syncThenable({
              done: false,
              value: void 0
            });
          }
          if (step === 1) {
            step = 2;
            return thenable.then((v) => ({
              done: false,
              value: v
            }));
          }
          return Promise.resolve({
            done: true,
            value: void 0
          });
        }
      };
    }
  };
}
function hydrateStoreFromAsyncIterable(coreFn, fn, initialValue, options) {
  const parent = getOwner();
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has(expectedId)) return null;
  const loaded = sharedConfig.load(expectedId);
  if (!isAsyncIterable(loaded)) return null;
  const srcIt = loaded[Symbol.asyncIterator]();
  const loading = hasLoadingWindow(options);
  let isFirst = true;
  let buffered = null;
  let terminal = false;
  const fail = (e) => {
    terminal = true;
    throw e;
  };
  return coreFn((draft) => {
    if (terminal) return fn(draft);
    const {
      proxy
    } = createShadowDraft(draft, options?.shallow);
    subFetch(fn, proxy);
    const process = (res) => {
      if (res.done) {
        terminal = true;
        return {
          done: true,
          value: void 0
        };
      }
      if (isFirst) {
        isFirst = false;
        setSnapshotCapture(false);
        try {
          if (Array.isArray(res.value)) {
            for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
            draft.length = res.value.length;
          } else {
            for (const key of Object.keys(draft)) {
              if (!(key in res.value)) delete draft[key];
            }
            Object.assign(draft, res.value);
          }
        } finally {
          setSnapshotCapture(true);
        }
      } else {
        applyPatches(draft, res.value);
      }
      return {
        done: false,
        value: void 0
      };
    };
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (isFirst) {
              const r2 = srcIt.next();
              if (r2 && typeof r2.then === "function") return {
                then(fn2, rej) {
                  r2.then((v) => {
                    let out2;
                    try {
                      out2 = process(v);
                    } catch (e) {
                      terminal = true;
                      rej(e);
                      return;
                    }
                    fn2(out2);
                  }, (e) => {
                    terminal = true;
                    rej(e);
                  });
                }
              };
              if (loading) {
                return new Promise((resolvePull) => {
                  onHydrationEnd(() => resolvePull(process(r2)));
                });
              }
              return syncThenable(process(r2));
            }
            if (buffered) {
              const b = buffered;
              buffered = null;
              return b.then(process, fail);
            }
            let r = srcIt.next();
            if (r && typeof r.then === "function") {
              return r.then(process, fail);
            }
            return new Promise((resolvePull) => {
              onHydrationEnd(() => {
                let result = process(r);
                while (!r.done) {
                  const peek = srcIt.next();
                  if (peek && typeof peek.then === "function") {
                    buffered = peek;
                    break;
                  }
                  r = peek;
                  if (!r.done) result = process(r);
                }
                resolvePull(result);
              });
            });
          },
          return(value) {
            buffered = null;
            return forwardIteratorReturn(srcIt, value);
          }
        };
      }
    };
  }, initialValue, options);
}
function wrapStoreFn(fn, options) {
  return (draft) => readSerializedOrCompute(() => fn(draft), draft, options);
}
function hydrateStoreLikeFn(coreFn, fn, initialValue, options, ssrSource) {
  if (ssrSource === "client") {
    return withHydrationGate((hydrated) => coreFn((draft) => {
      if (!hydrated()) return UNASKED;
      return fn(draft);
    }, initialValue, options));
  }
  if (ssrSource === "hybrid") {
    const id2 = peekNextChildId(getOwner());
    if (!sharedConfig.has(id2)) return coreFn(fn, initialValue, options);
    const initP = sharedConfig.load(id2);
    let takeover;
    const detect = (draft) => {
      const r = fn(draft);
      takeover = isAsyncIterable(r);
      return r;
    };
    const [hydrated, setHydrated] = createSignal(false, {
      ownedWrite: true
    });
    let live = false;
    const flip2 = () => {
      if (!live) setHydrated(true);
    };
    let adopted2 = false;
    let creating = true;
    let landedOnCreate = false;
    const result = coreFn((draft) => {
      if (live) return fn(draft);
      if (takeover === false) return readSerializedOrCompute(() => fn(draft), draft, options);
      if (hydrated()) {
        live = true;
        const {
          proxy,
          activate
        } = createShadowDraft(draft, options?.shallow);
        const r = fn(proxy);
        if (isAsyncIterable(r)) return wrapFirstYield(r, activate);
        if (r != null && typeof r.then === "function") return quietAnswer(r);
        return r;
      }
      if (adopted2) {
        live = true;
        return fn(draft);
      }
      subFetch(detect, draft);
      let answer;
      try {
        answer = readHydratedValue(initP, () => {
        }, options);
      } catch (e) {
        if (takeover) live = true;
        throw e;
      }
      if (!takeover) return answer;
      adopted2 = true;
      if (answer != null && typeof answer.then === "function") return adoptedAnswerStream(answer, flip2, () => live = true);
      if (creating) landedOnCreate = true;
      else queueMicrotask(flip2);
      return answer;
    }, initialValue, options);
    creating = false;
    if (landedOnCreate) flip2();
    return result;
  }
  const aiResult = hydrateStoreFromAsyncIterable(coreFn, fn, initialValue, options);
  if (aiResult !== null) return aiResult;
  return coreFn(wrapStoreFn(fn, options), initialValue, options);
}
function hydrateStoreLike(coreFn, fn, initialValue, options) {
  if (noHydrationId()) return coreFn(fn, initialValue, options);
  markTopLevelSnapshotScope();
  return hydrateStoreLikeFn(coreFn, fn, initialValue, options, options?.ssrSource);
}
var NoHydrateContext = {
  id: /* @__PURE__ */ Symbol("NoHydrateContext"),
  defaultValue: false
};
var sharedConfig = {
  hydrating: false,
  registry: void 0,
  done: false
};
function hydrationGetNextContextId() {
  const o = getOwner();
  if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
  if (getContext(NoHydrateContext)) return void 0;
  return getNextChildId(o);
}
var noop = () => {
};
var _hydrationEndCallbacks = null;
var _pendingBoundaries = 0;
var _hydrationDone = false;
var _snapshotRootOwner = null;
var _claimOwner = null;
var _claimRound;
function isClaiming(served3) {
  for (let owner = getOwner(); owner; owner = owner._parent) if (owner === _claimOwner || owner._nc && !served3) return owner === _claimOwner;
  return !_claimOwner;
}
function markTopLevelSnapshotScope() {
  if (_snapshotRootOwner) return;
  let owner = getOwner();
  if (!owner) return;
  while (owner._parent) owner = owner._parent;
  markSnapshotScope(owner);
  openLiveScope(owner);
  _snapshotRootOwner = owner;
}
function isHydrationInProgress() {
  return !_hydrationDone && (sharedConfig.hydrating || _pendingBoundaries > 0);
}
function onHydrationEnd(callback) {
  if (_hydrationDone || !sharedConfig.hydrating && _pendingBoundaries === 0) {
    queueMicrotask(callback);
    return;
  }
  if (!_hydrationEndCallbacks) _hydrationEndCallbacks = [];
  _hydrationEndCallbacks.push(callback);
}
function drainHydrationCallbacks() {
  if (_hydrationDone) return;
  _hydrationDone = true;
  _doneValue = true;
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
  const cbs = _hydrationEndCallbacks;
  _hydrationEndCallbacks = null;
  if (cbs) for (const cb of cbs) cb();
  setTimeout(() => {
    if (globalThis._$HY) globalThis._$HY.done = true;
    sharedConfig.registry?.clear();
  });
}
function checkHydrationComplete() {
  if (!_hydratingValue && _pendingBoundaries === 0) drainHydrationCallbacks();
}
var _hydratingValue = false;
var _doneValue = false;
var _createMemo;
var _createErrorBoundary;
var _createEffect;
var _createLoadingBoundary;
var _hydrateSignalLike;
var _hydrateStoreLike;
var _lazyHydrationLookup;
var MockPromise = /* @__PURE__ */ (() => {
  class MockPromise2 {
    catch() {
      return new MockPromise2();
    }
    then() {
      return new MockPromise2();
    }
    finally() {
      return new MockPromise2();
    }
  }
  for (const k of ["all", "allSettled", "any", "race", "reject", "resolve", "try"]) {
    MockPromise2[k] = () => new MockPromise2();
  }
  MockPromise2.withResolvers = () => ({
    promise: new MockPromise2(),
    resolve() {
    },
    reject() {
    }
  });
  return MockPromise2;
})();
var tracing = 0;
function subFetch(fn, prev) {
  const ogFetch = fetch;
  const ogPromise = Promise;
  tracing++;
  try {
    window.fetch = () => new MockPromise();
    Promise = MockPromise;
    const result = fn(prev);
    if (result && typeof result.next === "function" && typeof result[Symbol.asyncIterator] === "function") {
      const it = result[Symbol.asyncIterator]();
      if (it === result) it.next();
    }
    if (result && typeof result.then === "function") result.then(void 0, noop);
    if (IS_DEV && result && (typeof result.then === "function" || typeof result[Symbol.asyncIterator] === "function")) ;
    return result;
  } finally {
    window.fetch = ogFetch;
    Promise = ogPromise;
    tracing--;
  }
}
function syncThenable(value) {
  return {
    then(fn) {
      fn(value);
    }
  };
}
var servedPass = (write, adopt) => (x) => {
  flush();
  _hydratingValue = _snapshotRootOwner = !!adopt;
  _claimOwner = ~clock;
  if (adopt) markSnapshotScope(adopt);
  try {
    write(x);
    flush();
  } finally {
    _claimOwner = _hydratingValue = _snapshotRootOwner = null;
    if (adopt) releaseSnapshotScope(adopt);
    checkHydrationComplete();
  }
};
function readHydratedValue(initP, refresh2, options) {
  refresh2();
  if (initP != null && typeof initP === "object") {
    if (!hasLoadingWindow(options)) {
      if (initP.s === 2) {
        initP.then?.(void 0, noop);
        throw initP.v;
      }
      if (initP.s === 1) return isAsyncIterable(initP.v) ? {
        [Symbol.asyncIterator]: () => normalizeIterator(initP.v[Symbol.asyncIterator]())
      } : initP.v;
    }
    if (typeof initP.then === "function") return {
      then: (a, b) => initP.then(servedPass(a), servedPass(b))
    };
  }
  return initP;
}
var latchedOnce = /* @__PURE__ */ new WeakSet();
function readSerializedOrCompute(compute, prev, options, value) {
  const o = getOwner();
  const gate = nodeGate.get(o);
  if (gate && (sharedConfig.done || gate())) return takeOver(o, gate, compute, prev);
  if (sharedConfig.done) return compute(prev);
  if (!sharedConfig.has(o.id)) {
    const result = compute(prev);
    if (options?.ssrSource !== "hybrid" && result != null && typeof result === "object" && result[LIVE_SOURCE] && result[LIVE_LOCAL] !== void 0) {
      armLiveTakeover(o);
      return result[LIVE_LOCAL];
    }
    return result;
  }
  const initP = sharedConfig.load(o.id);
  if (latchedOnce.has(o)) {
    if (options?.ssrSource !== "hybrid" && _claimOwner !== ~clock && !(initP?.s === 2 && _claimRound === clock)) {
      let p = o;
      while (p && !p._hp) p = p._parent;
      if (!p && !(sharedConfig.hydrating && isClaiming(1))) return compute(prev);
      armLiveTakeover(o);
    }
  } else {
    latchedOnce.add(o);
    if (value && initP?.then) initP.then((v) => markSnapshotScope(o, v), noop);
  }
  return readHydratedValue(initP, () => {
    const traced = subFetch(compute, prev);
    if (options?.ssrSource !== "hybrid" && traced != null && traced[LIVE_SOURCE]) armLiveTakeover(o, !hasLoadingWindow(options) && initP?.then && !initP.s);
    return traced;
  }, options);
}
function takeOver(o, gate, compute, prev) {
  const result = compute(prev);
  if (gate !== TAKEN) {
    nodeGate.set(o, TAKEN);
    if (result != null && typeof result === "object" && result[LIVE_SOURCE]) result[LIVE_RESUME_FROM] = prev;
  }
  return result;
}
var UNASKED = {
  then() {
  }
};
var LIVE_SOURCE = /* @__PURE__ */ Symbol.for("solid.LiveSource");
var LIVE_RESUME_FROM = /* @__PURE__ */ Symbol.for("solid.LiveResumeFrom");
var LIVE_LOCAL = /* @__PURE__ */ Symbol.for("solid.LiveLocal");
var openScopes = /* @__PURE__ */ new Set();
var liveGates = /* @__PURE__ */ new Map();
var nodeGate = /* @__PURE__ */ new WeakMap();
var TAKEN = () => true;
function liveScopeOf(o) {
  if (openScopes.size === 0) return null;
  let owner = o;
  while (owner) {
    if (openScopes.has(owner)) return owner;
    owner = owner._parent;
  }
  return null;
}
function armLiveTakeover(o, streaming) {
  let gate = nodeGate.get(o);
  if (!gate) {
    const scope2 = streaming ? null : liveScopeOf(o);
    let entry = liveGates.get(scope2);
    if (!entry) {
      entry = createSignal(false);
      liveGates.set(scope2, entry);
      if (scope2 === null) onHydrationEnd(() => {
        liveGates.delete(null);
        entry[1](true);
      });
    }
    gate = entry[0];
    nodeGate.set(o, gate);
  }
  gate();
}
function openLiveScope(scope2) {
  openScopes.add(scope2);
}
function releaseLiveScope(scope2) {
  openScopes.delete(scope2);
  const entry = liveGates.get(scope2);
  if (!entry) return;
  liveGates.delete(scope2);
  entry[1](true);
}
function hasLoadingWindow(options) {
  return options != null && typeof options === "object" && ("loadingValue" in options || options.seedLoadingValue === true);
}
function forwardIteratorReturn(it, value) {
  const returned = it.return?.(value);
  return returned && typeof returned.then === "function" ? returned : syncThenable(returned ?? {
    done: true,
    value
  });
}
function pullStep(it) {
  try {
    return it.next();
  } catch (e) {
    const rejected = Promise.reject(e);
    rejected.catch(noop);
    return rejected;
  }
}
function normalizeIterator(it, deferFirst) {
  let first = true;
  let buffered = null;
  return {
    next() {
      if (first) {
        first = false;
        const r = it.next();
        if (r && typeof r.then === "function") return r;
        return deferFirst ? Promise.resolve(r) : syncThenable(r);
      }
      if (buffered) {
        const b = buffered;
        buffered = null;
        return b;
      }
      let latest2 = pullStep(it);
      if (latest2 && typeof latest2.then === "function") return latest2;
      let result = latest2;
      while (!latest2.done) {
        const peek = pullStep(it);
        if (peek && typeof peek.then === "function") {
          buffered = peek;
          break;
        }
        latest2 = peek;
        if (!latest2.done) result = latest2;
        else if (result !== latest2) buffered = Promise.resolve(latest2);
      }
      return Promise.resolve(result);
    },
    return(value) {
      buffered = null;
      return forwardIteratorReturn(it, value);
    }
  };
}
function applyPatches(target, patches) {
  for (const patch of patches) {
    const path = patch[0];
    let current = target;
    for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
    const key = path[path.length - 1];
    if (patch.length === 1) {
      Array.isArray(current) ? current.splice(key, 1) : delete current[key];
    } else if (patch.length === 3) {
      current.splice(key, 0, patch[1]);
    } else {
      current[key] = patch[1];
    }
  }
}
function isAsyncIterable(v) {
  return v != null && typeof v[Symbol.asyncIterator] === "function";
}
function noHydrationId() {
  const o = getOwner();
  return !o || o.id == null;
}
function wrapFirstYield(iterable, activate, quiet) {
  const srcIt = iterable[Symbol.asyncIterator]();
  let step = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (step === 0) {
            step = 1;
            return syncThenable({
              done: false,
              value: quiet
            });
          }
          const p = srcIt.next();
          if (step === 1) {
            step = 2;
            return p.then((r) => {
              activate?.();
              return r.done ? r : {
                done: false,
                value: quiet
              };
            });
          }
          return p;
        },
        return(value) {
          return forwardIteratorReturn(srcIt, value);
        }
      };
    }
  };
}
function adoptedAnswerStream(thenable, onLanded, onRejected) {
  let pulled = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (pulled) {
            onLanded();
            return Promise.resolve({
              done: true,
              value: void 0
            });
          }
          pulled = true;
          return {
            then(res, rej) {
              thenable.then((v) => res({
                done: false,
                value: v
              }), (e) => {
                onRejected();
                rej(e);
              });
            }
          };
        }
      };
    }
  };
}
function hydrateSignalFromAsyncIterable(coreFn, compute, options) {
  const parent = getOwner();
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has(expectedId)) return null;
  const loaded = sharedConfig.load(expectedId);
  if (!isAsyncIterable(loaded)) return null;
  const base = normalizeIterator(loaded[Symbol.asyncIterator](), hasLoadingWindow(options));
  let terminal = false;
  const it = {
    next() {
      const p = base.next();
      return {
        then(res, rej) {
          return p.then((r) => {
            if (r.done) terminal = true;
            return res(r);
          }, (e) => {
            terminal = true;
            if (rej) return rej(e);
            throw e;
          });
        }
      };
    },
    return(value) {
      return base.return(value);
    }
  };
  const iterable = {
    [Symbol.asyncIterator]() {
      return it;
    }
  };
  return coreFn((prev) => {
    if (terminal) return compute(prev);
    subFetch(compute, prev);
    return iterable;
  }, options);
}
function withHydrationGate(create2) {
  const [hydrated, setHydrated] = createSignal(false, {
    ownedWrite: true
  });
  const result = create2(hydrated);
  setHydrated(true);
  return result;
}
function hydrateSignalLike(coreFn, fn, options) {
  if (options?.transparent || noHydrationId()) return coreFn(fn, options);
  markTopLevelSnapshotScope();
  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    return withHydrationGate((hydrated) => coreFn((prev) => {
      if (!hydrated()) return UNASKED;
      return fn(prev);
    }, options));
  }
  if (ssrSource === "hybrid" && sharedConfig.has(peekNextChildId(getOwner()))) {
    let takeover;
    const detect = (prev) => {
      const r = fn(prev);
      takeover = isAsyncIterable(r);
      return r;
    };
    const [hydrated, setHydrated] = createSignal(false, {
      ownedWrite: true
    });
    let live = false;
    const flip2 = () => {
      if (!live) setHydrated(true);
    };
    let adopted2 = false;
    let creating = true;
    let landedOnCreate = false;
    const result = coreFn((prev) => {
      if (live) return fn(prev);
      if (hydrated()) {
        live = true;
        const r = fn(prev);
        return isAsyncIterable(r) ? wrapFirstYield(r, void 0, prev) : r;
      }
      if (adopted2) {
        live = true;
        return fn(prev);
      }
      let answer;
      try {
        answer = readSerializedOrCompute(detect, prev, options);
      } catch (e) {
        if (takeover) live = true;
        throw e;
      }
      if (!takeover) return answer;
      adopted2 = true;
      if (answer != null && typeof answer.then === "function") return adoptedAnswerStream(answer, flip2, () => live = true);
      if (creating) landedOnCreate = true;
      else queueMicrotask(flip2);
      return answer;
    }, options);
    creating = false;
    if (landedOnCreate) flip2();
    return result;
  }
  const aiResult = hydrateSignalFromAsyncIterable(coreFn, fn, options);
  if (aiResult !== null) return aiResult;
  return coreFn((prev) => readSerializedOrCompute(fn, prev, options, true), options);
}
function hydratedCreateMemo(compute, options) {
  if (!sharedConfig.hydrating) return createMemo(compute, options);
  return hydrateSignalLike(createMemo, compute, options);
}
function hydratedCreateSignal(fn, second) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return createSignal(fn, second);
  return hydrateSignalLike(createSignal, fn, second);
}
function hydratedCreateErrorBoundary(fn, fallback2) {
  if (sharedConfig.hydrating && !noHydrationId()) {
    markTopLevelSnapshotScope();
    const expectedId = peekNextChildId(getOwner());
    let err;
    if (sharedConfig.has(expectedId) && (err = sharedConfig.load(expectedId)) !== void 0) {
      let o;
      const read2 = createErrorBoundary(
        () => _hydratingValue ? hydrateWindow(0, fn, 0, (o = getOwner(), o._parent._nc = 1, ~clock)) : fn(),
        (e, reset2) => (o = 0, fallback2(e, reset2))
      );
      if (o) runWithOwner(o, () => createRenderEffect(() => {
        if (o) throw o = 0, err;
      }, noop));
      return read2;
    }
  }
  return createErrorBoundary(fn, fallback2);
}
function hydratedCreateRoot(init, options) {
  return createRoot(sharedConfig.hydrating ? (dispose2) => {
    markTopLevelSnapshotScope();
    return init(dispose2);
  } : init, options);
}
function hydratedEffect(coreFn, compute, effectFn, options) {
  if (!sharedConfig.hydrating || options?.transparent || noHydrationId()) return coreFn(compute, effectFn, options);
  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    let active2 = false;
    withHydrationGate((hydrated) => coreFn((prev) => {
      if (!hydrated()) return prev;
      active2 = true;
      return compute(prev);
    }, (next, prev) => {
      if (!active2) return;
      return effectFn(next, prev);
    }, options));
    return;
  }
  markTopLevelSnapshotScope();
  coreFn((prev) => readSerializedOrCompute(compute, prev), effectFn, options);
}
function hydratedCreateRenderEffect(compute, effectFn, options) {
  return hydratedEffect(createRenderEffect, compute, effectFn, options);
}
function hydratedCreateEffect(compute, effectFn, options) {
  return hydratedEffect(createEffect, compute, effectFn, options);
}
function lazyHydrationLookup(comp, moduleUrl, exportName) {
  const o = getOwner();
  const key = o && o.id != null ? peekNextChildId(o) : void 0;
  const cached = key != null ? globalThis._$HY?.modules?.[key] : void 0;
  if (cached) {
    const component = exportName ? cached[exportName] : cached.default;
    return () => component;
  }
  if (!comp && moduleUrl) {
    throw new Error(`lazy() module "${moduleUrl}" (hydration id "${key}") was not preloaded before hydration.`);
  }
  return comp;
}
function enableHydration() {
  createRoot2 = hydratedCreateRoot;
  _createMemo = hydratedCreateMemo;
  createSignal2 = hydratedCreateSignal;
  _createErrorBoundary = hydratedCreateErrorBoundary;
  _hydrateSignalLike = hydrateSignalLike;
  _hydrateStoreLike = hydrateStoreLike;
  createRenderEffect2 = hydratedCreateRenderEffect;
  _createEffect = hydratedCreateEffect;
  _createLoadingBoundary = hydratedCreateLoadingBoundary;
  _lazyHydrationLookup = lazyHydrationLookup;
  sharedConfig.getNextContextId = hydrationGetNextContextId;
  sharedConfig.isHydrationInProgress = isHydrationInProgress;
  sharedConfig.onHydrationEnd = onHydrationEnd;
  sharedConfig.isClaiming = isClaiming;
  const hy = globalThis._$HY;
  if (hy && !hy.f) {
    hy.f = fragmentPolicy;
    const prevFe = hy.fe;
    hy.fe = (id2, parent) => {
      prevFe && prevFe(id2, parent);
      for (const sub of _revealSubs) sub(id2, parent);
    };
    watchTruncation(hy);
  }
  _hydratingValue = sharedConfig.hydrating;
  _doneValue = sharedConfig.done;
  Object.defineProperty(sharedConfig, "hydrating", {
    get() {
      return _hydratingValue;
    },
    set(v) {
      const was = _hydratingValue;
      _hydratingValue = v;
      if (!was && v) {
        _hydrationDone = false;
        _doneValue = false;
        setSnapshotCapture(true);
        _snapshotRootOwner = null;
      } else if (was && !v) {
        if (_snapshotRootOwner) {
          releaseSnapshotScope(_snapshotRootOwner);
          releaseLiveScope(_snapshotRootOwner);
          _snapshotRootOwner = null;
        }
        checkHydrationComplete();
      }
    },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(sharedConfig, "done", {
    get() {
      return _doneValue;
    },
    set(v) {
      _doneValue = v;
      if (v) drainHydrationCallbacks();
    },
    configurable: true,
    enumerable: true
  });
}
var createMemo2 = (...args) => {
  return (_createMemo || createMemo)(...args);
};
var createSignal2 = createSignal;
var createErrorBoundary2 = (...args) => (_createErrorBoundary || createErrorBoundary)(...args);
var createOptimistic2 = (...args) => {
  return typeof args[0] === "function" && sharedConfig.hydrating ? _hydrateSignalLike(createOptimistic, args[0], args[1]) : createOptimistic(...args);
};
var createDeferred2 = (fn, options) => sharedConfig.hydrating ? _hydrateSignalLike(createDeferred, fn, options) : createDeferred(fn, options);
var createRoot2 = createRoot;
var createRenderEffect2 = createRenderEffect;
var createEffect2 = (...args) => (_createEffect || createEffect)(...args);
function createBoundaryTrigger() {
  setSnapshotCapture(false);
  const [s, set2] = createSignal(void 0, {
    equals: false
  });
  s();
  setSnapshotCapture(true);
  return set2;
}
function hydrateWindow(id2, fn, scope2, o = getOwner()) {
  const prevRegistry = sharedConfig.registry;
  const prevGather = sharedConfig.gather;
  const prevHydrating = _hydratingValue;
  const prevClaim = _claimOwner;
  const own = !_snapshotRootOwner && o;
  const capture = own && _hydrationDone;
  if (scope2) {
    sharedConfig.registry = scope2.registry;
    sharedConfig.gather = scope2.gather;
  }
  try {
    if (id2) sharedConfig.gather?.(id2);
    _hydratingValue = true;
    _claimOwner = o;
    _claimRound = clock;
    if (own) {
      if (capture) setSnapshotCapture(true);
      markSnapshotScope(own);
      openLiveScope(own);
      _snapshotRootOwner = own;
    }
    return fn();
  } finally {
    _hydratingValue = prevHydrating;
    _claimOwner = prevClaim;
    if (scope2) {
      sharedConfig.registry = prevRegistry;
      sharedConfig.gather = prevGather;
    }
    if (own) {
      _snapshotRootOwner = null;
      releaseSnapshotScope(own);
      releaseLiveScope(own);
      if (capture) clearSnapshots();
    }
  }
}
function resumeBoundaryHydration(o, id2, set2, release3, shouldHydrate = true) {
  const scope2 = sharedConfig.boundaryScopes?.get(id2);
  if (!release3()) return;
  if (isDisposed(o)) {
    checkHydrationComplete();
    return;
  }
  _hydratingValue = false;
  shouldHydrate ? hydrateWindow(id2, () => {
    set2();
    flush();
  }, scope2, o) : servedPass(set2, shouldHydrate === 0 && o)();
  flush();
  checkHydrationComplete();
}
function initBoundaryResume(o, id2) {
  _pendingBoundaries++;
  o._hp = 1;
  sharedConfig.captureBoundaryScope?.(id2);
  let released = false;
  const release3 = () => {
    if (released) return false;
    released = true;
    _pendingBoundaries--;
    o._hp = 0;
    sharedConfig.boundaryScopes?.delete(id2);
    const claim = _fragments.get(id2);
    if (claim) claim.claimed = false;
    return true;
  };
  onCleanup(() => {
    if (!isDisposed(o)) return;
    sharedConfig.cleanupFragment?.(id2);
    if (release3()) checkHydrationComplete();
  });
  const set2 = createBoundaryTrigger();
  return [set2, (shouldHydrate) => resumeBoundaryHydration(o, id2, set2, release3, shouldHydrate), release3];
}
var _fragments = /* @__PURE__ */ new Map();
var _truncated = /* @__PURE__ */ new Set();
var _revealSubs = /* @__PURE__ */ new Set();
var _truncationRejectors = /* @__PURE__ */ new Map();
function fragmentState(id2) {
  let f = _fragments.get(id2);
  if (!f) _fragments.set(id2, f = {});
  return f;
}
var _ownedFragment;
function fragmentPolicy(id2) {
  const f = fragmentState(id2);
  if (!_hydrationDone || f.claimed || _ownedFragment !== void 0 && _ownedFragment(id2)) return globalThis.$dfr(id2);
  f.held = true;
  return 0;
}
function replayHeldFragment(id2) {
  const f = _fragments.get(id2);
  if (f && f.held) {
    f.held = false;
    globalThis.$dfr(id2);
  }
}
function claimFragment(id2) {
  fragmentState(id2).claimed = true;
  replayHeldFragment(id2);
}
function fragmentSuperseded(id2) {
  const hy = globalThis._$HY;
  if (hy && hy.v && hy.v[id2]) return false;
  if (document.getElementById(id2)) return false;
  return !!document.getElementById("pl-" + id2);
}
function fragmentParked(id2) {
  const hy = globalThis._$HY;
  if (hy && hy.v && hy.v[id2]) return false;
  return !!document.getElementById(id2) && !!document.getElementById("pl-" + id2);
}
function whenRevealed(id2, cb) {
  if (!fragmentParked(id2)) return cb();
  const unsubscribe = subscribeFragments((revealed) => {
    if (revealed !== id2) return;
    unsubscribe();
    queueMicrotask(cb);
  });
}
function subscribeFragments(cb) {
  _revealSubs.add(cb);
  return () => _revealSubs.delete(cb);
}
function watchTruncation(hy) {
  const sweep = () => {
    if (!hy.r) return;
    const consumed = dropTruncatedRefs(hy);
    for (const key in hy.r) {
      if (key.length <= 3 || !key.endsWith("_fr")) continue;
      const ref = hy.r[key];
      if (ref && typeof ref === "object" && !ref.s) markTruncated(hy, key.slice(0, -3));
    }
    setTimeout(() => rejectTruncatedRefs(consumed));
  };
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sweep, {
    once: true
  });
  else if (hy.s) sweep();
}
function dropTruncatedRefs(hy) {
  const consumed = [];
  const R = globalThis.$R;
  if (!R || typeof R !== "object") return consumed;
  let registryKeys;
  const sweep = (entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.f !== "function" || !entry.p || typeof entry.p.then !== "function" || entry.p.s) return;
    if (!registryKeys) {
      registryKeys = /* @__PURE__ */ new Map();
      for (const key2 in hy.r) registryKeys.set(hy.r[key2], key2);
    }
    const key = registryKeys.get(entry.p);
    if (key === void 0) consumed.push(entry);
    else if (!key.endsWith("_fr")) delete hy.r[key];
  };
  for (const key in R) {
    const value = R[key];
    if (Array.isArray(value)) for (const entry of value) sweep(entry);
    else sweep(value);
  }
  return consumed;
}
function rejectTruncatedRefs(consumed) {
  for (const entry of consumed) {
    if (entry.p.s) continue;
    const err = new Error("Hydration value was truncated: the stream ended before it settled.");
    entry.f(err);
    entry.p.s = 2;
    entry.p.v = err;
    entry.p.then(void 0, noop);
  }
}
function markTruncated(hy, id2) {
  if (_truncated.has(id2)) return;
  _truncated.add(id2);
  const err = new Error(`Hydration fragment "${id2}" was truncated: the stream ended before its content arrived.`);
  const ref = hy.r[id2 + "_fr"];
  if (ref && typeof ref === "object") {
    ref.s = 2;
    ref.v = err;
  }
  const reject = _truncationRejectors.get(id2);
  if (reject) {
    _truncationRejectors.delete(id2);
    reject(err);
  }
  for (const sub of _revealSubs) sub(id2);
}
function fragmentAbort(id2) {
  return new Promise((_, reject) => _truncationRejectors.set(id2, reject));
}
function waitAndResume(p, resume, assetPromise, hydrateRejected = true, abort) {
  const data = (abort ? Promise.race([Promise.resolve(p), abort]) : Promise.resolve(p)).then(() => {
    if (p && typeof p === "object") p.s = 1;
    return true;
  }, (err) => {
    if (p && typeof p === "object") {
      p.s = 2;
      p.v = err;
    }
    return hydrateRejected;
  });
  if (!assetPromise) {
    data.then((shouldHydrate) => resume(shouldHydrate));
    return;
  }
  const assets = assetPromise.then(() => true, (err) => {
    reportAssetFailure(err);
    return false;
  });
  Promise.all([data, assets]).then(([dataHydrate, assetsOk]) => resume(assetsOk ? dataHydrate : false));
}
function reportAssetFailure(err) {
  console.error("Hydration module preload failed; rendering boundary content on the client:", err);
}
function scheduleResumeAfterAssets(id2, resume, assetPromise) {
  sharedConfig.gather?.(id2);
  const doResume = () => queueMicrotask(resume);
  if (assetPromise) {
    assetPromise.then(doResume, (err) => {
      reportAssetFailure(err);
      queueMicrotask(() => resume(false));
    });
    return true;
  }
  doResume();
  return false;
}
var boundaryAssets = (id2) => sharedConfig.loadModuleAssets?.(sharedConfig.load(id2 + "_assets"));
function hydratedCreateLoadingBoundary(fn, fallback2, options) {
  if (!sharedConfig.hydrating || noHydrationId()) return createLoadingBoundary(fn, fallback2, options);
  let settledSerializationResumeQueued = false;
  return createMemo(() => {
    const o = getOwner();
    const id2 = o.id;
    const assetPromise = sharedConfig.hydrating ? boundaryAssets(id2) : void 0;
    if (sharedConfig.hydrating && sharedConfig.has(id2)) {
      const ref = sharedConfig.load(id2);
      let p;
      if (ref) {
        if (typeof ref !== "object" || ref.s == null) p = ref;
        else if (ref.s === 1 || ref.s === 2) sharedConfig.gather?.(id2);
        else p = ref;
      }
      if (ref && typeof ref === "object" && ref.s === 1 && p == null && !settledSerializationResumeQueued) {
        if (assetPromise) {
          settledSerializationResumeQueued = true;
          const [, resume] = initBoundaryResume(o, id2);
          scheduleResumeAfterAssets(id2, resume, assetPromise);
          return void 0;
        }
        return createLoadingBoundary(fn, fallback2, options);
      }
      if (p) {
        const [, resume, release3] = initBoundaryResume(o, id2);
        if (p !== "$$f") {
          waitAndResume(p, resume, assetPromise);
        } else {
          const [open, setOpen] = createSignal();
          const afterAssets = () => {
            if (!release3()) return;
            setOpen(1);
            checkHydrationComplete();
          };
          waitAndResume(1, afterAssets, assetPromise);
          return createLoadingBoundary(() => {
            if (!open()) throw new NotReadyError(getOwner());
            return fn();
          }, () => createRoot(fallback2, {
            id: id2
          }), options);
        }
        return fallback2();
      }
    }
    if (sharedConfig.hydrating && sharedConfig.has(id2 + "_fr") && !settledSerializationResumeQueued) {
      const fr = sharedConfig.load(id2 + "_fr");
      replayHeldFragment(id2);
      const s = fr && typeof fr === "object" ? fr.s === 1 && fragmentParked(id2) ? 0 : fr.s : 0;
      const unclaimed = !isClaiming();
      if (s === 2 || unclaimed) fr.catch?.(noop);
      if (unclaimed || s === 1 && !assetPromise && !fragmentSuperseded(id2)) {
        sharedConfig.gather?.(id2);
        return createLoadingBoundary(fn, fallback2, options);
      }
      settledSerializationResumeQueued = true;
      const [, resume] = initBoundaryResume(o, id2);
      if (s === 1 && fragmentSuperseded(id2)) {
        waitAndResume(1, () => resume(false), assetPromise);
        return fallback2();
      }
      if (s === 1 || s === 2) {
        if (s === 2) {
          waitAndResume(1, () => resume(0), assetPromise);
          return void 0;
        }
        scheduleResumeAfterAssets(id2, resume, assetPromise);
        return void 0;
      }
      claimFragment(id2);
      const hy = globalThis._$HY;
      const revealed = hy.v?.[id2];
      waitAndResume(
        fr,
        (shouldHydrate) => shouldHydrate ? whenRevealed(id2, () => {
          const assets = boundaryAssets(id2);
          assets ? waitAndResume(true, resume, assets) : resume(true);
        }) : (revealed || hy.v?.[id2]?.forEach?.((n) => n.remove()), resume(shouldHydrate)),
        assetPromise,
        0,
        fragmentAbort(id2)
      );
      return revealed ? void 0 : fallback2();
    }
    if (assetPromise && !sharedConfig.has(id2)) {
      const [, resume] = initBoundaryResume(o, id2);
      assetPromise.then(() => resume(), (err) => {
        reportAssetFailure(err);
        resume(false);
      });
      return void 0;
    }
    return createLoadingBoundary(fn, fallback2, options);
  });
}
function createComponent(Comp, props, name, loc) {
  return untrack(() => Comp(props || {}));
}
function Errored(props) {
  return createErrorBoundary2(() => props.children, (err, reset2) => {
    const f = props.fallback;
    return typeof f === "function" ? f(err, reset2) : f;
  });
}

// ../store-proto-features/packages/solid/dist/internal.js
var sharedConfig2 = sharedConfig;

// ../store-proto-features/packages/web/dist/web.js
var $$SLOT = /* @__PURE__ */ Symbol("slot");
var $$INDEX = /* @__PURE__ */ Symbol("index");
var $$HOST = /* @__PURE__ */ Symbol("host");
var transparentOptions = {
  transparent: true,
  sync: true
};
function effect2(fn, effectFn, options) {
  const nodeOptions = options ? {
    sync: true,
    ...options,
    transparent: !options.scope
  } : transparentOptions;
  createRenderEffect2(fn, effectFn, nodeOptions);
}
function reconcileArrays(parentNode, a, b, marker) {
  let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, stamped, after, index, anchor;
  while (aStart < aEnd && a[aStart] === b[bStart]) {
    aStart++;
    bStart++;
  }
  if (aStart === aEnd && bStart === bEnd) return;
  const mv = parentNode.moveBefore && parentNode.isConnected;
  const slot = marker || parentNode;
  const insert2 = (n, ref2) => {
    mv && n.isConnected ? parentNode.moveBefore(n, ref2) : parentNode.insertBefore(n, ref2);
    if (marker || n[$$SLOT]) n[$$SLOT] = slot;
  };
  if (!aEnd) {
    for (const n of b) insert2(n, marker);
    return;
  }
  const isLive = (n) => n && n.parentNode === parentNode && (!(n = n[$$SLOT]) || n === slot);
  const ref = (k) => {
    while (k < bLength && !isLive(b[k])) k++;
    return b[k] || (after && after.parentNode !== parentNode ? marker || null : after);
  };
  after = isLive(anchor = a[aEnd - 1]) ? anchor.nextSibling : marker || null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      anchor = ref(bEnd);
      while (bStart < bEnd) insert2(b[bStart++], anchor);
    } else if (!isLive(anchor = a[aStart])) aStart++;
    else if (b[bStart] === a[aEnd - 1] && (anchor === b[bEnd - 1] || !stamped && anchor === b[bStart + 1] && a[aStart + 1] === b[bStart + 2])) {
      do {
        insert2(a[--aEnd], anchor);
        bStart++;
      } while (aStart < aEnd - 1 && bStart < bEnd && anchor === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
    } else if (bStart < bEnd && anchor === b[bEnd - 1] && a[aStart + 1] !== b[bEnd - 2] && isLive(b[bStart]) && isLive(a[aEnd - 1])) {
      insert2(anchor, ref(bEnd));
      aStart++;
      bEnd--;
    } else {
      if (!stamped) {
        stamped = 1;
        for (index = bStart; index < bEnd; ) b[index][$$INDEX] = index++;
      }
      if ((index = anchor[$$INDEX]) >= 0 && b[index] === anchor) {
        if (bStart < index && index < bEnd) {
          let i = aStart, sequence = 1;
          while (++i < aEnd && i < bEnd && a[i] === b[index + sequence]) sequence++;
          if (sequence > index - bStart) {
            while (bStart < index) insert2(b[bStart++], anchor);
          } else {
            const newNode = b[bStart++];
            aStart++;
            mv ? insert2(newNode, anchor) : parentNode.replaceChild(newNode, anchor);
            if (marker || newNode[$$SLOT]) newNode[$$SLOT] = slot;
          }
        } else aStart++;
      } else {
        anchor.remove();
        aStart++;
      }
    }
  }
}
var EVENT_KEY = "_$$";
var $$EVENT_OWNER = "_$SOLID_EVENT_OWNER";
var INNER_OWNED = {};
var delegatedEvents = /* @__PURE__ */ new Set();
var delegatedContainers = /* @__PURE__ */ new Map();
function render(code, element, init, options = {}) {
  let disposer;
  registerDelegatedRoot(element);
  try {
    createRoot2((dispose2) => {
      disposer = dispose2;
      if (options.onError) getOwner()[ROOT_ERROR_HOOK] = options.onError;
      const tree = code();
      if (element === document) effect2(() => flatten(tree), () => {
      });
      else insert(element, () => tree, element.firstChild ? null : void 0, init, {
        ...options.insertOptions,
        schedule: true
      });
    }, {
      id: options.renderId
    });
    flush();
  } catch (err) {
    if (disposer) disposer();
    unregisterDelegatedRoot(element);
    throw err;
  } finally {
  }
  return () => {
    disposer();
    unregisterDelegatedRoot(element);
    element.textContent = "";
  };
}
var policy;
function create(html, bypassGuard, flag) {
  const t = document.createElement("template");
  t.innerHTML = policy ? policy.createHTML(html) : html;
  const node = t.content.firstChild;
  return flag === 2 ? node.firstChild : node;
}
function template(html, flag) {
  let node;
  const fn = (bypassGuard) => (node || (node = create(html, bypassGuard, flag)), flag === 1 ? document.importNode(node, true) : node.cloneNode(true));
  return fn;
}
function delegateEvents(eventNames) {
  for (const name of eventNames) {
    if (!delegatedEvents.has(name)) {
      delegatedEvents.add(name);
      delegatedContainers.forEach((state, container) => attachDelegatedEvent(name, container, state));
    }
  }
}
function registerDelegatedRoot(root) {
  registerDelegatedContainer(root, root);
}
function unregisterDelegatedRoot(root) {
  unregisterDelegatedContainer(root, root);
}
function registerDelegatedContainer(container, owner = container) {
  if (!container || !owner) return;
  let state = delegatedContainers.get(container);
  if (!state) delegatedContainers.set(container, state = {
    owners: /* @__PURE__ */ new Map(),
    handlers: /* @__PURE__ */ new Map()
  });
  state.owners.set(owner, (state.owners.get(owner) || 0) + 1);
  delegatedEvents.forEach((name) => attachDelegatedEvent(name, container, state));
}
function unregisterDelegatedContainer(container, owner = container) {
  const state = delegatedContainers.get(container);
  if (!state) return;
  const count = state.owners.get(owner);
  if (count > 1) state.owners.set(owner, count - 1);
  else state.owners.delete(owner);
  if (state.owners.size) return;
  state.handlers.forEach((handler, name) => {
    container.removeEventListener(name, resetDelegatedEvent, true);
    container.removeEventListener(name, handler);
  });
  delegatedContainers.delete(container);
}
function resetDelegatedEvent(e) {
  delete e[$$EVENT_OWNER];
}
function attachDelegatedEvent(name, container, state) {
  if (state.handlers.has(name)) return;
  const handler = (e) => eventHandler(e, container, state);
  state.handlers.set(name, handler);
  container.addEventListener(name, resetDelegatedEvent, true);
  container.addEventListener(name, handler);
}
function getDelegatedRoot(node) {
  while (node) {
    if (delegatedContainers.get(node)?.owners.has(node)) return node;
    node = parentOf(node);
  }
}
var parentOf = (node) => node._$host || node.parentNode || node.host;
function findOwner(node, state) {
  let distance = 0;
  while (node) {
    if (state.owners.has(node)) return {
      owner: node,
      distance
    };
    distance++;
    node = parentOf(node);
  }
}
function scope(fn) {
  fn.$s = true;
  return fn;
}
var SCOPE_OPTIONS = {
  scope: true
};
var hydrationRt = null;
var selectInsert = null;
var hostRt = null;
function installHostTagging() {
  hostRt = tagHost;
}
function installHydrationRuntime() {
  hydrationRt = {
    claimInitial(parent, multi, initial) {
      if (isHydrating(parent)) {
        if (!multi && initial === void 0 && parent) initial = claimChildNodes(parent);
        else if (Array.isArray(initial)) stripTextSeparators(initial);
      }
      return initial;
    },
    reclaimRegion(current, parent, marker) {
      if (!sharedConfig2.hydrating || current == null || !parent.isConnected) return current;
      if (Array.isArray(current) ? current.every((n) => !n || n.isConnected) : current.isConnected) return current;
      let nodes;
      if (marker) {
        nodes = [];
        let node = marker.previousSibling, depth = 0;
        while (node) {
          if (node.nodeType === 8) {
            const v = node.nodeValue;
            if (v === "/") depth++;
            else if (v === "$") {
              if (depth === 0) break;
              depth--;
            }
          }
          nodes.unshift(node);
          node = node.previousSibling;
        }
      } else return claimChildNodes(parent);
      return stripTextSeparators(nodes);
    },
    dedupEvent(e) {
      return !!(sharedConfig2.registry && sharedConfig2.events && sharedConfig2.events.find(([el, ev]) => ev === e));
    }
  };
}
function stripTextSeparators(nodes) {
  let j = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], t = node.nodeType;
    if (t === 8 && node.nodeValue === "!$") {
      node.remove();
      continue;
    }
    if (isPlaceholderScaffolding(node, t)) continue;
    nodes[j++] = node;
  }
  nodes.length = j;
  return nodes;
}
function claimChildNodes(parent) {
  const live = parent.childNodes;
  const out2 = [];
  for (let i = 0, n = live.length; i < n; i++) {
    const node = live[i], t = node.nodeType;
    if (t === 8 && node.nodeValue === "!$") {
      node.remove();
      i--;
      n--;
      continue;
    }
    if (isPlaceholderScaffolding(node, t)) continue;
    out2.push(node);
  }
  return out2;
}
function isPlaceholderScaffolding(node, t) {
  return t === 8 ? node.nodeValue.startsWith("pl-") : t === 1 && node.localName === "template" && node.id.startsWith("pl-");
}
function insert(parent, accessor2, marker, current, options) {
  const multi = marker !== void 0;
  if (multi && !current) current = [];
  if (hydrationRt !== null) current = hydrationRt.claimInitial(parent, multi, current);
  if (typeof accessor2 !== "function") {
    accessor2 = normalize(accessor2, current, multi, true);
    if (typeof accessor2 !== "function") {
      insertExpression(parent, accessor2, current, marker);
      hostRt !== null && options && options.host && hostRt(accessor2, options.host);
      return;
    }
  }
  if (multi && current.length === 0) {
    const placeholder = document.createTextNode("");
    parent.insertBefore(placeholder, marker);
    current = [placeholder];
  }
  let ran = false;
  effect2(
    () => {
      if (hydrationRt !== null) current = hydrationRt.reclaimRegion(current, parent, marker);
      const value = normalize(accessor2(), current, multi, true);
      const again = ran;
      ran = true;
      if (typeof value !== "function") return value;
      const innerOptions = again && !(options && options.schedule) ? {
        ...options,
        schedule: true
      } : options;
      effect2(() => (hydrationRt !== null && (current = hydrationRt.reclaimRegion(current, parent, marker)), normalize(value, current, multi)), (inner) => {
        current = insertExpression(parent, inner, current, marker);
        hostRt !== null && options && options.host && hostRt(current, options.host);
      }, innerOptions);
      return INNER_OWNED;
    },
    (value) => {
      if (value === INNER_OWNED) return;
      current = insertExpression(parent, value, current, marker);
      hostRt !== null && options && options.host && hostRt(current, options.host);
    },
    accessor2.$s ? options ? {
      ...options,
      scope: true
    } : SCOPE_OPTIONS : options
  );
}
function loadModuleAssets(mapping) {
  const hy = globalThis._$HY;
  if (!hy) return;
  const pending = [];
  for (const key in mapping) {
    if (hy.modules[key]) continue;
    const entryUrl = new URL(mapping[key], document.baseURI).href;
    if (!hy.loading[key]) {
      hy.loading[key] = import(entryUrl).then((mod) => {
        hy.modules[key] = mod;
      }, (err) => {
        delete hy.loading[key];
        throw err;
      });
    }
    pending.push(hy.loading[key]);
  }
  return pending.length ? Promise.all(pending).then(() => {
  }) : void 0;
}
function hydrate(code, element, options = {}) {
  enableHydration();
  installHydrationRuntime();
  const hy = globalThis._$HY;
  const id2 = options.renderId || "";
  if (hy.s && !hy.s[id2] && !hy.s[""] && !hy.done && document.readyState === "loading") {
    let started, disposer;
    const start = () => started || (started = true, disposer = hydrate(code, element, options));
    (hy.sp || (hy.sp = [])).push([id2, start]);
    hy.sw = (key) => hy.sp.forEach(([k, f]) => (!key || k === key) && queueMicrotask(f));
    document.addEventListener("DOMContentLoaded", start, {
      once: true
    });
    return () => {
      started = true;
      disposer && disposer();
    };
  }
  if (hy.done) return render(code, element, [...element.childNodes], options);
  const head = (element.nodeType === 9 ? element : element.ownerDocument).head;
  if (head && element.contains(head)) {
    for (const n of [...head.childNodes]) {
      if (n.nodeType !== 1 || !n.hasAttribute("data-dh") || n.hasAttribute("data-dhf")) break;
      head.appendChild(n);
    }
  }
  options.renderId ||= "";
  if (!globalThis._$HY.modules) globalThis._$HY.modules = {};
  if (!globalThis._$HY.loading) globalThis._$HY.loading = {};
  sharedConfig2.completed = globalThis._$HY.completed;
  sharedConfig2.events = globalThis._$HY.events;
  sharedConfig2.load = (id3) => globalThis._$HY.r[id3];
  sharedConfig2.has = (id3) => id3 in globalThis._$HY.r;
  sharedConfig2.gather = (root) => gatherHydratable(element, root);
  sharedConfig2.loadModuleAssets = loadModuleAssets;
  sharedConfig2.cleanupFragment = (id3) => {
    const tpl = document.getElementById("pl-" + id3);
    if (tpl) {
      let node = tpl.nextSibling;
      while (node) {
        const next = node.nextSibling;
        if (node.nodeType === 8 && node.nodeValue === "pl-" + id3) {
          node.remove();
          break;
        }
        node.remove();
        node = next;
      }
      tpl.remove();
    }
  };
  sharedConfig2.registry = /* @__PURE__ */ new Map();
  if (!sharedConfig2.boundaryScopes) sharedConfig2.boundaryScopes = /* @__PURE__ */ new Map();
  sharedConfig2.captureBoundaryScope = (id3) => {
    if (sharedConfig2.registry) sharedConfig2.boundaryScopes.set(id3, {
      registry: sharedConfig2.registry,
      gather: sharedConfig2.gather
    });
  };
  sharedConfig2.hydrating = true;
  const hyr = globalThis._$HY.r;
  const rootMapping = hyr && (hyr[options.renderId + "_assets"] || hyr["_assets"]);
  if (rootMapping && typeof rootMapping === "object") {
    const p = loadModuleAssets(rootMapping);
    if (p) {
      gatherHydratable(element, options.renderId);
      const registry = sharedConfig2.registry;
      const gather = sharedConfig2.gather;
      let disposer;
      p.then(() => {
        sharedConfig2.registry = registry;
        sharedConfig2.gather = gather;
        sharedConfig2.hydrating = true;
        try {
          disposer = render(code, element, [...element.childNodes], options);
        } finally {
          sharedConfig2.hydrating = false;
        }
      }, (err) => {
        sharedConfig2.hydrating = false;
        sharedConfig2.registry = void 0;
        if (element.nodeType === 9) {
          (globalThis.reportError || console.error)(err);
          return;
        }
        console.error("Hydration module preload failed, falling back to client render:", err);
        disposer = render(code, element, [...element.childNodes], options);
      });
      return () => disposer && disposer();
    }
  }
  try {
    gatherHydratable(element, options.renderId);
    return render(code, element, [...element.childNodes], options);
  } finally {
    sharedConfig2.hydrating = false;
  }
}
function getNextElement(template2) {
  let key = sharedConfig2.hydrating && getHydrationKey(), node = isHydrating() && sharedConfig2.registry.get(key);
  if (!node) {
    if (!template2) {
      throw new Error(`Hydration Mismatch. Unable to find DOM nodes for hydration key: ${key}`);
    }
    return template2(true);
  }
  if (sharedConfig2.completed) sharedConfig2.completed.add(node);
  sharedConfig2.registry.delete(key);
  return node;
}
function runHydrationEvents() {
  if (sharedConfig2.events && !sharedConfig2.events.queued) {
    queueMicrotask(() => {
      const {
        completed,
        events
      } = sharedConfig2;
      if (!events) return;
      events.queued = false;
      while (events.length) {
        const [el, e, origin] = events[0];
        if (!completed.has(el)) return;
        events.shift();
        const target = origin || e.target;
        const replay = (container, state) => (Object.defineProperty(e, "target", {
          configurable: true,
          value: target
        }), eventHandler(e, container, state));
        let matchContainer, matchState, matchDistance, matches;
        for (const [container, state] of delegatedContainers) {
          if (!state.handlers.has(e.type)) continue;
          const entry = findOwner(target, state);
          if (!entry) continue;
          if (matchContainer) {
            if (!matches) matches = [{
              container: matchContainer,
              state: matchState,
              distance: matchDistance
            }];
            matches.push({
              container,
              state,
              distance: entry.distance
            });
          } else {
            matchContainer = container;
            matchState = state;
            matchDistance = entry.distance;
          }
        }
        if (matches) {
          matches.sort((a, b) => a.distance - b.distance);
          for (let i = 0; i < matches.length; i++) replay(matches[i].container, matches[i].state);
        } else if (matchContainer) replay(matchContainer, matchState);
        delete e.target;
        flush();
      }
      if (sharedConfig2.done) {
        sharedConfig2.events = _$HY.events = null;
        sharedConfig2.completed = _$HY.completed = null;
      }
    });
    sharedConfig2.events.queued = true;
  }
}
function isHydrating(node) {
  if (!sharedConfig2.hydrating) return false;
  if (sharedConfig2.isClaiming && !sharedConfig2.isClaiming()) return false;
  if (!node || node.isConnected) return true;
  return serverComponentClaims !== null && serverComponentClaims.claimed(node);
}
var serverComponentClaims = null;
function eventHandler(e, container, state) {
  if (hydrationRt !== null && hydrationRt.dedupEvent(e)) return;
  const prev = e[$$EVENT_OWNER];
  let resumeNode;
  if (prev) {
    if (prev === true || prev === container || !container.contains(prev)) return;
    resumeNode = prev;
  }
  const owner = state.owners.size === 1 && state.owners.has(container) ? container : findOwner(e.target, state)?.owner;
  if (!owner) return;
  if (owner === resumeNode) return;
  e[$$EVENT_OWNER] = owner;
  let node = resumeNode || e.target;
  const key = EVENT_KEY + e.type;
  const define = (name, value) => Object.defineProperty(e, name, {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      define("currentTarget", node);
      const data = node[`${key}Data`];
      data !== void 0 ? handler.call(node, data, e) : typeof handler === "function" ? handler.call(node, e) : handler.handleEvent(e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && define("target", node.host);
    return true;
  };
  const atOwner = () => node === owner || node.parentNode === owner;
  const walkUpTree = () => {
    while (node && handleNode() && !atOwner()) node = parentOf(node);
  };
  if (resumeNode) {
    if (resumeNode === e.target) node = parentOf(resumeNode);
    if (node && node !== owner) walkUpTree();
  } else if (e.composedPath) {
    const path = e.composedPath();
    if (path.length) {
      define("target", path[0]);
      for (let i = 0; i < path.length; i++) {
        node = path[i];
        if (!handleNode()) break;
        if (node._$host) {
          node = node._$host;
          walkUpTree();
          break;
        }
        if (atOwner()) break;
      }
    } else walkUpTree();
  } else walkUpTree();
  delete e.target;
  delete e.currentTarget;
}
function insertExpression(parent, value, current, marker) {
  if (hydrationRt !== null && isHydrating(parent)) {
    if (value && value !== current) {
      const arr = Array.isArray(value);
      for (const n of arr ? value : [value]) {
        if (n && n.nodeType) {
          if (!isHydrating(n)) return current;
        } else if (arr && (typeof n === "string" || typeof n === "number")) {
          return current;
        }
      }
    }
    return value;
  }
  if (value === current) return value;
  if (hydrationRt !== null && sharedConfig2.hydrating && value && value.length !== 0) {
    const tracked = [].concat(current ?? []);
    if ([].concat(value).every((n) => (n === tracked[0] && tracked.shift(), n?.parentNode === parent)) && !tracked.length) return value;
  }
  const t = typeof value;
  if (t === "string" || t === "number") {
    const tc = typeof current;
    if (tc === "string" || tc === "number") {
      parent.firstChild.data = value;
    } else {
      if (ownsAllChildren(parent, current)) parent.textContent = value;
      else {
        removeOwnedChildren(parent, current);
        parent.insertBefore(document.createTextNode(value), parent.firstChild);
      }
    }
  } else if (value === void 0) {
    cleanChildren(parent, current, marker);
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      cleanChildren(parent, current, marker ?? null, value);
    } else if (current != null && current.nodeType) {
      current.parentNode === parent ? parent.replaceChild(value, current) : parent.appendChild(value);
    } else if (current != null && parent.firstChild) {
      parent.replaceChild(value, parent.firstChild);
    } else {
      parent.appendChild(value);
    }
    if (marker || value[$$SLOT]) value[$$SLOT] = marker || parent;
  } else if (Array.isArray(value)) {
    const currentArray = Array.isArray(current);
    for (let i = 0, len = value.length; i < len; i++) {
      const item = value[i], t2 = typeof item;
      if (t2 === "string" || t2 === "number") {
        const prev = currentArray ? current[i] : void 0;
        if (prev && prev.nodeType === 3) {
          const last = prev._$d;
          if (last !== item && (last !== void 0 || prev.data !== "" + item)) prev.data = prev._$d = item;
          value[i] = prev;
        } else value[i] = document.createTextNode(item);
      }
    }
    if (value.length === 0) {
      cleanChildren(parent, current, marker);
    } else if (currentArray) {
      reconcileArrays(parent, current, value, marker);
    } else {
      if (current != null) cleanChildren(parent, current);
      reconcileArrays(parent, [], value);
    }
  } else ;
  selectInsert && selectInsert(parent);
  return value;
}
function normalize(value, current, multi, doNotUnwrap) {
  value = flatten(value, {
    skipNonRendered: true,
    doNotUnwrap
  });
  if (doNotUnwrap && typeof value === "function") return value;
  if (multi && !Array.isArray(value)) value = [value != null ? value : ""];
  if (hydrationRt !== null && sharedConfig2.hydrating && Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i++) {
      const item = value[i], prev = current && current[i], t = typeof item;
      if ((t === "string" || t === "number") && prev && prev.nodeType === 3 && isHydrating(prev)) value[i] = prev;
    }
  }
  return value;
}
function hostGetter() {
  return this[$$HOST]();
}
function tagHost(value, host) {
  if (Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i++) tagHost(value[i], host);
  } else if (value && value.nodeType && value[$$HOST] !== host) {
    value[$$HOST] = host;
    Object.defineProperty(value, "_$host", {
      get: hostGetter,
      configurable: true
    });
  }
}
function ownsAllChildren(parent, current) {
  if (current == null) return true;
  if (Array.isArray(current)) {
    return current.length ? parent.firstChild === current[0] && parent.lastChild === current[current.length - 1] : parent.firstChild === null;
  }
  if (current === "") return parent.firstChild === null;
  if (current.nodeType) return parent.firstChild === current && parent.lastChild === current;
  const first = parent.firstChild;
  return first !== null && first.nodeType === 3 && parent.lastChild === first;
}
function removeOwnedChildren(parent, current) {
  if (Array.isArray(current)) {
    for (let i = 0; i < current.length; i++) {
      const el = current[i];
      if (el.parentNode === parent) el.remove();
    }
  } else if (current.nodeType) {
    if (current.parentNode === parent) current.remove();
  } else {
    const first = parent.firstChild;
    if (first && first.nodeType === 3) first.remove();
  }
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === void 0) {
    if (ownsAllChildren(parent, current)) return parent.textContent = "";
    return removeOwnedChildren(parent, current);
  }
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (replacement !== el) {
        const tag = el[$$SLOT];
        const owns = el.parentNode === parent && (!tag || tag === (marker || parent));
        if (replacement && !inserted && !i) owns ? parent.replaceChild(replacement, el) : parent.insertBefore(replacement, marker);
        else if (owns) el.remove();
      } else inserted = true;
    }
  } else if (replacement) parent.insertBefore(replacement, marker);
  if (replacement && (marker || replacement[$$SLOT])) replacement[$$SLOT] = marker || parent;
}
function gatherHydratable(element, root) {
  const templates = element.querySelectorAll(root ? `[_hk^="${root.replace(/["\\]/g, "\\$&")}"]` : `*[_hk]`);
  const inFrame = root || serverComponentClaims === null ? void 0 : serverComponentClaims.inFrame(element);
  const registry = sharedConfig2.registry;
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    if (inFrame !== void 0 && inFrame(node)) continue;
    const key = node.getAttribute("_hk");
    if (!registry.has(key)) registry.set(key, node);
  }
}
function getHydrationKey() {
  return sharedConfig2.getNextContextId();
}
function Portal(props) {
  return runWithOwner(createOwner(), () => portalImpl(props));
}
var claimPortal;
function portalImpl(props) {
  let kids = [];
  const treeMarker = document.createTextNode(""), startMarker = document.createTextNode(""), endMarker = document.createTextNode(""), mount = () => props.mount || document.body, content = createMemo2(() => {
    const prev = claimPortal;
    kids = [];
    claimPortal = (n) => kids.push(n);
    try {
      return [startMarker, props.children];
    } finally {
      claimPortal = prev;
    }
  }, {
    ssrSource: "client",
    loadingValue: void 0
  });
  claimPortal && claimPortal(startMarker);
  createRenderEffect2(
    () => [mount(), content(), getOwner()],
    ([, c, owner]) => {
      const m = untrack(mount);
      m.insertBefore(endMarker, kids.find((k) => k.parentNode === m) || null);
      const dispose2 = runWithOwner(owner, () => createRoot2((d) => {
        installHostTagging();
        insert(m, c, endMarker, void 0, {
          host: () => treeMarker.parentNode
        });
        return d;
      }));
      return () => {
        dispose2();
        let c2 = startMarker;
        while (c2) {
          const n = c2.nextSibling;
          m.removeChild(c2);
          if (c2 === endMarker) break;
          c2 = n;
        }
      };
    },
    {
      schedule: true,
      ssrSource: "client"
    }
  );
  createEffect2(mount, () => {
    const m = untrack(mount);
    const ownerRoot = getDelegatedRoot(treeMarker);
    if (!ownerRoot || ownerRoot.contains(m)) return;
    registerDelegatedContainer(m, ownerRoot);
    return () => unregisterDelegatedContainer(m, ownerRoot);
  }, {
    ssrSource: "client"
  });
  if (sharedConfig2.hydrating) return createMemo2(() => treeMarker, {
    ssrSource: "client",
    loadingValue: void 0
  });
  return treeMarker;
}

// ../rx-store-proto-features/ref/compile/rt-web.ts
var readWhole = (v) => {
  if (v !== null && typeof v === "object") Reflect.ownKeys(v);
  return v;
};
var readCopy = (v) => v === null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(readCopy) : Object.fromEntries(Object.keys(v).map((k) => [k, readCopy(v[k])]));
var latestWhole = (v) => v !== null && typeof v === "object" && v[$TARGET] !== void 0 ? readCopy(v) : v;
var sameInput = (a, b) => {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const pa = Object.getPrototypeOf(a), plain = (p) => p === Object.prototype || p === null || p === Array.prototype;
  if (pa !== Object.getPrototypeOf(b) || !plain(pa)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameInput(a[k], b[k]));
};
var ERR = { toString: () => "#error" };
var PENDING_MARK = { toString: () => "#pending" };
var fmt = (v0) => fmt0(out(v0));
var fmt0 = (v) => v === ERR ? "#error" : v === PENDING_MARK ? "#pending" : v === void 0 ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
var raw2 = raw;
var isNode = (v) => typeof v === "function" || typeof v === "object" && v !== null && "nodeType" in v;
var isView = (v) => isNode(v) || Array.isArray(v) && (v.length === 0 || v.every((x) => x == null || typeof x === "string" || isView(x)) && v.some((x) => x != null && typeof x !== "string"));
function errorClass(name, params, message, id2) {
  const C = class extends Error {
    constructor(...args) {
      super("");
      this.name = name;
      params.forEach((p, i) => {
        this[p] = args[i];
      });
      this.message = String(untrack(() => message(...args)));
      if (id2) this.$class = id2;
    }
  };
  Object.defineProperty(C, "name", { value: name });
  Object.defineProperty(C, "declared", { value: true });
  const f = ((...args) => new C(...args));
  f.cls = C;
  f.errorClass = name;
  f.$class = id2;
  return f;
}
var PANIC = { panic: true };
var isA = (err, classes) => !classes || classes.includes(PANIC) || classes.some((c) => {
  const k = c?.cls ?? c;
  if (typeof k !== "function") return false;
  if (err instanceof k) return true;
  const id2 = c.$class;
  if (id2 && err && typeof err === "object" && err.$class === id2) {
    Object.setPrototypeOf(err, k.prototype);
    return true;
  }
  return false;
});
function catchAcc(f, match, alt) {
  const acc = untrack(() => createErrorBoundary2(() => readWhole(f()), (err) => new Fallback(() => {
    const e0 = err();
    return match(e0) ? alt(e0) : new Forward(e0);
  })));
  return () => unwrapFallback(acc());
}
function tryCatch(f, match, alt) {
  try {
    return f();
  } catch (err) {
    if (err instanceof NotReadyError || !match(err)) throw err;
    return alt(err);
  }
}
function catchRead(f, match, alt) {
  return getObserver() ? catchAcc(f, match, alt)() : tryCatch(f, match, alt);
}
var Fallback = class {
  get;
  constructor(g) {
    this.get = g;
  }
};
function unwrapFallback(v0) {
  let v = v0;
  if (v instanceof Fallback) v = v.get();
  if (v instanceof Forward) throw v.err;
  return v;
}
var NO_PROVISION = {};
var Forward = class {
  err;
  constructor(e) {
    this.err = e;
  }
};
function wireCopy(v, where, fail) {
  if (v === null || v === void 0 || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x, i) => wireCopy(x, `${where}[${i}]`, fail));
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const o = {};
      for (const k of Object.keys(v)) o[k] = wireCopy(v[k], `${where}.${k}`, fail);
      return o;
    }
  }
  return fail(`${where} is ${typeof v === "function" ? "a function" : `an instance of ${v.constructor?.name ?? "a class"}`}, which the wire cannot carry: send data`);
}
var wireFailure = (err) => err instanceof Error && err.constructor.declared ? err : new Error("Internal Server Error");
var Flight = class {
  key;
  first;
  settleFirst;
  rejectFirst;
  queue = [];
  waiters = [];
  started = false;
  constructor(key) {
    this.key = key;
    this.first = new Promise((r, j) => {
      this.settleFirst = r;
      this.rejectFirst = j;
    });
    this.first.catch(() => {
    });
  }
  push(x) {
    const w = this.waiters.shift();
    if (w) w(x);
    else this.queue.push(x);
  }
  resolve(v) {
    if (!this.started) {
      this.started = true;
      this.settleFirst(v);
    }
    this.push({ v });
  }
  reject(e) {
    if (!this.started) {
      this.started = true;
      this.rejectFirst(e);
    }
    this.push({ e });
  }
  [Symbol.asyncIterator]() {
    const next = () => new Promise((res, rej) => {
      const take = (x) => {
        if ("e" in x) rej(x.e);
        else res({ value: x.v, done: false });
      };
      const q = this.queue.shift();
      if (q) take(q);
      else this.waiters.push(take);
    });
    return { next, return: async () => ({ value: void 0, done: true }) };
  }
};
function createApp(opts) {
  const flights = /* @__PURE__ */ new Map();
  const lastKey = /* @__PURE__ */ new Map();
  const truthOf = /* @__PURE__ */ new Map();
  const registry = /* @__PURE__ */ new Map();
  const contexts = /* @__PURE__ */ new Map();
  const storeAccs = /* @__PURE__ */ new WeakSet();
  const modules = /* @__PURE__ */ new Map();
  const hoistedBy = /* @__PURE__ */ new Map();
  const hoistedOf = /* @__PURE__ */ new WeakMap();
  const log = [];
  let currentEq = null;
  let serverSeq = 0;
  let classSeq = 0;
  const jsErrors = /* @__PURE__ */ new Map();
  const tracing2 = () => {
    let ran = false;
    new Promise(() => {
      ran = true;
    });
    return !ran;
  };
  const flight = (key) => {
    if (tracing2()) return new Flight(key);
    let f = flights.get(key);
    if (!f) {
      f = new Flight(key);
      flights.set(key, f);
    }
    if (currentEq) lastKey.set(currentEq, key);
    return f;
  };
  const named = (name, fn) => name ? ((...a) => {
    const was = currentEq;
    currentEq = name;
    try {
      return fn(...a);
    } finally {
      currentEq = was;
    }
  }) : fn;
  const app2 = {
    root: opts.root,
    log,
    flights,
    lastKey,
    asyncError: null,
    /** Mount `view` on the root: build it, or (SV-3) adopt the page the server streamed into it. */
    mount(view, hydrating = false) {
      return hydrating ? hydrate(view, app2.root) : render(view, app2.root);
    },
    // the prelude: what `import pure { … } from "./prelude"` and the built-in names refer to
    B: {
      ...B,
      str: (x) => fmt(x),
      fail: (msg) => {
        throw Object.assign(new Error(msg), { panic: true });
      },
      // R-f-3: a JS throw — a panic, not in the failure row
      fetch: (key) => opts.api?.fetch ? opts.api.fetch(key) : flight(String(key)),
      log: (...a) => {
        log.push(`log(${a.map(fmt).join(", ")})`);
      }
    },
    /** `import pure { f } from "./api"`: every function is a flight keyed by its name and formatted arguments. */
    /** MO-8: a class `api.d.rx` declares as an error: the real module's, or (in the harness) a stand-in `C(message)`. */
    jsError: (name) => jsErrors.get(name) ?? (jsErrors.set(name, opts.api?.[name] ?? errorClass(name, ["message"], (m) => m ?? name, `${name}#${classSeq++}`)), jsErrors.get(name)),
    api: (name) => opts.api ? opts.api[name] ?? (() => {
      throw new Error(`./api has no ${name}`);
    }) : (...a) => flight(`${name}:${a.map(fmt).join(",")}`),
    /** MO-10: the scenario prelude's `./prims` — Solid primitives, as a library writes them (`ref/compile/prims-solid.ts`). */
    prim: (name) => primsSolid({ createSignal: createSignal2, createMemo: createMemo2 })[name] ?? (() => {
      throw new Error(`./prims has no ${name}`);
    }),
    // ---- the scenario harness's view of names (handler rows reach any live binding by name) ----
    reg(name, e) {
      let l = registry.get(name);
      if (!l) registry.set(name, l = []);
      l.push(e);
      const h = hoistedBy.get(name);
      if (h && e.get) {
        hoistedOf.set(e.get, h);
        hoistedBy.delete(name);
      }
    },
    lookup(name) {
      const l = registry.get(name);
      if (!l?.length) throw new Error(`unbound ${name}`);
      for (let i = l.length - 1; i >= 0; i--) if (l[i].w) return l[i];
      return l[l.length - 1];
    },
    dget(name, live = false) {
      const e = app2.lookup(name);
      return e.get ? live ? e.get() : app2.snapshot(e.get) : e.value;
    },
    // live: inside a probe (R-12), the read itself
    dset(name, keys, v, guess = false) {
      const w = app2.lookup(name).w;
      if (!w) throw new Error(`W-1: write to non-source ${name}`);
      if (guess) w.guess(v, keys);
      else if (keys.length) w.path(keys, v);
      else w.set(v);
    },
    // ---- declarations ----
    /** `source x := e`: atomic → a signal; structured → a store behind a signal slot, so the root can be replaced (ST-1, ST-2a). */
    /** With a guess written to it (AC-3), the writable is the truth and an optimistic layer derives from it: plain writes
     *  go to the truth, guesses to the layer, and each guess ends when its action's hold commits, showing the truth then. */
    source(name, init, guessed2 = false) {
      void name;
      if (false) {
        const [store, setStore] = createStore2(init);
        const [get3, set3] = createSignal2(store);
        const H = handleOf(store);
        get3.h = () => {
          const v = get3();
          return v === store ? H : v;
        };
        const w = {
          set: (v) => {
            if (typeof v === "function") {
              setStore(v);
              set3(store);
            } else if (typeof v === "object" && v !== null) {
              setStore(() => v);
              set3(store);
            } else set3(v);
          },
          path: pathWrite(setStore, H),
          guess: () => {
            throw new Error("a guess on a := source that the compiler did not mark as guessed");
          }
        };
        if (false) {
          const [view, setView] = createOptimisticStore2(() => get3(), Array.isArray(init) ? [] : {});
          const acc = () => view;
          storeAccs.add(acc);
          const VH = handleOf(view);
          acc.h = () => VH;
          return [acc, { ...w, guess: guessInto(setView, VH) }];
        }
        return [get3, w];
      }
      const [get2, set2] = createSignal2(init);
      if (guessed2) {
        const [view, setGuess] = createOptimistic2(() => get2());
        return [view, { set: set2, path: () => {
          throw new Error("a path write to an atomic source");
        }, guess: setGuess }];
      }
      return [get2, { set: set2, path: () => {
        throw new Error("a path write to an atomic source");
      }, guess: () => {
        throw new Error("a guess on a := source that the compiler did not mark as guessed");
      } }];
    },
    /** `source x = e` (ST-5): createSignal(fn); with a guess written to it, a createOptimistic layer over that truth (AC-3);
     *  written or probed by path, createStore(fn, {}) whose derive writes its draft. */
    question(name, compute, opts2, mode, key) {
      const fn = named(name, compute);
      const derive = (draft) => {
        const r = fn(draft);
        if (r instanceof Flight || r instanceof Promise) return (async () => landDraft(draft, r instanceof Flight ? await r.first : await r, key))();
        return landDraft(draft, r, key);
      };
      const seed = () => key && !mode.record ? [] : {};
      if (false) {
        const [truth2, setTruth] = createStore2(derive, seed(), key ? { key } : void 0);
        const tacc = () => truth2;
        storeAccs.add(tacc);
        const [view, setView] = createOptimisticStore2(() => truth2, seed(), key ? { key } : void 0);
        const get3 = () => view;
        storeAccs.add(get3);
        truthOf.set(get3, tacc);
        return [get3, { set: (v) => setTruth((d) => typeof v === "function" ? v(d) : v), path: pathWrite(setTruth, handleOf(truth2)), guess: guessInto(setView, handleOf(view)) }];
      }
      if (false) {
        const [store, setStore] = createOptimisticStore2(derive, seed(), key ? { key } : void 0);
        const get3 = () => store;
        storeAccs.add(get3);
        const plain = () => {
          throw new Error("a plain write to an equation");
        };
        return [get3, { set: plain, path: plain, guess: guessInto(setStore, handleOf(store)) }];
      }
      if (mode.optimistic && mode.derived) {
        const plain = () => {
          throw new Error("a plain write to an equation");
        };
        const [get3, setGuess] = createOptimistic2(fn, opts2);
        return [get3, { set: plain, path: plain, guess: setGuess }];
      }
      if (mode.optimistic) {
        const [truth2, setTruth] = createSignal2(fn, opts2);
        const [get3, setGuess] = createOptimistic2(() => truth2());
        truthOf.set(get3, truth2);
        return [get3, { set: setTruth, path: () => {
          throw new Error("optimistic path writes are not lowered yet");
        }, guess: setGuess }];
      }
      if (false) {
        const [store, setStore] = createStore2(async (draft) => {
          const r = fn(draft);
          const v = r instanceof Flight ? await r.first : await r;
          if (v && typeof v === "object") {
            for (const k of Object.keys(draft)) if (!(k in v)) delete draft[k];
            Object.assign(draft, v);
          }
        }, {});
        const get3 = () => store;
        storeAccs.add(get3);
        return [get3, { set: () => {
          throw new Error("a root write to a derived store is not lowered yet");
        }, path: (keys, v) => setStore((d) => {
          let o = d;
          for (const k of keys.slice(0, -1)) o = o[k];
          o[keys[keys.length - 1]] = v;
        }), guess: () => {
          throw new Error("optimistic over a structured question source is not lowered yet");
        } }];
      }
      const [get2, set2] = createSignal2(fn, opts2);
      return [get2, { set: set2, path: () => {
        throw new Error("a path write to an atomic source");
      }, guess: () => {
        throw new Error("GUESS_NO_QUESTION");
      } }];
    },
    memo: (name, fn, opts2) => createMemo2(named(name, fn), opts2),
    deferred: (name, fn, opts2) => createDeferred2(named(name, fn), opts2),
    /** `x key k = e` (ST-4): a keyed projection. */
    keyed: true ? void 0 : (name, key, fn, record2 = false) => {
      const src = createMemo2(named(name, () => fn()));
      const p = createProjection2(() => src(), record2 ? {} : [], { key });
      const acc = () => p;
      truthOf.set(acc, src);
      return acc;
    },
    // AC-4: `refresh rows` re-asks the memo under the projection   // the answer is a memo (sync, or the tail await's); the projection reconciles it by key
    /** `x = draft(pre x -> seed) { … }` (ST-3). */
    draft: true ? void 0 : (seed, body) => {
      const p = createProjection2(body, seed);
      const H = handleOf(p);
      const acc = () => p;
      acc.h = () => H;
      return acc;
    },
    /** `pre y` of another node (C-2): a companion memo carrying (current, previous), owned where `y` is declared. */
    pre: (get2) => {
      const m = createMemo2((st) => ({ cur: get2(), prev: st ? st.cur : void 0 }));
      return () => m().prev;
    },
    firstPaint: (f) => ({ loadingValue: untrack(f) }),
    /** `effect (…) { … }`: compute, then apply; fires on a differing value (EF-2); an input that failed doesn't fire it (EF-2a: the failure shows where it's read), and the next answer does; a store enters whole, as a snapshot. */
    effect(n, inputs, apply) {
      const run = (vals) => {
        const r = apply(vals);
        return typeof r === "function" ? r : void 0;
      };
      let last = null;
      createEffect2((() => inputs().map(latestWhole)), { effect: (vals) => {
        if (last && last.length === vals.length && vals.every((v, i) => sameInput(v, last[i]))) return;
        last = vals;
        return run(vals);
      }, error: () => {
        last = null;
      } });
    },
    /** `action f(…) { … }` (AC-1): a generator; a statement-level `await` is a hold-safe yield. */
    action(gen) {
      const run = action(gen);
      return (...a) => {
        const p = run(...a);
        p.catch((e) => {
          app2.asyncError = e;
        });
        return p;
      };
    },
    awaited: (v) => v instanceof Flight ? v.first : v,
    /** `x = await f() catch (e: C) => alt` (R-f-4): a matching rejection lands `alt` as the answer; others reject on. */
    settle: (p, match, alt) => p && typeof p.then === "function" ? p.then((v) => v, (err) => {
      if (match(err)) return alt(err);
      throw err;
    }) : p,
    /** RG-8: Solid's Portal — client-only: the server renders nothing for it, the browser renders it once it has the page. */
    Portal,
    /** CSS-2: a dynamic class with the view's scope class after it. */
    scopedClass: (v, hash) => v == null || v === false || v === "" ? hash : `${v} ${hash}`,
    /** SV-7b: a client question — not asked on the server; the browser asks it once hydrated (Solid's \`ssrSource: "client"\`). */
    clientQuestion: (o) => ({ ...o ?? {}, ssrSource: "client" }),
    /** 12 SF-2: a server fn as the client calls it — every call a flight. Asked in reactive scope it is a question, one
     *  flight per arguments, as a JS import's; in imperative scope each call is a new request. \`fn\` is the module-level
     *  \`"use server"\` function (SF-7a): the body in place, or — once Solid's \`transformDirectives\` has made it a reference
     *  — a request to the server. */
    serverRef(name, fn) {
      return (...args) => {
        const key = `${name}:${args.map(fmt).join(",")}`;
        const question2 = !!getObserver();
        if (question2 && flights.has(key)) return flights.get(key);
        const fl = question2 ? flight(key) : new Flight(`${key}#${serverSeq++}`);
        globalThis.__rx_app = app2;
        let p;
        try {
          p = Promise.resolve(fn(...args));
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then((v) => fl.resolve(v), (e) => fl.reject(e));
        return fl;
      };
    },
    /** SF-6: a server fn's body (a generator, as an action's), driven by promises — not by an action: it is no change of
     *  the client's — behind a wire that copies arguments and result and lets only declared failures through. */
    serverCall(name, gen, args) {
      return new Promise((resolve2, reject) => {
        const fail = (msg) => {
          throw new Error(`WIRE_VALUE: ${name}: ${msg}`);
        };
        let g;
        try {
          g = gen(...args.map((a, i) => wireCopy(a, `argument ${i + 1}`, fail)));
        } catch (e) {
          reject(e);
          return;
        }
        const step = (input, thrown) => {
          const was = currentEq;
          currentEq = null;
          let r;
          try {
            r = untrack(() => thrown ? g.throw(input) : g.next(input));
          } catch (e) {
            reject(wireFailure(e));
            return;
          } finally {
            currentEq = was;
          }
          if (r.done) {
            try {
              resolve2(wireCopy(r.value, "its result", fail));
            } catch (e) {
              reject(e);
            }
            return;
          }
          Promise.resolve(r.value).then((v) => step(v, false), (e) => step(e, true));
        };
        step(void 0, false);
      });
    },
    hoisted(name, get2) {
      let l = hoistedBy.get(name);
      if (!l) hoistedBy.set(name, l = []);
      l.push(get2);
    },
    until: (p) => until(p),
    // AC-6
    onSettled: (f) => onSettled(f),
    // EF-7
    onFlush: (f) => onFlush(f),
    // EF-8
    refresh(name, get2) {
      const key = lastKey.get(name);
      if (key) flights.delete(key);
      for (const h of hoistedOf.get(get2) ?? []) refresh(h);
      const t = truthOf.get(get2) ?? get2;
      refresh(storeAccs.has(t) ? t() : t);
    },
    affects: (get2) => affects(storeAccs.has(get2) ? get2() : get2),
    // a structured source's accessor wraps its store: Solid takes the store (#50), as `refresh` above
    preOr: (v, init) => v === void 0 ? init() : v,
    // ---- modules (09 MO-1): a dependency's factory runs once per app; its exports are shared by every importer ----
    module(key, factory) {
      let m = modules.get(key);
      if (!m) {
        m = factory(app2);
        modules.set(key, m);
      }
      return m;
    },
    // ---- context (RG-7) ----
    owner: () => getOwner(),
    /** `context x: T = d` (RG-7): the declaration is the identity; `d`, if any, is evaluated once, owned where it is declared. */
    /** `context x: T = d` (RG-7): the declaration is the identity (a sentinel default: absence is ours to decide); `d` is
     *  evaluated once, owned where it is declared — created now, so it takes its id there on both sides (SV-3). */
    context(name, dflt) {
      return { name, ctx: createContext2(NO_PROVISION, name), dflt, owner: getOwner(), dv: dflt ? { get: createMemo2(dflt) } : null };
    },
    provide(c, e) {
      setContext(c.ctx, e);
    },
    use(c, owner) {
      const e = getContext(c.ctx, owner ?? void 0);
      if (e && e !== NO_PROVISION) return e;
      if (c.dv) return c.dv;
      throw new Error(`RG-7b: no provision for ${c.name}`);
    },
    useGet(c, owner) {
      const e = app2.use(c, owner);
      return e.get ? e.get() : e.value;
    },
    runWithOwner,
    // ---- reads ----
    /** An imperative read sees σ (H-10): a pending value is a value; a snapshot of an error throws it (R-f-7). */
    snapshot(get2) {
      try {
        return untrack(get2);
      } catch (e) {
        if (e instanceof NotReadyError) return PENDING_MARK;
        throw e;
      }
    },
    // ---- failures (R-f) ----
    errorClass: (name, params, message) => errorClass(name, params, message, `${name}#${classSeq++}`),
    // a declaration's identity: the same on both sides (SV-5a)
    isA,
    PANIC,
    catchMemo: catchAcc,
    tryCatch,
    catchRead,
    throw: (e) => {
      throw e;
    },
    eq: (a, b) => raw2(a) === raw2(b),
    get,
    val,
    out,
    hacc,
    untrack,
    omit,
    latest: (f) => latest(() => latestWhole(f())),
    isPending: (f) => isPending(() => readWhole(f())),
    fmt,
    // ---- views: compiled JSX (compile/jsx.ts, generate "dom") does the rest ----
    show: (v) => isT(v) ? fmt(v) : isView(v) ? v : fmt(v),
    /** `errored fallback(e: A | B)`: a failure of another class passes to the boundary above (R-f-4) — the fallback hands it out
     *  and a memo throws it there (a rethrow from the fallback itself did not recover until solidjs/solid#4277: ref/oracle/repros/dv7-rethrow.mjs). */
    TypedErrored(props) {
      const classes = props.classes;
      const out2 = createComponent(Errored, {
        fallback: (err) => {
          const owner = getOwner();
          const ok = createMemo2(() => isA(err(), classes));
          let shown = null;
          return new Fallback(() => ok() ? shown ??= runWithOwner(owner, () => props.fallback(err)) : new Forward(err()));
        },
        get children() {
          return props.children;
        }
      });
      return createMemo2(() => unwrapFallback(typeof out2 === "function" ? out2() : out2));
    }
  };
  return app2;
}
function landDraft(draft, v, key) {
  if (key && v && typeof v === "object") return v;
  assignDraft(draft, v);
  return void 0;
}
function assignDraft(draft, v) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(draft) && Array.isArray(v)) {
    draft.length = v.length;
    v.forEach((x, i) => {
      draft[i] = x;
    });
    return;
  }
  for (const k of Object.keys(draft)) if (!(k in v)) delete draft[k];
  Object.assign(draft, v);
}

// rt/tmp/features-counter-manifest/main.mjs
var _tmpl$ = /* @__PURE__ */ template(`<button>`);
function main(__rt) {
  const __B = __rt.B;
  return () => {
    const __o = __rt.owner();
    function V$App(v$props) {
      const __o2 = __rt.owner();
      const [v$n, w$n] = __rt.source("n", __rt.untrack(() => 0));
      __rt.reg("n", {
        get: v$n,
        w: w$n
      });
      const h$n = __rt.hacc(v$n);
      return (() => {
        var _el$ = getNextElement(_tmpl$);
        _el$._$$click = () => {
          w$n.set(__rt.snapshot(h$n) + 1);
        };
        insert(_el$, scope(() => {
          return __rt.show(h$n());
        }));
        runHydrationEvents();
        return _el$;
      })();
    }
    return createComponent(V$App, { children: [] });
  };
}
delegateEvents(["click"]);

// rt/tmp/features-counter-manifest/api.mjs
var api_exports = {};
__export(api_exports, {
  buildDeep: () => buildDeep,
  buildRows: () => buildRows,
  loadRows: () => loadRows,
  save: () => save,
  swapRows: () => swapRows
});
var id = 0;
var buildRows = (n) => Array.from({ length: n }, () => ({ id: ++id, label: "row " + id, n: id }));
var swapRows = (rs) => {
  const a = Array.from(rs);
  if (a.length > 3) {
    const t = a[1];
    a[1] = a[a.length - 2];
    a[a.length - 2] = t;
  }
  return a;
};
var buildDeep = (n) => Array.from({ length: n }, (_, i) => ({ id: i, a: { b: { c: "c" + i } } }));
var save = (t) => new Promise((r) => setTimeout(() => r(t), 100));
var loadRows = (p) => new Promise((r) => setTimeout(() => r(buildRows(10)), 100));

// rt/tmp/features-counter-manifest/entry.mjs
var app = createApp({ root: document.getElementById("app"), api: api_exports });
app.mount(main(app));
