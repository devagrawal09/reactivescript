// HMR planner for the trace protocol (TRACE-CONTRACT §2). The real host calls this with the old and new graphs
// from the compiler; the fake calls the same function. Pure ESM, no dependencies, Node and browser.
//
// A plan partitions every source, equation, effect and action of old ∪ new. State (source / equation / effect) is
// kept, reset, rerun, added, removed, or a move. Actions have no state: rerun if the body changed, else kept.
// Identity is the key. A rename or a `#n` shift is a move when the declaration (minus the name, for a rename) matches.

const PLAN_KINDS = new Set(["source", "eq", "effect", "action"]);

const sites = (graph, name) => graph.regions.filter(r => r.kind === "children" && r.name === name)
  .map(r => r.key).sort().join("\n");
const paths = items => items.map(item => (item.ownerPath ?? []).join("/"));

/** Only primary source accessors enter this app-local registry; auxiliaries
 * for a hoisted await/catch share a trace key but do not consume a seed. */
export function prepareCarry(before, after, plan, sources, changedModules) {
  const carry = new Map(), fallback = new Set(), expected = new Map();
  const moved = new Map(plan.moved.map(({ from, to }) => [to, from]));
  const nodes = new Map(after.nodes.map(n => [n.key, n]));
  const kept = new Set(plan.kept);
  for (const key of [...plan.kept, ...plan.rerun]) {
    const n = nodes.get(key);
    if (n?.kind !== "source" || (!kept.has(key) && !n.question)) continue;
    const { scope, module } = keyParts(key);
    if (!scope && !changedModules.has(module)) continue; // live module root was not replaced
    const reads = [...(sources.get(moved.get(key) ?? key) ?? [])];
    if (!reads.length) continue;
    const shown = reads.map(read => read.hmrValue?.());
    const ownerPaths = paths(reads);
    // More than one render site or a static shape edit makes mount order
    // ambiguous. One unchanged site (including a keyed list) pairs in order.
    const site = sites(after, scope);
    if (sites(before, scope) !== site || (reads.length > 1 && (!site || site.includes("\n") || new Set(ownerPaths).size !== 1))
      || shown.some(v => !v || !Object.hasOwn(v, "value") || v.held)) {
      fallback.add(key);
      continue;
    }
    const keepAnswer = n.question && kept.has(key) && !after.edges.some(e => e.to === n.id && e.type === "read" && e.mode === "tracked");
    expected.set(key, ownerPaths);
    carry.set(key, { entries: shown.map((v, i) => ({ value: v.value, keepAnswer, instance: reads[i].instance })), used: 0 });
  }
  return { carry, fallback, expected };
}

export function finishCarry({ carry, fallback, expected }, sources) {
  for (const [key, group] of carry) {
    const actual = paths([...(sources.get(key) ?? [])]);
    if (group.used !== group.entries.length || actual.length !== group.entries.length
      || actual.some((path, i) => path !== expected.get(key)[i])) fallback.add(key);
  }
  return [...fallback];
}

/** Source lines for a node: `lines[file]`, keys are 1-based line numbers (strings after JSON). */
function lineMap(graph, node) {
  if (!graph?.lines || !node) return null;
  return graph.lines[node.file] ?? graph.lines[graph.modules?.[node.mod]] ?? null;
}

function braceDelta(line) {
  const s = String(line).replace(/\/\/.*$/, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "");
  let d = 0;
  for (const c of s) if (c === "{") d++; else if (c === "}") d--;
  return d;
}

/**
 * Declaration text. A node may carry `decl` or `text` (preferred when a future graph has them); otherwise the
 * source line, extended through the closing brace when the first line opens one.
 */
export function declText(graph, node) {
  if (node?.decl != null) return String(node.decl);
  if (node?.text != null) return String(node.text);
  const lines = lineMap(graph, node);
  if (!lines || node.line == null) return "";
  const start = lines[node.line];
  if (start == null) return "";
  const keys = Object.keys(lines).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  const i0 = keys.indexOf(Number(node.line));
  if (i0 < 0) return start;
  let depth = braceDelta(start);
  if (depth <= 0) return start;
  const out = [start];
  for (let i = i0 + 1; i < keys.length && out.length < 120; i++) {
    const t = lines[keys[i]];
    out.push(t);
    depth += braceDelta(t);
    if (depth <= 0) break;
  }
  return out.join("\n");
}

// Keep literal text intact, including // and spaces inside quotes.
const LITERAL_OR_COMMENT = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
/** Comments stripped, blank lines dropped, trailing space dropped. A comment-only edit is not a change. */
export function normDecl(text) {
  return String(text ?? "").replace(LITERAL_OR_COMMENT, (_match, literal) => literal ?? " ").trim();
}
const comparable = text => (normDecl(text).match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[\p{ID_Continue}$]+|[^\s]/gu) ?? []).join("\0");

function normType(t) {
  if (!t) return "";
  return String(t).replace(/\s+/g, " ").replace(/\s*\|\s*/g, " | ").trim();
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Declaration with the binding name blanked, so a rename still matches. First occurrence only. */
export function blankName(text, name) {
  if (!name) return text;
  return String(text).replace(new RegExp(`\\b${escapeReg(name)}\\b`), "□");
}

/**
 * Pull type, operator and rhs out of a declaration. `:=` is an initialiser; `=` on a source is the seed or the
 * question expression. `key id` between the type and `=` is not part of the type.
 */
export function parseDecl(kind, _name, text) {
  const raw = String(text ?? "").trim();
  if (kind === "source") {
    const m = /^(?:export\s+)?source\s+\w+\s*(?::\s*([^=]+?))?(?:\s+key\s+\w+)?\s*(:=|=)\s*([\s\S]*)$/.exec(raw);
    if (!m) return { type: null, op: null, rhs: raw };
    let type = m[1]?.trim() || null;
    if (type) type = type.replace(/\s+key\s+[\s\S]+$/, "").trim() || null;
    return { type, op: m[2], rhs: m[3].trim() };
  }
  if (kind === "action" || kind === "fn" || kind === "server" || kind === "effect") {
    return { type: null, op: null, rhs: raw };
  }
  const m = /^(?:export\s+)?\w+\s*(?::\s*([^=]+?))?\s*=\s*([\s\S]*)$/.exec(raw);
  if (!m) return { type: null, op: "=", rhs: raw };
  return { type: m[1]?.trim() || null, op: "=", rhs: m[2].trim() };
}

/** `<module>|<scope>|<name>[#n]`. Module paths have no `|`. */
export function keyParts(key) {
  const a = String(key).indexOf("|");
  const b = a < 0 ? -1 : String(key).indexOf("|", a + 1);
  if (a < 0 || b < 0) return { module: "", scope: "", name: String(key), index: "" };
  const rest = String(key).slice(b + 1);
  const m = /^(.*?)(?:#(\d+))?$/.exec(rest);
  return { module: key.slice(0, a), scope: key.slice(a + 1, b), name: m?.[1] ?? rest, index: m?.[2] ?? "" };
}

function baseKey(key) {
  const p = keyParts(key);
  return `${p.module}|${p.scope}|${p.name}`;
}

function planNodes(g) {
  return (g?.nodes ?? []).filter(n => n && n.key && PLAN_KINDS.has(n.kind));
}

function readKeys(graph, node) {
  const byId = new Map((graph.nodes ?? []).map(n => [n.id, n]));
  const keys = [];
  for (const e of graph.edges ?? []) {
    if (e.type === "read" && e.to === node.id) {
      const s = byId.get(e.from);
      if (s?.key) keys.push(s.key);
    }
  }
  return keys.sort();
}

function mapMoved(key, moved) {
  const m = moved.find(x => x.from === key);
  return m ? m.to : key;
}

/**
 * @param {object} oldGraph graph from `buildGraph`
 * @param {object} newGraph graph from `buildGraph`
 * @param {{ renamed?: {from: string, to: string}[], reindexed?: {from: string, to: string}[] }} [edits]
 *   Optional identity hints from a host that already knows the edit. Heuristics run for everything else.
 * @returns {import("./hmr.mjs").Plan}
 */
export function planHmr(oldGraph, newGraph, edits) {
  const oldN = planNodes(oldGraph);
  const newN = planNodes(newGraph);
  const oldByKey = new Map(oldN.map(n => [n.key, n]));
  const newByKey = new Map(newN.map(n => [n.key, n]));
  const usedO = new Set();
  const usedN = new Set();
  /** @type {{ o: any, n: any, move: null | "renamed" | "reindexed" | "scope" }[]} */
  const paired = [];

  const take = (o, n, move) => {
    if (!o || !n || usedO.has(o.key) || usedN.has(n.key)) return false;
    if (o.kind !== n.kind && move) return false;
    // The wire partitions keys (not declaration instances). When a move's
    // old key is still present, prefer the exact key over an overlapping move.
    if (move && (o.key === n.key || newByKey.has(o.key))) return false;
    usedO.add(o.key);
    usedN.add(n.key);
    paired.push({ o, n, move });
    return true;
  };

  for (const h of edits?.renamed ?? []) take(oldByKey.get(h.from), newByKey.get(h.to), "renamed");
  for (const h of edits?.reindexed ?? []) take(oldByKey.get(h.from), newByKey.get(h.to), "reindexed");

  // `#n` shift: same module, scope, name and kind. Match by declaration text, not by the old index.
  const group = nodes => {
    const m = new Map();
    for (const n of nodes) {
      const k = `${n.kind}|${baseKey(n.key)}`;
      (m.get(k) ?? m.set(k, []).get(k)).push(n);
    }
    return m;
  };
  const gOld = group(oldN);
  const gNew = group(newN);
  for (const [k, os] of gOld) {
    const ns = gNew.get(k);
    if (!ns) continue;
    for (const o of os) {
      if (usedO.has(o.key)) continue;
      const ot = comparable(declText(oldGraph, o));
      const n = ns.find(x => !usedN.has(x.key) && comparable(declText(newGraph, x)) === ot);
      if (n) take(o, n, o.key === n.key ? null : "reindexed");
    }
  }

  // Same key: an edit of one declaration, or a kind change (source became an equation, and so on).
  for (const o of oldN) {
    if (usedO.has(o.key)) continue;
    const n = newByKey.get(o.key);
    if (n && !usedN.has(n.key)) take(o, n, null);
  }

  // Rename: same kind, module and scope, declaration equal once the binding name is blanked.
  const byDist = (o, list) => {
    const ob = comparable(blankName(normDecl(declText(oldGraph, o)), o.name));
    const op = keyParts(o.key);
    let best = null, bestDist = Infinity;
    for (const n of list) {
      if (usedN.has(n.key) || n.kind !== o.kind || n.name === o.name) continue;
      const np = keyParts(n.key);
      if (np.module !== op.module || np.scope !== op.scope) continue;
      if (comparable(blankName(normDecl(declText(newGraph, n)), n.name)) !== ob) continue;
      const dist = Math.abs((n.line ?? 0) - (o.line ?? 0));
      if (dist < bestDist) { best = n; bestDist = dist; }
    }
    return best;
  };
  for (const o of oldN) {
    if (usedO.has(o.key)) continue;
    const n = byDist(o, newN);
    if (n) take(o, n, "renamed");
  }

  // Same declaration moved into another component: the key's scope changed. That resets state.
  for (const o of oldN) {
    if (usedO.has(o.key)) continue;
    const ob = comparable(blankName(normDecl(declText(oldGraph, o)), o.name));
    const op = keyParts(o.key);
    let best = null, bestDist = Infinity;
    for (const n of newN) {
      if (usedN.has(n.key) || n.kind !== o.kind) continue;
      const np = keyParts(n.key);
      if (np.module !== op.module || np.name !== op.name || np.scope === op.scope) continue;
      if (comparable(blankName(normDecl(declText(newGraph, n)), n.name)) !== ob) continue;
      const dist = Math.abs((n.line ?? 0) - (o.line ?? 0));
      if (dist < bestDist) { best = n; bestDist = dist; }
    }
    if (best) take(o, best, "scope");
  }

  const plan = { kept: [], reset: [], rerun: [], added: [], removed: [], moved: [], reasons: {} };
  const pending = [];

  const ownChange = (o, n) => {
    const ot = normDecl(declText(oldGraph, o));
    const nt = normDecl(declText(newGraph, n));
    const op = parseDecl(o.kind, o.name, ot);
    const np = parseDecl(n.kind, n.name, nt);
    if (o.kind !== n.kind) return { bucket: "reset", reason: "kind-changed" };
    if (keyParts(o.key).scope !== keyParts(n.key).scope) return { bucket: "reset", reason: "scope-changed" };
    if (normType(o.type ?? op.type) !== normType(n.type ?? np.type) && n.kind !== "action") return { bucket: "reset", reason: "type-changed" };
    const rhsChanged = comparable(op.rhs) !== comparable(np.rhs);
    // The binding name is part of the text. Blank it, or a rename looks like an expression edit.
    const bodyChanged = comparable(blankName(ot, o.name)) !== comparable(blankName(nt, n.name));
    if (n.kind === "source" && (rhsChanged || bodyChanged)) {
      if (np.op === "=" && (n.question || /\bawait\b/.test(np.rhs))) return { bucket: "rerun", reason: "expr-changed" };
      return { bucket: "kept", reason: "init-changed" };
    }
    if ((n.kind === "eq" || n.kind === "effect" || n.kind === "action") && (rhsChanged || bodyChanged))
      return { bucket: "rerun", reason: "expr-changed" };
    return { bucket: "pending", reason: null };
  };

  for (const p of paired) {
    const c = ownChange(p.o, p.n);
    if (p.move) {
      plan.moved.push({ from: p.o.key, to: p.n.key });
      plan.reasons[p.o.key] = p.move === "reindexed" ? "reindexed" : p.move === "scope" ? "scope-changed" : "renamed";
    }
    if (c.bucket === "pending") pending.push(p);
    else {
      plan[c.bucket].push(p.n.key);
      plan.reasons[p.n.key] = c.reason;
    }
  }
  for (const o of oldN) if (!usedO.has(o.key) && !newByKey.has(o.key)) {
    plan.removed.push(o.key);
    plan.reasons[o.key] = "gone";
  }
  for (const n of newN) if (!usedN.has(n.key)) {
    plan.added.push(n.key);
    plan.reasons[n.key] = "new";
  }

  const dirty = new Set([...plan.reset, ...plan.rerun, ...plan.added, ...plan.removed, ...plan.moved.map(m => m.from)]);
  let left = pending;
  for (let guard = 0; guard < left.length + 2 && left.length; guard++) {
    const next = [];
    let progressed = false;
    for (const p of left) {
      if (p.n.kind !== "eq" && p.n.kind !== "effect") { next.push(p); continue; }
      const oldReads = readKeys(oldGraph, p.o).map(k => mapMoved(k, plan.moved)).sort();
      const newReads = readKeys(newGraph, p.n);
      const readsChanged = oldReads.join("\0") !== newReads.join("\0");
      const readsDirty = newReads.some(k => dirty.has(k));
      if (readsChanged || readsDirty) {
        plan.rerun.push(p.n.key);
        plan.reasons[p.n.key] = "upstream-changed";
        dirty.add(p.n.key);
        progressed = true;
      } else next.push(p);
    }
    left = next;
    if (!progressed) break;
  }
  for (const p of left) {
    plan.kept.push(p.n.key);
    plan.reasons[p.n.key] = "unchanged";
  }

  for (const k of ["kept", "reset", "rerun", "added", "removed"]) plan[k].sort();
  plan.moved.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  const reasons = {};
  for (const k of Object.keys(plan.reasons).sort()) reasons[k] = plan.reasons[k];
  plan.reasons = reasons;
  return plan;
}
