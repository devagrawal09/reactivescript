// The map's layout, as a pure function of the graph: where every module plate, region frame, token, cluster, view-text
// strip and reserved area goes, in board pixels. Computed once per graph and never changed by zoom: the three detail
// levels (overview, structure, detail) draw different things inside the same boxes, so moving between them shifts
// nothing. No DOM: sizes come from a fixed monospace metric, so the layout doesn't depend on fonts loading, and the same
// module serves the page (map.html, embedded by build.mjs), Node tools and tests.
//
//   import { analyze, layoutWorld, planTrunks } from "./layout.mjs";
//   const A = analyze(graph);                  // derived model: regions tree, ranks, control-flow labels, boundaries…
//   const L = layoutWorld(A, { aspect: 1.6 }); // the boxes
//   const routes = planTrunks(["3>0|read:tracked"], L);
//
// Rules kept by the layout: modules top to bottom in dependency order (a module sits in a lower band than everything
// it needs, so every arrow between modules points up); inside a frame, a token sits in a lower row than the tokens of
// its group it needs; nothing overlaps; the result is deterministic for a graph and options.

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/**
 * @typedef {object} Layout
 * @property {number} width  board width
 * @property {number} height board height
 * @property {Map<number|"world", Box & { key: number|"world", row: number, band: number }>} plates a module's plate
 *   (key = module index) or the "world" strip of JS imports
 * @property {{ top: number, bottom: number, keys: (number|"world")[] }[]} rows plate rows, top to bottom
 * @property {Map<string, Box & { id: string, kind: string, depth: number, parent: string|null, label: Box }>} frames
 *   region frames (module roots included, kind "program"), with their header box
 * @property {Map<string, Box & { id: string, level: 2|3, role: "named"|"site"|"label"|"world", region: string|null }>} tokens
 *   every token (node id; a control region's tag under its region id, role "label"); `level` is the first detail level
 *   that shows it
 * @property {(Box & { mod: number, unit: string, label: string, what: string })[]} clusters groups of a dense module's names
 * @property {Map<string, Box>} strips a region's view-text strip (detail level)
 * @property {(Box & { region: string, kind: "sites"|"strip" })[]} reserved areas the detail level fills (structure
 *   level shows them empty)
 * @property {(Box & { file: string, label: Box })[]} worldGroups JS imports grouped by file, in the world strip
 * @property {{ x: number, y: number }} gaps between plates in a row, between rows
 */

export const CTL = { then: "if", else: "else", for: "for", loading: "loading", errored: "errored" };
export const ORDER = ["props", "context", "source", "asource", "eq", "aeq", "action", "fn", "server", "errclass", "comp", "import"];
export const SHAPE = { source: "well", asource: "well", eq: "flow", aeq: "flow", props: "flow", reader: "flow", action: "act", handler: "act", effect: "ring", apply: "ring",
  import: "plug", server: "plug", fn: "plug", comp: "frm", context: "frm", prop: "frm", provide: "frm", errclass: "fail" };
export const kindOf = n => (n.kind === "source" && n.question ? "asource" : n.kind === "eq" && n.async ? "aeq" : n.kind);
const FRAME_WORD = { component: "component", for: "for each", then: "if · then", else: "else", loading: "loading", errored: "errored", children: "renders", imported: "renders (imported)" };
const REACTIVE = new Set(["reader", "prop", "effect", "provide"]);

// ---- analysis: what the map derives from a graph ---------------------------------------------------------------------
/**
 * The derived model the map draws from: the regions tree with each region's own nodes, edge indexes, dependency ranks,
 * component and module levels, control-flow labels, boundary notifier edges. Does not change `graph`.
 * @param {object} graph a `buildGraph` (or `diffGraphs`) result
 * @param {{ diff?: boolean }} [opts]
 */
export function analyze(graph, { diff = !!graph.diff } = {}) {
  const G = { ...graph, edges: [...graph.edges] };
  const nodes = new Map(G.nodes.map(n => [n.id, n]));
  const out = new Map(), inc = new Map();
  const link = e => { (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e); (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)).push(e); };
  for (const e of G.edges) link(e);
  const regions = new Map(G.regions.map(r => [r.id, { ...r, kids: [], nodes: [] }]));
  for (const r of regions.values()) if (r.parent && regions.has(r.parent)) regions.get(r.parent).kids.push(r);
  const compRegion = new Map();
  for (const n of G.nodes) {
    const r = regions.get(n.region);
    if (n.kind === "comp") {
      const cr = [...regions.values()].find(x => x.mod === n.mod && x.kind === "component" && x.name === n.name);
      if (cr) { compRegion.set(n.id, cr.id); continue; }
    }
    if (n.world && !n.from) continue;
    (r ?? regions.get(`${n.mod}:r0`))?.nodes.push(n);
  }
  const compOfRegion = new Map([...compRegion].map(([n, r]) => [r, n]));
  // depends(x): what x needs (reads, writes, calls, props it passes into): x sits below it
  const deps = new Map();
  for (const e of G.edges) {
    const [a, b] = e.type === "read" ? [e.to, e.from] : [e.from, e.to];
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    (deps.get(a) ?? deps.set(a, new Set()).get(a)).add(b);
  }
  const memo = (fn) => { const m = new Map(), path = new Set(); return id => { if (m.has(id)) return m.get(id); if (path.has(id)) return 0; path.add(id); const v = fn(id); path.delete(id); m.set(id, v); return v; }; };
  const rank = memo(id => { let r = 0; for (const d of deps.get(id) ?? []) r = Math.max(r, rank(d) + 1); return r; });
  const rendered = (r, acc = new Set()) => {
    for (const k of r.kids) {
      if (k.kind === "children" || k.kind === "imported") {
        const c = G.nodes.find(n => n.kind === "comp" && n.name === k.name && (n.mod === k.mod || !G.nodes.some(m => m.kind === "comp" && m.name === k.name && m.mod === k.mod)));
        if (c) acc.add(c.id);
      }
      rendered(k, acc);
    }
    return acc;
  };
  const compLevel = memo(compId => { const r = regions.get(compRegion.get(compId)); let l = 0; if (r) for (const c of rendered(r)) if (c !== compId) l = Math.max(l, compLevel(c) + 1); return l; });
  const modDeps = new Map(G.modules.map((_, i) => [i, new Set()]));
  for (const [a, ds] of deps) for (const b of ds) {
    const ma = nodes.get(a).mod, mb = nodes.get(b).mod;
    if (ma !== mb && !nodes.get(b).world) modDeps.get(ma)?.add(mb);
  }
  for (const n of G.nodes) if (n.kind === "comp") for (const c of rendered(regions.get(compRegion.get(n.id)) ?? { kids: [] })) {
    const mc = nodes.get(c).mod; if (mc !== n.mod) modDeps.get(n.mod)?.add(mc);
  }
  const modLevel = memo(m => { let l = 0; for (const d of modDeps.get(m) ?? []) l = Math.max(l, modLevel(d) + 1); return l; });
  const firstLine = r => Math.min(...r.nodes.map(n => n.line), ...r.kids.map(firstLine), 1e9);
  const empty = r => r.kind !== "component" && !r.nodes.length && r.kids.every(empty) && r.kind !== "children";
  const lineOf = n => ((n.status === "removed" ? G.linesBefore : G.lines)?.[n.file]?.[n.line] ?? "").trim();
  const ctlInfo = new Map();
  const controlInfo = r => {
    if (ctlInfo.has(r.id)) return ctlInfo.get(r.id);
    const L = firstLine(r), ls = (r.status === "removed" ? G.linesBefore : G.lines)?.[G.modules[r.mod]] ?? {};
    const pat = {
      then: [/(?:^|[{\s])if\s+(.+?)\s*\{/, m => `if ${m[1]}`],
      else: [/\belse\s+if\s+(.+?)\s*\{|\belse\b/, m => (m[1] ? `else if ${m[1]}` : "else")],
      for: [/\{\s*for\s+(.+?)\s*\{/, m => `for ${m[1]}`],
      loading: [/\bloading\b\s*(on\s*\([^)]*\))?/, m => (m[1] ? `loading ${m[1].replace(/\s+/g, "")}` : "loading")],
      errored: [/\berrored\b(?:\s+fallback\s*\(([^)]*)\))?/, m => (m[1] ? `errored (${m[1].trim()})` : "errored")],
    }[r.kind];
    let info = { text: CTL[r.kind] ?? r.kind, line: null, site: null };
    if (r.head) info = { text: r.head.text, line: r.head.line, site: null };
    else {
      let bound = L;
      const below = rr => { for (const k of rr.kids ?? []) { const h = CTL[k.kind] && controlInfo(k); if (h?.line) bound = Math.min(bound, h.line - 1); else below(k); } };
      below(r);
      if (pat && bound < 1e9) for (let i = bound; i >= Math.max(1, bound - 40); i--) {
        const m = ls[i] && pat[0].exec(ls[i]);
        if (m) { info = { text: pat[1](m), line: i, site: null }; break; }
      }
    }
    const kw = { then: "if", for: "for", loading: "loading on" }[r.kind];
    if (kw && info.line) info.site = regions.get(r.parent)?.nodes.find(n => n.site && n.name === kw && n.line === info.line) ?? null;
    ctlInfo.set(r.id, info);
    return info;
  };
  const ctlSites = new Set();
  for (const r of regions.values()) if (CTL[r.kind] && !empty(r)) { const i = controlInfo(r); if (i.site) ctlSites.add(i.site.id); }
  // boundaries: which names can make each show its fallback (see map.html's guide)
  const covered = (r, kind, acc = { sites: new Set(), seen: new Set() }) => {
    for (const n of r.nodes) if (n.site && REACTIVE.has(n.kind)) acc.sites.add(n.id);
    for (const k of r.kids) {
      const typed = k.kind === "errored" && /\(\s*\w+\s*:/.test(controlInfo(k).text);
      if (k.kind === "component" || (k.kind === kind && !typed)) continue;
      if ((k.kind === "children" || k.kind === "imported") && k.name)
        for (const c of G.nodes) if (c.kind === "comp" && c.name === k.name) {
          const cr = regions.get(compRegion.get(c.id));
          if (cr && !acc.seen.has(cr.id)) { acc.seen.add(cr.id); covered(cr, kind, acc); }
        }
      covered(k, kind, acc);
    }
    return acc;
  };
  const pendingRoots = siteIds => {
    const roots = new Map();
    for (const sid of siteIds) {
      const seen = new Set([sid]), todo = [sid];
      while (todo.length) for (const e of inc.get(todo.pop()) ?? []) {
        if (!((e.type === "read" && e.mode === "tracked" && !e.probe) || e.type === "passes") || seen.has(e.from)) continue;
        seen.add(e.from);
        const n = nodes.get(e.from);
        if (!n) continue;
        if (n.async && !n.site && !roots.has(n.id)) roots.set(n.id, sid);
        todo.push(e.from);
      }
    }
    return roots;
  };
  const boundaryCover = new Map();
  for (const r of regions.values()) {
    if ((r.kind !== "loading" && r.kind !== "errored") || empty(r)) continue;
    const { sites } = covered(r, r.kind);
    boundaryCover.set(r.id, sites);
    for (const [root, via] of pendingRoots(sites)) {
      const e = { from: root, to: r.id, type: "notifies", boundary: r.kind, via, status: diff ? "same" : undefined };
      G.edges.push(e); link(e);
    }
  }
  const keyIds = new Map();
  for (const n of G.nodes) if (n.key) (keyIds.get(n.key) ?? keyIds.set(n.key, []).get(n.key)).push(n.id);
  const label = id => nodes.get(id)?.name ?? (regions.get(id) ? (CTL[regions.get(id).kind] ? controlInfo(regions.get(id)).text : `<${regions.get(id).name}/>`) : id);
  const shorten = s => { const m = s.match(/\{([^{}]{1,40})\}/); return (m ? m[1].trim() : s).slice(0, 28); };
  // a markup hole is named by what it reads: `{ total }`, `{ pending? users }`
  const readsOf = n => [...new Set((inc.get(n.id) ?? []).filter(e => e.type === "read").map(e => (e.probe === "pending" ? "pending? " : e.probe ? `${e.probe} ` : "") + label(e.from) + (e.field ? `.${e.field}` : "")))].join(", ").slice(0, 34);
  /** the text a token shows for its name */
  const chipLabel = n => (n.site && n.name === "{…}" ? `{ ${readsOf(n) || shorten(lineOf(n))} }` : n.name);
  const modName = mi => (G.modules[mi] ?? "").split("/").pop().replace(/\.rx$/, "");
  // a dense module's names, by who uses them (another module, or a component of this one)
  const clusterNames = (list, mi) => {
    const ids = new Set(list.map(n => n.id));
    const unitOf = id => {
      const n = nodes.get(id);
      if (!n) { const rg = regions.get(id); return rg && rg.mod !== mi ? `m${rg.mod}` : null; }
      if (n.world && !n.from) return null;
      if (n.mod !== mi) return `m${n.mod}`;
      let r = regions.get(n.region);
      while (r && r.kind !== "component") r = regions.get(r.parent);
      return r ? `c${r.name}` : null;
    };
    const primary = new Map();
    const vote = (n, pick) => {
      const votes = new Map();
      for (const e of [...(out.get(n.id) ?? []), ...(inc.get(n.id) ?? [])]) { const o = e.from === n.id ? e.to : e.from; const u = pick(o); if (u) votes.set(u, (votes.get(u) ?? 0) + 1); }
      let best = null, bv = 0; for (const [u, v] of [...votes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (v > bv) { best = u; bv = v; }
      return best;
    };
    for (const n of list) { const u = vote(n, o => (ids.has(o) ? null : unitOf(o))); if (u) primary.set(n.id, u); }
    for (let it = 0; it < 3; it++) for (const n of list) if (!primary.has(n.id)) { const u = vote(n, o => ids.has(o) && primary.get(o)); if (u) primary.set(n.id, u); }
    const groups = new Map();
    for (const n of list) { const u = primary.get(n.id) ?? "core"; (groups.get(u) ?? groups.set(u, []).get(u)).push(n); }
    const small = [...groups].filter(([u, ns]) => ns.length < 2 && u !== "core");
    if (small.length > 1) for (const [u, ns] of small) { groups.delete(u); (groups.get("other") ?? groups.set("other", []).get("other")).push(...ns); }
    if (groups.size < 2) return null;
    return [...groups].map(([unit, ns]) => ({
      unit, nodes: ns,
      label: unit === "core" ? "inside" : unit === "other" ? "used by one each" : unit[0] === "m" ? "used by" : "used in",
      what: unit === "core" || unit === "other" ? `${ns.length}` : unit[0] === "m" ? modName(+unit.slice(1)) : `<${unit.slice(1)} />`,
    }));
  };
  const moduleLinks = () => {
    const w = new Map(), add = (a, b) => { if (a === b || a == null || b == null) return; const k = a < b ? `${a},${b}` : `${b},${a}`; w.set(k, (w.get(k) ?? 0) + 1); };
    const modOf = id => { const n = nodes.get(id); if (n) return n.world && !n.from ? null : n.mod; return regions.get(id)?.mod ?? null; };
    for (const e of G.edges) add(modOf(e.from), modOf(e.to));
    return w;
  };
  return { G, nodes, out, inc, regions, compRegion, compOfRegion, deps, ctlSites, boundaryCover, keyIds,
    rank, rendered, compLevel, modLevel, firstLine, empty, lineOf, controlInfo, label, readsOf, chipLabel, modName, clusterNames, moduleLinks };
}

// ---- sizes: a fixed monospace metric, so the layout is the same before and after fonts load -------------------------
/** Sizes of things, in px; `mono` is a monospace character's width in ems. */
export const METRICS = {
  // a monospace glyph is .6em; .64 leaves slack for hinting at small sizes
  mono: .64, sans: .56, nameFont: 13.5, siteFont: 12.5, badgeFont: 10, tagFont: 12.5, stripFont: 12, labelFont: 12,
  namedH: 34, siteH: 28, labelH: 30, stripH: 30,
  gapX: 16, siteGapX: 14, rowGap: 56, lineGap: 30,
  frame: { t: 12, x: 16, b: 18 }, plate: { t: 46, x: 24, b: 28 }, cluster: { t: 26, x: 14, b: 16, gapX: 26, gapY: 24 },
  kidsGap: 20, sitesSep: 44, stripGap: 16, compMin: 420, viewMin: 300,
  plates: { gapX: 90, gapY: 120, pad: 70 },
};
const monoW = (text, font, M) => String(text).length * font * M.mono;
/** A token's box size: its icon, name, marks and badges, in the page's chip paddings. */
export function tokenSize(n, A, M = METRICS) {
  const kk = kindOf(n), shape = SHAPE[kk] ?? "plug", site = !!n.site;
  const pad = shape === "act" ? (site ? [13, 19] : [15, 22]) : shape === "ring" ? [15, 17] : site ? [8, 11] : [10, 14];
  let w = pad[0] + pad[1] + 14 + 6 + monoW(A.chipLabel(n), site ? M.siteFont : M.nameFont, M);
  if (n.async) w += 13 + 6;
  if (n.kind === "source" && n.question) w += 15 + 6;
  const badges = [n.flavor, n.from, site ? `L${n.line}` : null].filter(Boolean);
  for (const b of badges) w += 6 + 10 + monoW(b, M.badgeFont, M);
  return { w: Math.ceil(Math.min(w, 420)), h: site ? M.siteH : M.namedH };
}

// ---- inside a frame: tokens in rows of dependency, wrapped to the width -----------------------------------------------
// A row per step of dependency within the group (a token sits below the tokens of its group it needs), sorted by role
// then line; a row wider than the frame wraps onto more lines; lines are centred.
function rankRows(list, A) {
  const inSet = new Set(list.map(n => n.id)), memo = new Map(), path = new Set();
  const local = id => {
    if (memo.has(id)) return memo.get(id);
    if (path.has(id)) return 0;
    path.add(id);
    let r = 0;
    for (const d of A.deps.get(id) ?? []) if (inSet.has(d) && d !== id) r = Math.max(r, local(d) + 1);
    path.delete(id); memo.set(id, r);
    return r;
  };
  const byRank = new Map();
  for (const n of list) { const k = local(n.id); (byRank.get(k) ?? byRank.set(k, []).get(k)).push(n); }
  return [...byRank.keys()].sort((a, b) => a - b).map(k => byRank.get(k).sort((a, b) => ORDER.indexOf(kindOf(a)) - ORDER.indexOf(kindOf(b)) || a.line - b.line || (a.id < b.id ? -1 : 1)));
}
function flowTokens(groups, x, y, w, gapX, ctx, extra) {
  const M = ctx.M;
  let cy = y;
  groups.forEach((g, gi) => {
    if (gi) cy += g[0]?.site ? M.rowGap - 12 : M.rowGap;   // between steps of dependency: room for the arrows
    const lines = [[]]; let lw = 0;
    for (const n of g) {
      const s = ctx.size(n);
      if (lines.at(-1).length && lw + gapX + s.w > w) { lines.push([]); lw = 0; }
      lw += (lines.at(-1).length ? gapX : 0) + s.w; lines.at(-1).push([n, s]);
    }
    lines.forEach((line, li) => {
      if (li) cy += M.lineGap;                              // a wrapped line: room for value badges under tokens
      const lineW = line.reduce((a, [, s]) => a + s.w, 0) + gapX * (line.length - 1);
      const h = Math.max(...line.map(([, s]) => s.h));
      let cx = x + Math.max(0, (w - lineW) / 2);
      for (const [n, s] of line) { ctx.token(n, cx, cy + (h - s.h) / 2, s, extra); cx += s.w + gapX; }
      cy += h;
    });
  });
  return cy - y;
}
// the natural width of token rows: the widest row, unwrapped
const rowsWidth = (groups, gapX, ctx) => Math.max(0, ...groups.map(g => g.reduce((a, n) => a + ctx.size(n).w, 0) + gapX * (g.length - 1)));

// estimate of a region's view-text strip width (one line)
function stripWidth(r, A, M) {
  let chars = 0;
  for (const p of r.outline ?? []) {
    if (p.br) chars += 3;
    else if ("attr" in p) chars += p.attr.length + p.text.length + 4;
    else if ("text" in p) chars += p.text.length;
    else if ("site" in p) { const n = A.nodes.get(p.site); if (n && !A.ctlSites.has(p.site)) chars += Math.min(22, A.chipLabel(n).length) + 3; }
    else if ("region" in p) { const k = A.regions.get(p.region); if (k && !A.empty(k)) chars += (CTL[k.kind] ? A.controlInfo(k).text.length : (k.name ?? k.kind).length + 4) + 3; }
  }
  return 60 + chars * M.stripFont * M.mono;
}
const hasStrip = r => r.outline?.some(p => "text" in p || "site" in p);

// ---- a region's frame: header, names, sites, view text, then the regions inside ---------------------------------------
function layRegion(r, x, y, w, ctx, depth, parent) {
  const { A, M } = ctx;
  const isRoot = r.kind === "program";
  const pad = isRoot ? M.plate : M.frame;
  const inner = w - 2 * pad.x;
  const top = y;
  ctx.frames.set(r.id, { id: r.id, kind: r.kind, x, y, w, h: 0, depth, parent, label: { x: x + pad.x, y: y + (isRoot ? 12 : pad.t), w: inner, h: M.labelH } });
  let cy = y + pad.t + (isRoot ? 0 : M.labelH + 12);
  // the header's own tokens: a component's name, a control construct's tag (and what it reads)
  if (!isRoot) {
    const comp = r.kind === "component" ? A.G.nodes.find(n => A.compRegion.get(n.id) === r.id) : null;
    const lx = x + pad.x, ly = y + pad.t;
    if (comp) { const s = ctx.size(comp); ctx.token(comp, lx, ly + 1, { w: s.w, h: M.labelH - 2 }, { role: "label", region: r.id, level: 2 }); }
    else if (CTL[r.kind]) {
      const info = A.controlInfo(r);
      // the tag, and what it reads beside it; in a narrow frame both shrink (the page cuts their text) to fit the header
      const sw0 = info.site ? ctx.size(info.site).w : 0;
      let tw = Math.min(inner, 70 + monoW(info.text, M.tagFont, M) + 24);
      if (info.site) tw = Math.min(tw, Math.max(80, inner - sw0 - 8));
      ctx.tokens.set(r.id, { id: r.id, x: lx, y: ly, w: tw, h: M.labelH, role: "label", region: r.id, level: 2 });
      if (info.site) ctx.token(info.site, lx + tw + 8, ly + 2, { w: Math.max(24, Math.min(sw0, inner - tw - 8)), h: M.labelH - 4 }, { role: "label", region: r.id, level: 3 });
    }
  }
  const named = r.nodes.filter(n => !n.site), sites = r.nodes.filter(n => n.site && !A.ctlSites.has(n.id));
  const groups = isRoot && named.length > 10 ? A.clusterNames(named, r.mod) : null;
  if (groups) {
    // clusters, in the order of the plates that use them (ctx.clusterOrder), flowed in lines
    const C = M.cluster;
    const order = ctx.clusterOrder?.(r.mod) ?? (u => (u === "core" ? -1 : 0));
    groups.sort((a, b) => order(a.unit) - order(b.unit) || (a.unit < b.unit ? -1 : 1));
    const boxes = groups.map(g => { const rr = rankRows(g.nodes, A); return { g, rr, w: Math.min(inner, Math.max(160, rowsWidth(rr, M.gapX, ctx) + 2 * C.x, 30 + monoW(`${g.label} ${g.what}`, 10, M))) }; });
    let lines = [[]], lw = 0;
    for (const b of boxes) { if (lines.at(-1).length && lw + C.gapX + b.w > inner) { lines.push([]); lw = 0; } lw += (lines.at(-1).length ? C.gapX : 0) + b.w; lines.at(-1).push(b); }
    for (const line of lines) {
      const lineW = line.reduce((a, b) => a + b.w, 0) + C.gapX * (line.length - 1);
      let cx = x + pad.x + (inner - lineW) / 2, lh = 0;
      for (const b of line) {
        const h = C.t + flowTokens(b.rr, cx + C.x, cy + C.t, b.w - 2 * C.x, M.gapX, ctx, { region: r.id }) + C.b;
        ctx.clusters.push({ mod: r.mod, unit: b.g.unit, label: b.g.label, what: b.g.what, x: cx, y: cy, w: b.w, h });
        lh = Math.max(lh, h); cx += b.w + C.gapX;
      }
      cy += lh + C.gapY;
    }
    cy -= C.gapY;
  } else if (named.length) cy += flowTokens(rankRows(named, A), x + pad.x, cy, inner, M.gapX, ctx, { region: r.id });
  // view sites: the detail level's; reserved
  if (sites.length) {
    if (cy > y + pad.t + (isRoot ? 0 : M.labelH + 12)) cy += M.sitesSep;
    const sy = cy;
    cy += flowTokens(rankRows(sites, A), x + pad.x, cy, inner, M.siteGapX, ctx, { region: r.id });
    ctx.reserved.push({ region: r.id, kind: "sites", x: x + pad.x, y: sy, w: inner, h: cy - sy });
  }
  // the view text strip: one line, reserved
  if (hasStrip(r)) {
    cy += M.stripGap;
    const sw = Math.min(inner, stripWidth(r, A, M));
    const box = { x: x + pad.x + (inner - sw) / 2, y: cy, w: sw, h: M.stripH };
    ctx.strips.set(r.id, box);
    ctx.reserved.push({ region: r.id, kind: "strip", ...box });
    cy += M.stripH;
  }
  // regions inside: components by what renders what, then the view's regions side by side, then the mounts
  const kids = r.kids.filter(k => !A.empty(k));
  const extra = isRoot ? [...A.regions.values()].filter(k => k.mod === r.mod && !k.parent && k.id !== r.id && !A.empty(k)) : [];
  const comps = kids.filter(k => k.kind === "component");
  const byLevel = new Map();
  for (const k of comps) { const l = A.compLevel(A.compOfRegion.get(k.id)); (byLevel.get(l) ?? byLevel.set(l, []).get(l)).push(k); }
  const gridOf = (list, min) => {
    const n = list.length, cols = Math.max(1, Math.min(n, Math.floor((inner + M.kidsGap) / (min + M.kidsGap))));
    const cw = (inner - M.kidsGap * (cols - 1)) / cols;
    for (let i = 0; i < n; i += cols) {
      cy += M.kidsGap;
      let rh = 0;
      list.slice(i, i + cols).forEach((k, j) => { rh = Math.max(rh, layRegion(k, x + pad.x + j * (cw + M.kidsGap), cy, cw, ctx, depth + 1, r.id)); });
      cy += rh;
    }
  };
  for (const l of [...byLevel.keys()].sort((a, b) => a - b)) gridOf(byLevel.get(l).sort((a, b) => A.firstLine(a) - A.firstLine(b) || (a.id < b.id ? -1 : 1)), M.compMin);
  const rest = kids.filter(k => k.kind !== "component").sort((a, b) => A.firstLine(a) - A.firstLine(b) || (a.id < b.id ? -1 : 1));
  const mounts = rest.filter(k => k.kind === "children" || k.kind === "imported");
  const view = rest.filter(k => !mounts.includes(k));
  if (view.length) gridOf(view, M.viewMin);
  if (mounts.length) {
    cy += 12;
    let cx = x + pad.x, lh = 0;
    for (const k of mounts) {
      const mw = Math.min(inner, 24 + monoW(`${FRAME_WORD[k.kind]} <${k.name ?? ""} />`, M.labelFont, M));
      if (cx > x + pad.x && cx + mw > x + pad.x + inner) { cx = x + pad.x; cy += lh + 8; lh = 0; }
      ctx.frames.set(k.id, { id: k.id, kind: k.kind, x: cx, y: cy, w: mw, h: 28, depth: depth + 1, parent: r.id, label: { x: cx + 8, y: cy, w: mw - 16, h: 28 } });
      ctx.tokens.set(k.id, { id: k.id, x: cx, y: cy, w: mw, h: 28, role: "label", region: k.id, level: 2 });
      cx += mw + 8; lh = Math.max(lh, 28);
    }
    cy += lh;
  }
  for (const k of extra) { cy += M.kidsGap; cy += layRegion(k, x + pad.x, cy, inner, ctx, depth + 1, r.id); }
  const h = cy - top + pad.b;
  ctx.frames.get(r.id).h = h;
  return h;
}

// ---- the world: plates in bands ----------------------------------------------------------------------------------
/**
 * Orders the modules within each band to cut crossings (barycenters of the modules they share edges with, swept down
 * and up). `bands`: arrays of module ids, sorted in place; `weight(a, b)`: edges between two modules.
 */
export function orderBands(bands, weight) {
  const pos = new Map();
  const setPos = () => bands.forEach(b => b.forEach((mi, i) => pos.set(mi, (i + .5) / b.length)));
  setPos();
  const bary = (mi, others) => { let s = 0, n = 0; for (const o of others) { const w = weight(mi, o); if (w) { s += w * pos.get(o); n += w; } } return n ? s / n : pos.get(mi); };
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 ? [...bands.keys()].reverse() : [...bands.keys()];
    for (const k of order) {
      const others = bands.filter((_, j) => j !== k).flat();
      const bc = new Map(bands[k].map(mi => [mi, bary(mi, others)]));
      bands[k].sort((a, b) => bc.get(a) - bc.get(b) || a - b);
      setPos();
    }
  }
  return bands;
}

/**
 * The layout of the whole world, sized for the detail level (everything every level can show has its place).
 * @param {ReturnType<typeof analyze>} A
 * @param {{ aspect?: number, metrics?: Partial<typeof METRICS>, size?: (node: object) => { w: number, h: number } }} [opts]
 *   `aspect`: the screen's width / height the world should roughly take (bands wrap to it); `size` overrides token sizes
 * @returns {Layout}
 */
export function layoutWorld(A, { aspect = 1.6, metrics = {}, size } = {}) {
  const M = { ...METRICS, ...metrics };
  const sizeMemo = new Map();
  const sizeOf = n => { if (!sizeMemo.has(n.id)) sizeMemo.set(n.id, size?.(n) ?? tokenSize(n, A, M)); return sizeMemo.get(n.id); };
  const P = M.plates;
  const mods = A.G.modules.map((_, mi) => mi).filter(mi => A.regions.get(`${mi}:r0`));
  const tokenCount = mi => A.G.nodes.filter(n => n.mod === mi && !(n.world && !n.from)).length;
  const baseW = mi => Math.round(Math.min(1250, Math.max(360, 128 * Math.sqrt(tokenCount(mi) + 2))));
  const links = A.moduleLinks(), weight = (a, b) => links.get(a < b ? `${a},${b}` : `${b},${a}`) ?? 0;
  const bandsMap = new Map();
  for (const mi of mods) { const l = A.modLevel(mi); (bandsMap.get(l) ?? bandsMap.set(l, []).get(l)).push(mi); }
  const bands = [...bandsMap.keys()].sort((a, b) => a - b).map(l => bandsMap.get(l));
  orderBands(bands, weight);
  // a plate laid out alone at a width, at the origin: its height
  const measure = (mi, w, clusterOrder) => {
    const ctx = { A, M, size: sizeOf, frames: new Map(), tokens: new Map(), clusters: [], strips: new Map(), reserved: [], clusterOrder,
      token(n, x, y, s, extra) { this.tokens.set(n.id, { id: n.id, x, y, w: s.w, h: s.h, role: extra?.role ?? (n.site ? "site" : "named"), region: extra?.region ?? n.region ?? null, level: extra?.level ?? (n.site ? 3 : 2) }); } };
    const h = layRegion(A.regions.get(`${mi}:r0`), 0, 0, w, ctx, 0, null);
    return { h, ctx };
  };
  const widths = new Map(mods.map(mi => [mi, baseW(mi)]));
  let heights = new Map(mods.map(mi => [mi, measure(mi, widths.get(mi)).h]));
  const area = mods.reduce((a, mi) => a + (widths.get(mi) + P.gapX) * (heights.get(mi) + P.gapY), 0);
  const maxRow = Math.max(...mods.map(mi => widths.get(mi)), Math.sqrt(area * aspect) * 1.05);
  const rows = [];
  for (const band of bands) {
    let row = [], w = 0;
    for (const mi of band) {
      const sw = widths.get(mi);
      if (row.length && w + P.gapX + sw > maxRow) { rows.push(row); row = []; w = 0; }
      w += (row.length ? P.gapX : 0) + sw; row.push(mi);
    }
    if (row.length) rows.push(row);
  }
  const widthOf = r => r.reduce((a, mi) => a + widths.get(mi), 0) + P.gapX * (r.length - 1);
  let contentW = Math.max(...rows.map(widthOf), 400);
  // a row narrower than the world gives its spare width to its plates, the tallest the most
  for (const r of rows) {
    const slack = contentW - widthOf(r); if (slack < 120) continue;
    const hs = r.reduce((a, mi) => a + heights.get(mi), 0);
    for (const mi of r) { const w0 = widths.get(mi); widths.set(mi, Math.round(Math.min(w0 + slack * heights.get(mi) / hs, w0 * 3, 2600))); }
  }
  contentW = Math.max(...rows.map(widthOf), 400);
  // the world strip of JS imports, on top: groups by file, flowed
  const world = A.G.nodes.filter(n => n.world && !n.from);
  const place = clusterOrder => {
    const L = { width: 0, height: 0, plates: new Map(), rows: [], frames: new Map(), tokens: new Map(), clusters: [], strips: new Map(), reserved: [], worldGroups: [], gaps: { x: P.gapX, y: P.gapY } };
    let y = P.pad;
    if (world.length) {
      const byFile = new Map();
      for (const n of [...world].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))) (byFile.get(n.file) ?? byFile.set(n.file, []).get(n.file)).push(n);
      const x0 = P.pad + 18, inner = contentW - 36;
      let cx = x0, cy = y + 40, lh = 0;
      for (const [file, ns] of byFile) {
        const tw = ns.reduce((a, n) => a + sizeOf(n).w, 0) + M.gapX * (ns.length - 1);
        const gw = Math.min(inner, Math.max(tw, monoW(`from ${file}`, 11, M)));
        if (cx > x0 && cx + gw > x0 + inner) { cx = x0; cy += lh + 18; lh = 0; }
        let tx = cx, ty = cy + 20, rowH = M.namedH;
        for (const n of ns) { const s = sizeOf(n); if (tx > cx && tx + s.w > cx + gw) { tx = cx; ty += M.namedH + 12; rowH += M.namedH + 12; } L.tokens.set(n.id, { id: n.id, x: tx, y: ty, w: s.w, h: s.h, role: "world", region: null, level: 2 }); tx += s.w + M.gapX; }
        L.worldGroups.push({ file, x: cx, y: cy, w: gw, h: 20 + rowH, label: { x: cx, y: cy, w: gw, h: 16 } });
        lh = Math.max(lh, 20 + rowH); cx += gw + 30;
      }
      const h = cy + lh + 18 - y;
      L.plates.set("world", { key: "world", x: P.pad, y, w: contentW, h, row: 0, band: -1 });
      L.rows.push({ top: y, bottom: y + h, keys: ["world"] });
      y += h + P.gapY;
    }
    for (const r of rows) {
      const ms = r.map(mi => [mi, measure(mi, widths.get(mi), clusterOrder)]);
      const h = Math.max(...ms.map(([, m]) => m.h));
      let x = P.pad + (contentW - widthOf(r)) / 2;
      const ri = L.rows.length;
      L.rows.push({ top: y, bottom: y + h, keys: r });
      for (const [mi, m] of ms) {
        const w = widths.get(mi);
        L.plates.set(mi, { key: mi, x, y, w, h: m.h, row: ri, band: A.modLevel(mi) });
        const sh = b => ({ ...b, x: b.x + x, y: b.y + y });
        for (const [id, f] of m.ctx.frames) L.frames.set(id, { ...sh(f), label: sh(f.label) });
        for (const [id, t] of m.ctx.tokens) L.tokens.set(id, sh(t));
        for (const c of m.ctx.clusters) L.clusters.push(sh(c));
        for (const [id, s] of m.ctx.strips) L.strips.set(id, sh(s));
        for (const v of m.ctx.reserved) L.reserved.push(sh(v));
        x += w + P.gapX;
      }
      y += h + P.gapY;
    }
    L.width = contentW + 2 * P.pad;
    L.height = y - P.gapY + P.pad;
    return L;
  };
  // clusters face their consumers: a second pass orders each dense plate's clusters by where the plates using them are
  const first = place(null);
  const cx = mi => { const p = first.plates.get(mi); return p ? p.x + p.w / 2 : 1e6; };
  return place(() => u => (u === "core" ? -1e6 : u[0] === "m" ? cx(+u.slice(1)) : 1e6 - 1));
}

// ---- routes between plates ------------------------------------------------------------------------------------------
// the x of each gap a route can climb through in a row: left of the first plate, between plates, right of the last
export function channels(row, L, g = L.gaps.x) {
  const ps = row.keys.map(k => L.plates.get(k)).sort((a, b) => a.x - b.x);
  const xs = [ps[0].x - g / 2];
  for (let i = 1; i < ps.length; i++) xs.push((ps[i - 1].x + ps[i - 1].w + ps[i].x) / 2);
  xs.push(ps.at(-1).x + ps.at(-1).w + g / 2);
  return xs;
}
/**
 * Plans bundles between plates. `pairs`: keys `a>b` or `a>b|kind` (plate keys; a below b). Every bundle gets a port on
 * a's top and one on b's bottom, spread so bundles don't share them, the gaps it climbs through in the rows between,
 * and a lane in each gutter and gap it uses. Returns key → points [[x, y], …] from a's top to b's bottom.
 * @param {Iterable<string>} pairs
 * @param {Layout} L
 */
export function planTrunks(pairs, L) {
  const plan = new Map();
  const pk = k => (k === "world" ? "world" : +k);
  const P = k => { const p = L.plates.get(k); return p && { l: p.x, r: p.x + p.w, t: p.y, b: p.y + p.h, row: p.row }; };
  const cx = p => (p.l + p.r) / 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ok = [...pairs].map(key => { const [a, b] = key.split("|")[0].split(">"); return { key, a, b }; }).filter(({ a, b }) => { const A = P(pk(a)), B = P(pk(b)); return A && B && A.row > B.row; });
  const outs = new Map(), ins = new Map();
  for (const r of ok) { (outs.get(r.a) ?? outs.set(r.a, []).get(r.a)).push(r); (ins.get(r.b) ?? ins.set(r.b, []).get(r.b)).push(r); }
  const spread = (p, list, end) => {
    const xs = new Map(), sorted = [...list].sort((x, y) => cx(P(pk(x[end]))) - cx(P(pk(y[end]))) || (x.key < y.key ? -1 : 1));
    const w = p.r - p.l, span = Math.min(w * .7, 22 * (sorted.length - 1)), x0 = cx(p) - span / 2;
    sorted.forEach((r, i) => xs.set(r.key, sorted.length === 1 ? clamp(cx(P(pk(r[end]))), p.l + w * .25, p.r - w * .25) : x0 + (span * i) / (sorted.length - 1)));
    return xs;
  };
  const outX = new Map([...outs].map(([a, l]) => [a, spread(P(pk(a)), l, "b")])), inX = new Map([...ins].map(([b, l]) => [b, spread(P(pk(b)), l, "a")]));
  const routes = ok.map(({ key, a, b }) => {
    const A = P(pk(a)), B = P(pk(b)), xa = outX.get(a).get(key), xb = inX.get(b).get(key);
    const steps = []; let x = xa;
    for (let i = A.row - 1; i > B.row; i--) {
      const ch = channels(L.rows[i], L);
      let c = 0, cost = Infinity;
      ch.forEach((cxv, j) => { const k = Math.abs(cxv - xb) + Math.abs(cxv - x) * .6; if (k < cost) { cost = k; c = j; } });
      steps.push({ row: i, ch: c, x: ch[c] }); x = ch[c];
    }
    return { key, A, B, xa, xb, steps };
  });
  const lanes = new Map(), take = (slot, r) => (lanes.get(slot) ?? lanes.set(slot, []).get(slot)).push(r);
  for (const r of routes) { take(`g${r.A.row}`, r); for (const s of r.steps) { take(`g${s.row}`, r); take(`c${s.row}:${s.ch}`, r); } }
  const laneOf = new Map();
  for (const [slot, rs] of lanes) { rs.sort((p, q) => p.xb - q.xb || p.xa - q.xa || (p.key < q.key ? -1 : 1)); rs.forEach((r, i) => laneOf.set(`${slot}|${r.key}`, i - (rs.length - 1) / 2)); }
  const lg = slot => clamp(L.gaps.y * .7 / Math.max(1, lanes.get(slot).length), 4, 12), lc = slot => clamp(L.gaps.x * .6 / Math.max(1, lanes.get(slot).length), 4, 12);
  const gy = (i, r) => (L.rows[i - 1].bottom + L.rows[i].top) / 2 + laneOf.get(`g${i}|${r.key}`) * lg(`g${i}`);
  for (const r of routes) {
    const pts = [[r.xa, r.A.t], [r.xa, gy(r.A.row, r)]];
    for (const s of r.steps) {
      const x = s.x + laneOf.get(`c${s.row}:${s.ch}|${r.key}`) * lc(`c${s.row}:${s.ch}`);
      pts.push([x, gy(s.row + 1, r)], [x, gy(s.row, r)]);
    }
    pts.push([r.xb, pts.at(-1)[1]], [r.xb, r.B.b]);
    plan.set(r.key, pts);
  }
  return plan;
}

/**
 * The zoom thresholds between detail levels. A level comes in only once its text reads at `minText` px on screen or
 * more: the structure level (2) when a name (`METRICS.nameFont`) does, the detail level (3) when a view site's text
 * (`METRICS.siteFont`) does. Going back down waits `hysteresis` lower, so a zoom resting near a threshold doesn't flicker.
 */
export function levelThresholds({ minText = 11, hysteresis = .05, metrics = METRICS } = {}) {
  const at = font => Math.ceil((minText / font) * 100) / 100;
  const up = { 1: at(metrics.nameFont), 2: at(metrics.siteFont) };
  return { up, down: { 2: +(up[1] - hysteresis).toFixed(2), 3: +(up[2] - hysteresis).toFixed(2) }, minText };
}
/** The thresholds the page uses: up 1→2 at .82, 2→3 at .88; down 3→2 below .83, 2→1 below .77. */
export const LEVELS = levelThresholds();
/** The detail level for a zoom, with hysteresis: `prev` is the current level. */
export function levelFor(s, prev = 3, LV = LEVELS) {
  let l = prev;
  if (l === 1 && s >= LV.up[1]) l = 2;
  if (l === 2 && s >= LV.up[2]) l = 3;
  if (l === 3 && s < LV.down[3]) l = 2;
  if (l === 2 && s < LV.down[2]) l = 1;
  return l;
}
