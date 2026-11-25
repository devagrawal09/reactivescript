const roles = {
  source: "state", eq: "derived", props: "derived", reader: "derived",
  action: "imperative", handler: "imperative", effect: "imperative", apply: "imperative",
  fn: "outside", server: "outside", import: "outside", comp: "structure", context: "structure",
  prop: "structure", provide: "structure", errclass: "failure",
};
const isBoundary = r => r.kind === "loading" || r.kind === "errored";
const ref = n => ({ key: n.key, kind: n.kind, file: n.file, line: n.line });
export const location = n => n?.file ? `  ${n.file}:${n.line ?? "?"}` : "";
const describe = n => `${n.key}  ${n.kind}${location(n)}`;
const result = (data, lines, empty) => ({ data, text: lines.join("\n") || empty });
const append = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

export function unknownKey(key, choices, search = "find") {
  const distance = k => {
    const a = key.toLowerCase(), b = k.toLowerCase();
    if (b.includes(a)) return 0;
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j])));
      row = next;
    }
    return row[b.length];
  };
  const near = choices.map(k => [k, distance(k)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
  return new Error(`unknown key ${key}; ${near.length ? `did you mean: ${near.map(([k]) => k).join(", ")}? ` : ""}Use ${search} to list keys.`);
}

export function queryGraph(g, method, p) {
  const nodes = new Map(g.nodes.map(n => [n.id, n]));
  const regions = new Map(g.regions.map(r => [r.id, r]));
  const byKey = new Map(g.nodes.map(n => [n.key, n]));
  const inc = new Map(), out = new Map(), kids = new Map(), members = new Map();
  for (const e of g.edges) { append(inc, e.to, e); append(out, e.from, e); }
  for (const n of g.nodes) append(members, n.region, n);
  for (const r of g.regions) append(kids, r.parent, r);
  const componentRegion = n => n && g.regions.find(r => r.mod === n.mod && r.kind === "component" && r.name === n.name);
  const firsts = new Map();
  function first(r) {
    if (!firsts.has(r.id)) firsts.set(r.id, Math.min(Infinity, ...(members.get(r.id) ?? []).map(n => n.line), ...(kids.get(r.id) ?? []).map(first)));
    return firsts.get(r.id);
  }
  function regionRef(r) {
    const file = g.modules[r.mod];
    let line = first(r);
    if (isBoundary(r)) {
      const ls = g.lines[file] ?? {};
      const pattern = new RegExp(`\\{\\s*${r.kind}\\b|^\\s*${r.kind}\\s+(?:on|fallback)\\b`);
      const hits = Object.keys(ls).map(Number).filter(i => pattern.test(ls[i]));
      const siblings = g.regions.filter(x => x.mod === r.mod && x.kind === r.kind);
      line = (hits.length === siblings.length ? hits[siblings.indexOf(r)] : hits.findLast(i => i <= line)) ?? line;
    }
    return { key: r.key, kind: r.kind, file, line: Number.isFinite(line) ? line : null };
  }
  function notifiers(r) {
    const visited = new Set(), sites = new Set(), roots = new Map();
    function cover(region, nested = false) {
      if (visited.has(region.id)) return;
      if (nested && region.kind === r.kind) {
        const line = regionRef(region).line;
        if (r.kind !== "errored" || !/fallback\s*\(\s*\w+\s*:/.test(g.lines[g.modules[region.mod]]?.[line] ?? "")) return;
      }
      visited.add(region.id);
      for (const n of members.get(region.id) ?? []) if (n.site && ["reader", "prop", "effect", "provide"].includes(n.kind)) sites.add(n.id);
      for (const e of out.get(region.id) ?? []) if (e.type === "renders") {
        const comp = componentRegion(nodes.get(e.to));
        if (comp) cover(comp, true);
      }
      for (const child of kids.get(region.id) ?? []) if (child.kind !== "component") cover(child, true);
    }
    cover(r);
    for (const site of sites) {
      const todo = [site], seen = new Set(todo);
      for (const id of todo) for (const e of inc.get(id) ?? []) {
        if (seen.has(e.from) || !(e.type === "passes" || (e.type === "read" && e.mode === "tracked" && !e.probe))) continue;
        seen.add(e.from);
        const n = nodes.get(e.from);
        if (!n) continue;
        if (n.async && !n.site && !roots.has(n.id)) roots.set(n.id, { ...ref(n), via: ref(nodes.get(site)) });
        todo.push(e.from);
      }
    }
    return [...roots.values()];
  }
  const boundaries = g.regions.filter(isBoundary);
  if (method === "find") {
    const q = p.query.toLowerCase();
    const found = g.nodes.filter(n => n.key.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)).map(ref);
    return result(found, found.map(describe), "no matching nodes");
  }
  if (method === "overview") {
    const data = g.modules.map((file, mod) => {
      const ns = g.nodes.filter(n => n.mod === mod), counts = {};
      for (const n of ns) { const role = roles[n.kind] ?? "other"; counts[role] = (counts[role] ?? 0) + 1; }
      return { file, counts, components: ns.filter(n => n.kind === "comp").map(ref),
        boundaries: boundaries.filter(r => r.mod === mod).map(regionRef),
        topLevel: ns.filter(n => !n.site && regions.get(n.region)?.kind === "program").map(ref) };
    });
    return result(data, data.flatMap(m => [
      `${m.file}  ${Object.entries(m.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`,
      ...m.components.map(n => `  component ${describe(n)}`),
      ...m.boundaries.map(n => `  boundary ${describe(n)}`),
      ...m.topLevel.filter(n => n.kind !== "comp").map(n => `  top-level ${describe(n)}`),
    ]));
  }
  if (method === "boundary") {
    if (p.key === undefined) {
      const data = boundaries.map(regionRef);
      return result(data, data.map(describe), "no loading or errored boundaries");
    }
    const r = boundaries.find(r => r.key === p.key);
    if (!r) throw unknownKey(p.key, boundaries.map(r => r.key), "boundary");
    const data = { ...regionRef(r), notifiers: notifiers(r) };
    return result(data, [describe(data), ...data.notifiers.map(n => `  ${describe(n)} via ${describe(n.via)}`),
      ...(!data.notifiers.length ? ["  no known notifiers"] : [])]);
  }
  const n = byKey.get(p.key);
  if (!n) throw unknownKey(p.key, [...byKey.keys()]);
  if (method === "node") {
    function linked(type, dir) {
      const incoming = dir === "in";
      return ((incoming ? inc : out).get(n.id) ?? []).filter(e => e.type === type)
        .map(e => ({ ...ref(nodes.get(incoming ? e.from : e.to)), mode: e.mode, probe: e.probe, op: e.op, field: e.field, at: e.line }));
    }
    const data = { ...ref(n), role: roles[n.kind] ?? "other",
      marks: { pending: !!n.async, question: !!n.question, io: !!n.io, trust: !!n.world },
      declaration: g.lines[n.file]?.[n.line] ?? "", component: null, boundaries: [],
      reads: linked("read", "in"), writes: linked("write", "out"), calls: linked("call", "out"),
      readBy: linked("read", "out"), writtenBy: linked("write", "in") };
    for (let r = regions.get(n.region); r; r = regions.get(r.parent)) {
      if (r.kind === "component" && !data.component) {
        const comp = g.nodes.find(n => n.mod === r.mod && n.kind === "comp" && n.name === r.name);
        data.component = comp ? ref(comp) : regionRef(r);
      }
      if (isBoundary(r)) data.boundaries.push(regionRef(r));
    }
    const marks = Object.keys(data.marks).filter(k => data.marks[k]);
    return result(data, [
      `${describe(data)}  role=${data.role}  marks=${marks.join(",") || "none"}`, `  declaration: ${data.declaration.trim()}`,
      ...(data.component ? [`  component ${describe(data.component)}`] : []),
      ...data.boundaries.map(b => `  boundary ${describe(b)}`),
      ...Object.entries({ "read-by": data.readBy, "written-by": data.writtenBy, reads: data.reads, writes: data.writes, calls: data.calls })
        .flatMap(([k, list]) => list.map(x => `  ${k} ${describe(x)}${[x.mode, x.probe, x.op, x.field].filter(Boolean).map(v => `  ${v}`).join("")}`)),
    ]);
  }
  const down = p.direction === "down";
  const todo = [[n.id, !down || !["source", "eq", "props", "reader", "prop"].includes(n.kind), 0]];
  const seen = new Set(), found = new Map();
  if (!down) todo.push([n.id, false, 0]);
  for (const [id, imperative, depth] of todo) {
    const state = `${id}:${imperative}`;
    if (seen.has(state)) continue;
    seen.add(state);
    if (id !== n.id && !found.has(id)) {
      const other = nodes.get(id);
      found.set(id, { ...(other ? ref(other) : regionRef(regions.get(id))), depth });
    }
    if (depth === p.depth) continue;
    for (const e of (down ? out : inc).get(id) ?? []) {
      const data = e.type === "passes" || e.type === "renders" || (e.type === "read" && (e.mode === "tracked" || e.probe));
      const next = down ? e.to : e.from;
      if (down) {
        if (data || (imperative && (e.type === "write" || e.type === "call"))) todo.push([next, e.type === "call", depth + 1]);
      } else if (imperative ? e.type === "call" : (data || e.type === "write")) {
        todo.push([next, !data, depth + 1]);
        if (data) todo.push([next, true, depth + 1]);
      }
    }
  }
  const data = [...found.values()];
  return result(data, data.map(x => `${x.depth}  ${describe(x)}`), `no ${p.direction === "up" ? "upstream" : "downstream"} nodes`);
}

export function queryDiff(g) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const changes = g.diff.summary.map(i => ({ ...i, nodes: i.ids.map(id => ref(byId.get(id))) }));
  const boundaries = g.regions.filter(r => isBoundary(r) && ["added", "removed"].includes(r.status))
    .map(r => ({ key: r.key, file: g.modules[r.mod], line: r.head?.line, kind: r.kind, status: r.status }));
  return result({ before: g.diff.before, after: g.diff.after, changes, boundaries },
    [`${g.diff.before} → ${g.diff.after}`, ...(changes.length ? changes.map(i =>
      `${i.text.replaceAll("`", "")}  [${i.nodes.map(n => `${n.key}${location(n)}`).join("; ")}]`) : boundaries.length ? [] : ["no notable behavior changes"]),
    ...boundaries.map(b => `${b.status} boundary ${describe(b)}`)]);
}
/** Text rendering of the live recorder's read-only queries. */
export function liveText(method, data) {
  const at = t => `${Math.round(t)}ms`;
  const since = r => r.since === undefined ? "" : ` since ${at(r.since)}`;
  const val = r => `${r.key ?? r.name}=${String(r.preview ?? "(no value)").replace(/\r?\n/g, "\\n")}${r.path ? ` [${r.path}]` : ""}${location(r)}`;
  const waiting = r => `${r.key}  held${r.by.length ? `: waiting on ${r.by.join(", ")}` : ""}${since(r)}`;
  const value = r => `${r.error || r.observation || (r.pending && r.preview === undefined)
    ? `${r.key ?? ""}  ${r.observation ?? (r.error ? `error: ${r.error}` : "pending (no value yet)")}${location(r)}`
    : `${val(r)}${r.pending ? `  pending${since(r)}` : ""}`}${r.held ? `\n${waiting(r.held)}` : ""}`;
  const boundary = r => `${r.region}  ${r.state}${r.error ? `: ${r.error}` : ""}`;
  const running = r => `${r.key}  running #${r.id}${since(r)}`;
  const event = r => {
    const label = r.type === "boundary" ? `${boundary(r)}${r.origin ? ` ← ${r.origin}` : ""}`
      : r.type === "held" ? waiting(r)
      : `${r.key}  ${[r.type, r.state, r.id === undefined ? "" : `#${r.id}`, r.args, r.error, r.reason, r.origin].filter(Boolean).join(" ")}${location(r)}`;
    return `${r.seq}  ${at(r.at)}  ${label}`;
  };
  const change = r => `${r.error ? `${r.key}  error: ${r.error}` : val(r)}  ${r.origin ?? "unknown origin"}`;
  switch (method) {
    case "status": return `connected pages: ${data.pages}\nflushes: ${data.flushes}\nuptime: ${at(data.uptime)}`;
    case "tail": return data.flatMap(r => r.type === "flush" ? r.changes.map(c => `${r.seq}  ${at(r.at)}  ${change(c)}`) : event(r)).join("\n") || "no records";
    case "record": return data.records ? `${data.truncated ? "recording truncated\n" : ""}${liveText("tail", data.records)}`
      : data.recording ? `recording since #${data.since} (${data.filter})` : "not recording";
    case "boundary_history": return [data.observation ?? `current: ${boundary(data)}`, ...(data.history ?? []).map(event)].join("\n");
    case "value": return value(data);
    case "state":
      if (data.observation && !data.key) return data.observation;
      if (data.region) return data.observation ?? boundary(data);
      if (data.key) return [value(data), ...(data.runs ?? []).map(running)].join("\n");
      return [...data.values.map(value), ...data.boundaries.map(boundary), ...(data.held ?? []).map(waiting), ...data.runs.map(running), ...data.reverts.map(event)].join("\n") || "no live state";
    case "why": return [value(data.current ?? data), ...(data.seq ? [`${data.seq}  ${at(data.at)}  ${change(data)}`,
      ...(data.chain ?? []).map(c => `${"  ".repeat(c.depth)}← ${change(c)}`)] : ["no change recorded"]),
      ...data.events.map(event), ...(data.readers ?? []).map(r => `${waiting(r)}${location(r)}`)].join("\n");
    case "pending": return data.map(r => `${r.key}${since(r)}${location(r)}`).join("\n") || "no pending requests";
  }
}
