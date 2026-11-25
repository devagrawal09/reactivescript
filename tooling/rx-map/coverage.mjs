// Reactive coverage measures paths through the static graph, not source lines.
import { mergeTraceGraphs } from "./coverage/graphs.mjs";

const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = entries => Object.fromEntries([...entries].sort(([a], [b]) => cmp(a, b)));
const unique = list => [...new Set(list)].sort(cmp);
const keyOf = key => typeof key === "string" ? key.replace(/~i\d+$/, "") : null;
const classOf = error => typeof error === "string" ? error.split(":", 1)[0] : null;
const classes = text => unique((text ?? "").split("|").map(x => x.trim()).filter(Boolean));
const KINDS = ["node", "edge", "loading", "errored", "guess", "action"];
const PRIORITY = ["errored", "action", "guess", "loading", "node", "edge"];
const OUTCOMES = ["confirmed", "reverted", "superseded"];
const moduleOf = (g, n) => n.file ?? g.modules[n.mod];
const reactive = n => n.key && !n.site && !n.world && (n.kind === "source" || n.kind === "eq");

function indexBy(items, key) {
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

function describe(graph) {
  const paths = new Map(), inputs = [], guesses = [], catches = [];
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const calls = indexBy(graph.edges.filter(e => e.type === "call"), e => e.from);
  const children = indexBy(graph.regions, r => r.parent);
  const inside = indexBy(graph.nodes, n => n.region);
  const add = (kind, suffix, module, line, target, label) => {
    const id = `${kind}:${suffix}`;
    const path = { id, kind, module, line: line ?? 1, label, target };
    const old = paths.get(id);
    if (!old || path.line < old.line) paths.set(id, path);
    return id;
  };
  function firstLine(r) {
    return Math.min(Infinity, ...(r.outline ?? []).map(x => x.line ?? Infinity),
      ...(inside.get(r.id) ?? []).map(x => x.line ?? Infinity),
      ...(children.get(r.id) ?? []).map(firstLine));
  }
  for (const n of nodes.values()) {
    const module = moduleOf(graph, n);
    if (reactive(n)) add("node", n.key, module, n.line, n.key, `${n.name} changes`);
    if (n.kind !== "action" || !n.key || n.world || n.site) continue;
    add("action", `${n.key}:ok`, module, n.line, n.key, `${n.name} succeeds`);
    const seen = new Set([n.id]), todo = [n.id];
    while (todo.length) for (const e of calls.get(todo.pop()) ?? []) {
      const callee = nodes.get(e.to);
      if (!callee || callee.kind === "action" || seen.has(callee.id)) continue;
      seen.add(callee.id);
      const rejects = /\brejects\s*\(([^)]*)\)/.exec(callee.decl?.line ?? "")?.[1];
      for (const name of classes(rejects)) add("action", `${n.key}:rejected:${name}`, module, n.line, n.key,
        `${n.name} rejects with ${name}`);
      if (callee.kind === "fn") todo.push(callee.id);
    }
  }
  for (const e of graph.edges) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a?.key || !b?.key) continue;
    const pair = `${a.key}->${b.key}`;
    if (e.type === "read" && e.mode === "tracked" && e.probe == null && reactive(a) && reactive(b)) {
      const id = add("edge", pair, moduleOf(graph, b), e.line ?? b.line, b.key,
        `a change carries from ${a.name} to ${b.name}`);
      inputs.push({ from: a.key, to: b.key, id });
    }
    if (e.type === "write" && e.op === "optimistic" && ["action", "handler"].includes(a.kind) && b.kind === "source") {
      for (const outcome of OUTCOMES) add("guess", `${pair}:${outcome}`, moduleOf(graph, a), e.line ?? a.line, a.key,
        `${a.name}'s guess on ${b.name} ${outcome}`);
      guesses.push({ from: a.key, to: b.key, pair });
    }
  }
  for (const r of graph.regions) {
    if (!r.key || (r.kind !== "loading" && (r.kind !== "errored" || r.deadTyped))) continue;
    const head = r.head?.text ?? r.kind, module = graph.modules[r.mod];
    const first = r.head?.line ?? r.line ?? firstLine(r), line = Number.isFinite(first) ? first : 1;
    if (r.kind === "loading") add("loading", r.key, module, line, r.key, `${head} shows`);
    else {
      const typed = /^errored\s*\(([^:()]+):\s*([^)]*)\)/.exec(head);
      for (const name of typed ? classes(typed[2]) : [null]) {
        const text = name ? `errored (${typed[1].trim()}: ${name})` : head;
        const id = add("errored", name ? `${r.key}:${name}` : r.key, module, line, r.key,
          `${text} shows its fallback`);
        catches.push({ region: r.key, name, id });
      }
    }
  }
  return { paths, inputs, guesses, catches };
}

export function universe(graph) {
  return [...describe(graph).paths.values()].sort((a, b) => cmp(a.id, b.id));
}

export function createCollector({ graphs = [], tool }) {
  // Dev builds may register more graphs after attach. Hosts can supply a live getter.
  const registered = typeof graphs === "function" ? graphs : () => graphs;
  let previous = [], paths = new Map(), inputs, writers, writes, catches;
  function refresh() {
    const list = registered();
    if (list.length === previous.length && list.every((g, i) => g === previous[i])) return;
    previous = [...list];
    const all = list.map(describe);
    paths = new Map(all.flatMap(d => [...d.paths]));
    inputs = indexBy([...new Map(all.flatMap(d => d.inputs).map(x => [x.id, x])).values()], x => x.to);
    const pairs = [...new Map(all.flatMap(d => d.guesses).map(x => [x.pair, x])).values()];
    writers = indexBy(pairs, x => x.to);
    writes = indexBy(pairs, x => x.from);
    catches = indexBy([...new Map(all.flatMap(d => d.catches).map(x => [x.id, x])).values()], x => x.region);
  }

  const hits = new Map(), last = new Map(), pending = new Set(), active = new Map(), recent = new Map();
  const run = { tool, tests: 0, failed: 0, at: new Date().toISOString() };
  let recording = false, test = "", error, messages = [];
  function count(into, id, name) {
    if (!paths.has(id)) return;
    const h = into.get(id);
    into.set(id, { n: (h?.n ?? 0) + 1, by: name === undefined
      ? h?.by ?? [] : unique([...(h?.by ?? []), name]).slice(0, 8) });
  }
  const attribution = () => recording ? test : undefined;
  const hit = id => count(hits, id, attribution());
  function boundary(b) {
    const region = keyOf(b.region);
    if (b.state === "fallback") hit(`loading:${region}`);
    if (b.state !== "error") return;
    const options = catches?.get(region) ?? [];
    for (const { name, id } of options) {
      if (!name || name === classOf(b.error) || (b.error == null && options.length === 1)) hit(id);
    }
  }
  const stateOf = v => v.error !== undefined ? `error:${v.error}` : v.preview !== undefined ? `value:${v.preview}` : undefined;
  const runId = r => r.id ?? keyOf(r.key);
  const touch = key => { for (const r of active.values()) r.touched.add(key); };
  function finishRecent(key) {
    const item = recent.get(key);
    if (item?.outcome) count(hits, `guess:${item.pair}:${item.outcome}`, item.name);
    recent.delete(key);
  }
  function resetRecent() { for (const key of recent.keys()) finishRecent(key); }
  const startRun = r => ({ id: runId(r), key: keyOf(r.key), origin: r.origin, touched: new Set(), reverts: new Map() });
  const matches = (r, m) => (m.runId === undefined || m.runId === r.id) &&
    (!r.origin || !m.origin || r.origin === m.origin);
  function feed(msg) {
    if (!msg || typeof msg.type !== "string") return;
    if (recording) messages.push(msg);
    refresh();
    const key = keyOf(msg.key);
    switch (msg.type) {
      case "reset":
        resetRecent();
        last.clear(); pending.clear(); active.clear();
        break;
      case "snapshot":
        for (const v of msg.values ?? []) {
          const k = keyOf(v.key), state = stateOf(v);
          if (k && state !== undefined) last.set(k, state);
          if (k && v.pending) pending.add(k);
        }
        for (const v of msg.flights ?? []) pending.add(keyOf(v.key));
        for (const r of msg.runs ?? []) if (!active.has(runId(r)))
          active.set(runId(r), startRun(r));
        for (const h of msg.held ?? []) touch(keyOf(h.key));
        for (const b of msg.boundaries ?? []) boundary(b);
        break;
      case "flush": {
        const changed = new Set(), hmr = /^hmr\b/.test(msg.origin ?? "");
        const settled = new Map();
        for (const c of msg.changes ?? []) {
          const k = keyOf(c.key);
          if (!k) continue;
          const v = stateOf(c);
          if (v === undefined) { last.delete(k); continue; }
          // prev is the bridge's prior shown value, including on the first flush of a write.
          const before = last.get(k) ?? stateOf({ preview: c.prev, error: c.prevError });
          const landed = pending.delete(k);
          last.set(k, v);
          if (hmr || /^hmr\b/.test(c.origin ?? "")) continue;
          touch(k);
          settled.set(k, (settled.get(k) ?? true) && before === v && (!c.full || !c.full.includes("…")) &&
            (!c.preview?.includes("…") || !!c.full));
          if ((before !== undefined || landed) && before !== v) changed.add(k);
        }
        for (const r of active.values()) for (const [k, revert] of r.reverts) {
          if (revert.outcome === "superseded" && revert.samePreview === undefined && settled.has(k))
            revert.samePreview = settled.get(k);
        }
        const order = new Map();
        msg.order?.forEach((k, i) => { const stable = keyOf(k); if (!order.has(stable)) order.set(stable, i); });
        for (const k of changed) {
          hit(`node:${k}`);
          for (const { from, id } of inputs?.get(k) ?? [])
            if (changed.has(from) && (!msg.order || order.get(from) < order.get(k))) hit(id);
        }
        break;
      }
      case "flight":
        if (key && msg.state === "start") {
          pending.add(key);
          if (!/^hmr\b/.test(msg.origin ?? "")) {
            const causes = new Set((msg.cause ?? []).map(x => keyOf(x.key)));
            for (const { from, id } of inputs?.get(key) ?? []) if (causes.has(from)) hit(id);
          }
        } else if (key && msg.state === "abandon" && msg.error == null) pending.delete(key);
        break;
      case "boundary":
        boundary(msg);
        break;
      case "held":
        if (key) touch(key);
        break;
      case "revert": {
        const candidates = writers?.get(key) ?? [];
        const matching = [...active.values()].filter(r => matches(r, msg) && candidates.some(x => x.from === r.key));
        const outcome = msg.reason === "superseded" ? "superseded" : "reverted";
        if (matching.length) {
          for (const r of matching) {
            const previous = r.reverts.get(key);
            r.reverts.set(key, { outcome: previous?.outcome === "reverted" ? "reverted" : outcome, name: attribution() });
          }
        } else if (recent.has(key) && matches(recent.get(key), msg)) {
          // Solid emits this diagnostic at settlement, not necessarily before
          // run.end. A successful store write can settle to a new reference
          // even when the guess itself was right.
          const old = recent.get(key);
          if (old.outcome !== "reverted" && old.outcome !== "superseded") {
            old.outcome = outcome === "superseded" && old.success ? "confirmed" : "reverted";
            old.name = attribution();
          }
        } else if (candidates.length === 1 && msg.runId === undefined) hit(`guess:${candidates[0].pair}:${outcome}`);
        break;
      }
      case "run": {
        const id = runId(msg);
        if (msg.state === "start") {
          for (const { to } of writes?.get(key) ?? []) finishRecent(to);
          active.set(id, startRun(msg));
          break;
        }
        const r = active.get(id);
        active.delete(id);
        const success = msg.state === "end";
        if (success) hit(`action:${key}:ok`);
        else if (msg.state === "error") hit(`action:${key}:rejected:${classOf(msg.error)}`);
        else break;
        if (!r) break;
        for (const { to, pair } of writes?.get(key) ?? []) {
          const revert = r.reverts.get(to);
          if (recent.has(to) && !revert && !r.touched.has(to)) continue;
          finishRecent(to);
          recent.set(to, { pair, id, origin: msg.origin ?? r.origin, success,
            // A settling flush can precede run.end. A reference-only store
            // correction has the same shown preview; a replacement does not.
            outcome: revert ? !success ? "reverted" : revert.samePreview ? "confirmed" : revert.outcome
              : success && r.touched.has(to) ? "confirmed" : null,
            name: revert ? revert.name : attribution() });
        }
        break;
      }
    }
  }
  return {
    feed,
    begin(name) {
      resetRecent();
      test = String(name);
      messages = [];
      error = undefined;
      recording = true;
    },
    end({ failed = false, error: detail } = {}) {
      if (!recording) return;
      run.tests++;
      if (failed) run.failed++;
      if (detail != null) error = String(detail);
      recording = false;
    },
    result() {
      refresh();
      const observed = new Map(hits);
      for (const item of recent.values()) if (item.outcome) count(observed, `guess:${item.pair}:${item.outcome}`, item.name);
      for (const r of active.values()) for (const { to, pair } of writes?.get(r.key) ?? []) {
        const revert = r.reverts.get(to);
        if (revert) count(observed, `guess:${pair}:${revert.outcome}`, revert.name);
      }
      return { rxCoverage: 1, modules: unique([...paths.values()].map(p => p.module)), paths: sorted(paths),
        hits: sorted([...observed].map(([id, h]) => [id, { n: h.n, by: [...h.by] }])), runs: [{ ...run }] };
    },
    trace(fromSeq) {
      const start = fromSeq === undefined ? 0 : messages.findIndex(m => m.type === "flush" && m.seq >= fromSeq);
      return { rxTrace: 1, test, ...(error === undefined ? {} : { error }), graph: mergeTraceGraphs(registered()),
        messages: start < 0 ? [] : messages.slice(start) };
    },
  };
}

export function merge(...files) {
  const paths = new Map(), hits = new Map();
  for (const file of files) {
    for (const [id, path] of Object.entries(file.paths)) {
      // Lines can move between runs; choose deterministic metadata until rebase supplies current lines.
      const old = paths.get(id);
      if (!old || cmp(JSON.stringify(path), JSON.stringify(old)) < 0) paths.set(id, path);
    }
    for (const [id, hit] of Object.entries(file.hits)) {
      const old = hits.get(id);
      hits.set(id, { n: (old?.n ?? 0) + hit.n, by: unique([...(old?.by ?? []), ...hit.by]).slice(0, 8) });
    }
  }
  return { rxCoverage: 1, modules: unique(files.flatMap(f => f.modules)), paths: sorted(paths), hits: sorted(hits),
    runs: files.flatMap(f => f.runs) };
}

export function rebase(file, graph) {
  const paths = Object.fromEntries(universe(graph).map(p => [p.id, p]));
  return { rxCoverage: 1, modules: unique(Object.values(paths).map(p => p.module)), paths,
    hits: sorted(Object.entries(file.hits).filter(([id]) => Object.hasOwn(paths, id))), runs: [...file.runs] };
}

export function uncovered(file, { kind, module, limit = Infinity } = {}) {
  return Object.values(file.paths).filter(p => !(file.hits[p.id]?.n > 0) &&
      (!kind || p.kind === kind) && (!module || p.module === module))
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) ||
      cmp(a.module, b.module) || a.line - b.line || cmp(a.id, b.id)).slice(0, limit);
}

export function summary(file, { module } = {}) {
  const counts = Object.fromEntries([...KINDS, "all"].map(k => [k, { covered: 0, total: 0 }]));
  for (const p of Object.values(file.paths)) if (!module || p.module === module) {
    for (const count of [counts[p.kind], counts.all]) {
      count.total++;
      if (file.hits[p.id]?.n > 0) count.covered++;
    }
  }
  return counts;
}

function missing(p) {
  switch (p.kind) {
    case "node": return `changes ${p.label.replace(/ changes$/, "")}`;
    case "edge": return `carries a change ${p.label.replace(/^a change carries /, "")}`;
    case "loading": return `shows ${p.label.replace(/ shows$/, "")}`;
    case "errored": return `makes ${p.label.replace(/ shows its fallback$/, "")} show its fallback`;
    case "guess": return `sees ${p.label}`;
    case "action": return `makes ${p.label.replace(/ succeeds$/, " succeed").replace(/ rejects with /, " reject with ")}`;
  }
}

export function report(file, { module, kind, json } = {}) {
  const kinds = [...KINDS, "all"];
  const modules = Object.fromEntries(file.modules.filter(m => !module || module === m).map(m => [m, summary(file, { module: m })]));
  const program = summary(file, { module });
  const paths = uncovered(file, { module, kind });
  const stale = Object.keys(file.hits).filter(id => !Object.hasOwn(file.paths, id)).sort(cmp);
  if (json) return JSON.stringify({ modules, program, uncovered: paths, stale }, null, 2);
  const table = [["Module", ...kinds], ...[...Object.entries(modules), ["Program total", program]]
    .map(([m, counts]) => [m, ...kinds.map(k => `${counts[k].covered}/${counts[k].total}`)])];
  const widths = kinds.map((_, i) => Math.max(...table.map(row => row[i].length)));
  const lines = table.map(row => row.map((v, i) => i < row.length - 1 ? v.padEnd(widths[i]) : v).join("  "));
  if (paths.length) {
    const loc = p => `${p.module}:${p.line}`;
    const width = Math.max(...paths.map(p => loc(p).length));
    lines.push("", ...paths.map(p => `${loc(p).padEnd(width)}  no test ${missing(p)}`));
  }
  if (stale.length) lines.push("", ...stale.map(id => `stale: ${id}`));
  return lines.join("\n");
}

export async function collectBrowserCoverage(page, file) {
  const result = await page.evaluate(() => {
    if (!globalThis.__RX_COVERAGE__) throw new Error("Import @reactivescript/map/coverage/browser in the dev build first");
    return globalThis.__RX_COVERAGE__.result();
  });
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(result, null, 2) + "\n");
  return result;
}

export function rxCoverage() {
  return {
    name: "rx-coverage",
    config(config) {
      if (!process.env.VITEST || process.env.RX_COVERAGE !== "1") return;
      const setup = "@reactivescript/map/coverage/vitest";
      if ([config.test?.setupFiles ?? []].flat().includes(setup)) return;
      return { test: { setupFiles: [setup] } };
    },
  };
}
