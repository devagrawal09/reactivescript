// Two versions of one program as one map: every node and edge of both, each marked same, added, removed or changed, and
// a summary that leads with what changes behaviour (what an action can now reach, what became async or touches the
// world) rather than with how many lines moved.
import { addKeys } from "./graph.mjs";

const PROPS = ["kind", "async", "io", "question", "flavor", "world"];

export function diffGraphs(A, B) {
  if (!A.nodes.every(n => n.key)) addKeys(A);
  if (!B.nodes.every(n => n.key)) addKeys(B);

  // ---- modules: the after side's order, then any module only the before side has
  const modules = [...B.modules];
  const modA = A.modules.map(m => { const i = modules.indexOf(m); return i >= 0 ? i : modules.push(m) - 1; });

  // ---- regions by key
  const regB = new Map(B.regions.map(r => [r.key, r]));
  const regMap = new Map();   // A region id → union region id
  for (const r of A.regions) regMap.set(r.id, regB.get(r.key)?.id ?? `a:${r.id}`);
  const regKeysA = new Set(A.regions.map(r => r.key));
  const regA = new Map(A.regions.map(r => [r.key, r]));
  const outlineText = r => JSON.stringify(r.outline?.filter(p => "text" in p).map(p => [p.attr ?? "", p.text]));
  const regions = B.regions.map(r => {
    const old = regA.get(r.key);
    const textChanged = old?.outline && r.outline && outlineText(old) !== outlineText(r);
    return { ...r, status: textChanged ? "changed" : regKeysA.has(r.key) ? "same" : "added", ...(textChanged ? { reason: "text changed" } : {}) };
  });
  for (const r of A.regions) if (!regB.has(r.key)) regions.push({ ...r, id: `a:${r.id}`, mod: modA[r.mod], parent: r.parent == null ? null : regMap.get(r.parent), status: "removed" });

  // ---- nodes: named ones by key; sites by place, then by what they read, then in line order
  const match = new Map();    // A node id → B node id
  const bByKey = new Map(B.nodes.filter(n => !n.site).map(n => [n.key, n]));
  for (const a of A.nodes) if (!a.site && bByKey.has(a.key)) match.set(a.id, bByKey.get(a.key).id);
  const group = (g) => { const m = new Map(); for (const n of g.nodes) if (n.site) (m.get(n.base) ?? m.set(n.base, []).get(n.base)).push(n); return m; };
  const sitesA = group(A), sitesB = group(B);
  for (const [base, as] of sitesA) {
    const bs = (sitesB.get(base) ?? []).slice();
    const left = [];
    for (const a of as) { const i = bs.findIndex(b => b.sig === a.sig); if (i >= 0) match.set(a.id, bs.splice(i, 1)[0].id); else left.push(a); }
    left.sort((x, y) => x.line - y.line); bs.sort((x, y) => x.line - y.line);
    left.forEach((a, i) => { if (bs[i]) match.set(a.id, bs[i].id); });
  }
  const back = new Map([...match].map(([a, b]) => [b, a]));
  for (const r of regions) if (r.status === "removed" && r.outline) {
    r.outline = r.outline.map(p => "region" in p ? { ...p, region: regMap.get(p.region) }
      : "site" in p ? { ...p, site: match.get(p.site) ?? `a:${p.site}` } : p);
  }
  const nodeA = new Map(A.nodes.map(n => [n.id, n]));
  const textA = n => A.lines[n.file]?.[n.line]?.trim() ?? "";
  const textB = n => B.lines[n.file]?.[n.line]?.trim() ?? "";

  const nodes = B.nodes.map(n => {
    const aId = back.get(n.id);
    if (!aId) return { ...n, status: "added" };
    const a = nodeA.get(aId);
    const was = {};
    for (const p of PROPS) if ((a[p] ?? false) !== (n[p] ?? false)) was[p] = a[p] ?? false;
    const before = { line: a.line, text: textA(a) };
    const edited = before.text !== textB(n);
    return { ...n, status: Object.keys(was).length ? "changed" : "same", was, before, edited };
  });
  const uid = id => match.get(id) ?? (regMap.has(id) ? regMap.get(id) : `a:${id}`);
  for (const a of A.nodes) if (!match.has(a.id)) {
    nodes.push({ ...a, id: `a:${a.id}`, mod: modA[a.mod], region: regMap.get(a.region) ?? a.region, status: "removed", before: { line: a.line, text: textA(a) } });
  }

  // ---- edges
  const ek = e => [e.from, e.to, e.type, e.mode ?? "", e.probe ?? "", e.op ?? "", e.field ?? "", e.path ? 1 : 0].join("|");
  const loose = e => [e.from, e.to, e.type, e.field ?? ""].join("|");
  const eA = A.edges.map(e => ({ ...e, from: uid(e.from), to: uid(e.to) }));
  const aExact = new Map(), aLoose = new Map();
  for (const e of eA) { aExact.set(ek(e), e); (aLoose.get(loose(e)) ?? aLoose.set(loose(e), []).get(loose(e))).push(e); }
  const used = new Set();
  const edges = [];
  const pending = [];
  for (const e of B.edges) {
    const a = aExact.get(ek(e));
    if (a && !used.has(a)) { used.add(a); edges.push({ ...e, status: "same" }); } else pending.push(e);
  }
  for (const e of pending) {
    const a = (aLoose.get(loose(e)) ?? []).find(x => !used.has(x));
    if (a) { used.add(a); edges.push({ ...e, status: "changed", was: { mode: a.mode, probe: a.probe, op: a.op, path: a.path } }); }
    else edges.push({ ...e, status: "added" });
  }
  for (const e of eA) if (!used.has(e)) edges.push({ ...e, status: "removed" });

  const union = {
    modules, absModules: B.absModules, nodes, edges, regions, lines: B.lines, linesBefore: A.lines,
    diff: { before: A.label ?? "before", after: B.label ?? "after" },
  };
  union.diff.summary = summarize(A, B, union, match);
  return union;
}

// ---- summary -------------------------------------------------------------------------------------------------------
const NOUN = { source: "source", eq: "equation", action: "action", fn: "function", server: "server function", context: "context",
  errclass: "error class", comp: "component", import: "JS import", props: "props", handler: "handler", reader: "view read",
  effect: "effect", prop: "prop", provide: "provide" };
const opWord = { write: ":=", optimistic: "guess", refresh: "refresh", affects: "affects", provide: "provide" };
const readWord = e => e.probe ? (e.probe === "pending" ? "pending?" : e.probe) : e.mode;

/**
 * What a change at `id` can reach. The action itself (and what it calls) writes and calls; data reached that way
 * travels on only by tracked reads and props. An equation's own calls are how it computes, not part of the change.
 */
export function reach(g, id) {
  const out = new Map();
  for (const e of g.edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
  const seen = new Set([id]), imp = new Set([id]), todo = [[id, true]];
  while (todo.length) {
    const [x, imperative] = todo.pop();
    for (const e of out.get(x) ?? []) {
      const data = e.type === "passes" || e.type === "renders" || (e.type === "read" && (e.mode === "tracked" || e.probe));
      const act = imperative && (e.type === "write" || e.type === "call");
      if (!data && !act) continue;
      const nextImp = e.type === "call";
      if (!seen.has(e.to) || (nextImp && !imp.has(e.to))) { seen.add(e.to); if (nextImp) imp.add(e.to); todo.push([e.to, nextImp]); }
    }
  }
  seen.delete(id);
  return seen;
}

function summarize(A, B, U, match) {
  const items = [];
  const byId = new Map(U.nodes.map(n => [n.id, n]));
  const name = id => { const n = byId.get(id); return n ? (n.site ? `${n.name} (L${n.line})` : n.name) : id; };
  const add = (weight, text, ids) => items.push({ weight, text, ids });

  // what each action or handler can reach, before and after, compared by key
  const nodeB = new Map(B.nodes.map(n => [n.id, n])), nodeA = new Map(A.nodes.map(n => [n.id, n]));
  for (const [aId, bId] of match) {
    const n = nodeB.get(bId);
    if (!(n.kind === "action" || n.kind === "handler")) continue;
    // a handler that only calls an action says nothing the action's own line does not
    if (n.kind === "handler" && !U.edges.some(e => e.from === bId && e.status !== "same")) continue;
    const before = new Set([...reach(A, aId)].map(x => nodeA.get(x)?.key).filter(Boolean));
    const after = new Set([...reach(B, bId)].map(x => nodeB.get(x)?.key).filter(Boolean));
    const keyName = k => { const m = B.nodes.find(x => x.key === k) ?? A.nodes.find(x => x.key === k); return m && !m.site ? m.name : null; };
    const gained = [...after].filter(k => !before.has(k)).map(keyName).filter(Boolean);
    const lost = [...before].filter(k => !after.has(k)).map(keyName).filter(Boolean);
    if (gained.length || lost.length) {
      const who = n.kind === "action" ? `\`${n.name}\`` : `${n.name} (L${n.line})`;
      add(n.kind === "action" ? 0 : 1,
        `${who} now reaches ${[...gained.map(x => `+\`${x}\``), ...lost.map(x => `−\`${x}\``)].join(" ")}`, [bId]);
    }
  }

  for (const n of U.nodes) {
    if (n.status === "changed") {
      const bits = [];
      if ("kind" in n.was) bits.push(`was ${NOUN[n.was.kind] ?? n.was.kind}, now ${NOUN[n.kind] ?? n.kind}`);
      if ("async" in n.was) bits.push(n.async ? "became async: can be pending, a reader under no `loading` holds the page" : "no longer async");
      if ("io" in n.was) bits.push(n.io ? "now touches the world (io)" : "no longer touches the world");
      if ("question" in n.was) bits.push(n.question ? "now a source with a standing question" : "no longer re-asks");
      if (bits.length) add(1, `\`${n.name}\` ${bits.join("; ")}`, [n.id]);
    }
    if ((n.status === "added" || n.status === "removed") && !n.site)
      add(2, `${n.status === "added" ? "added" : "removed"} ${NOUN[n.kind] ?? n.kind} \`${n.name}\``, [n.id]);
  }

  for (const e of U.edges) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to || e.status === "same") continue;
    const gone = x => x.status === "added" || x.status === "removed";
    // an edge of a node that is itself new or gone is said by that node's own item
    if (e.type === "write" && gone(from)) continue;
    if (e.type === "call" && (gone(from) || to.status === "removed")) continue;
    if (e.type === "read" && gone(to)) continue;
    const sym = s => (s === "added" ? "now" : s === "removed" ? "no longer" : "");
    if (e.type === "write") {
      if (e.status === "changed") add(1, `\`${name(e.from)}\` writes \`${name(e.to)}\` with ${opWord[e.op] ?? e.op} (was ${opWord[e.was.op] ?? e.was.op})`, [e.from, e.to]);
      else add(1, `\`${name(e.from)}\` ${sym(e.status)} ${e.op === "optimistic" ? "guesses" : e.op === "refresh" ? "refreshes" : e.op === "affects" ? "affects" : "writes"} \`${name(e.to)}\``, [e.from, e.to]);
    } else if (e.type === "call" && (to.io || to.kind === "server" || (to.world && e.status === "added"))) {
      add(1, `\`${name(e.from)}\` ${sym(e.status)} calls \`${name(e.to)}\`${to.io ? " (io)" : ""}`, [e.from, e.to]);
    } else if (e.type === "read") {
      if (e.status === "changed") add(2, `\`${name(e.to)}\` reads \`${name(e.from)}\` as ${readWord(e)} (was ${readWord(e.was)})`, [e.from, e.to]);
      else if (!to.site || from.async || gone(from)) add(3, `\`${name(e.to)}\` ${sym(e.status)} reads \`${name(e.from)}\`${from.async ? " (can be pending)" : ""}`, [e.from, e.to]);
    }
  }
  const seen = new Set();
  return items.sort((a, b) => a.weight - b.weight).filter(i => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}
