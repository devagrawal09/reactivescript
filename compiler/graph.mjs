// Turns `rxc model`'s resolved model (spec/11 CP-6) into the graph used by HMR and the map: one node per named thing (a source, an
// equation, an action, a function, a server function, a context, an error class, a JS import) and one per unnamed site (a
// markup read, a handler, a prop, an effect), regions as nested frames, and an edge per read, write and call. Imports of
// another .rx module are folded into the symbol they name, so a module's state is drawn once, where it lives.
import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

/** Computations that are a named symbol's own body: they draw as that symbol, not as a separate site. */
const OWNED = new Set(["seed", "memo", "question", "keyed", "deferred", "action", "fn", "server", "default"]);

export function buildGraph(model, { root = process.cwd(), source = f => readFileSync(f, "utf8") } = {}) {
  const files = model.map(m => resolve(root, m.file));
  const rel = f => relative(root, f) || f;
  const nodes = [], edges = [], regions = [], lines = {};
  const symNode = new Map();   // `${mi}:${symId}` → node id (after import folding)
  const byName = new Map();    // `${abs}:${name}` → node id, for import folding

  const src = files.map(f => { try { return source(f).split("\n"); } catch { return []; } });
  // every line of every module: the map labels control flow (`if …`, `for …`, `loading on(…)`) from the source
  src.forEach((ls, mi) => { const m = (lines[rel(files[mi])] = {}); ls.forEach((t, i) => { if (t.trim()) m[i + 1] = t; }); });
  const keepLine = () => {};
  // A JS import's declaration line number in `decl.from` (`at`, 1-based), when the file is there to read: the `.d.rx`
  // line itself, or the TS module's export of the name. The model has the line's text, not its number.
  const declFiles = new Map();
  const declAt = (d, name, importer) => {
    if (!d?.from) return {};
    const file = [resolve(root, d.from), resolve(dirname(importer), d.from)].find(f => {
      if (!declFiles.has(f)) { try { declFiles.set(f, source(f).split("\n")); } catch { declFiles.set(f, null); } }
      return declFiles.get(f);
    });
    const ls = file ? declFiles.get(file) : null;
    if (!ls) return {};
    const id = name.replace(/[$]/g, "\\$");
    const pats = /\.d\.rx$/.test(d.from) ? [l => l.trim() === d.line.trim(), l => new RegExp(`^\\s*export\\b.*\\b(?:fn|error|const|let)\\s+${id}\\b`).test(l)]
      : [l => new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${id}\\b`).test(l),
        l => new RegExp(`^\\s*export\\s*\\{[^}]*\\b${id}\\b`).test(l)];
    for (const p of pats) { const i = ls.findIndex(p); if (i >= 0) return { at: i + 1 }; }
    return {};
  };

  // The model marks an imported source with `from`; other imported names (actions, equations, components, error
  // classes) carry no `from`, so read it off their import line.
  const importFrom = (mi, s) => {
    if (s.from) return s.from;
    const text = src[mi][s.line - 1] ?? "";
    const m = /^\s*import\b[^"']*["']([^"']+)["']/.exec(text);
    if (!m || !/\.rx$/.test(m[1])) return null;
    return new RegExp(`[{,\\s]${s.name}[\\s,}]`).test(text) ? m[1] : null;
  };
  model.forEach((m, mi) => { for (const s of m.symbols) { const f = importFrom(mi, s); if (f) s.from = f; } });

  // 1. regions and own symbols
  model.forEach((m, mi) => {
    const file = rel(files[mi]);
    for (const r of m.regions) {
      regions.push({ id: `${mi}:r${r.id}`, mod: mi, kind: r.kind, name: r.name ?? null,
        parent: r.parent == null ? null : `${mi}:r${r.parent}`,
        ...(r.arms ? { arms: r.arms.map(a => ({ ...a })) } : {}),
        ...(r.outline ? { outline: r.outline.map(p => "site" in p ? { ...p, site: `${mi}:c${p.site}` }
          : "region" in p ? { ...p, region: `${mi}:r${p.region}` } : { ...p }) } : {}) });
      for (const p of r.outline ?? []) if (p.line != null) keepLine(mi, p.line);
    }
    for (const s of m.symbols) {
      if (s.from) continue;                        // folded below
      const id = `${mi}:s${s.id}`;
      const spec = /^\s*import\b[^"']*?\bfrom\s+["']([^"']+)["']/.exec(src[mi].slice(s.line - 1, s.line + 20).join("\n"))?.[1];
      nodes.push({ id, mod: mi, file, kind: s.kind, name: s.name, line: s.line, region: `${mi}:r${s.region}`,
        io: !!s.io, question: !!s.question, async: !!s.question, world: s.kind === "import",
        ...(spec && !spec.endsWith(".rx") ? { jsFrom: spec } : {}),
        // a JS import's effective declaration (09 MO-11): its line, the file it is from (a written `.d.rx`, or the TS
        // module it was generated from), and its origin (`written`, `helper` with the helpers, `default`)
        ...(s.decl ? { decl: { line: s.decl.line, from: s.decl.from, origin: s.decl.origin, helpers: s.decl.helpers ?? [],
          ...declAt(s.decl, s.name, files[mi]) } } : {}),
        ...(s.key ? { rxKey: s.key } : {}) });
      symNode.set(`${mi}:${s.id}`, id);
      byName.set(`${files[mi]}:${s.name}`, id);
      keepLine(mi, s.line);
    }
  });

  // 2. fold `.rx` imports into the symbol they name; props resolve to their component
  model.forEach((m, mi) => {
    for (const s of m.symbols) {
      if (!s.from) continue;
      const target = resolve(dirname(files[mi]), s.from);
      const id = byName.get(`${target}:${s.name}`) ?? byName.get(`${target.replace(/\.rx$/, "")}.rx:${s.name}`);
      if (id) symNode.set(`${mi}:${s.id}`, id);
      else {
        const nid = `${mi}:s${s.id}`;
        nodes.push({ id: nid, mod: mi, file: rel(files[mi]), kind: s.kind, name: s.name, line: s.line,
          region: `${mi}:r${s.region}`, io: !!s.io, question: !!s.question, async: !!s.question, world: true, from: s.from });
        symNode.set(`${mi}:${s.id}`, nid);
        keepLine(mi, s.line);
      }
    }
  });

  // 3. computations: owned ones merge into their symbol, the rest become sites
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  model.forEach((m, mi) => {
    const file = rel(files[mi]);
    const compOwner = new Map();  // computation id → node id
    const ownerOf = c => {
      if (OWNED.has(c.kind) && c.name) {
        const s = m.symbols.find(s => s.name === c.name && !s.from && s.kind !== "props"
          && (s.region === c.region || s.line === c.line)) ?? m.symbols.find(s => s.name === c.name && !s.from);
        if (s) return symNode.get(`${mi}:${s.id}`);
      }
      return null;
    };
    for (const c of m.computations) {
      let owner = c.kind === "apply" && c.in != null ? compOwner.get(c.in) : ownerOf(c);
      if (!owner) {
        owner = `${mi}:c${c.id}`;
        const name = c.kind === "provide" ? `provide ${c.name}` : c.at ?? c.name ?? c.kind;
        nodes.push({ id: owner, mod: mi, file, kind: c.kind, site: true, name, line: c.line, region: `${mi}:r${c.region}` });
        keepLine(mi, c.line);
        if (c.kind === "prop" && c.at) {
          // `<Row user={…}>`: the value flows into Row's props
          const comp = c.at.split(" ")[0];
          const props = model.flatMap((mm, mj) => mm.symbols.filter(s => s.kind === "props" && mm.regions.find(r => r.id === s.region)?.name === comp).map(s => symNode.get(`${mj}:${s.id}`)))[0];
          if (props) edges.push({ from: owner, to: props, type: "passes", field: c.at.split(" ")[1] ?? null });
        }
        if (c.kind === "provide") {
          const ctx = m.symbols.find(s => s.kind === "context" && s.name === c.name);
          if (ctx) edges.push({ from: owner, to: symNode.get(`${mi}:${ctx.id}`), type: "write", op: "provide" });
        }
      } else {
        const n = nodeById.get(owner);
        if (n && c.kind === "question") n.async = true;
        if (n && (c.kind === "keyed" || c.kind === "deferred")) { n.async = n.async || c.calls.length > 0; n.flavor = c.kind; }
        // an action's own catches (the model's `catches`): the classes each handles, null for a catch-all
        if (n && c.kind === "action" && c.catches?.length) n.catches = c.catches.map(x => ({
          classes: x.classes ?? null, ...(x.arms ? { arms: x.arms.map(a => ({ ...a })) } : {}),
        }));
      }
      compOwner.set(c.id, owner);
      for (const r of c.reads) {
        const from = symNode.get(`${mi}:${r.sym}`);
        if (from && from !== owner) edges.push({ from, to: owner, type: "read", mode: r.mode, probe: r.probe ?? null, field: r.field ?? null, line: c.line });
      }
      for (const w of c.writes) {
        const to = symNode.get(`${mi}:${w.sym}`);
        if (to) edges.push({ from: owner, to, type: "write", op: w.op, path: !!w.path, ...(w.field ? { field: w.field } : {}), line: c.line });
      }
      for (const k of c.calls) {
        const to = symNode.get(`${mi}:${k}`);
        if (to && to !== owner) edges.push({ from: owner, to, type: "call", line: c.line });
      }
    }
    // a component rendered somewhere: the region that holds it points at the component
    for (const r of m.regions) {
      if (r.kind !== "children" || !r.name) continue;
      const s = m.symbols.find(s => s.kind === "comp" && s.name === r.name);
      const to = s && symNode.get(`${mi}:${s.id}`);
      if (to) edges.push({ from: `${mi}:r${r.id}`, to, type: "renders" });
    }
  });

  // "can be pending" is "awaits": the model marks a source with a standing question as a question even when it never
  // awaits (`source editing = null`), and an equation whose await sits inside `?:` as a plain memo. The declaration's
  // own line says which.
  for (const n of nodes) {
    if (n.site || (n.kind !== "source" && n.kind !== "eq") || n.world) continue;
    const mi = n.mod, text = src[mi]?.[n.line - 1] ?? "";
    const awaits = /\bawait\b/.test(text);
    if (n.kind === "source") n.async = awaits;
    else n.async = n.async || awaits;
  }

  // dedupe identical edges (a handler that reads the same thing twice)
  const seen = new Set();
  const uniq = edges.filter(e => { const k = JSON.stringify([e.from, e.to, e.type, e.mode, e.op, e.probe, e.field]); return seen.has(k) ? false : (seen.add(k), true); });
  const graph = { modules: files.map(rel), absModules: files, nodes, edges: uniq, regions, lines };
  controlHeads(graph, mi => src[mi] ?? []);
  addKeys(graph);
  return graph;
}

/** How each control-flow construct reads in source: the pattern of its header line, and its label. */
export const CONTROL = {
  then: [/(?:^|[{\s])if\s+(.+?)\s*\{/, m => `if ${m[1]}`],
  else: [/\belse\s+if\s+(.+?)\s*\{|\belse\b/, m => (m[1] ? `else if ${m[1]}` : "else")],
  for: [/\{\s*for\s+(.+?)\s*\{/, m => `for ${m[1]}`],
  loading: [/\bloading\b\s*(on\s*\([^)]*\))?/, m => (m[1] ? `loading ${m[1].replace(/\s+/g, "")}` : "loading")],
  errored: [/\berrored\b(?:\s+fallback\s*\(([^)]*)\))?/, m => (m[1] ? `errored (${m[1].trim()})` : "errored")],
};

/**
 * Gives each `if` / `else` / `for` / `loading` / `errored` region its own header: `head = { line, text }`, e.g.
 * `errored (e)`. The model has no line for a region, so it is read off the source: the nearest header line
 * above the region's first line. Nested constructs are placed first, and a region's search starts above the headers of
 * the constructs inside it, so an outer boundary is not labelled with an inner boundary's head.
 */
export function controlHeads(graph, sourceOf) {
  const kids = new Map(), own = new Map();
  for (const r of graph.regions) if (r.parent) (kids.get(r.parent) ?? kids.set(r.parent, []).get(r.parent)).push(r);
  for (const n of graph.nodes) if (n.region && n.line) (own.get(n.region) ?? own.set(n.region, []).get(n.region)).push(n.line);
  const firstMemo = new Map(), headMemo = new Map();
  const first = r => {
    if (!firstMemo.has(r.id)) { firstMemo.set(r.id, 1e9); firstMemo.set(r.id, Math.min(...(own.get(r.id) ?? []), ...(kids.get(r.id) ?? []).map(first), 1e9)); }
    return firstMemo.get(r.id);
  };
  const head = r => {
    if (headMemo.has(r.id)) return headMemo.get(r.id);
    headMemo.set(r.id, null);
    let bound = Math.min(first(r), r.arms?.[0]?.line ?? Infinity);
    const below = rr => { for (const k of kids.get(rr.id) ?? []) { const h = CONTROL[k.kind] && head(k); if (h?.line) bound = Math.min(bound, h.line - 1); else below(k); } };
    below(r);
    const pat = CONTROL[r.kind], ls = sourceOf(r.mod);
    let h = null;
    if (pat && bound < 1e9) for (let i = bound; i >= Math.max(1, bound - 40); i--) {
      const text = ls[i - 1];
      const m = text && !text.trimStart().startsWith("//") && pat[0].exec(text);
      if (m) { h = { line: i, text: pat[1](m) }; break; }
    }
    headMemo.set(r.id, h);
    return h;
  };
  for (const r of graph.regions) if (CONTROL[r.kind]) { const h = head(r); if (h) r.head = h; }
  return graph;
}

/**
 * Stable keys, so two versions of one program can be lined up (`--diff`) and a running program's nodes can be found on
 * the map (live mode). Ids are positions in the model and lines move; a key is what a reader would call the same thing.
 *
 * - A named node: `<module>|<scope>|<name>[#n]`, the key a dev build gives the Solid nodes it creates (as `rx:<key>`).
 *   `scope` is the enclosing component's name, or empty at module scope. `#n` tells apart the 2nd, 3rd… declaration of
 *   one name in one scope of a module, in source order (two `if` branches). When the model carries the key (`key` on a
 *   symbol), that one is used, so the map and the build cannot disagree.
 * - A view site has no name: it is keyed by its module, the chain of regions it sits in, and what it is, with an ordinal
 *   for look-alikes (and `sig`, what it reads, to pair look-alikes in a diff).
 */
export function addKeys(g) {
  const regionById = new Map(g.regions.map(r => [r.id, r]));
  const kidsOf = new Map();
  for (const r of g.regions) (kidsOf.get(r.parent) ?? kidsOf.set(r.parent, []).get(r.parent)).push(r);
  const nodeLine = new Map();
  for (const n of g.nodes) nodeLine.set(n.region, Math.min(nodeLine.get(n.region) ?? 1e9, n.line ?? 1e9));
  const firstLine = r => Math.min(nodeLine.get(r.id) ?? 1e9, ...(kidsOf.get(r.id) ?? []).map(firstLine));
  const path = new Map();
  const walk = (parentId, prefix) => {
    const kids = (kidsOf.get(parentId) ?? []).slice().sort((a, b) => firstLine(a) - firstLine(b));
    const count = {};
    for (const r of kids) {
      const base = r.kind + (r.name ? `:${r.name}` : "");
      const i = (count[base] = (count[base] ?? -1) + 1);
      const p = `${prefix}/${base}${i ? `#${i}` : ""}`;
      path.set(r.id, p);
      walk(r.id, p);
    }
  };
  for (const r of g.regions) if (r.parent == null) {
    const base = r.kind === "program" ? "" : `/${r.kind}${r.name ? `:${r.name}` : ""}`;
    path.set(r.id, base); walk(r.id, base);
  }
  for (const r of g.regions) r.key = `${g.modules[r.mod]}|${path.get(r.id)}`;
  const reads = new Map();
  for (const e of g.edges) if (e.type === "read") (reads.get(e.to) ?? reads.set(e.to, []).get(e.to)).push(e.from);
  const nodeById = new Map(g.nodes.map(n => [n.id, n]));
  // the scope of a named node: the nearest component region up its chain
  const scopeOf = id => {
    for (let r = regionById.get(id); r; r = regionById.get(r.parent)) if (r.kind === "component") return r.name ?? "";
    return "";
  };
  const taken = {};
  for (const n of g.nodes.slice().sort((a, b) => a.line - b.line)) {
    if (n.site) {
      const where = `${g.modules[n.mod]}|${path.get(n.region) ?? ""}`;
      n.base = `${where}|${n.kind}:${n.name}`;
      n.sig = (reads.get(n.id) ?? []).map(id => nodeById.get(id)?.name).sort().join(",");
    } else n.base = `${g.modules[n.mod]}|${scopeOf(n.region)}|${n.name}`;
    const i = (taken[n.base] = (taken[n.base] ?? -1) + 1);
    n.key = n.rxKey ?? (i ? `${n.base}#${i}` : n.base);
  }
}
