// @reactivescript/map/live: the map beside a running dev build. Browser only.
//
// A dev build's entry module calls `register(graph)` (the Vite front end adds the call). That sets
// `globalThis.__RX__ = { graphs, mount }`; a host (the devtools' Map view) calls `mount(el)` to draw the map of every
// registered program in an iframe and light it as Solid's flushes change the nodes the build named `rx:<key>`.
//
// What is posted to the iframe, every message with `source: "rx-map"`:
//   { type: "flush", seq, at, changes: [{ name, key, preview?, origin? }] }  a flush that changed something
//   { type: "flight", key, state: "start" | "land" | "abandon" }             async work for an RX node
//   { type: "reset" }
import { pageHTML } from "./page.mjs";
import { LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE } from "./live-protocol.mjs";

const SOURCE = "rx-map";
const RX = "rx:";
const graphs = [];
const mounts = new Set();
const bridges = new Map();
let recording;
// Resolve before the entry calls register: its first render can start flights
// in the same turn, before a lazy attribution import would finish.
const engine = await Promise.all([import("solid-js"), import("solid-js/attribution")]).catch(() => []);

/** Adds a program's graph (from `@reactivescript/map/graph`'s `buildGraph`). Re-registering its entry replaces it. */
export function register(graph, { hot } = {}) {
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
  const queue = [];
  const post = msg => {
    if (ready && iframe.contentWindow) iframe.contentWindow.postMessage(msg, "*");
    else if (queue.length < 2000) queue.push(msg);
  };
  iframe.addEventListener("load", () => {
    ready = true;
    for (const msg of queue.splice(0)) iframe.contentWindow?.postMessage(msg, "*");
  });
  const m = {
    load() {
      ready = false;
      queue.length = 0;
      iframe.srcdoc = pageHTML(mergeGraphs(graphs), { live: true });
    },
  };
  m.load();
  el.append(iframe);
  mounts.add(m);
  const recorder = getRecorder();
  recorder.listeners.add(post);
  return () => {
    if (!mounts.delete(m)) return;
    recorder.listeners.delete(post);
    iframe.remove();
    releaseRecorder();
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
    releaseRecorder();
  };
  hot.dispose?.(stop);
  hot.prune?.(stop);
  ready();
}

function releaseRecorder() {
  if (mounts.size || bridges.size || !recording) return;
  recording.stop();
  recording = undefined;
}

function getRecorder() {
  if (recording) return recording;
  const size = 2000, ring = new Array(size), listeners = new Set(), latest = new Map(), last = new Map(), flights = new Map();
  const start = performance.now();
  let seq = 0, flushes = 0;
  const locate = key => {
    for (const graph of graphs) {
      const n = graph.nodes.find(n => n.key === key);
      if (n) return { file: n.file, line: n.line };
    }
    return {};
  };
  const stop = listen((msg, flightId, since, origin) => {
    if (msg.type === "flush") {
      msg.seq = ++flushes;
      const changes = msg.changes.map(c => ({ ...c, ...locate(c.key) }));
      const record = { type: "flush", seq: ++seq, at: msg.at, changes };
      ring[(seq - 1) % size] = record;
      for (const c of changes) if (c.key) {
        if (c.preview !== undefined) latest.set(c.key, c);
        last.set(c.key, { change: c, record });
      }
    } else {
      const at = performance.now();
      const r = { type: "flight", seq: ++seq, at, key: msg.key, state: msg.state, origin, ...locate(msg.key) };
      ring[(seq - 1) % size] = r;
      if (msg.state === "start") flights.set(flightId, { key: msg.key, since: since ?? at, ...locate(msg.key) });
      else flights.delete(flightId);
    }
    for (const post of listeners) post(msg);
  });
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
        const records = [];
        for (let i = Math.max(0, since, seq - limit); i < seq; i++) records.push(ring[i % size]);
        return records;
      }
      case "value": {
        known();
        if (!latest.has(key)) throw new Error(`no preview yet for ${key}; interact with the page to change its value`);
        const { preview } = latest.get(key);
        return { key, preview, ...locate(key) };
      }
      case "why": {
        known();
        const hit = last.get(key);
        if (!hit) throw new Error(`no change recorded for ${key}; interact with the page to change its value`);
        const { change, record } = hit;
        const others = [...new Map(record.changes.filter(c => c.key && c.key !== key).map(c => [c.key, c])).values()];
        return { ...change, seq: record.seq, at: record.at, others };
      }
      case "pending": {
        const byKey = new Map();
        for (const r of flights.values()) if (!byKey.has(r.key) || byKey.get(r.key).since > r.since) byKey.set(r.key, r);
        return [...byKey.values()];
      }
      default: throw new Error("unknown live method; use status, tail, value, why, or pending");
    }
  }
  return recording = { stop, listeners, query };
}

// ---- the engine's records ---------------------------------------------------------------------------------------
// Without a dev Solid (no records channel), the map is drawn and stays still.
function listen(post) {
  const [solid, attr] = engine;
  const records = solid?.OBSERVE?.records;
  const attribution = attr?.attribution;
  if (!records || typeof attribution?.enable !== "function") return () => {};
  const untrack = typeof solid.untrack === "function" ? solid.untrack : f => f();
  const formatOrigin = typeof attr.formatOrigin === "function" ? attr.formatOrigin : o => o.kind + (o.name ? ` ${o.name}` : "");

  // A flush lists every node whose shown value it changed; with `bodies`, the values beside them (live, so they are
  // previewed now).
  const onFlush = (event, live) => {
    if (!event.changes?.length) return;
    const changes = event.changes.map((c, i) => {
      const out = { name: c.nodeName, key: keyOf(c.nodeName) };
      const body = live?.changes?.[i];
      if (body && "value" in body) out.preview = untrack(() => preview(body.value));
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
    }
  };
  const onFlight = (event, node) => {
    const key = keyOf(event.nodeName);
    if (!key) return;
    if (event.outcome === "landed" && node) announced.delete(node);
    post({ source: SOURCE, type: "flight", key, state: event.outcome === "landed" ? "land" : "abandon" }, event.nodeId,
      undefined, event.interaction && formatOrigin(event.interaction));
  };

  const offs = [
    records.subscribe("flush", onFlush, { bodies: true }),
    records.subscribe("flight", onFlight),
    records.subscribe("rerun", onRun),
    records.subscribe("create", onRun),
  ];
  const release = attribution.enable({ log: false, values: "full" });
  return () => {
    release();
    for (const off of offs) off();
  };
}

const keyOf = name => (typeof name === "string" && name.startsWith(RX) ? name.slice(RX.length) : null);

/** A short string of a value, at most 80 characters. */
export function preview(v) {
  let s;
  try { s = show(v, 2); } catch { s = "?"; }
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}
function show(v, depth) {
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
  for (; n < len && out.length < 80; n++) out += (n ? ", " : "") + (arr ? "" : `${keys[n]}: `) + show(arr ? v[n] : v[keys[n]], depth - 1);
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
