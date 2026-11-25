// A trace replays several dev entries as one graph. Remap local ids while keeping
// the first occurrence of shared declarations; messages already use stable keys.
export function mergeTraceGraphs(graphs) {
  if (graphs.length === 1) return graphs[0];
  const out = { modules: [], absModules: [], nodes: [], edges: [], regions: [], lines: {} };
  const ids = new Map(), edges = new Set();
  for (const g of graphs) {
    const modules = g.modules.map((m, i) => {
      const existing = out.modules.indexOf(m);
      if (existing >= 0) return existing;
      out.absModules.push(g.absModules?.[i] ?? null);
      return out.modules.push(m) - 1;
    });
    const local = new Map(), added = new Set();
    for (const x of [...g.regions, ...g.nodes]) {
      const id = ids.get(x.key) ?? `${modules[x.mod]}:${x.id.split(":").slice(1).join(":")}`;
      local.set(x.id, id);
      if (!ids.has(x.key)) added.add(x.id);
      if (x.key) ids.set(x.key, id);
    }
    const ref = id => local.get(id) ?? id;
    for (const r of g.regions) if (added.has(r.id)) out.regions.push({ ...r, id: ref(r.id), mod: modules[r.mod],
      parent: ref(r.parent),
      ...(r.outline ? { outline: r.outline.map(p => "site" in p ? { ...p, site: ref(p.site) }
        : "region" in p ? { ...p, region: ref(p.region) } : p) } : {}) });
    for (const n of g.nodes) if (added.has(n.id)) out.nodes.push({ ...n, id: ref(n.id), mod: modules[n.mod], region: ref(n.region) });
    for (const e of g.edges) {
      const edge = { ...e, from: ref(e.from), to: ref(e.to) }, key = JSON.stringify(edge);
      if (!edges.has(key)) { edges.add(key); out.edges.push(edge); }
    }
    Object.assign(out.lines, g.lines);
  }
  return out;
}
