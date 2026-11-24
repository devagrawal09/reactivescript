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

const SOURCE = "rx-map";
const RX = "rx:";
const graphs = [];
const mounts = new Set();

/** Adds a program's graph (from `@reactivescript/map/graph`'s `buildGraph`). Re-registering its entry replaces it. */
export function register(graph) {
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
  let stop = null, disposed = false;
  listen(post).then(s => (disposed ? s() : (stop = s)));
  return () => {
    if (disposed) return;
    disposed = true;
    mounts.delete(m);
    stop?.();
    iframe.remove();
  };
}

// ---- the engine's records ---------------------------------------------------------------------------------------
// `solid-js/attribution` is loaded only here, when something mounts: a build that never mounts never runs it. Without
// a dev Solid (no records channel, an inert attribution), the map is drawn and stays still.
async function listen(post) {
  let solid, attr;
  try {
    [solid, attr] = await Promise.all([import("solid-js"), import("solid-js/attribution")]);
  } catch {
    return () => {};
  }
  const records = solid.OBSERVE?.records;
  const attribution = attr.attribution;
  if (!records || typeof attribution?.enable !== "function") return () => {};
  const untrack = typeof solid.untrack === "function" ? solid.untrack : f => f();
  const formatOrigin = typeof attr.formatOrigin === "function" ? attr.formatOrigin : o => o.kind + (o.name ? ` ${o.name}` : "");
  let seq = 0;

  // A flush lists every node whose shown value it changed; with `bodies`, the values beside them (live, so they are
  // previewed now).
  const onFlush = (event, live) => {
    if (!event.changes?.length) return;
    const changes = event.changes.map((c, i) => {
      const out = { name: c.nodeName, key: keyOf(c.nodeName) };
      const body = live?.changes?.[i];
      if (body && "value" in body) out.preview = untrack(() => preview(body.value));
      if (c.origin) {
        try { out.origin = formatOrigin(c.origin); } catch {}
      }
      return out;
    });
    post({ source: SOURCE, type: "flush", seq: ++seq, at: event.at, changes });
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
      post({ source: SOURCE, type: "flight", key, state: "start" });
    }
  };
  const onFlight = (event, node) => {
    const key = keyOf(event.nodeName);
    if (!key) return;
    if (event.outcome === "landed" && node) announced.delete(node);
    post({ source: SOURCE, type: "flight", key, state: event.outcome === "landed" ? "land" : "abandon" });
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
