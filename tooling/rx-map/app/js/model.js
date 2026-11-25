// The map's model of a graph: what every view, trace, search and tooltip reads. The analysis (regions tree, ranks,
// control-flow heads, boundary notifiers, labels) is layout.mjs's `analyze`, the same the layout is computed from; this
// adds the counts, edge indexes and the reads the views make. Pure: `buildModel(graph)` returns a fresh model (the graph
// handed in is not changed); every other export reads one. Where things go on the board is layout.js.
import { FAM, FAM_HEX, KIND, SHAPE, STATUS, kindOf, famOf, edgeKey as edgeKeyOf } from "./vocab.js";
import { analyze, declTag } from "../../layout.mjs";

/** The model of a graph: what every view and trace reads. Opaque to RX; read through the functions below. */
export function buildModel(g) {
  // analyze copies the array, not its edges. The trace indexes below belong to this model only.
  const A = analyze({ ...g, edges: g.edges.map(e => ({ ...e })) }, { diff: !!g.diff });
  const M = { diff: !!g.diff, A, G: A.G, nodes: A.nodes, out: A.out, inc: A.inc, regions: A.regions, compRegion: A.compRegion,
    compOfRegion: A.compOfRegion, deps: A.deps, ctlSites: A.ctlSites, boundaryCover: A.boundaryCover, keyIds: A.keyIds };
  M.kindCount = {}; M.edgeCount = {};
  for (const n of M.G.nodes) { const k = n.kind === "comp" ? "comp" : kindOf(n); M.kindCount[k] = (M.kindCount[k] ?? 0) + 1; }
  for (const e of M.G.edges) { const k = edgeKeyOf(e); M.edgeCount[k] = (M.edgeCount[k] ?? 0) + 1; }
  // every edge gets an index: traces and the edge layer name edges by it
  M.G.edges.forEach((e, i) => { e.i = i; });
  return M;
}
export const graphOf = M => M.G;
/** The page title of a model's graph: its title, else its modules' file names (build.mjs computes it the same way). */
export const titleOf = M => M.G.title ?? (M.G.modules ?? []).map(m => m.split("/").pop()).join(", ");
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

export const label = (M, id) => M.A.label(id);
export const lineOf = (M, n) => M.A.lineOf(n);
/** A source line of a module, trimmed. */
export const moduleLine = (M, mod, line) => (M.G.lines?.[M.G.modules[mod]]?.[line] ?? "").trim();
/** What a control-flow region is (`if c`, `for x in xs`, `loading on(k)`), its line, and the read that decides it. */
export const controlInfo = (M, r) => M.A.controlInfo(r);
/** How many readers report to a boundary. */
export const coverCount = (M, id) => M.boundaryCover.get(id)?.size ?? 0;
/** A markup hole is named by what it reads: `{ total }`, `{ pending? users }`. */
export const readsOf = (M, n) => M.A.readsOf(n);

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

// ---- a token as the views draw it -------------------------------------------------------------------------------
/** A chip: one token's look (role, shape, marks, badges, diff status), as plain data. */
export function chipView(M, n) {
  const kk = kindOf(n), meta = KIND[kk] ?? { k: n.kind, label: n.kind };
  const badges = [];
  if (n.flavor) badges.push(n.flavor);
  if (n.from) badges.push(n.from);
  if (n.site) badges.push(`L${n.line}`);
  const chg = n.status === "changed" ? n.was ?? {} : {};
  const name = M.A.chipLabel(n);
  const status = n.status && n.status !== "same" ? n.status : "";
  return {
    id: n.id, key: n.key ?? "", kk, shape: SHAPE[kk] ?? "plug", fam: famOf(n), name, badges,
    site: !!n.site, async: !!n.async, question: n.kind === "source" && !!n.question, io: !!n.io, trust: !!n.world,
    chgAsync: "async" in chg, chgQuestion: "question" in chg, chgKind: "kind" in chg, chgIo: "io" in chg,
    status, mark: status ? STATUS[status] : "",
    // a JS import's declaration: where its rows come from (09 MO-11), the line itself on hover
    decl: n.decl ? { tag: declTag(n), origin: n.decl.origin,
      title: `${n.decl.line}\n${n.decl.origin === "written" ? "written in" : "generated from"} ${n.decl.from}${n.decl.origin === "brand" ? ` · ${n.decl.brands.join(", ")}` : n.decl.origin === "default" ? " · no brand: the default" : ""}` } : null,
    aria: `${meta.label ?? n.kind} ${name}${status ? `, ${status}` : ""}${n.decl ? `, declared ${n.decl.origin === "written" ? "in a .d.rx" : n.decl.origin === "brand" ? "by brands" : "by default"}` : ""}`,
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
