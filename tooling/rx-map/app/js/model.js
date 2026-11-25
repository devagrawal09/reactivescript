// The map's model of a graph: indexes, ranks, control-flow heads, boundary notifiers, and the board tree the RX views
// draw. Pure: `buildModel(graph)` returns a fresh model (the graph handed in is not changed); every other export reads
// one. Ported from map.html (loadGraph … pendingRoots, render's layout decisions, the traces).
import { CTL, FAM, FAM_HEX, FRAME, KIND, ORDER, SHAPE, STATUS, kindOf, famOf, edgeKey as edgeKeyOf } from "./vocab.js";

/** The model of a graph: what every view and trace reads. Opaque to RX; read through the functions below. */
export function buildModel(g) {
  const M = { diff: !!g.diff };
  const G = (M.G = { ...g, edges: [...g.edges] });   // the boundary edges below are the map's own
  const nodes = (M.nodes = new Map(G.nodes.map(n => [n.id, n])));
  const out = (M.out = new Map()), inc = (M.inc = new Map());
  const link = e => { (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e); (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)).push(e); };
  for (const e of G.edges) link(e);
  const regions = (M.regions = new Map(G.regions.map(r => [r.id, { ...r, kids: [], nodes: [] }])));
  for (const r of regions.values()) if (r.parent && regions.has(r.parent)) regions.get(r.parent).kids.push(r);
  const compRegion = (M.compRegion = new Map());  // comp node id → component region id
  for (const n of G.nodes) {
    const r = regions.get(n.region);
    if (n.kind === "comp") {
      const cr = [...regions.values()].find(x => x.mod === n.mod && x.kind === "component" && x.name === n.name);
      if (cr) { compRegion.set(n.id, cr.id); continue; }
    }
    if (n.world && !n.from) continue;    // drawn in the world column
    (r ?? regions.get(`${n.mod}:r0`))?.nodes.push(n);
  }
  M.ctlInfo = new Map();
  // layout: everything sits below what it depends on, so every arrow points up. depends(x) = what x needs: what it
  // reads, what it writes, what it calls, the props it passes into.
  const deps = (M.deps = new Map());
  for (const e of G.edges) {
    const [a, b] = e.type === "read" ? [e.to, e.from] : [e.from, e.to];
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    (deps.get(a) ?? deps.set(a, new Set()).get(a)).add(b);
  }
  M.rankMemo = new Map(); M.onPath = new Set();
  M.compOfRegion = new Map([...compRegion].map(([n, r]) => [r, n]));
  M.compLevelMemo = new Map();
  // modules: one whose nodes depend on another's sits below it
  const modDeps = (M.modDeps = new Map(G.modules.map((_, i) => [i, new Set()])));
  for (const [a, ds] of deps) for (const b of ds) {
    const ma = nodes.get(a).mod, mb = nodes.get(b).mod;
    if (ma !== mb && !nodes.get(b).world) modDeps.get(ma)?.add(mb);
  }
  for (const n of G.nodes) if (n.kind === "comp") for (const c of rendered(M, regions.get(compRegion.get(n.id)) ?? { kids: [] })) {
    const mc = nodes.get(c).mod; if (mc !== n.mod) modDeps.get(n.mod)?.add(mc);
  }
  M.modMemo = new Map();
  M.ctlSites = new Set();
  for (const r of regions.values()) if (CTL[r.kind] && !empty(r)) { const i = controlInfo(M, r); if (i.site) M.ctlSites.add(i.site.id); }
  M.boundaryCover = new Map();
  for (const r of regions.values()) {
    if ((r.kind !== "loading" && r.kind !== "errored") || empty(r)) continue;
    const { sites } = covered(M, r, r.kind);
    M.boundaryCover.set(r.id, sites);
    for (const [root, via] of pendingRoots(M, sites)) {
      const e = { from: root, to: r.id, type: "notifies", boundary: r.kind, via, status: M.diff ? "same" : undefined };
      G.edges.push(e);
      link(e);
    }
  }
  // a key names the same thing across a live session, a diff and a module replacement
  M.keyIds = new Map();
  for (const n of G.nodes) if (n.key) (M.keyIds.get(n.key) ?? M.keyIds.set(n.key, []).get(n.key)).push(n.id);
  M.kindCount = {}; M.edgeCount = {};
  for (const n of G.nodes) { const k = n.kind === "comp" ? "comp" : kindOf(n); M.kindCount[k] = (M.kindCount[k] ?? 0) + 1; }
  for (const e of G.edges) { const k = edgeKeyOf(e); M.edgeCount[k] = (M.edgeCount[k] ?? 0) + 1; }
  // every edge gets an index: traces and the edge layer name edges by it
  G.edges.forEach((e, i) => { e.i = i; });
  return M;
}
export const graphOf = M => M.G;
export const nodeOf = (M, id) => M.nodes.get(id) ?? null;
export const regionOf = (M, id) => M.regions.get(id) ?? null;
export const isRegion = (M, id) => M.regions.has(id);
/** A region by id or by key (a live message names a boundary either way). */
export function regionByRef(M, ref) { if (M.regions.has(ref)) return M.regions.get(ref); for (const r of M.regions.values()) if (r.key === ref) return r; return null; }
export const idsOfKey = (M, key) => M.keyIds.get(key) ?? [];
export const hasKey = (M, key) => M.keyIds.has(key);
export const keyOf = (M, id) => M.nodes.get(id)?.key ?? null;
export const inEdges = (M, id) => M.inc.get(id) ?? [];
export const outEdges = (M, id) => M.out.get(id) ?? [];
export const kindCount = M => M.kindCount;
export const edgeCount = M => M.edgeCount;

export function label(M, id) {
  const n = M.nodes.get(id); if (n) return n.name;
  const r = M.regions.get(id);
  return r ? (CTL[r.kind] ? controlInfo(M, r).text : `<${r.name}/>`) : id;
}
export const lineOf = (M, n) => ((n.status === "removed" ? M.G.linesBefore : M.G.lines)?.[n.file]?.[n.line] ?? "").trim();
/** A source line of a module, trimmed. */
export const moduleLine = (M, mod, line) => (M.G.lines?.[M.G.modules[mod]]?.[line] ?? "").trim();

function rank(M, id) {
  if (M.rankMemo.has(id)) return M.rankMemo.get(id);
  if (M.onPath.has(id)) return 0;   // a cycle: break it here
  M.onPath.add(id);
  let r = 0;
  for (const d of M.deps.get(id) ?? []) r = Math.max(r, rank(M, d) + 1);
  M.onPath.delete(id);
  M.rankMemo.set(id, r);
  return r;
}
// components: one that renders another sits below it
function rendered(M, r, acc = new Set()) {
  const G = M.G;
  for (const k of r.kids) {
    if (k.kind === "children" || k.kind === "imported") {
      const c = G.nodes.find(n => n.kind === "comp" && n.name === k.name && (n.mod === k.mod || !G.nodes.some(m => m.kind === "comp" && m.name === k.name && m.mod === k.mod)));
      if (c) acc.add(c.id);
    }
    rendered(M, k, acc);
  }
  return acc;
}
function compLevel(M, compId, path = new Set()) {
  if (M.compLevelMemo.has(compId)) return M.compLevelMemo.get(compId);
  if (path.has(compId)) return 0;
  path.add(compId);
  const r = M.regions.get(M.compRegion.get(compId));
  let l = 0;
  if (r) for (const c of rendered(M, r)) if (c !== compId) l = Math.max(l, compLevel(M, c, path) + 1);
  path.delete(compId);
  M.compLevelMemo.set(compId, l);
  return l;
}
function modLevel(M, m, path = new Set()) {
  if (M.modMemo.has(m)) return M.modMemo.get(m);
  if (path.has(m)) return 0;
  path.add(m);
  let l = 0;
  for (const d of M.modDeps.get(m) ?? []) l = Math.max(l, modLevel(M, d, path) + 1);
  path.delete(m);
  M.modMemo.set(m, l);
  return l;
}
const firstLine = r => Math.min(...r.nodes.map(n => n.line), ...r.kids.map(firstLine), 1e9);
const empty = r => r.kind !== "component" && !r.nodes.length && r.kids.every(empty) && r.kind !== "children";

// ---- control flow: what each branch, row and boundary is, read from its source line ----------------------------
export function controlInfo(M, r) {
  if (M.ctlInfo.has(r.id)) return M.ctlInfo.get(r.id);
  const G = M.G;
  const L = firstLine(r), ls = (r.status === "removed" ? G.linesBefore : G.lines)?.[G.modules[r.mod]] ?? {};
  const pat = {
    then: [/(?:^|[{\s])if\s+(.+?)\s*\{/, m => `if ${m[1]}`],
    else: [/\belse\s+if\s+(.+?)\s*\{|\belse\b/, m => (m[1] ? `else if ${m[1]}` : "else")],
    for: [/\{\s*for\s+(.+?)\s*\{/, m => `for ${m[1]}`],
    loading: [/\bloading\b\s*(on\s*\([^)]*\))?/, m => (m[1] ? `loading ${m[1].replace(/\s+/g, "")}` : "loading")],
    errored: [/\berrored\b(?:\s+fallback\s*\(([^)]*)\))?/, m => (m[1] ? `errored (${m[1].trim()})` : "errored")],
  }[r.kind];
  let info = { text: CTL[r.kind] ?? r.kind, line: null, site: null };
  if (r.head) info = { text: r.head.text, line: r.head.line, site: null };   // the graph read it (graph.mjs controlHeads)
  else {
    // an older graph: read it here, above the headers of the constructs nested in it
    let bound = L;
    const below = rr => { for (const k of rr.kids ?? []) { const h = CTL[k.kind] && controlInfo(M, k); if (h?.line) bound = Math.min(bound, h.line - 1); else below(k); } };
    below(r);
    if (pat && bound < 1e9) for (let i = bound; i >= Math.max(1, bound - 40); i--) {
      const m = ls[i] && pat[0].exec(ls[i]);
      if (m) { info = { text: pat[1](m), line: i, site: null }; break; }
    }
  }
  // the read that decides it (`if c`, `for x in xs`, `loading on(k)`) sits in the parent region: it is drawn in the header
  const kw = { then: "if", for: "for", loading: "loading on" }[r.kind];
  if (kw && info.line) info.site = M.regions.get(r.parent)?.nodes.find(n => n.site && n.name === kw && n.line === info.line) ?? null;
  M.ctlInfo.set(r.id, info);
  return info;
}

// ---- boundaries: which names can make each one show its fallback ------------------------------------------------
const REACTIVE = new Set(["reader", "prop", "effect", "provide"]);
function covered(M, r, kind, acc = { sites: new Set(), seen: new Set() }) {
  for (const n of r.nodes) if (n.site && REACTIVE.has(n.kind)) acc.sites.add(n.id);
  for (const k of r.kids) {
    const typed = k.kind === "errored" && /\(\s*\w+\s*:/.test(controlInfo(M, k).text);
    if (k.kind === "component" || (k.kind === kind && !typed)) continue;
    if ((k.kind === "children" || k.kind === "imported") && k.name)
      for (const c of M.G.nodes) if (c.kind === "comp" && c.name === k.name) {
        const cr = M.regions.get(M.compRegion.get(c.id));
        if (cr && !acc.seen.has(cr.id)) { acc.seen.add(cr.id); covered(M, cr, kind, acc); }
      }
    covered(M, k, kind, acc);
  }
  return acc;
}
function pendingRoots(M, siteIds) {
  const roots = new Map();
  for (const sid of siteIds) {
    const seen = new Set([sid]), todo = [sid];
    while (todo.length) for (const e of M.inc.get(todo.pop()) ?? []) {
      if (!((e.type === "read" && e.mode === "tracked" && !e.probe) || e.type === "passes") || seen.has(e.from)) continue;
      seen.add(e.from);
      const n = M.nodes.get(e.from);
      if (!n) continue;
      if (n.async && !n.site && !roots.has(n.id)) roots.set(n.id, sid);
      todo.push(e.from);
    }
  }
  return roots;
}
/** How many readers report to a boundary. */
export const coverCount = (M, id) => M.boundaryCover.get(id)?.size ?? 0;

// a markup hole is named by what it reads: `{ total }`, `{ pending? users }`
export function readsOf(M, n) {
  const names = (M.inc.get(n.id) ?? []).filter(e => e.type === "read").map(e => (e.probe === "pending" ? "pending? " : e.probe ? `${e.probe} ` : "") + label(M, e.from) + (e.field ? `.${e.field}` : ""));
  return [...new Set(names)].join(", ").slice(0, 34);
}
function shorten(s) { const m = s.match(/\{([^{}]{1,40})\}/); return (m ? m[1].trim() : s).slice(0, 28); }

// ---- traces: sets of node / region ids and edge indexes ---------------------------------------------------------
// in diff mode, the before or after view leaves out the other side's edges, traces included
const visibleIn = view => e => !(view === "before" && e.status === "added") && !(view === "after" && e.status === "removed");
const trace = (ids, edges) => ({ ids: [...ids], edges: [...edges].map(e => e.i) });
/** A token and its edges (hover, select). `view`: "both" | "before" | "after". */
export function neighbourhood(M, id, view = "both") {
  const edges = [...(M.out.get(id) ?? []), ...(M.inc.get(id) ?? [])].filter(visibleIn(view));
  return trace(new Set([id, ...edges.map(e => e.from), ...edges.map(e => e.to)]), edges);
}
// what a change here can reach: writes and calls go out, then tracked reads carry it on. A snapshot read stops it.
export function downstream(M, id, view = "both") {
  const visible = visibleIn(view);
  const ids = new Set([id]), edges = new Set(), todo = [[id, true]], seenImp = new Set([id]);
  while (todo.length) {
    const [x, imperative] = todo.pop();
    for (const e of M.out.get(x) ?? []) {
      if (!visible(e)) continue;
      const data = e.type === "passes" || e.type === "renders" || e.type === "notifies" || (e.type === "read" && (e.mode === "tracked" || e.probe));
      const act = imperative && (e.type === "write" || e.type === "call");
      if (!data && !act) continue;
      edges.add(e);
      const nextImp = e.type === "call";
      if (!ids.has(e.to) || (nextImp && !seenImp.has(e.to))) {
        ids.add(e.to); if (nextImp) seenImp.add(e.to);
        todo.push([e.to, nextImp]);
      }
    }
  }
  return trace(ids, edges);
}
// what this depends on: what it reads (tracked), who writes those, and what it calls into
export function upstream(M, id, view = "both") {
  const visible = visibleIn(view);
  const ids = new Set([id]), edges = new Set(), todo = [id];
  while (todo.length) {
    const x = todo.pop();
    for (const e of M.inc.get(x) ?? []) {
      if (!visible(e)) continue;
      const go = (e.type === "read" && (e.mode === "tracked" || e.probe)) || e.type === "write" || e.type === "passes" || e.type === "notifies";
      if (!go) continue;
      edges.add(e);
      if (!ids.has(e.from)) { ids.add(e.from); todo.push(e.from); }
    }
    if (x === id) for (const e of M.out.get(x) ?? []) if (e.type === "call") { edges.add(e); ids.add(e.to); }
  }
  return trace(ids, edges);
}
/** A diff summary item, lit: its names, the changed edges between them, and for "reaches" what the action reaches. */
export function summaryTrace(M, i) {
  const it = M.G.diff.summary[i];
  const ids = new Set(it.ids), edges = new Set(M.G.edges.filter(e => ids.has(e.from) && ids.has(e.to) || (it.ids.length === 1 && (e.from === it.ids[0] || e.to === it.ids[0]) && e.status !== "same")));
  for (const e of edges) { ids.add(e.from); ids.add(e.to); }
  if (/reaches/.test(it.text)) { const d = downstream(M, it.ids[0]); d.ids.forEach(x => ids.add(x)); d.edges.forEach(x => edges.add(M.G.edges[x])); }
  return { ids: [...ids], edges: [...edges].map(e => e.i), first: it.ids[0] };
}

// ---- the board: what the views draw, as plain data ------------------------------------------------------------
// A chip: one token on the board.
function chipView(M, n) {
  const kk = kindOf(n), meta = KIND[kk] ?? { k: n.kind, label: n.kind };
  const badges = [];
  if (n.flavor) badges.push(n.flavor);
  if (n.from) badges.push(n.from);
  if (n.site) badges.push(`L${n.line}`);
  const chg = n.status === "changed" ? n.was ?? {} : {};
  const name = n.site && n.name === "{…}" ? `{ ${readsOf(M, n) || shorten(lineOf(M, n))} }` : n.name;
  const status = n.status && n.status !== "same" ? n.status : "";
  return {
    id: n.id, key: n.key ?? "", kk, shape: SHAPE[kk] ?? "plug", fam: famOf(n), name, badges,
    site: !!n.site, async: !!n.async, question: n.kind === "source" && !!n.question, io: !!n.io, trust: !!n.world,
    chgAsync: "async" in chg, chgQuestion: "question" in chg, chgKind: "kind" in chg, chgIo: "io" in chg,
    status, mark: status ? STATUS[status] : "",
    aria: `${meta.label ?? n.kind} ${name}${status ? `, ${status}` : ""}`,
  };
}
function rows(M, list) {
  const byRank = new Map();
  for (const n of list) { const k = rank(M, n.id); (byRank.get(k) ?? byRank.set(k, []).get(k)).push(n); }
  return [...byRank.keys()].sort((a, b) => a - b).map(k =>
    byRank.get(k).sort((a, b) => ORDER.indexOf(kindOf(a)) - ORDER.indexOf(kindOf(b)) || a.line - b.line).map(n => chipView(M, n)));
}
function frameView(M, r) {
  const status = r.status && r.status !== "same" ? r.status : "";
  let head;
  const comp = r.kind === "component" ? M.G.nodes.find(n => M.compRegion.get(n.id) === r.id) : null;
  if (comp) head = { type: "comp", chip: chipView(M, comp) };
  else if (CTL[r.kind]) {
    const info = controlInfo(M, r);
    const read = info.site ? { ...chipView(M, info.site), name: readsOf(M, info.site) || "—", badges: [] } : null;
    const notifiers = r.kind === "loading" || r.kind === "errored"
      ? (M.inc.get(r.id) ?? []).filter(e => e.type === "notifies").map(e => ({ id: e.from, label: label(M, e.from) })) : [];
    head = { type: "ctl", text: info.text, aria: `${r.kind} ${info.text}${info.line ? `, line ${info.line}` : ""}`, read, notifiers,
      boundary: r.kind === "loading" || r.kind === "errored",
      lead: r.kind === "loading" ? "pending from" : "can fail from",
      none: r.kind === "loading" ? "nothing read below can be pending" : "nothing read below awaits" };
  } else head = { type: "plain", text: FRAME[r.kind] ?? r.kind, b: (r.kind === "children" || r.kind === "imported") && r.name ? `<${r.name} />` : "" };
  const kids = r.kids.filter(k => !empty(k));
  const comps = kids.filter(k => k.kind === "component");
  const levels = new Map();
  for (const k of comps) { const l = compLevel(M, M.compOfRegion.get(k.id)); (levels.get(l) ?? levels.set(l, []).get(l)).push(k); }
  const compGrids = [...levels.keys()].sort((a, b) => a - b).map(l => levels.get(l).sort((a, b) => firstLine(a) - firstLine(b)).map(k => frameView(M, k)));
  const rest = kids.filter(k => k.kind !== "component").sort((a, b) => firstLine(a) - firstLine(b));
  const mounts = rest.filter(k => k.kind === "children" || k.kind === "imported");
  const view = rest.filter(k => !mounts.includes(k));
  return {
    id: r.id, key: r.key ?? "", kind: r.kind, status, ctl: !!CTL[r.kind], head,
    named: rows(M, r.nodes.filter(n => !n.site)),
    sites: rows(M, r.nodes.filter(n => n.site && !M.ctlSites.has(n.id))),
    compGrids, view: view.map(k => frameView(M, k)), mounts: mounts.map(k => frameView(M, k)),
    module: null, extra: [],
  };
}
/** The whole board: the world column, then module plates in dependency order (a row per level), and the stats line. */
export function boardTree(M) {
  const G = M.G;
  const worldNodes = G.nodes.filter(n => n.world && !n.from);
  const byFile = new Map();
  for (const n of worldNodes) (byFile.get(n.file) ?? byFile.set(n.file, []).get(n.file)).push(n);
  const world = [...byFile].map(([file, ns]) => ({ file, chips: ns.sort((a, b) => a.line - b.line).map(n => chipView(M, n)) }));
  const levels = new Map();
  G.modules.forEach((_, mi) => { if (M.regions.get(`${mi}:r0`)) { const l = modLevel(M, mi); (levels.get(l) ?? levels.set(l, []).get(l)).push(mi); } });
  const plates = [...levels.keys()].sort((a, b) => a - b).map(l => levels.get(l).map(mi => {
    const root = M.regions.get(`${mi}:r0`);
    const f = frameView(M, root);
    f.module = { index: mi, path: G.modules[mi] };
    // regions with no parent other than the program root (an imported component's instance)
    for (const r of M.regions.values()) if (r.mod === mi && !r.parent && r.id !== root.id && !empty(r)) f.extra.push(frameView(M, r));
    return f;
  }));
  const named = G.nodes.filter(n => !n.site).length, sites = G.nodes.length - named;
  return {
    world, levels: plates,
    stats: `${G.modules.length} module${G.modules.length > 1 ? "s" : ""} · ${named} names · ${sites} sites · ${G.edges.length} edges`,
    flat: G.nodes.length > 900,
  };
}

/** Search: the drawn chips whose name contains `q` (lower case), names first (exact, then prefix, then anywhere), in
 *  reading order. A chip is drawn unless its kind is hidden (`hidden` has `k:<kind>`). */
export function searchHits(M, q, hidden) {
  const off = new Set((hidden ?? []).filter(k => k.startsWith("k:")).map(k => k.slice(2)));
  const drawn = n => n.kind === "comp" || !off.has(kindOf(n));
  const score = n => (n.name.toLowerCase() === q ? 0 : n.name.toLowerCase().startsWith(q) ? 1 : 2) + (n.site ? 3 : 0);
  const found = M.G.nodes.filter(n => drawn(n) && n.name?.toLowerCase().includes(q) && onBoard(M, n));
  found.sort((a, b) => score(a) - score(b) || a.mod - b.mod || a.line - b.line);
  return [...new Set(found.map(n => n.id))];
}
// whether a node has a token on the board: world imports are drawn in the world row; the rest in a region's rows or
// as a component's or a control header's token
function onBoard(M, n) {
  if (n.world && !n.from) return true;
  if (n.kind === "comp") return M.compRegion.has(n.id) || !!M.regions.get(n.region) || !!M.regions.get(`${n.mod}:r0`);
  return !!(M.regions.get(n.region) ?? M.regions.get(`${n.mod}:r0`));
}

/** The edges at these indexes (a trace's), as objects (fx's sparkle takes them). */
export const edgesAt = (M, idxs) => (idxs ?? []).map(i => M.G.edges[i]).filter(Boolean);

/** What the tooltip says about a name or a region. */
export function tipInfo(M, id) {
  const r = M.regions.get(id);
  if (r) {
    const info = controlInfo(M, r);
    return { region: true, micro: r.kind === "then" ? "branch" : r.kind, name: info.text, code: info.line ? moduleLine(M, r.mod, info.line) : "", kk: "", fam: "", hex: "", label: "", flags: "", where: "", key: "" };
  }
  const n = M.nodes.get(id);
  if (!n) return null;
  const kk = kindOf(n), f = FAM[kk] ?? "outside";
  return {
    region: false, micro: "", name: n.name, code: lineOf(M, n), kk, fam: f, hex: FAM_HEX[f], label: KIND[kk]?.label ?? n.kind,
    flags: `· ${f}${n.async ? " · can be pending" : ""}${n.io ? " · io" : ""}${n.world ? " · trust point" : ""}`,
    where: `${n.file}:${n.line}${n.status && n.status !== "same" ? ` · ${n.status}` : ""}`, key: n.key ?? "",
  };
}

/** The node a `#name` hash names: a name first, else a site with that name; "" if none. */
export function findByName(M, name) {
  if (!name) return "";
  const n = M.G.nodes.find(n => n.name === name && !n.site) ?? M.G.nodes.find(n => n.name === name);
  return n?.id ?? "";
}
