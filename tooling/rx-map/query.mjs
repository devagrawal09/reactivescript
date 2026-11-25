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
// A parent/root access can affect its descendants and vice versa. An unknown
// computed segment matches any single segment at that position.
const overlaps = (a, b) => {
  if (!a || !b) return true;
  const as = a.split("."), bs = b.split(".");
  return as.slice(0, bs.length).every((p, i) => p === "*" || bs[i] === "*" || p === bs[i]);
};
const quoteOutline = (region, nodes, incoming, site) => {
  const parts = region?.outline;
  if (!parts?.some(p => "text" in p)) return;
  const i = site == null ? 0 : parts.findIndex(p => p.site === site);
  if (i < 0) return;
  const start = Math.max(0, i - 2), end = Math.min(parts.length, i + 4);
  if (!parts.slice(start, end).some(p => "text" in p)) return;
  const text = parts.slice(start, end).map(p => "text" in p ? (p.attr ? `${p.attr}: ${p.text}` : p.text)
    : p.site ? `[${(incoming.get(p.site) ?? []).filter(e => e.type === "read").map(e => nodes.get(e.from)?.name).filter(Boolean).join(", ") || nodes.get(p.site)?.name || "…"}]`
    : " ").join("").replace(/\s+/g, " ").trim();
  return `${start ? "… " : ""}${text.slice(0, 140)}${end < parts.length || text.length > 140 ? " …" : ""}`;
};

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
  const readsBy = id => (out.get(id) ?? []).filter(e => e.type === "read");
  const writesBy = id => (inc.get(id) ?? []).filter(e => e.type === "write");
  const fields = n => [...new Set([...readsBy(n.id), ...writesBy(n.id)].flatMap(e => {
    if (!e.field) return [];
    const parts = e.field.split(".");
    return parts.map((_, i) => parts.slice(0, i + 1).join("."));
  }))].sort();
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
    const rank = ({ name, key }) => {
      name = name.toLowerCase(); key = key.toLowerCase();
      const label = key.slice(key.lastIndexOf("|") + 1);
      if (q === name || q === key) return 0;
      if (name.startsWith(q) || label.startsWith(q)) return 1;
      if (q.includes("|") && key.startsWith(q)) return 1;
      if (name.includes(q) || label.includes(q)) return 2;
      if (!q.includes("|") && key.startsWith(q)) return 3;
      return key.includes(q) ? 4 : Infinity;
    };
    const candidates = g.nodes.filter(n => p.imports || n.kind !== "import").flatMap(n => [n, ...fields(n).map(field => ({
      ...n, name: `${n.name}.${field}`, key: `${n.key}.${field}`, field, store: n.key,
    }))]);
    const ranked = candidates.map(n => ({ n, rank: rank(n) }));
    // A bare search that hits a symbol needn't also list every node in a
    // matching filename. An explicit filename still works as a module filter.
    const named = !q.includes(".") && !q.includes("/") && ranked.some(x => x.rank < 3);
    const found = ranked.filter(x => x.rank < (named ? 3 : Infinity) && (!x.n.field || x.rank < 3))
      .sort((a, b) => a.rank - b.rank || Number(!!a.n.field) - Number(!!b.n.field))
      .map(({ n }) => ({ ...ref(n), ...(n.field ? { field: n.field, store: n.store } : {}) }));
    return result(found, found.map(describe), "no matching nodes");
  }
  if (method === "overview") {
    const data = g.modules.map((file, mod) => {
      const all = g.nodes.filter(n => n.mod === mod), counts = {};
      const ns = p.imports ? all : all.filter(n => n.kind !== "import");
      for (const n of ns) { const role = roles[n.kind] ?? "other"; counts[role] = (counts[role] ?? 0) + 1; }
      return { file, counts, ...(!p.imports ? { importsHidden: all.length - ns.length } : {}), components: ns.filter(n => n.kind === "comp").map(ref),
        boundaries: boundaries.filter(r => r.mod === mod).map(regionRef),
        topLevel: ns.filter(n => !n.site && regions.get(n.region)?.kind === "program").map(ref) };
    });
    return result(data, data.flatMap(m => [
      `${m.file}  ${Object.entries(m.counts).map(([k, v]) => `${k}=${v}`).join(" ")}${m.importsHidden ? `  (${m.importsHidden} JS imports hidden)` : ""}`,
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
    const outline = quoteOutline(r, nodes, inc);
    const data = { ...regionRef(r), notifiers: notifiers(r), ...(outline ? { outline } : {}) };
    return result(data, [describe(data), ...data.notifiers.map(n => `  ${describe(n)} via ${describe(n.via)}`),
      ...(!data.notifiers.length ? ["  no known notifiers"] : []), ...(outline ? [`  view: ${outline}`] : [])]);
  }
  const root = byKey.has(p.key) ? p.key : [...byKey.keys()].filter(k => p.key.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
  const n = byKey.get(root);
  const field = root && root !== p.key ? p.key.slice(root.length + 1) : undefined;
  if (!n) throw unknownKey(p.key, [...byKey.keys()]);
  if (method === "node") {
    function linked(type, dir) {
      const incoming = dir === "in";
      return ((incoming ? inc : out).get(n.id) ?? []).filter(e => e.type === type &&
          (!field || ((type === "read" && !incoming || type === "write" && incoming) && overlaps(field, e.field))))
        .map(e => ({ ...ref(nodes.get(incoming ? e.from : e.to)), mode: e.mode, probe: e.probe, op: e.op, field: e.field, at: e.line }));
    }
    const data = { ...ref(n), ...(field ? { key: p.key, field, store: root } : {}), role: roles[n.kind] ?? "other",
      marks: { pending: !!n.async, question: !!n.question, io: !!n.io, trust: !!n.world },
      declaration: g.lines[n.file]?.[n.line] ?? "", component: null, boundaries: [],
      reads: linked("read", "in"), writes: linked("write", "out"), calls: linked("call", "out"),
      readBy: linked("read", "out"), writtenBy: linked("write", "in") };
    // a JS import's effective declaration (09 MO-11): a written `.d.rx` line, else the one generated from the TS module
    if (n.decl) data.imported = { line: n.decl.line, from: n.decl.from, origin: n.decl.origin, ...(n.decl.helpers?.length ? { helpers: n.decl.helpers } : {}) };
    if (!field && ["source", "eq"].includes(n.kind)) data.fields = fields(n).map(field => ({
      key: `${root}.${field}`, field,
      readBy: data.readBy.filter(r => overlaps(field, r.field)), writtenBy: data.writtenBy.filter(w => overlaps(field, w.field)),
    }));
    const sites = n.site ? [n] : data.readBy.map(r => byKey.get(r.key)).filter(x => x?.site);
    const outline = sites.map(s => quoteOutline(regions.get(s.region), nodes, inc, s.id)).find(Boolean);
    if (outline) data.outline = outline;
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
      ...(data.imported ? [`  imported: ${data.imported.line}  from ${data.imported.from}  (${data.imported.origin}${data.imported.helpers ? `: ${data.imported.helpers.join(", ")}` : ""})`] : []),
      ...(outline ? [`  view: ${outline}`] : []),
      ...(data.component ? [`  component ${describe(data.component)}`] : []),
      ...data.boundaries.map(b => `  boundary ${describe(b)}`),
      ...Object.entries({ "read-by": data.readBy, "written-by": data.writtenBy, reads: data.reads, writes: data.writes, calls: data.calls })
        .flatMap(([k, list]) => list.map(x => `  ${k} ${describe(x)}${[x.mode, x.probe, x.op, x.field].filter(Boolean).map(v => `  ${v}`).join("")}`)),
      ...(data.fields ?? []).map(f => `  field ${f.field}: read-by ${[...new Set(f.readBy.map(r => r.key))].join(", ") || "none"}; written-by ${[...new Set(f.writtenBy.map(w => w.key))].join(", ") || "none"}`),
    ]);
  }
  const down = p.direction !== "up";
  const todo = [[n.id, !down || !["source", "eq", "props", "reader", "prop"].includes(n.kind), 0]];
  const seen = new Set(), found = new Map();
  if (!down) todo.push([n.id, false, 0]);
  for (const [id, imperative, depth, path = id === n.id ? field : undefined] of todo) {
    const state = JSON.stringify([id, imperative, path]);
    if (seen.has(state)) continue;
    seen.add(state);
    if (id !== n.id && !found.has(id)) {
      const other = nodes.get(id);
      found.set(id, { ...(other ? ref(other) : regionRef(regions.get(id))), depth });
    }
    if (depth === p.depth) continue;
    for (const e of (down ? out : inc).get(id) ?? []) {
      if (path) {
        // An equation's inbound reads may contribute to any output field.
        // The known target/source paths constrain only writes, passes and
        // downstream reads at the starting node.
        if (down && e.type !== "read") continue;
        if ((down || e.type === "write" || e.type === "passes") && !overlaps(path, e.field)) continue;
      }
      const data = e.type === "passes" || e.type === "renders" || (e.type === "read" && (e.mode === "tracked" || e.probe));
      const next = down ? e.to : e.from;
      if (down) {
        if (data || (imperative && (e.type === "write" || e.type === "call"))) todo.push([next, e.type === "call", depth + 1, e.type === "passes" ? e.field : undefined]);
      } else if (imperative ? e.type === "call" : (data || e.type === "write")) {
        const nextPath = e.type === "read" && nodes.get(next)?.kind === "props" ? e.field : undefined;
        todo.push([next, !data, depth + 1, nextPath]);
        if (data) todo.push([next, true, depth + 1, nextPath]);
      }
    }
  }
  const data = [...found.values()];
  return result(data, data.map(x => `${x.depth}  ${describe(x)}`), `no ${down ? "downstream" : "upstream"} nodes`);
}

export function queryDiff(g) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const changes = g.diff.summary.map(i => ({ ...i, nodes: i.ids.map(id => ref(byId.get(id))) }));
  const boundaries = g.regions.filter(r => isBoundary(r) && ["added", "removed"].includes(r.status))
    .map(r => ({ key: r.key, file: g.modules[r.mod], line: r.head?.line, kind: r.kind, status: r.status }));
  const textChanges = g.regions.filter(r => r.reason === "text changed").map(r => ({ key: r.key, file: g.modules[r.mod], line: r.head?.line, kind: r.kind }));
  return result({ before: g.diff.before, after: g.diff.after, changes, boundaries, textChanges },
    [`${g.diff.before} → ${g.diff.after}`, ...(changes.length ? changes.map(i =>
      `${i.text.replaceAll("`", "")}  [${i.nodes.map(n => `${n.key}${location(n)}`).join("; ")}]`) : boundaries.length || textChanges.length ? [] : ["no notable behavior changes"]),
    ...boundaries.map(b => `${b.status} boundary ${describe(b)}`), ...textChanges.map(r => `text changed ${describe(r)}`)]);
}
/** Whether a `why` answer shows a held write: the key's own, one of its events, or a reader waiting on it. */
const whyHeld = d => !!(d.current?.held || d.held || d.events?.some(e => e.type === "held") || d.readers?.length);
/** The hint under a held write: holds are by design (AC-1, H-2); what shows the work while it runs. */
export const heldHint = key => {
  const name = String(key ?? "x").replace(/^rx:/, "").split("|").pop().replace(/~.*$/, "");
  return `hint: the hold is by design (an action's writes commit together). To show it while the action runs, read \`latest ${name}\` or \`pending? ${name}\` where it is shown, or make status-only state a guess (\`guess saving := true\` shows now and goes back when the action ends). guide/async.md, "Showing progress while an action runs"`;
};
/** Text rendering of the live recorder's read-only queries. */
export function liveText(method, data) {
  const at = t => `${Math.round(t)}ms`;
  const since = r => r.since === undefined ? "" : ` since ${at(r.since)}`;
  const who = r => `${r.key ?? r.name}${r.instance === undefined ? "" : ` [instance ${r.continuity ? `${r.continuity.from}→${r.instance} (${r.continuity.status})` : r.instance}${r.ownerPath?.length ? ` · ${r.ownerPath.join(" › ")}` : ""}]`}`;
  const val = r => `${who(r)}=${String(r.preview ?? "(no value)").replace(/\r?\n/g, "\\n")}${r.path ? ` [${r.path}]` : ""}${location(r)}`;
  const waiting = r => `${who(r)}  held${since(r)}${r.blockers?.length ? `: waiting on ${r.blockers.map(b => `${who(b)} ${b.type} #${b.id}${since(b)}${b.via?.length ? ` via ${b.via.join(" → ")}` : ""}`).join(", ")}` : " (no blocker observed)"}`;
  const value = r => `${r.error || r.observation || (r.pending && r.preview === undefined)
    ? `${who(r)}  ${r.observation ?? (r.error ? `${r.failedUntripped ? "failed, untripped" : "error"}: ${r.error}` : "pending (no value yet)")}${location(r)}`
    : `${val(r)}${r.pending ? `  pending${since(r)}` : ""}`}${r.held ? `\n${waiting(r.held)}` : ""}${r.untripped
      ? `\nfailed but not tripped: no live reader under ${r.untripped.boundary} because ${r.untripped.guards.join(", ")} ${r.untripped.guards.length === 1 ? "is" : "are"} false` : ""}`;
  const boundary = r => `${r.region}  ${r.state}${r.error ? `: ${r.error}` : ""}`;
  const running = r => `${r.key}  running #${r.id}${since(r)}`;
  const event = r => {
    if (r.type === "reload") return `${r.seq}  ${at(r.at)}  page reloaded`;
    const label = r.type === "boundary" ? `${boundary(r)}${r.origin ? ` ← ${r.origin}` : ""}`
      : r.type === "held" ? waiting(r)
      : `${who(r)}  ${[r.type, r.state, r.id === undefined ? "" : `#${r.id}`, r.args, r.error, r.reason,
        r.type === "revert" && r.reason === "superseded" ? "(replaced by the answer, not a failure)" : "", r.origin].filter(Boolean).join(" ")}${location(r)}`;
    return `${r.seq}  ${at(r.at)}  ${label}`;
  };
  const change = r => `${r.error ? `${who(r)}  error: ${r.error}` : val(r)}  ${r.origin ?? "unknown origin"}`;
  if (data.instances) return data.instances.map(r => liveText(method, r)).join("\n");
  switch (method) {
    case "trace": return data.map(b => [
      `${b.type} ${who(b)} #${b.id}${b.instance === undefined && b.ownerPath?.length ? ` [${b.ownerPath.join(" › ")}]` : ""} ${b.args ?? "[]"} → ${b.error ? `rejected: ${b.error}` : b.result ?? "running"}${b.duration == null ? "" : ` (${at(b.duration)})`}${b.origin ? ` ← ${b.origin}` : ""}`,
      ...b.calls.map(c => `  call ${c.key} #${c.id}`),
      ...b.writes.map(w => `  ${w.type === "held" ? waiting({ ...w, since: w.at }) : `${w.type} ${who(w)}${w.preview === undefined ? "" : ` = ${w.preview}`}`} @ ${at(w.at)} (frame #${w.seq})`),
    ].join("\n")).join("\n\n") || "no matching calls or runs";
    case "hmr": return data.sources.map(s => `${who(s)}  ${s.status}: ${s.reason}`).join("\n") || "no observed source replacements";
    case "status": return `connected pages: ${data.pages}\nflushes: ${data.flushes}\nuptime: ${at(data.uptime)}`;
    case "tail": return data.flatMap(r => r.type === "flush" ? r.changes.map(c => `${r.seq}  ${at(r.at)}  ${change(c)}`) : event(r)).join("\n") || "no records";
    case "record": return data.records ? `${data.truncated ? "recording truncated\n" : ""}${liveText("tail", data.records)}`
      : data.recording ? `recording since #${data.since} (${data.filter})` : "not recording";
    case "boundary_history": return [data.observation ?? `current: ${boundary(data)}`, ...(data.history ?? []).map(event)].join("\n");
    case "value": return value(data);
    case "state":
      if (data.observation && !data.key) return data.observation;
      if (data.region) return data.observation ?? boundary(data);
      if (data.key) return [value(data), ...(data.hmr ? [`HMR ${data.hmr.status}: ${data.hmr.reason}`] : []), ...(data.runs ?? []).map(running)].join("\n");
      return [...data.values.map(value), ...data.boundaries.map(boundary), ...(data.held ?? []).map(waiting), ...data.runs.map(running), ...data.reverts.map(event)].join("\n") || "no live state";
    case "why": return [value(data.current ?? data), ...(data.seq ? [`${data.seq}  ${at(data.at)}  ${change(data)}`,
      ...(data.chain ?? []).map(c => `${"  ".repeat(c.depth)}← ${change(c)}`)] : ["no change recorded"]),
      ...data.events.map(event), ...(data.readers ?? []).map(r => `${waiting(r)}${location(r)}`),
      ...(whyHeld(data) ? [heldHint(data.current?.key ?? data.key)] : [])].join("\n");
    case "pending": return data.map(r => `${r.key}${since(r)}${location(r)}`).join("\n") || "no pending requests";
  }
}
