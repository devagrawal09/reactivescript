// Routes on the immutable world boxes, in board coordinates.
import { planTrunks } from "../../layout.mjs";
import { edgeStyle, edgeKey, kindOf } from "./vocab.js";
import { edgePath } from "./geometry.js";
import { regionByRef } from "./model.js";
import { overviewLevel } from "./layout.js";

const plateKeyOf = (M, id) => { const n = M.nodes.get(id); return n ? n.world && !n.from ? "world" : n.mod : M.regions.get(id)?.mod; };
function roundPath(pts, r = 14) {
  pts = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > .5);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const k = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${x1 - (x1 - x0) / l1 * k},${y1 - (y1 - y0) / l1 * k} Q${x1},${y1} ${x1 + (x2 - x1) / l2 * k},${y1 + (y2 - y1) / l2 * k}`;
  }
  return d + ` L${pts.at(-1)[0]},${pts.at(-1)[1]}`;
}

// one edge, from what depends (fromId) to what it needs (toId): a curve inside a plate; between plates, a stub out of
// the token to its plate's port, the bundle, and a stub from the other port into the token
function routed(M, L, anchor, fromId, toId, plan, kind = "") {
  const ka = plateKeyOf(M, fromId), kb = plateKeyOf(M, toId);
  const A_ = anchor(fromId), B_ = anchor(toId);
  if (ka == null || kb == null) return null;
  if (ka === kb) return A_ && B_ ? { d: edgePath(A_, B_) } : null;
  const key = `${ka}>${kb}${kind}`, t = plan?.get(key);
  if (!t) {
    if (A_ && B_) return { d: edgePath(A_, B_) };
    const PA = L.plates.get(ka), PB = L.plates.get(kb);
    const bx = p => ({ l: p.x, r: p.x + p.w, t: p.y, b: p.y + p.h, x: p.x + p.w / 2, y: p.y + p.h / 2 });
    return PA && PB ? { d: edgePath(bx(PA), bx(PB)) } : null;
  }
  const [xa, ya] = t[0], [xb, yb] = t.at(-1);
  const head = A_ && A_.t > ya + 4 ? roundPath([[A_.x, A_.t], [A_.x, ya - 12], [xa, ya - 12]], 10) : "";
  const tail = B_ && B_.b < yb - 4 ? roundPath([[xb, yb + 12], [B_.x, yb + 12], [B_.x, B_.b]], 10) : "";
  return { head, tail, trunk: roundPath(t), key };
}

export function edgeLayer(M, L, level, focus, all, view, hiddenKeys, caught) {
  const far = () => level === overviewLevel(), hidden = new Set(hiddenKeys);
  const list = (focus ? focus.edges.map(i => M.G.edges[i]) : far() || all ? M.G.edges
    : M.diff && !hidden.has("d:changes") ? M.G.edges.filter(e => e.status !== "same") : [])
    .filter(e => e && !(view === "before" && e.status === "added") && !(view === "after" && e.status === "removed") && !hidden.has(`e:${edgeKey(e)}`));
  const anchor = id => {
    const n = M.nodes.get(id), t = L.tokens.get(id);
    if (far() || (n && n.kind !== "comp" && hidden.has(`k:${kindOf(n)}`)) || (t && t.level > level)) return null;
    const b = t ?? L.frames.get(id)?.label;
    return b && { l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h, x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };
  const markers = new Set();
  const paths = [], glows = [], trunks = new Map();
  const line = (d, s, { glow, marker = true, width = s.w, opacity, cls = "" } = {}) => {
    const id = `m${s.c.slice(1)}`;
    if (marker) markers.add(s.c);
    if (glow || focus) glows.push({ d, c: glow || s.c, w: width + 6, op: glow ? .4 : .14 });
    paths.push({ cls, d, c: s.c, w: width, dash: s.d || undefined, marker: marker ? `url(#${id})` : undefined,
      op: opacity ?? (glow ? 1 : focus ? .95 : .55) });
  };
  // drawn from what depends to what it depends on: a read points at what it reads
  const ends = e => (e.type === "read" || e.type === "notifies" ? [e.to, e.from] : [e.from, e.to]);
  const kindOfEdge = e => (far() ? "" : `|${edgeKey(e)}`);
  const pairs = new Set();
  for (const e of list) { const [f, t] = ends(e), a = plateKeyOf(M, f), b = plateKeyOf(M, t); if (a != null && b != null && a !== b) pairs.add(`${a}>${b}${kindOfEdge(e)}`); }
  const plan = planTrunks(pairs, L);
  for (const e of list) {
    const [fromId, toId] = ends(e);
    const s = edgeStyle(e); if (!s) continue;
    const r = routed(M, L, anchor, fromId, toId, plan, kindOfEdge(e)); if (!r) continue;
    const glow = e.status && e.status !== "same" ? { added: "#22c55e", removed: "#ef4444", changed: "#e879f9" }[e.status] : null;
    if (r.d) { line(r.d, s, { glow }); continue; }
    // between plates: the stubs per edge, the trunk once per pair of plates and kind of edge (a bundle)
    if (r.head) line(r.head, s, { glow, marker: false });
    if (r.tail) line(r.tail, s, { glow });
    const k = r.key, t = trunks.get(k);
    if (t) { t.n++; t.glow ||= glow; t.tail ||= !!r.tail; } else trunks.set(k, { d: r.trunk, s, n: 1, glow, tail: !!r.tail });
  }
  // caught by: from each failing name to the boundary showing its fallback for it
  for (const [from, rid] of caught) {
    const r = routed(M, L, anchor, from, rid, null); if (!r) continue;
    const s = { c: "#fb7185", d: "6 4", w: 2.2 };
    for (const d of [r.d, r.head, r.trunk, r.tail].filter(Boolean)) line(d, s, { glow: "#fb7185", marker: d === (r.d ?? r.tail ?? r.trunk), opacity: 1, cls: "caught" });
  }
  const bundle = far() ? { c: "#9fb4d8", d: "", w: 2 } : null;   // in the overview a bundle is every kind of edge between two modules
  for (const t of trunks.values()) line(t.d, bundle ?? t.s, { glow: t.glow, marker: !t.tail, width: (bundle ?? t.s).w + Math.min(far() ? 10 : 4, Math.log2(t.n) * (far() ? 2.2 : 1.4)), opacity: t.glow ? 1 : focus ? .9 : far() ? .45 : .5, cls: "trunk" });
  return { paths, glows, markers: [...markers], size: far() ? 18 : 12 };
}

export function caughtPairs(M, values, boundaries) {
  const pairs = [];
  const failing = new Set(Object.entries(values).filter(([, v]) => v.error).flatMap(([k]) => (M.keyIds.get(k) ?? []).filter(id => !M.nodes.get(id)?.site)));
  if (!failing.size) return pairs;
  for (const [ref, b] of Object.entries(boundaries)) {
    if (b.state !== "fallback" && b.state !== "error") continue;
    const r = regionByRef(M, ref); if (!r || (r.kind !== "errored" && b.state !== "error")) continue;
    const got = new Set();
    for (const e of M.inc.get(r.id) ?? []) if (e.type === "notifies" && failing.has(e.from)) got.add(e.from);
    for (const sid of M.boundaryCover.get(r.id) ?? []) for (const e of M.inc.get(sid) ?? []) if (e.type === "read" && failing.has(e.from)) got.add(e.from);
    if (!got.size && b.error) for (const id of failing) if (String(values[M.nodes.get(id).key]?.error) === String(b.error)) got.add(id);
    for (const id of got) pairs.push([id, r.id]);
  }
  return pairs;
}
