// @reactivescript/map/live: the map beside a running dev build. Browser only.
//
// A dev build's entry module calls `register(graph)` (the Vite front end adds the call). That sets
// `globalThis.__RX__ = { graphs, mount }`; a host (the devtools' Map view) calls `mount(el)` to draw the map of every
// registered program in an iframe and light it as Solid's flushes change the nodes the build named `rx:<key>`.
//
// The recorder belongs to the app session, not to a particular map iframe.
import { pageHTML } from "./page.mjs";
import { LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE } from "./live-protocol.mjs";

const SOURCE = "rx-map";
const RX = "rx:";
const message = msg => ({ source: SOURCE, v: 1, ...msg });
const graphs = [];
const mounts = new Set();
const bridges = new Map();
let recording;
// Resolve before the entry calls register: its first render can start flights
// in the same turn, before a lazy attribution import would finish.
const engine = await Promise.all([import("solid-js"), import("solid-js/attribution")]).catch(() => []);
const untracked = fn => engine[0]?.runWithOwner ? engine[0].runWithOwner(null, fn) : fn();
const errorPreview = error => untracked(() => preview(error));
function previews(value) {
  const out = { preview: preview(value) };
  if (value !== null && typeof value === "object" && !(value instanceof Error)) {
    const full = preview(value, 2000, 4);
    if (full.length > out.preview.length) out.full = full;
  }
  return out;
}
function inspect(key) {
  const entries = globalThis.__RX_NODES__?.get(key);
  if (!entries?.size) return;
  try { return [...entries].at(-1)(previews); } catch { /* instrumentation is best effort */ }
}

/** Adds a program's graph (from `@reactivescript/map/graph`'s `buildGraph`). Re-registering its entry replaces it. */
export function register(graph, { hot } = {}) {
  getRecorder();
  if (hot) connect(hot);
  const entry = graph?.modules?.[0];
  const i = graphs.findIndex(g => g.modules?.[0] === entry);
  if (i >= 0) {
    if (JSON.stringify(graphs[i]) === JSON.stringify(graph)) return;
    graphs[i] = graph;
  } else graphs.push(graph);
  const rx = (globalThis.__RX__ ??= {});
  rx.graphs = graphs;
  rx.mount = mount;
  for (const m of mounts) m.load();
}

/** Draws the map into `el`, live. Returns the dispose. */
export function mount(el) {
  const iframe = document.createElement("iframe");
  iframe.title = "rx-map";
  iframe.style.cssText = "display:block;width:100%;height:100%;border:0";
  let ready = false;
  const post = msg => {
    if (ready && iframe.contentWindow) iframe.contentWindow.postMessage(msg, "*");
  };
  const receive = ({ source, data }) => {
    if (source !== iframe.contentWindow || data?.source !== SOURCE || data.v !== 1) return;
    const recorder = getRecorder();
    if (data.type === "hello") {
      ready = true;
      post(recorder.snapshot());
      post(recorder.timeline());
    } else if (data.type === "snapshot?") post(recorder.snapshot());
    else if (data.type === "travel" || data.type === "resume")
      post(message({ type: "travel-denied", to: data.to ?? recorder.timeline().head, reason: "unsupported" }));
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
  getRecorder().listeners.add(post);
  return () => {
    if (!mounts.delete(m)) return;
    recording?.listeners.delete(post);
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
  hot.on("vite:ws:connect", ready);
  const stop = () => {
    if (!bridges.delete(hot)) return;
    hot.off?.(LIVE_REQUEST, request);
    hot.off?.("vite:ws:connect", ready);
  };
  hot.dispose?.(stop);
  hot.prune?.(stop);
  ready();
}

function getRecorder() {
  if (recording) return recording;
  const size = 2000, ring = new Array(size), steps = new Array(size), listeners = new Set();
  const latest = new Map(), last = new Map(), flights = new Map(), runs = new Map(), boundaries = new Map();
  const start = performance.now();
  let seq = 0, flushes = 0;
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
  const addRecord = msg => {
    const { source, v, ...record } = msg;
    record.seq = ++seq;
    ring[(seq - 1) % size] = record;
    return record;
  };
  const publish = msg => { for (const post of listeners) post(message(msg)); };
  const flightKeys = () => {
    const keys = new Map();
    for (const r of flights.values()) if (!keys.has(r.key) || keys.get(r.key).since > r.since) keys.set(r.key, r);
    return keys;
  };
  const send = (msg, flightId, since, origin) => {
    if (msg.type === "flush") {
      const changes = msg.changes.map(c => ({ ...c, ...locate(c.key), ...(c.key && latest.has(c.key) ? { prev: latest.get(c.key).preview } : {}) }));
      const { at } = msg;
      const step = { seq: ++flushes, at, changes };
      steps[(flushes - 1) % size] = step;
      const record = addRecord({ type: "flush", at, changes });
      for (const c of changes) if (c.key) {
        if (c.preview !== undefined) latest.set(c.key, c);
        last.set(c.key, { change: c, record });
      }
      publish({ type: "flush", ...step });
    } else if (msg.type === "flight") {
      const at = performance.now();
      const before = [...flights.values()].some(r => r.key === msg.key);
      if (msg.state === "start") flights.set(flightId, { key: msg.key, since: since ?? at, ...locate(msg.key) });
      else if (!flights.delete(flightId)) return;
      const after = [...flights.values()].some(r => r.key === msg.key);
      if (before === after) return;
      addRecord({ ...msg, at, origin, ...locate(msg.key) });
      publish({ ...msg, at });
    } else {
      addRecord({ ...msg, ...locate(msg.key) });
      publish(msg);
    }
  };
  listen(send);
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
  const trace = event => {
    if (event.type === "dispose") {
      for (const [id, f] of flights) if (f.key === event.key)
        send({ type: "flight", key: event.key, state: "abandon" }, id);
      latest.delete(event.key);
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
  };
  globalThis.__RX_TRACE__ = trace;
  function current(key, flight) {
    const now = inspect(key);
    if (now) return { key, ...now.value, ...(now.error ? { error: now.error.preview } : {}),
      pending: !!(!now.error && (flight || now.pending)), ...(!now.error && flight ? { since: flight.since } : {}), ...locate(key) };
    const old = latest.get(key);
    // Support named Solid nodes (and older RX runtimes), but never resurrect disposed registry nodes.
    const legacy = !globalThis.__RX_NODES__ && old;
    return { key, ...(legacy ? { preview: old.preview, full: old.full } : {}), pending: !!flight,
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
      values: all.filter(s => s.preview !== undefined).map(({ key, preview, full }) => ({ key, preview, full })),
      flights: all.filter(s => s.pending && s.since !== undefined).map(({ key, since }) => ({ key, since })),
      boundaries: allBoundaries(), runs: [...runs.values()] });
  }
  function timeline() {
    const history = [];
    for (let i = Math.max(0, flushes - size); i < flushes; i++) history.push(steps[i % size]);
    return message({ type: "timeline", head: flushes, viewing: null, steps: history, capacity: size });
  }
  function query(method, { key, since = 0, limit = 20 } = {}) {
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
      case "state":
        if (key !== undefined) {
          const boundary = allBoundaries().find(b => b.region === key);
          if (boundary) return boundary;
          known();
          return { ...current(key, flightKeys().get(key)), runs: [...runs.values()].filter(r => r.key === key) };
        }
        return { values: states(), flights: pending(), boundaries: allBoundaries().filter(b => b.state !== "ok"),
          runs: [...runs.values()], reverts: recent().filter(r => r.type === "revert").slice(-10) };
      case "why": {
        known();
        const hit = last.get(key);
        const related = new Set([key]);
        for (const g of graphs) {
          const byId = new Map(g.nodes.map(n => [n.id, n.key]));
          for (const e of g.edges) if (e.type === "write" && byId.get(e.to) === key) related.add(byId.get(e.from));
        }
        const events = recent().filter(r => (r.type === "run" || r.type === "revert") && related.has(r.key)).slice(-10);
        const state = current(key, flightKeys().get(key));
        if (!hit) return { ...state, others: [], events };
        const { change, record } = hit;
        const others = [...new Map(record.changes.filter(c => c.key && c.key !== key).map(c => [c.key, c])).values()];
        return { ...change, seq: record.seq, at: record.at, others, events, current: state };
      }
      case "pending": return pending();
      default: throw new Error("unknown live method; use status, tail, state, value, why, or pending");
    }
  }
  return recording = { listeners, query, snapshot, timeline };
}

// ---- the engine's records ---------------------------------------------------------------------------------------
// Without a dev Solid (no records channel), the map is drawn and stays still.
function listen(post) {
  const [solid, attr] = engine;
  const records = solid?.OBSERVE?.records;
  const attribution = attr?.attribution;
  if (!records || typeof attribution?.enable !== "function") return () => {};
  const formatOrigin = typeof attr.formatOrigin === "function" ? attr.formatOrigin : o => o.kind + (o.name ? ` ${o.name}` : "");

  // A flush lists every node whose shown value it changed; with `bodies`, the values beside them (live, so they are
  // previewed now).
  const onFlush = (event, live) => {
    if (!event.changes?.length) return;
    const roots = new Map();
    const changes = event.changes.map((c, i) => {
      const out = { name: c.nodeName, key: keyOf(c.nodeName) };
      const body = live?.changes?.[i];
      if (out.key) {
        if (!roots.has(out.key)) roots.set(out.key, inspect(out.key));
        const root = roots.get(out.key);
        if (c.key !== undefined && c.key !== "$guess") out.path = storePath(body?.node, c.key);
        if (root?.value) Object.assign(out, root.value);
        else if (!root && !out.path && body && "value" in body) Object.assign(out, untracked(() => previews(body.value)));
      } else if (body && "value" in body) out.preview = untracked(() => preview(body.value));
      const origin = c.origin ?? event.interaction;
      if (origin) {
        try { out.origin = formatOrigin(origin); } catch {}
      }
      return out;
    });
    post({ source: SOURCE, type: "flush", at: event.at, changes });
  };

  // The engine's flight record comes when a flight ends: landed, or abandoned because the node started another. A
  // start has no record, so it is read off the node a run just finished: a new promise in `_x._inFlight` (dev builds
  // keep the field's name).
  const announced = new WeakMap();
  const onRun = (event, node) => {
    const key = keyOf(event.nodeName);
    if (!key || !node) return;
    const flight = node._x?._inFlight;
    if (flight && announced.get(node) !== flight) {
      announced.set(node, flight);
      post({ source: SOURCE, type: "flight", key, state: "start" }, event.nodeId, event.at,
        event.interaction && formatOrigin(event.interaction));
      // Solid's flight record covers successful landings and supersession, not
      // rejection. Observe native promise rejection without replacing the promise.
      if (flight instanceof Promise) flight.then(undefined, () => {
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
  if (v instanceof Error) return `${v.name}: ${v.message}`;
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
      out.regions.push({ ...r, id: map.get(r.id), mod: mod[r.mod].i, parent: r.parent == null ? null : map.get(r.parent) ?? re(r.parent) });
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
