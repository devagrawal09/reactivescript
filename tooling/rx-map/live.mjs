// @reactivescript/map/live: the map beside a running dev build. Browser only.
//
// A dev build's entry module calls `register(graph)` (the Vite front end adds the call). That sets
// `globalThis.__RX__ = { graphs, mount }`; a host (the devtools' Map view) calls `mount(el)` to draw the map of every
// registered program in an iframe and light it as Solid's flushes change the nodes the build named `rx:<key>`.
//
// The recorder belongs to the app session, not to a particular map iframe.
import { pageHTML } from "./page.mjs";
import { LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE, LIVE_TRACE } from "./live-protocol.mjs";
import { planHmr, keyParts } from "./hmr.mjs";

const SOURCE = "rx-map";
const RX = "rx:";
const probeOwners = new WeakSet();
const probeNode = node => !!node && (probeOwners.has(node._owner) || probeOwners.has(node._parent));
const message = msg => ({ source: SOURCE, v: 1, ...msg });
const graphs = [];
const mounts = new Set();
const bridges = new Map();
const entries = new Map();
let replacements = Promise.resolve();
let localEdit = 0;
const hmrFlights = new WeakMap();
let recording;
// Resolve before the entry calls register: its first render can start flights
// in the same turn, before a lazy attribution import would finish.
const engine = await Promise.all([import("solid-js"), import("solid-js/attribution")]).catch(() => []);
// Previews read app state from wherever the bridge runs (an action's click handler, a flush record): untrack, so
// Solid's strict-read check (STRICT_READ_UNTRACKED) doesn't count the bridge's reads as the app's; no owner, so
// nothing the read makes is owned by the app's scope.
const untracked = fn => {
  const solid = engine[0];
  const run = solid?.untrack ? () => solid.untrack(fn) : fn;
  return solid?.runWithOwner ? solid.runWithOwner(null, run) : run();
};
const errorPreview = error => untracked(() => preview(error, 200));
function previews(value) {
  const out = { preview: preview(value) };
  if (value !== null && typeof value === "object" && !(value instanceof Error)) {
    const full = preview(value, 2000, 4);
    if (full.length > out.preview.length) out.full = full;
  }
  return out;
}
function inspect(key, format = previews) {
  const entries = globalThis.__RX_NODES__?.get(key);
  if (!entries?.size) return;
  try { return [...entries].at(-1)(format); } catch { /* instrumentation is best effort */ }
}

// The compiled RX default export is an app factory, not a Solid component export.
// Keep the JS importer and its root alive; replace the view inside that root.
export function hotEntry(payload, factory, hot) {
  const replacement = { ...payload, factory, hot };
  const graph = payload.graph ?? payload.update.graph;
  const entry = graph.modules.at(-1);
  let state = entries.get(entry);
  if (!state) {
    const solid = engine[0];
    const [code, replace] = solid.createSignal({ factory });
    state = { revision: payload.revision, graph, replace,
      main: rt => () => solid.createMemo(() => {
        const { factory } = code();
        return solid.untrack(() => factory(rt)());
      }, { transparent: true, _plumbing: true }) };
    entries.set(entry, state);
    register(graph, { hot });
  }
  function accept(next) {
    replacements = replacements.then(async () => {
      const recorder = getRecorder();
      if (!next) {
        if (state.announced) recorder.hmr({ phase: "failed", id: state.announced.id, error: "replacement module did not load", fallback: "none" });
        state.announced = null;
        return;
      }
      const graph = next.graph ?? next.update.graph;
      const { from, to, ...base } = next.update ?? {};
      const plan = from === state.revision ? base.plan : planHmr(state.graph, graph);
      const edit = { phase: "plan", id: base.id ?? `client-${++localEdit}`, modules: base.modules ?? [entry], graph, plan };
      if (state.announced?.id !== edit.id || from !== state.revision) recorder.hmr(edit);
      state.announced = null;
      await recorder.replaceModule(edit, () => state.replace({ factory: next.factory }), () => {
        state.revision = next.revision;
        state.graph = graph;
        register(graph, { hot: next.hot, replacement: true });
      });
    }).catch(e => console.error("[rx-map] replacement failed:", e));
  }
  return { main: state.main, replacement, accept };
}

/** Adds a program's graph (from `@reactivescript/map/graph`'s `buildGraph`). Re-registering its entry replaces it. */
export function register(graph, { hot, replacement = false } = {}) {
  getRecorder();
  if (hot) connect(hot);
  // Models are dependency-first: shared imports do not identify the entry.
  const entry = graph?.modules?.at(-1);
  const i = graphs.findIndex(g => g.modules?.at(-1) === entry);
  if (i >= 0) {
    graphs[i] = graph;
  } else graphs.push(graph);
  const rx = (globalThis.__RX__ ??= {});
  rx.graphs = graphs;
  rx.mount = mount;
  rx.attach = attach;
  // Attached maps get the graph from the plan/apply messages. Don't reload
  // their iframe between apply and done.
  if (!replacement) for (const m of mounts) m.load();
}

// A view's message (TRACE-CONTRACT §3). Answers to `hello` and `snapshot?` go to the asker; `step`, `resume` and
// `travel-denied` go to every view, since they all show the one app.
function receiveFromView(data, reply) {
  const recorder = getRecorder();
  if (data.type === "hello") {
    reply(recorder.snapshot());
    reply(recorder.timeline(wantsInternals(data)));
  } else if (data.type === "snapshot?") reply(recorder.snapshot());
  else if (data.type === "travel") recorder.travel(data.to);
  else if (data.type === "resume") recorder.resume();
}
const wantsInternals = data => Array.isArray(data.want) && data.want.includes("internals");

/**
 * A view without the map page: `listener` gets every host message (`{source: "rx-map", v: 1, ...}`) and `post` takes
 * view messages, as the map's iframe would send them. For tests and other tools in the app's window.
 */
export function attach(listener) {
  const recorder = getRecorder();
  let internals = false;
  const deliver = (msg, raw) => listener(internals && raw ? raw : msg);
  recorder.listeners.add(deliver);
  return {
    post(msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hello") internals = wantsInternals(msg);
      receiveFromView(msg, deliver);
    },
    detach() { recorder.listeners.delete(deliver); },
  };
}

/** Draws the map into `el`, live. Returns the dispose. */
export function mount(el) {
  const iframe = document.createElement("iframe");
  iframe.title = "rx-map";
  iframe.style.cssText = "display:block;width:100%;height:100%;border:0";
  el.setAttribute("data-rx-map", ""); // input here stays live while the app is read-only (viewing)
  let ready = false, internals = false;
  const post = msg => {
    if (msg && ready && iframe.contentWindow) iframe.contentWindow.postMessage(msg, "*");
  };
  const forward = (msg, raw) => post(internals && raw ? raw : msg);
  const receive = ({ source, data }) => {
    if (source !== iframe.contentWindow || data?.source !== SOURCE || data.v !== 1) return;
    if (data.type === "hello") {
      ready = true;
      internals = wantsInternals(data);
    }
    receiveFromView(data, post);
  };
  window.addEventListener("message", receive);
  const m = {
    load() {
      ready = false;
      iframe.srcdoc = pageHTML(mergeGraphs(graphs), { live: true });
    },
  };
  m.load();
  el.append(iframe);
  mounts.add(m);
  getRecorder().listeners.add(forward);
  return () => {
    if (!mounts.delete(m)) return;
    recording?.listeners.delete(forward);
    window.removeEventListener("message", receive);
    iframe.remove();
  };
}

function connect(hot) {
  if (bridges.has(hot)) return;
  const recorder = getRecorder();
  const request = ({ id, method, params } = {}) => {
    try { hot.send(LIVE_RESPONSE, { id, result: recorder.query(method, params) }); }
    catch (e) { hot.send(LIVE_RESPONSE, { id, error: e.message }); }
  };
  const ready = () => hot.send(LIVE_READY);
  bridges.set(hot, request);
  hot.on(LIVE_REQUEST, request);
  const onPlan = ({ from, to, type, ...edit }) => {
    const state = entries.get(edit.graph.modules.at(-1));
    if (state?.revision !== from || state.announced?.id === edit.id) return; // a behind tab replans when it receives the code
    state.announced = edit;
    recorder.hmr(edit);
  };
  const onError = ({ entry, id, error }) => {
    if (entries.has(entry)) recorder.hmr({ phase: "failed", id, error, fallback: "none" });
  };
  hot.on("rx:hmr:plan", onPlan);
  hot.on("rx:hmr:error", onError);
  const trace = record => hot.send(LIVE_TRACE, record);
  recorder.traces.add(trace);
  hot.on("vite:ws:connect", ready);
  const stop = () => {
    if (!bridges.delete(hot)) return;
    hot.off?.(LIVE_REQUEST, request);
    hot.off?.("rx:hmr:plan", onPlan);
    hot.off?.("rx:hmr:error", onError);
    recorder.traces.delete(trace);
    hot.off?.("vite:ws:connect", ready);
  };
  hot.dispose?.(stop);
  hot.prune?.(stop);
  ready();
}

function getRecorder() {
  if (recording) return recording;
  const size = 2000, ring = new Array(size), listeners = new Set(), traces = new Set();
  // The timeline: one step per flush, `capacity` of them (TRACE-CONTRACT §4). Beside each step, the engine nodes it
  // changed and what each showed before, which is what travel pins (Solid's openView).
  const capacity = Math.max(1, Math.floor(globalThis.__RX_TIMELINE_CAPACITY__ ?? 2000));
  let guessesNamed = false; // this Solid's records name the store properties a guess moved
  const steps = new Array(capacity), raws = new Array(capacity), guesses = new Array(capacity), internals = new Array(capacity);
  const carrierOnly = new Array(capacity), rewrites = new Array(capacity), carrierKeys = new Array(capacity);
  // Does this Solid's view read a list's unnoded keys (mapArray rows) through the pinned container (solid-view
  // 980f5b4c5)? Probed once, at the first travel; until then, and on an older Solid, wholesale rewrites are inexact.
  let listsThroughPin = null, guessedListsThroughPin = null, probing = false;
  let probingGuess = false;
  // A private list, prepended once and read through mapArray, then shown under a view at its first frame: with the
  // fix the view shows "a", without it the present "b". Synchronous, outside any flush (travel is called from a
  // message handler); its flushes are not history.
  function probeListPins(openView) {
    const s = engine[0], records = s?.OBSERVE?.records;
    if (!s?.createStore || !s.mapArray || !s.createRoot || !s.createRenderEffect || !records?.subscribe) return false;
    probing = true;
    let dispose, shown, off;
    const pins = new Map();
    try {
      off = records.subscribe("flush", (_e, live) => {
        for (const c of live?.changes ?? []) if (c.node && !pins.has(c.node)) pins.set(c.node, c.prev);
      }, { bodies: true });
      const [list, setList] = s.createStore([{ l: "a" }]);
      s.createRoot(d => {
        dispose = d;
        const rows = s.mapArray(() => list, r => () => (typeof r === "function" ? r() : r).l);
        s.createRenderEffect(() => rows().map(f => f()).join(","), v => { shown = v; });
      });
      s.flush();
      pins.clear();
      setList(l => [{ l: "b" }, ...l]);
      s.flush();
      if (shown !== "b,a") return false;
      const v = openView();
      try {
        v.show(pins);
        return shown === "a";
      } finally { v.resume(); }
    } catch { return false; }
    finally {
      off?.();
      try { dispose?.(); s.flush(); } catch {}
      probing = false;
    }
  }
  // 49b25a45c also rewinds a list an optimistic layer guessed over across an
  // await. Probe that separately: the plain-list fix shipped first.
  async function probeGuessedListPins(openView) {
    const s = engine[0];
    if (!s?.createOptimisticStore || !s.action) return false;
    let dispose, off, shown;
    const pins = new Map();
    try {
      let guess, write, release;
      const gate = new Promise(resolve => { release = resolve; });
      s.createRoot(d => {
        dispose = d;
        probeOwners.add(s.getOwner());
        const [truth, setTruth] = s.createStore([{ id: "a" }]);
        const [slot] = s.createSignal(truth);
        const [list, setList] = s.createOptimisticStore(() => slot(), []);
        const rows = s.mapArray(() => list, row => () => (typeof row === "function" ? row() : row).id);
        s.createRenderEffect(() => rows().map(f => f()).join(","), v => { shown = v; });
        write = () => setTruth(r => [{ id: "b" }, ...r]);
        guess = s.action(function* () {
          setList(r => r.filter(x => x.id !== "b"));
          yield gate;
          setTruth(r => r.filter(x => x.id !== "b"));
        });
      });
      s.flush();
      write();
      s.flush();
      if (shown !== "b,a") return false;
      off = s.OBSERVE.records.subscribe("flush", (_e, live) => {
        for (const c of live?.changes ?? [])
          if (probeNode(c.node) && !pins.has(c.node)) pins.set(c.node, c.prev);
      }, { bodies: true });
      const done = guess();
      s.flush();
      const guessed = shown === "a";
      release();
      await done;
      s.flush();
      if (!guessed || shown !== "a" || !pins.size) return false;
      const v = openView();
      try {
        v.show(pins);
        return shown === "b,a";
      } finally { v.resume(); }
    } catch { return false; }
    finally {
      off?.();
      try { dispose?.(); s.flush(); } catch {}
    }
  }
  const base = new Map(); // previews as of just before the oldest step kept
  const latest = new Map(), last = new Map(), flights = new Map(), runs = new Map(), boundaries = new Map();
  const activeErrors = new Map(), held = new Map(), writes = new Set(), dirty = new Set();
  const start = performance.now();
  let seq = 0, flushes = 0;
  // Travel: the open view, the seq it shows, and a resume whose landing waits on async work.
  let view = null, viewing = null, landing = null;
  let replacing = null;
  const reincarnations = new WeakMap();
  const sourceAt = key => {
    const entries = globalThis.__RX_NODES__?.get(key);
    return entries?.size === 1 ? entries.values().next().value : undefined;
  };
  function valueFrame(keys) {
    const out = new Map();
    for (const key of keys) {
      const entry = sourceAt(key);
      const shown = inspect(key);
      if (!shown) continue;
      const value = entry?.hmrValue?.();
      out.set(key, {
        entry, value,
        state: shown.error != null ? ERR + errorPreview(shown.error) : shown.value?.preview,
      });
    }
    return out;
  }
  const hmr = edit => send({ ...edit, type: "hmr", at: performance.now() });
  const sites = (graph, name) => graph.regions.filter(r => r.kind === "children" && r.name === name).map(r => r.key).sort().join("\n");
  async function replaceModule(edit, swap, installed) {
    const { id, graph, plan } = edit;
    const previous = graphs.find(g => g.modules.at(-1) === graph.modules.at(-1));
    const keys = new Set([...previous.nodes, ...graph.nodes].filter(n => n.key).map(n => n.key));
    // Don't seed from a historical view or a proposal currently hidden by a hold.
    if (view || queued !== null) resume();
    while (landing) await new Promise(resolve => setTimeout(resolve, 16));
    const solid = engine[0];
    solid.flush();
    const before = valueFrame(keys);
    const moved = new Map(plan.moved.map(({ from, to }) => [to, from]));
    const carry = new Map(), fallback = new Set();
    const nodeByKey = new Map(graph.nodes.map(n => [n.key, n]));
    const kept = new Set(plan.kept);
    for (const key of [...plan.kept, ...plan.rerun]) {
      const n = nodeByKey.get(key), from = moved.get(key) ?? key;
      if (n?.kind !== "source" || (!kept.has(key) && !n.question)) continue;
      const prior = before.get(from);
      if (!prior) continue;
      const scope = keyParts(key).scope;
      if (!prior.value || !Object.hasOwn(prior.value, "value") || prior.value.held
        || sites(previous, scope) !== sites(graph, scope)) fallback.add(key);
      else carry.set(key, {
        value: prior.value.value, question: n.question,
        keepAnswer: n.question && kept.has(key) && !graph.edges.some(e => e.to === n.id && e.type === "read" && e.mode === "tracked"),
      });
    }
    replacing = { id };
    hmr({ phase: "apply", id });
    globalThis.__RX_HMR__ = { carry };
    let transaction;
    try {
      // Same Solid seam as travel. There are no historical pins here: branch
      // closes the replacement hold and commits its new owners to live.
      transaction = engine[1]?.openView?.({ effects: true });
      swap();
      transaction?.branch();
      solid.flush();
      installed();
    } catch (e) {
      try { transaction?.resume(); } catch { /* the reload recovers the root */ }
      replacing = null;
      hmr({ phase: "failed", id, error: errorPreview(e), fallback: "reload" });
      globalThis.location.reload();
      return;
    } finally {
      delete globalThis.__RX_HMR__;
    }
    for (const [key, seed] of carry) if (!seed.used || !sourceAt(key)) fallback.add(key);
    // New flights will be recorded separately; give their landings the HMR origin.
    const after = valueFrame(keys);
    const changes = [], raw = [], inexact = new Set();
    for (const key of keys) {
      const old = before.get(key), next = after.get(key);
      const predecessor = before.get(moved.get(key) ?? key);
      if (predecessor?.entry?.node && next?.entry?.node && predecessor.entry.node !== next.entry.node) {
        reincarnations.set(predecessor.entry.node, next.entry.node);
        if (predecessor.value && Object.hasOwn(predecessor.value, "value") && (!next.entry.node._fn || next.entry.node._x?._q))
          raw.push({ node: next.entry.node, prev: predecessor.value.value });
      }
      // openView cannot pin a synchronous computation. A changed expression
      // can make new code disagree with an old step even with every input pinned.
      if ((nodeByKey.get(key)?.kind === "eq" && plan.reasons[key] === "expr-changed")
        || (old?.entry && !next?.entry?.node) || (!next?.entry && old?.state !== next?.state))
        inexact.add(key);
      if (old?.state === next?.state) continue;
      const change = { key, name: RX + key, ...locate(key), origin: `hmr ${id}` };
      if (old?.state !== undefined) old.state.startsWith(ERR) ? change.prevError = old.state.slice(ERR.length) : change.prev = old.state;
      if (next?.state !== undefined) next.state.startsWith(ERR) ? change.error = next.state.slice(ERR.length) : Object.assign(change, inspect(key)?.value);
      changes.push(change);
    }
    dirty.clear();
    replacing = null;
    // Start a timeline seam even if the edit only changed the view, not its values.
    addStep(performance.now(), changes, raw, [], false, `hmr ${id}`, [...inexact]);
    const changed = new Set([...plan.reset, ...plan.rerun, ...plan.added]);
    hmr({ phase: "done", id, changes: changes.filter(c => changed.has(c.key)),
      ...(fallback.size ? { fallback: "refresh", uncarried: [...fallback].sort() } : {}) });
    queueReconcile();
  }
  const shownLast = new WeakMap(); // engine node → the value last recorded for it (a landing's records say "pin")
  const locate = key => {
    for (const graph of graphs) {
      const n = graph.nodes.find(n => n.key === key);
      if (n) return { file: n.file, line: n.line };
    }
    return {};
  };
  const recent = (limit = size, since = 0) => {
    const records = [];
    for (let i = Math.max(0, since, seq - limit); i < seq; i++) records.push(ring[i % size]);
    return records;
  };
  const addRecord = (msg, internal) => {
    const { source, v, ...record } = msg;
    for (const trace of traces) trace(internal?.length ? { ...record, changes: [...record.changes, ...internal] } : { ...record });
    if (record.type === "flush" && !record.changes.length && !record.origin) return;
    record.seq = ++seq;
    ring[(seq - 1) % size] = record;
    return record;
  };
  const publish = (msg, raw) => { for (const post of listeners) post(msg && message(msg), raw && message(raw)); };
  const flightKeys = () => {
    const keys = new Map();
    for (const r of flights.values()) if (!keys.has(r.key) || keys.get(r.key).since > r.since) keys.set(r.key, r);
    return keys;
  };
  function heldBy(key) {
    const blocking = new Set(flightKeys().keys());
    const reached = new Set([key]);
    for (const g of graphs) {
      const keys = new Map(g.nodes.map(n => [n.id, n.key]));
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of g.edges) {
          const from = keys.get(e.from), to = keys.get(e.to);
          if (e.type === "read" && e.mode === "tracked" && reached.has(from) && to && !reached.has(to)) {
            reached.add(to); grew = true;
          }
        }
      }
    }
    return [...blocking].filter(k => reached.has(k));
  }
  function reconcileWrites(at) {
    for (const key of writes) {
      const now = inspect(key, () => undefined);
      const old = held.get(key);
      if (now?.held) {
        const by = heldBy(key);
        if (!old || by.join("|") !== old.by.join("|")) {
          held.set(key, { key, by, since: old?.since ?? at });
          send({ type: "held", key, by, at });
        }
      } else {
        if (held.delete(key)) send({ type: "released", key, at });
      }
    }
  }
  // A key touched by an instance being made or disposed, a flight, a write or an error: the timeline's state for it
  // must be the state of the instance alive now (a component-scoped key outlives its instances: a remounted
  // component's first answer is no engine change, and a disposed one's last value or error is not the app's).
  const headState = new Map(), registered = new Set();
  function reconcileErrors(changes) {
    const expected = new Map();
    for (const c of changes) if (c.key) expected.set(c.key, stateOf(c));
    for (const key of dirty) {
      // a name the RX registry never had (a named Solid node, an older runtime) is the engine record's alone
      if (!globalThis.__RX_NODES__?.has(key) && !registered.has(key)) continue;
      const now = currentState(key);
      const was = expected.has(key) ? expected.get(key) : headState.get(key);
      if (now?.startsWith(ERR)) activeErrors.set(key, now.slice(ERR.length));
      else activeErrors.delete(key);
      if (now === was) continue;
      if (now === undefined) changes.push({ key, name: RX + key });
      else if (now.startsWith(ERR)) changes.push({ key, name: RX + key, error: now.slice(ERR.length) });
      else changes.push({ key, name: RX + key, ...inspect(key).value });
    }
    dirty.clear();
    return changes;
  }
  const withInternals = (step, internal) => internal.length ? { ...step, changes: [...step.changes, ...internal] } : step;
  const publishStep = (step, internal) => publish({ type: "flush", ...step }, { type: "flush", ...withInternals(step, internal) });
  const addStep = (at, changes, raw, internal, quiet = false, origin, inexact = []) => {
    const i = flushes % capacity;
    // the step falling out of the ring folds into the base the others replay from
    if (flushes >= capacity) applyPreviews(base, steps[i].changes);
    const step = { seq: ++flushes, at, changes, ...(origin ? { origin } : {}) };
    steps[i] = step;
    raws[i] = raw;
    internals[i] = internal;
    // A store guess shows through the store's guess carrier (`<store>.$guess`). Solid with the store-guess record
    // (f9ee22ade) also lists the property and presence nodes it moved, which travel pins like any other; an older
    // Solid lists only the carrier, and pins can't take the store back past that guess.
    const carriers = changes.filter(c => c.key && c.name?.endsWith(".$guess")).map(c => c.key);
    const wasNamed = guessesNamed;
    for (const k of carriers) if (changes.some(c => c.key === k && c.path !== undefined && !c.name?.endsWith(".$guess"))) guessesNamed = true;
    // A list whose length changed with no index entry beside it was rewritten wholesale (`list := [x, ...list]`): Solid
    // lists only its container and length, and under a view a list's items still come from the store's backing
    // (openView known gap), so its rows can't be taken back past this step.
    const rowless = changes.filter(c => c.key && c.path === "length" && !changes.some(d => d.key === c.key && /^\d+(\.|$)/.test(d.path ?? ""))).map(c => c.key);
    guesses[i] = [...(guessesNamed ? [] : carriers), ...inexact];
    rewrites[i] = rowless;
    carrierKeys[i] = carriers;
    if (!wasNamed && guessesNamed) for (let s = oldest(); s < flushes; s++) {
      // (the first named guess tells this Solid apart: earlier carrier-only entries were not gaps)
      const j = (s - 1) % capacity;
      guesses[j] = (guesses[j] ?? []).filter(k => !carrierOnly[j]?.includes(k));
    }
    carrierOnly[i] = guessesNamed ? [] : carriers;
    applyPreviews(headState, changes);
    const record = addRecord({ type: "flush", at, changes, ...(origin ? { origin } : {}) }, internal);
    for (const c of changes) if (c.key) {
      if (c.preview !== undefined) latest.set(c.key, c);
      last.set(c.key, { change: c, record });
    }
    if (!quiet) publishStep(step, internal);
    return step;
  };
  const send = (msg, flightId, since, origin) => {
    if (msg.type === "flush") {
      // Under a view nothing the program does shows, and the view's own pins are not history.
      if (view || probing || replacing) return;
      if (landing) return void landing.records.push(msg);
      const raw = recordRaw(msg.raw);
      const all = reconcileErrors(msg.changes);
      const errors = new Map(all.filter(c => c.key && c.error !== undefined).map(c => [c.key, c]));
      const internal = all.filter(c => !c.key);
      const changes = all.filter(c => c.key && (!errors.has(c.key) || errors.get(c.key) === c)).map(({ before, ...c }) => {
        const prev = c.key && latest.has(c.key) ? latest.get(c.key).preview : before;
        return { ...c, ...locate(c.key), ...(prev !== undefined ? { prev } : {}) };
      });
      // Keyless engine nodes are still part of the app frame, even when
      // hidden from the map. Keep their raw bodies for openView.
      if (changes.length || internal.length || raw.length) addStep(msg.at, changes, raw, internal, false, msg.origin);
    } else if (msg.type === "flight") {
      const at = performance.now();
      const before = [...flights.values()].some(r => r.key === msg.key);
      if (msg.state === "start") flights.set(flightId, { key: msg.key, since: since ?? at, ...locate(msg.key) });
      else if (!flights.delete(flightId)) return;
      dirty.add(msg.key);
      const after = [...flights.values()].some(r => r.key === msg.key);
      if (before === after) return;
      addRecord({ ...msg, at, origin, ...locate(msg.key) });
      publish({ ...msg, at });
    } else {
      addRecord({ ...msg, ...locate(msg.key) });
      publish(msg);
    }
  };
  listen((msg, ...args) => {
    send(msg, ...args);
    queueReconcile();
  }, key => dirty.add(key), () => replacing && `hmr ${replacing.id}`);
  // The compiler supplies the resolved region ID. Keep graph path numbering (including #n)
  // in the graph builder, rather than deriving a second path by walking the JSX.
  const regionRefs = () => new Map(graphs.flatMap(g => g.regions
    .filter(r => r.kind === "loading" || r.kind === "errored")
    .map(r => [`${g.modules[r.mod]}|${r.id.split(":r").at(-1)}`, r.key])));
  function boundaryState(ref, region) {
    const instances = [...(globalThis.__RX_BOUNDARIES__?.get(ref) ?? [])];
    const active = instances.findLast(b => b.state !== "ok");
    return { region, state: active?.state ?? "ok", ...(active?.state === "error" ? { error: errorPreview(active.error) } : {}) };
  }
  function allBoundaries() {
    const states = [], hiddenBy = [];
    for (const [ref, key] of regionRefs()) {
      const b = boundaryState(ref, key);
      states.push(b);
      if (b.state !== "ok" && [...globalThis.__RX_BOUNDARIES__.get(ref)].every(x => x.state !== "ok"))
        hiddenBy.push(`${key}/`);
    }
    // Regions denote the boundary's content; its own fallback is outside
    // that region. A retained inner fallback is not displayed while an
    // enclosing boundary has swapped the content out.
    return states.map(b => hiddenBy.some(prefix => b.region.startsWith(prefix)) ? { region: b.region, state: "ok" } : b);
  }
  // Fallback cleanup can happen in the same turn as a replacement fallback mounts.
  let boundariesQueued = false;
  let reconcileQueued = false;
  const queueReconcile = () => {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      const at = performance.now();
      if (!view && !landing) reconcileWrites(at);
      send({ type: "flush", at, changes: [] });
    });
  };
  const trace = event => {
    if (event.type === "node") registered.add(event.key);
    if (event.type === "write" || event.type === "node") {
      if (event.type === "write") writes.add(event.key);
      dirty.add(event.key);
      queueReconcile();
      return;
    }
    if (event.type === "dispose") {
      for (const [id, f] of flights) if (f.key === event.key)
        send({ type: "flight", key: event.key, state: "abandon" }, id);
      latest.delete(event.key);
      activeErrors.delete(event.key);
      writes.delete(event.key);
      if (held.delete(event.key)) send({ type: "released", key: event.key, at: performance.now() });
      queueReconcile();
      return;
    }
    if (event.type === "boundary") {
      if (boundariesQueued) return;
      boundariesQueued = true;
      queueMicrotask(() => {
        boundariesQueued = false;
        if (globalThis.__RX_TRACE__ !== trace) return;
        for (const b of allBoundaries()) {
          const prev = boundaries.get(b.region);
          if ((prev?.state ?? "ok") === b.state && prev?.error === b.error) continue;
          boundaries.set(b.region, b);
          send({ type: "boundary", ...b, at: performance.now() });
        }
      });
      return;
    }
    const { type, key, id, state, args, error } = event;
    const at = performance.now();
    const msg = { type, key, id, state, at };
    if (state === "start") {
      msg.args = untracked(() => preview(args));
      runs.set(id, { key, id, since: at });
    } else {
      runs.delete(id);
      if (state === "error") msg.error = errorPreview(error);
    }
    send(msg);
    queueReconcile();
  };
  globalThis.__RX_TRACE__ = trace;
  function current(key, flight) {
    const now = inspect(key);
    if (now) return { key, ...now.value, ...(now.error ? { error: errorPreview(now.error) } : {}),
      pending: !!(!now.error && (flight || now.pending)), ...(!now.error && flight ? { since: flight.since } : {}), ...locate(key) };
    const old = latest.get(key);
    // Support named Solid nodes (and older RX runtimes), but never resurrect disposed registry nodes.
    const legacy = !globalThis.__RX_NODES__ && old;
    return { key, ...(!legacy && !flight ? { observation: "unobserved" } : {}), ...(legacy ? { preview: old.preview, full: old.full } : {}), pending: !!flight,
      ...(flight ? { since: flight.since } : {}), ...locate(key) };
  }
  function pending() {
    return states().filter(s => s.pending).map(({ key, since, file, line }) => ({ key, since, file, line }));
  }
  function states() {
    const flying = flightKeys(), keys = new Set([...flying.keys(), ...(globalThis.__RX_NODES__?.keys() ?? latest.keys())]);
    return [...keys].map(key => current(key, flying.get(key)));
  }
  function snapshot() {
    const all = states(), at = performance.now();
    return message({ type: "snapshot", at,
      values: all.filter(s => s.preview !== undefined || s.error || s.pending).map(({ key, preview, full, error, pending }) => ({
        key, preview, full, ...(error ? { error } : {}), ...(pending ? { pending: true } : {}) })),
      flights: all.filter(s => s.pending && s.since !== undefined).map(({ key, since }) => ({ key, since })),
      boundaries: allBoundaries(), runs: [...runs.values()], held: [...held.values()] });
  }
  function timeline(showInternals = false) {
    const history = [];
    for (let i = Math.max(0, flushes - capacity); i < flushes; i++) {
      const slot = i % capacity;
      history.push(showInternals ? withInternals(steps[slot], internals[slot]) : steps[slot]);
    }
    return message({ type: "timeline", head: flushes, viewing, steps: history, capacity });
  }

  // ---- time travel (TRACE-CONTRACT §2 "Time travel") ----------------------------------------------------------------
  // A step's raw changes are the engine's own (`flush` records with bodies): the node and what it showed before.
  // Showing seq n pins every node changed after n at what it showed before its first change after n; sync
  // derivations, render effects and the DOM re-derive from the pins (Solid's openView, #5089).
  function recordRaw(raw) {
    const out = [];
    for (const { node, prev, value } of raw ?? []) {
      out.push({ node, prev });
      shownLast.set(node, value);
    }
    return out;
  }
  const oldest = () => Math.max(1, flushes - capacity + 1);
  // Before a key's first recorded change, its value is that change's `prev` (TRACE-CONTRACT §4b).
  function valuesAt(n) {
    const m = new Map(base), seen = new Set(base.keys());
    for (let s = oldest(); s <= flushes; s++)
      for (const c of steps[(s - 1) % capacity].changes) {
        if (!c.key || seen.has(c.key)) continue;
        seen.add(c.key);
        if (c.prev !== undefined) m.set(c.key, c.prev);
      }
    for (let s = oldest(); s <= n; s++) applyPreviews(m, steps[(s - 1) % capacity].changes);
    return m;
  }
  // Keys travel can't show exactly at n: on a Solid whose records name only a store guess's carrier, a store guessed
  // after n (and what reads it). Once a guess's record has named its properties, this Solid has none.
  function inexactAt(n) {
    const roots = new Set();
    const guessedAfter = new Set();
    for (let s = n + 1; s <= flushes; s++) for (const k of carrierKeys[(s - 1) % capacity] ?? []) guessedAfter.add(k);
    for (let s = n + 1; s <= flushes; s++) {
      const i = (s - 1) % capacity;
      for (const k of guesses[i] ?? []) roots.add(k);
      if (!listsThroughPin) for (const k of rewrites[i] ?? []) roots.add(k);
    }
    // A Solid whose view reads a list's rows through the pinned container rewinds a list rewritten wholesale, except
    // one an optimistic layer guessed over after n (a guess held across an await, then landed): its rows still read
    // wrong or `undefined` under the view (solid-view 980f5b4c5; reported).
    if (listsThroughPin && !guessedListsThroughPin && guessedAfter.size) {
      const rewritten = new Set();
      for (let s = oldest(); s <= flushes; s++) for (const k of rewrites[(s - 1) % capacity] ?? []) rewritten.add(k);
      for (const k of guessedAfter) if (rewritten.has(k)) roots.add(k);
    }
    if (!roots.size) return [];
    const out = new Set(roots);
    for (const g of graphs) {
      const byId = new Map(g.nodes.map(x => [x.id, x])), next = new Map();
      for (const e of g.edges) if (e.type === "read") (next.get(e.from) ?? next.set(e.from, []).get(e.from)).push(e.to);
      const todo = g.nodes.filter(x => roots.has(x.key)).map(x => x.id), seen = new Set(todo);
      while (todo.length) for (const to of next.get(todo.pop()) ?? []) if (!seen.has(to)) {
        seen.add(to); todo.push(to);
        if (byId.get(to)?.key) out.add(byId.get(to).key);
      }
    }
    return [...out].sort();
  }
  function pinsFor(n) {
    const pins = new Map();
    for (let s = flushes; s > n; s--) for (const c of raws[(s - 1) % capacity]) {
      let node = c.node;
      while (reincarnations.has(node)) node = reincarnations.get(node);
      pins.set(node, c.prev);
    }
    return pins;
  }
  const nameOf = key => {
    for (const graph of graphs) { const n = graph.nodes.find(n => n.key === key); if (n) return n.name; }
    return latest.get(key)?.name ?? key.split("|").at(-1);
  };
  function diffValues(from, to) {
    const changes = [];
    for (const key of [...new Set([...from.keys(), ...to.keys()])].sort()) {
      if (from.has(key) === to.has(key) && from.get(key) === to.get(key)) continue;
      const c = { key, name: nameOf(key), ...locate(key) };
      const a = from.get(key), b = to.get(key);
      if (a !== undefined) a.startsWith(ERR) ? (c.prevError = a.slice(ERR.length)) : (c.prev = a);
      if (b !== undefined) b.startsWith(ERR) ? (c.error = b.slice(ERR.length)) : (c.preview = b);
      changes.push(c);
    }
    return changes;
  }
  // While viewing the app is read-only (TRACE-CONTRACT §4b): input on it would write beneath the view, unseen.
  let blocker = null;
  function readOnly(n) {
    if (typeof document === "undefined") return;
    if (n == null) {
      blocker?.off();
      blocker = null;
      document.documentElement.removeAttribute("data-rx-viewing");
      return;
    }
    document.documentElement.setAttribute("data-rx-viewing", String(n));
    (blocker ??= blockInput(() => resume())).show(n);
  }
  const deny = (to, reason) => publish({ type: "travel-denied", to, reason });
  // A question in the air or an action still running is a hold that has not landed: opening a view now, its landing
  // would come beneath the view and could not be told apart from what the view shows. Moving between seqs once
  // viewing is fine (the app is read-only, and what lands stays beneath).
  const holding = () => !!landing || probingGuess || (!view && (flightKeys().size > 0 || runs.size > 0 || held.size > 0
    || [...writes].some(key => inspect(key, () => undefined)?.held)));
  // Travel asked for while holding waits (TRACE-CONTRACT v0.6 `travel-pending`): the newest target wins, and goes
  // when the hold has landed. `resume` drops it.
  let queued = null, queueTimer = 0;
  function tryQueued() {
    if (queued === null || queueTimer) return;
    // never from inside a flush or an action body: openView throws there
    queueTimer = setTimeout(() => {
      queueTimer = 0;
      if (queued === null) return;
      if (holding()) return void setTimeout(tryQueued, 50);
      const to = queued;
      queued = null;
      travel(to);
    }, 0);
  }
  function travel(to) {
    if (holding()) {
      queued = to; // checked when it goes: the seq may be recorded by then
      publish({ type: "travel-pending", to });
      return tryQueued();
    }
    queued = null;
    if (!Number.isInteger(to) || to < oldest() || to > flushes) return deny(to, "evicted");
    const openView = engine[1]?.openView;
    if (typeof openView !== "function") return deny(to, "unsupported");
    try {
      if (!view) {
        if (listsThroughPin === null) {
          listsThroughPin = probeListPins(openView);
          // dev-only, for tests and tools: not part of the trace protocol
          (globalThis.__RX__ ??= {}).travel = { listsThroughPin };
        }
        if (listsThroughPin && guessedListsThroughPin === null && guessesNamed
          && rewrites.flat().some(k => carrierKeys.some(keys => keys?.includes(k)))) {
          queued = to;
          publish({ type: "travel-pending", to });
          probingGuess = true;
          void probeGuessedListPins(openView).then(supported => {
            probingGuess = false;
            guessedListsThroughPin = supported;
            globalThis.__RX__.travel.guessedListsThroughPin = supported;
            tryQueued();
          });
          return;
        }
        const v = openView();
        view = v; // set after openView: its own flush of what was staged is live history
      }
      const from = viewing ?? flushes;
      view.show(pinsFor(to));
      viewing = to;
      readOnly(to);
      const inexact = inexactAt(to);
      publish({ type: "step", from, to, direction: to < from ? "back" : "forward", changes: diffValues(valuesAt(from), valuesAt(to)),
        ...(inexact.length ? { inexact } : {}) });
    } catch (e) {
      // openView throws inside a flush, an effect or an action body (and while another view is open)
      if (view && viewing === null) { const v = view; view = null; readOnly(null); try { v.resume(); } catch {} }
      deny(to, "unsupported");
      console.warn("[rx-map] travel failed:", e);
    }
  }
  function resume() {
    queued = null;
    if (landing) return; // its resume is on the way
    if (!view) return publish({ type: "resume", head: flushes, changes: [] });
    const v = view, from = viewing;
    view = null;
    viewing = null;
    landing = { view: v, from, records: [] };
    readOnly(null);
    let done = false;
    try { done = v.resume(); } catch (e) { console.warn("[rx-map] resume failed:", e); done = true; }
    if (done) land();
    else waitForLanding();
  }
  function waitForLanding() {
    const check = () => {
      if (!landing) return;
      let busy = false;
      try { busy = landing.view.landing(); } catch {}
      if (busy) setTimeout(check, 16);
      else land();
    };
    setTimeout(check, 16);
  }
  // Everything the program did beneath the view lands as one transition: one step, measured against what the
  // timeline last recorded (the engine's landing record measures against the pins, which were never history).
  function land() {
    const { from, records } = landing;
    landing = null;
    const head = valuesAt(flushes);
    const now = new Map(), nodes = new Map();
    let at = performance.now();
    for (const r of records) {
      at = r.at ?? at;
      for (const { before, ...c } of r.changes) if (c.key) now.set(c.key, c);
      for (const { node, name, prev, value } of r.raw ?? []) {
        if (!nodes.has(node)) nodes.set(node, { node, name, prev: shownLast.has(node) ? shownLast.get(node) : prev });
        nodes.get(node).value = value;
      }
    }
    const raw = [];
    for (const { node, prev, value } of nodes.values()) {
      shownLast.set(node, value);
      if (!Object.is(prev, value)) raw.push({ node, prev });
    }
    // A node the view pinned whose truth beneath ended where the pin was shows no change in the landing record;
    // its current value comes from the node itself.
    for (const key of head.keys()) if (!now.has(key)) {
      const cur = inspect(key);
      if (cur?.value && cur.error == null && cur.value.preview !== head.get(key)) now.set(key, { key, name: nameOf(key), ...cur.value });
    }
    const changes = [];
    const landed = new Map(reconcileErrors([...now.values()]).map(c => [c.key, c]));
    for (const [key, c] of landed) {
      if (head.has(key) && head.get(key) === stateOf(c)) continue;
      const out = { ...c, ...locate(key) };
      delete out.prev;
      if (head.has(key)) { if (!head.get(key).startsWith(ERR)) out.prev = head.get(key); }
      else {
        // a first change: the node's own value before, as the timeline last recorded it
        const own = [...nodes.values()].find(x => x.name === RX + key);
        if (own && own.prev !== undefined) out.prev = untracked(() => preview(own.prev));
      }
      changes.push(out);
    }
    // The landing is one new step when something keyed moved; otherwise its records are only the pins coming off.
    // The view hears the step after the resume, as the flush that brings it live again.
    const internal = records.flatMap(r => r.changes.filter(c => !c.key));
    const step = changes.length ? addStep(at, changes, raw, internal, true) : null;
    publish({ type: "resume", head: flushes, changes: diffValues(valuesAt(from), valuesAt(flushes)) });
    if (step) publishStep(step, internal);
    queueReconcile();
  }
  function query(method, { key, keys = [], since = 0, limit = 20 } = {}) {
    const known = () => {
      if (typeof key !== "string" || !key) throw new Error("provide a key from find");
      const keys = [...last.keys(), ...graphs.flatMap(g => g.nodes.map(n => n.key))];
      if (!keys.includes(key)) {
        const name = key.split("|").at(-1).toLowerCase();
        const similar = [...new Set(keys)].filter(k => k.toLowerCase().includes(name)).slice(0, 3);
        throw new Error(`unknown key ${key}; ${similar.length ? `did you mean: ${similar.join(", ")}? ` : ""}Use find for keys.`);
      }
    };
    switch (method) {
      case "status": return { flushes, uptime: performance.now() - start };
      case "tail": {
        if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > size)
          throw new Error("tail takes a nonnegative since and a limit from 1 to 2000");
        return recent(limit, since);
      }
      case "value": {
        known();
        return current(key, flightKeys().get(key));
      }
      case "boundary_history": {
        const ref = [...regionRefs()].find(([, region]) => region === key)?.[0];
        const state = allBoundaries().find(b => b.region === key);
        if (!state) throw new Error(`unknown boundary ${key}`);
        const notifiers = new Set(Array.isArray(keys) ? keys : []);
        let origin;
        const history = recent().filter(r => r.region === key || (r.type === "flight" && notifiers.has(r.key))).slice(-16).map(r => {
          if (r.type === "flight") { origin = r.origin; return r; }
          const result = origin ? { ...r, origin } : r;
          origin = undefined;
          return result;
        });
        return { ...state, ...(!globalThis.__RX_BOUNDARIES__?.has(ref) ? { observation: "not created yet" } : {}), history };
      }
      case "state":
        if (key !== undefined) {
          const boundary = allBoundaries().find(b => b.region === key);
          if (boundary) return query("boundary_history", { key });
          known();
          return { ...current(key, flightKeys().get(key)), held: held.get(key), runs: [...runs.values()].filter(r => r.key === key) };
        }
        return { values: states(), flights: pending(), boundaries: allBoundaries().filter(b => b.state !== "ok"),
          held: [...held.values()], runs: [...runs.values()], reverts: recent().filter(r => r.type === "revert").slice(-10) };
      case "why": {
        known();
        const hit = last.get(key);
        const related = new Set([key]);
        const chain = [];
        const changed = new Map(hit?.record.changes.map(c => [c.key, c]));
        const upstream = new Set([key]);
        for (const g of graphs) {
          const byId = new Map(g.nodes.map(n => [n.id, n.key]));
          const walk = (to, depth) => {
            if (depth > 5 || chain.length >= 24) return;
            for (const e of g.edges) {
              const from = byId.get(e.from);
              if (!from || byId.get(e.to) !== to) continue;
              if (e.type === "write") related.add(from);
              if (e.type !== "read" && e.type !== "passes") continue;
              if (upstream.has(from)) continue;
              upstream.add(from);
              if (changed.has(from)) chain.push({ ...changed.get(from), depth });
              walk(from, depth + 1);
            }
          };
          walk(key, 1);
        }
        const events = recent().filter(r => (["run", "revert", "held", "released"].includes(r.type) && related.has(r.key)) ||
          (r.type === "flight" && upstream.has(r.key))).slice(-16);
        const readers = [...held.values()].filter(h => h.by.some(k => upstream.has(k))).map(h => ({ ...h, ...locate(h.key) }));
        const state = current(key, flightKeys().get(key));
        if (!hit) return { ...state, others: [], events, chain, readers };
        const { change, record } = hit;
        const others = [...new Map(record.changes.filter(c => c.key && c.key !== key).map(c => [c.key, c])).values()];
        return { ...change, seq: record.seq, at: record.at, others, events, chain, readers, current: state };
      }
      case "pending": return pending();
      default: throw new Error("unknown live method; use status, tail, state, value, why, or pending");
    }
  }
  return recording = { listeners, traces, query, snapshot, timeline, travel, resume, hmr, replaceModule };
}

// ---- read-only while viewing ----------------------------------------------------------------------------------------
// Capture-phase listeners on the window stop pointer and keyboard input before the app (or Solid's delegated
// handlers) sees it, except in the map, the devtools and the badge, which says why and offers a way back.
const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu",
  "touchstart", "touchend", "keydown", "keyup", "keypress", "beforeinput", "input", "change", "submit", "paste", "cut",
  "drop", "dragstart"];
const ALLOWED = "[data-rx-map], [data-rx-viewing-badge], [data-solid-dev-toolbar-root], [data-solid-dev-toolbar]";
function blockInput(onResume) {
  const badge = document.createElement("div");
  badge.setAttribute("data-rx-viewing-badge", "");
  const shadow = badge.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    .b { position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
      padding: 5px 6px 5px 10px; border-radius: 999px; font: 500 12px/1.2 system-ui, sans-serif; color: #e2e8f0;
      background: rgba(15, 23, 42, .88); box-shadow: 0 2px 10px rgba(0, 0, 0, .25); transition: transform .15s }
    .b.nudge { transform: translateY(-3px) }
    button { font: inherit; color: #0f172a; background: #e2e8f0; border: 0; border-radius: 999px; padding: 3px 9px; cursor: pointer }
  </style><div class="b" role="status"><span></span><button type="button">Resume</button></div>`;
  const box = shadow.querySelector(".b"), label = shadow.querySelector("span");
  shadow.querySelector("button").addEventListener("click", () => onResume());
  const allowed = ev => ev.composedPath().some(n => n instanceof Element && n.matches(ALLOWED));
  let nudged = 0;
  const stop = ev => {
    if (allowed(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.type === "pointerdown" || ev.type === "keydown") {
      box.classList.add("nudge");
      clearTimeout(nudged);
      nudged = setTimeout(() => box.classList.remove("nudge"), 160);
    }
  };
  for (const t of BLOCKED) window.addEventListener(t, stop, true);
  // a caret left in an app field would suggest typing works
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest?.(ALLOWED)) active.blur?.();
  document.body.append(badge);
  return {
    show(n) { label.textContent = `viewing #${n} — resume to interact`; },
    off() {
      for (const t of BLOCKED) window.removeEventListener(t, stop, true);
      clearTimeout(nudged);
      badge.remove();
    },
  };
}

// A key's shown state in the timeline: its preview, or its error (TRACE-CONTRACT v0.6: an error is a state, not an
// absence). Absent = no value shown (never answered, or no live instance).
const ERR = "\u0000error\u0000";
const stateOf = c => c.error !== undefined ? ERR + c.error : c.preview;
function applyPreviews(map, changes) {
  for (const c of changes ?? []) if (c.key) {
    const v = stateOf(c);
    if (v === undefined) map.delete(c.key);
    else map.set(c.key, v);
  }
}
// The state of the instance a key shows now (the newest live one): undefined when none is alive or it has no value yet.
function currentState(key) {
  const e = inspect(key);
  if (!e) return undefined;
  if (e.error != null) return ERR + errorPreview(e.error);
  return e.value?.preview;
}

// ---- the engine's records ---------------------------------------------------------------------------------------
// Without a dev Solid (no records channel), the map is drawn and stays still.
function listen(post, dirty, replacingOrigin) {
  const [solid, attr] = engine;
  const records = solid?.OBSERVE?.records;
  const attribution = attr?.attribution;
  if (!records || typeof attribution?.enable !== "function") return () => {};
  const formatOrigin = typeof attr.formatOrigin === "function" ? attr.formatOrigin : o => o.kind + (o.name ? ` ${o.name}` : "");

  // A flush lists every node whose shown value it changed; with `bodies`, the values beside them (live, so they are
  // previewed now).
  const onFlush = (event, live) => {
    const hmr = (live?.changes ?? []).map(c => hmrFlights.get(c.node)).find(Boolean);
    const roots = new Map();
    const changes = (event.changes ?? []).flatMap((c, i) => {
      if (probeNode(live?.changes?.[i]?.node)) return [];
      const out = { name: c.nodeName, key: keyOf(c.nodeName) };
      const body = live?.changes?.[i];
      if (out.key) {
        dirty(out.key);
        if (!roots.has(out.key)) roots.set(out.key, inspect(out.key));
        const root = roots.get(out.key);
        if (c.key !== undefined && c.key !== "$guess") out.path = storePath(body?.node, c.key);
        if (root?.error != null) out.error = errorPreview(root.error);
        else if (root?.value) Object.assign(out, root.value);
        else if (!root && !out.path && body && "value" in body) Object.assign(out, untracked(() => previews(body.value)));
        // the node's own value before (not a store property's): the prev of a key's first change
        if (c.nodeName === RX + out.key && body?.prev !== undefined) out.before = untracked(() => preview(body.prev));
      } else if (body && "value" in body) out.preview = untracked(() => preview(body.value));
      const origin = c.origin ?? event.interaction;
      if (origin) {
        try { out.origin = formatOrigin(origin); } catch {}
      }
      if (hmr && out.key) out.origin = hmr;
      return out;
    });
    // The engine's own nodes and what each showed before: what time travel pins.
    const raw = [];
    for (let i = 0; i < (live?.changes?.length ?? 0); i++) {
      const body = live.changes[i];
      if (!body?.node || probeNode(body.node) || solid.OBSERVE.isExcluded?.(body.node)) continue;
      raw.push({ node: body.node, name: event.changes[i]?.nodeName, prev: body.prev, value: body.value });
    }
    post({ source: SOURCE, type: "flush", at: event.at, changes, raw, ...(hmr ? { origin: hmr } : {}) });
  };

  // The engine's flight record comes when a flight ends: landed, or abandoned because the node started another. A
  // start has no record, so it is read off the node a run just finished: a new promise in `_x._inFlight` (dev builds
  // keep the field's name).
  const announced = new WeakMap();
  const onRun = (event, node) => {
    const key = keyOf(event.nodeName);
    if (!key || !node) return;
    dirty(key);
    const flight = node._x?._inFlight;
    if (flight && announced.get(node) !== flight) {
      const hmr = replacingOrigin();
      if (hmr) hmrFlights.set(node, hmr);
      announced.set(node, flight);
      post({ source: SOURCE, type: "flight", key, state: "start" }, event.nodeId, event.at,
        event.interaction && formatOrigin(event.interaction));
      // Solid's flight record covers successful landings and supersession, not
      // rejection. Observe native promise rejection without replacing the promise.
      if (flight instanceof Promise) flight.then(() => {
        // Nor does it cover a node disposed while asking (a component a route or a view remounted): its answer lands
        // nowhere, and an open flight would hold travel forever. (`_flags` bit 6 is REACTIVE_DISPOSED.)
        setTimeout(() => {
          if (announced.get(node) !== flight || !(node._flags & (1 << 6))) return;
          announced.delete(node);
          post({ type: "flight", key, state: "abandon" }, event.nodeId);
        }, 0);
      }, () => {
        if (announced.get(node) !== flight) return;
        announced.delete(node);
        post({ type: "flight", key, state: "abandon" }, event.nodeId);
      });
    }
  };
  const onFlight = (event, node) => {
    const key = keyOf(event.nodeName);
    if (!key) return;
    if (node) announced.delete(node);
    // The flight's end and flush arrive in the same turn, in engine order.
    if (node && hmrFlights.has(node)) queueMicrotask(() => hmrFlights.delete(node));
    post({ source: SOURCE, type: "flight", key, state: event.outcome === "landed" ? "land" : "abandon" }, event.nodeId,
      undefined, event.interaction && formatOrigin(event.interaction));
  };

  const offs = [
    records.subscribe("flush", onFlush, { bodies: true }),
    records.subscribe("flight", onFlight),
    records.subscribe("rerun", onRun),
    records.subscribe("create", onRun),
    solid.OBSERVE.diagnostics?.subscribe(event => {
      if (event.code !== "OPTIMISTIC_REVERTED") return;
      const key = keyOf(event.nodeName ?? event.data?.source);
      if (!key) return;
      const origin = event.interaction ?? event.origin;
      post({ type: "revert", key, at: performance.now(), reason: event.data?.how,
        ...(origin ? { origin: formatOrigin(origin) } : {}) });
    }),
  ];
  const release = attribution.enable({ log: false, values: "full" });
  return () => {
    release();
    for (const off of offs) off?.();
  };
}

// FlushChange.key is only the leaf. Walk the same target links Solid uses
// for attribution's own store paths. Older engines can only give the leaf.
function storePath(node, leaf) {
  const parts = [leaf];
  for (let t = node?._host; t?.pk != null && parts.length < 128; t = t.u) parts.push(String(t.pk));
  return parts.reverse().join(".");
}

// Solid names property nodes `<name>.<leaf>`; the part before the dot is the declaration.
const keyOf = name => {
  if (typeof name !== "string" || !name.startsWith(RX)) return null;
  const k = name.slice(RX.length), bar = k.lastIndexOf("|"), dot = k.indexOf(".", bar + 1);
  return dot < 0 ? k : k.slice(0, dot);
};

/** A short string of a value, at most 80 characters. */
export function preview(v, max = 80, depth = 2) {
  let s;
  try { s = show(v, depth, max); } catch (e) {
    // Store reads can throw during inspection; let the accessor report those as state.
    if (max === 2000) throw e;
    s = "?";
  }
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function show(v, depth, max) {
  switch (typeof v) {
    case "string": return JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v);
    case "undefined": return "undefined";
    case "function": return `ƒ ${v.name || "anonymous"}`;
    case "bigint": return `${v}n`;
    case "symbol": return v.toString();
    case "object": break;
    default: return String(v);
  }
  if (v === null) return "null";
  if (v instanceof Date) return isNaN(v) ? "Invalid Date" : v.toISOString();
  if (v instanceof Error) return `${v.name === "Error" && v.constructor?.name ? v.constructor.name : v.name}: ${v.message}`;
  if (typeof v.then === "function") return "Promise";
  const arr = Array.isArray(v);
  if (depth <= 0) return arr ? `Array(${v.length})` : "{…}";
  let out = arr ? "[" : "{", n = 0;
  const keys = arr ? null : Object.keys(v);
  const len = arr ? v.length : keys.length;
  for (; n < len && out.length < max; n++) out += (n ? ", " : "") + (arr ? "" : `${keys[n]}: `) + show(arr ? v[n] : v[keys[n]], depth - 1, max - out.length);
  if (n < len) out += `, …${len - n}`;
  return out + (arr ? "]" : "}");
}

/**
 * Several programs as one map: their modules side by side. A module two programs share is drawn once, its nodes and
 * regions matched by key.
 */
export function mergeGraphs(list) {
  if (list.length === 1) return list[0];
  const out = { modules: [], absModules: [], nodes: [], edges: [], regions: [], lines: {} };
  if (list.every(g => g.title)) out.title = list.map(g => g.title).join(", ");
  // ids are `<module index>:<local>`, and the page finds a module's root region as `<module index>:r0`: a module new
  // to the merge keeps its local ids under its new index; a shared one maps to what the earlier program drew
  const byKey = new Map(), edgeSeen = new Set();
  list.forEach(g => {
    const mod = g.modules.map((m, i) => {
      const at = out.modules.indexOf(m);
      if (at >= 0) return { i: at, shared: true };
      out.absModules.push(g.absModules?.[i] ?? null);
      return { i: out.modules.push(m) - 1, shared: false };
    });
    const local = id => { const c = id.indexOf(":"); return { m: mod[+id.slice(0, c)], rest: id.slice(c + 1) }; };
    const re = id => { const { m, rest } = local(id); return `${m.i}:${rest}`; };
    const map = new Map();
    for (const x of [...g.regions, ...g.nodes]) {
      const { m } = local(x.id);
      map.set(x.id, (m.shared && x.key && byKey.get(x.key)) || re(x.id));
    }
    for (const r of g.regions) {
      if (mod[r.mod].shared) continue;
      if (r.key) byKey.set(r.key, map.get(r.id));
      out.regions.push({ ...r, id: map.get(r.id), mod: mod[r.mod].i, parent: r.parent == null ? null : map.get(r.parent) ?? re(r.parent),
        ...(r.outline ? { outline: r.outline.map(p => "site" in p ? { ...p, site: map.get(p.site) }
          : "region" in p ? { ...p, region: map.get(p.region) } : p) } : {}) });
    }
    for (const n of g.nodes) {
      if (mod[n.mod].shared) continue;
      if (n.key) byKey.set(n.key, map.get(n.id));
      out.nodes.push({ ...n, id: map.get(n.id), mod: mod[n.mod].i, region: map.get(n.region) ?? re(n.region) });
    }
    for (const e of g.edges) {
      const ne = { ...e, from: map.get(e.from) ?? re(e.from), to: map.get(e.to) ?? re(e.to) };
      const k = JSON.stringify(ne);
      if (!edgeSeen.has(k)) { edgeSeen.add(k); out.edges.push(ne); }
    }
    Object.assign(out.lines, g.lines);
  });
  return out;
}

// ---- pop-outs: a map window attaches to the bridge itself ------------------------------------------------------------
// A pop-out is opened by the map in the dock's iframe, but it must outlive that iframe (the dock leaves the Map tab) and
// the app's reloads. `__RX__.connect(post)` gives it the same stream a mounted map gets, straight from this page:
// `post(msg)` receives host → view messages; `send(msg)` takes the view's (hello, snapshot?, travel, resume); `graph()`
// is the merged graph; `close()` detaches. A post that throws (its window is gone) detaches it.
export function connectView(post) {
  const recorder = getRecorder();
  let ready = false, closed = false, internals = false;
  const deliver = (msg, raw) => {
    if (!ready || closed) return;
    try { post(internals && raw ? raw : msg); } catch { close(); }
  };
  const close = () => { closed = true; recorder.listeners.delete(deliver); };
  recorder.listeners.add(deliver);
  return {
    send(data) {
      if (closed || data?.source !== SOURCE || data.v !== 1) return;
      if (data.type === "hello") { ready = true; internals = wantsInternals(data); }
      receiveFromView(data, deliver);   // the same handling a mounted map's messages get (hello, snapshot?, travel, resume)
    },
    graph: () => mergeGraphs(graphs),
    close,
  };
}
if (typeof globalThis !== "undefined") (globalThis.__RX__ ??= {}).connect = connectView;
