// Live mode's state, as one plain object, and the one reducer that changes it. Ported from map.html's onLive and its
// handlers (onFlight, onFlush, applyChanges, onSnapshot, onTimeline, onStep, onResume, reconcile, onHmr, …).
//
// The same reducer runs twice per message: here on a plain JS mirror (so `__RX_VIEW__.values()`, the timeline canvas,
// travel's throttle and the transient effects read the state synchronously, burst after burst), and in live.rx on the
// store's draft (`live := s => reduce(s, m, model)`), which the views render. It changes `s` in place and returns
// nothing, so it works on both; it must stay deterministic (no clocks, no randomness): what it needs from outside is
// put on the message first by `enrich`.
//
// Message types starting with "~" are the page's own (a travel target, the pop-out's connection, the swap after a
// module replacement); the transport drops them from outside.
import { reducedMotion } from "./env.js";
import { famOf, keyName, kindOf, PLAN_GROUPS, ICON, ICON_OF, SHAPE } from "./vocab.js";
import { valueAt } from "./values.js";
import { comet, ring, fire, orb, clearOrbs, clearPulses, revert, rewind, shake, beat, toast } from "./fx.js";
import { sfx, note } from "./sound.js";
import { anchorOf } from "./geometry.js";
import { putGraph } from "./graphs.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A fresh, empty live state (a new object every call: the mirror and the store must not share one). */
export function freshLive() {
  return {
    // key → { preview?, error?, pending, count, seq, origin, current, shown, old, anim, delay, roll }
    values: {},
    flying: {},        // key → requests in the air
    runs: {},          // run id → key (actions running)
    held: {},          // key → { by: Key[], since }
    boundaries: {},    // region ref (key or id) → { state, error? }
    inexact: {},       // key → true: can't be shown exactly at the viewed seq
    flushes: 0,
    connected: true,
    tl: { steps: [], head: 0, viewing: null, target: null, capacity: 2000, flights: [], hmrs: [], rev: 0 },
    // a module replacement: the plan (its graph kept by number), its phase, and what the board marks for it
    hmr: { plan: null, phase: null, error: null, swapped: false, pendingDone: null, marks: {}, planned: {}, incoming: {} },
  };
}

let S = freshLive();
/** The mirror: the live state as of the last message handled (plain, synchronous). */
export const mirror = () => S;
/** What `__RX_VIEW__.values()` returns: every key's preview. */
export const previews = () => Object.fromEntries(Object.entries(S.values).map(([k, v]) => [k, v.preview]));

const has = (M, key) => key != null && M.keyIds.has(key);
const idsOf = (M, key) => M.keyIds.get(key) ?? [];
const chipIds = (M, key) => idsOf(M, key).filter(id => anchorOf(id)?.classList.contains("chip"));
const lastAt = s => s.tl.steps.length ? s.tl.steps[s.tl.steps.length - 1].at : 0;
const del = (o, k) => { if (k in o) delete o[k]; };

// ---- enrich: what the reducer needs that isn't in the message (computed once, from the mirror before it changes) --
function enrich(raw, M, extra) {
  const m = { ...raw, ...extra };
  if (m.type === "flight" && !has(M, m.key)) return null;
  if (m.type === "flight") m.at = m.at ?? lastAt(S);
  if (m.type === "flush" || m.type === "step" || m.type === "resume" || m.type === "~done") {
    const flush = m.type === "flush";
    m.changes = (m.changes ?? []).filter(c => c && has(M, c.key));
    m.waves = waves(M, m.changes, flush, m.cause, m.order);
  }
  if (m.type === "hmr") {
    if (m.phase !== "plan" && (!S.hmr.plan || m.id !== S.hmr.plan.id)) return null;
    if (m.phase === "plan") m.graphNo = m.graph?.nodes ? putGraph(m.graph) : -1;
    if (m.phase === "done" && S.hmr.swapped) m.waves = waves(M, (m.changes ?? []).filter(c => c && has(M, c.key)), false);
  }
  if (m.type === "released" && !(m.key in S.held)) return null;
  if (m.type === "held" && !has(M, m.key)) return null;
  return m;
}

// causal waves: a changed node one step after the changed nodes it reads (or after its cause). Returns, per changed id,
// its delay (ms) and the edges its comets run along; per key, the delay of its first id (the value badge rolls then).
function waves(M, changes, flush, cause, order) {
  const byId = new Map();
  for (const c of changes) for (const id of idsOf(M, c.key)) byId.set(id, c);
  const T = flush && !reducedMotion() ? 240 : 0, level = new Map(), via = new Map();
  const ord = order ? new Map(order.map((k, i) => [k, i])) : null;
  const causeIds = new Set(cause ? idsOf(M, cause) : []);
  const flows = e => (e.type === "read" && (e.mode === "tracked" || e.probe)) || e.type === "write" || e.type === "passes" || e.type === "call";
  const lv = (id, path = new Set()) => {
    if (level.has(id)) return level.get(id);
    if (path.has(id)) return 0;
    path.add(id);
    let l = 0; const ins = [];
    const k = M.nodes.get(id)?.key;
    for (const e of M.inc.get(id) ?? []) {
      if (!flows(e) || e.from === id) continue;
      if (byId.has(e.from) && (!ord || (ord.get(M.nodes.get(e.from)?.key) ?? -1) < (ord.get(k) ?? 1e9))) { l = Math.max(l, lv(e.from, path) + 1); ins.push(e); }
    }
    if (!ins.length) for (const e of M.inc.get(id) ?? []) if (causeIds.has(e.from) && flows(e)) { l = 1; ins.push(e); }
    path.delete(id);
    level.set(id, l); via.set(id, ins);
    return l;
  };
  const ids = [], delays = {};
  for (const [id, c] of byId) {
    const at = flush ? Math.min(4, lv(id)) * T : 0;
    ids.push({ id, key: c.key, at, via: flush ? (via.get(id) ?? []).map(e => e.from) : [], error: typeof c.error === "string" });
    if (!(c.key in delays)) delays[c.key] = at;
  }
  return { ids, delays, cause: flush ? [...causeIds].filter(id => !byId.has(id)) : [], T };
}

// ---- the reducer ---------------------------------------------------------------------------------------------
/** Applies one (enriched) message to `s`, in place. `M` is the model the keys are looked up in. */
export function reduce(s, m, M) {
  switch (m.type) {
    case "reset": return onReset(s);
    case "flight": return onFlight(s, m);
    case "flush": return onFlush(s, m);
    case "timeline": return onTimeline(s, m, M);
    case "step": return onStep(s, m, M);
    case "resume": return onResume(s, m, M);
    case "travel-denied": s.tl.target = null; s.tl.rev++; return;
    case "hmr": return onHmr(s, m, M);
    case "snapshot": return onSnapshot(s, m, M);
    case "boundary": s.boundaries[m.region] = { state: m.state, error: m.error ?? null }; return;
    case "held": s.held[m.key] = { by: [...(m.by ?? [])], since: m.at ?? null }; return;
    case "released": del(s.held, m.key); return;
    case "run": if (m.state === "start") s.runs[m.id] = m.key; else del(s.runs, m.id); return;
    case "~target": s.tl.target = m.seq; s.tl.rev++; return;
    case "~connected": s.connected = m.ok; return;
    case "~flushes": s.flushes = m.n; return;
    case "~swapped": return onSwapped(s);
    case "~done": s.hmr.pendingDone = null; return applyChanges(s, m.changes, m.waves, { seq: s.tl.viewing ?? s.tl.head });
  }
}

function onReset(s) {
  const f = freshLive();
  for (const k of Object.keys(f)) {
    if (k === "connected") continue;
    s[k] = f[k];
  }
}

function onFlight(s, m) {
  const k = s.flying[m.key] ?? 0;
  const next = m.state === "start" ? k + 1 : Math.max(0, k - 1);
  if (next) s.flying[m.key] = next; else del(s.flying, m.key);
  const fl = s.tl.flights;
  if (m.state === "start") fl.push({ key: m.key, start: m.at, end: null, state: null });
  else {
    for (let i = fl.length - 1; i >= 0; i--) if (fl[i].key === m.key && fl[i].end == null) { fl[i].end = m.at; fl[i].state = m.state; break; }
  }
  if (fl.length > 400) fl.splice(0, fl.length - 400);
  s.tl.rev++;
}

function onFlush(s, m) {
  s.flushes++;
  if (typeof m.seq === "number") {
    s.tl.steps.push({ seq: m.seq, at: m.at, origin: m.origin, cause: m.cause, changes: m.changes, order: m.order });
    if (s.tl.steps.length > s.tl.capacity) s.tl.steps.splice(0, s.tl.steps.length - s.tl.capacity);
    s.tl.head = Math.max(s.tl.head, m.seq);
  }
  s.tl.rev++;
  applyChanges(s, m.changes, m.waves, { flush: true, seq: m.seq });
}

// a value badge rolls to new text: up (forward) or down (back); the same direction twice alternates its animation
function roll(v, text, { dir = "up", delay = 0, prev, still = false }) {
  const old = prev ?? v.shown ?? "";
  v.old = old;
  v.shown = text;
  if (still) { v.anim = null; return; }
  const a = dir === "down" ? "down" : "up";
  v.anim = v.anim === a ? `${a}2` : a;
  v.delay = Math.round(delay);
  v.roll = (v.roll ?? 0) + 1;
}
const blank = () => ({ count: 0, pending: false, seq: null, origin: null, current: false, shown: null, old: "", anim: null, delay: 0, roll: 0 });

// the changes of a flush, a step or a resume: values (and their badges' roll)
function applyChanges(s, changes, w, { flush = false, dir = "up", seq } = {}) {
  for (const c of changes) {
    const v = { ...blank(), ...(s.values[c.key] ?? {}) };
    if (flush) { v.count++; v.seq = seq ?? null; }
    else v.seq = s.tl.viewing ?? s.tl.head;
    v.origin = c.origin ?? v.origin ?? null;
    if (typeof c.error === "string") { v.error = c.error; delete v.preview; v.pending = false; }
    else if (typeof c.preview === "string") { v.preview = c.full ?? c.preview; delete v.error; }
    if ("pending" in c) v.pending = !!c.pending;
    if (v.preview !== undefined && typeof c.error !== "string") roll(v, v.preview, { dir, delay: w?.delays?.[c.key] ?? 0, prev: c.prev });
    s.values[c.key] = v;
  }
}

function onSnapshot(s, d, M) {
  for (const { key, preview, full, error, pending } of d.values ?? []) {
    if (!has(M, key) || (typeof preview !== "string" && typeof error !== "string" && !pending)) continue;
    const v = { ...blank(), ...(s.values[key] ?? {}) };
    v.preview = full ?? preview;
    if (typeof error === "string") v.error = error; else delete v.error;
    v.pending = !!pending; v.current = true; v.seq = v.seq ?? s.tl.head;
    if (v.preview !== undefined) roll(v, v.preview, { still: true });
    s.values[key] = v;
  }
  if (Array.isArray(d.held)) {
    s.held = {};
    for (const h of d.held) if (h?.key && has(M, h.key)) s.held[h.key] = { by: [...(h.by ?? [])], since: h.since ?? null };
  }
  if (Array.isArray(d.flights)) {
    s.flying = {};
    for (const { key, since } of d.flights) {
      if (!has(M, key)) continue;
      s.flying[key] = 1;
      if (!s.tl.flights.some(f => f.key === key && f.end == null)) s.tl.flights.push({ key, start: since ?? lastAt(s), end: null, state: null });
    }
  }
  if (Array.isArray(d.boundaries)) {
    s.boundaries = {};
    for (const b of d.boundaries) if (b?.region) s.boundaries[b.region] = { state: b.state, error: b.error ?? null };
  }
  if (Array.isArray(d.runs)) {
    s.runs = {};
    for (const r of d.runs) s.runs[r.id] = r.key;
  }
  s.tl.rev++;
}

function onTimeline(s, d, M) {
  const cap = d.capacity ?? s.tl.capacity;
  s.tl.steps = Array.isArray(d.steps) ? d.steps.slice(-cap) : [];
  s.tl.capacity = cap;
  s.tl.head = d.head ?? s.tl.steps.at(-1)?.seq ?? 0;
  s.tl.viewing = d.viewing ?? null;
  // the values the timeline implies, without fanfare
  const counted = new Set();
  for (const st of s.tl.steps) for (const c of st.changes ?? []) if (c?.key && has(M, c.key) && typeof c.preview === "string" && (s.tl.viewing == null || st.seq <= s.tl.viewing)) {
    const v = { ...blank(), ...(s.values[c.key] ?? {}) };
    if (!counted.has(c.key)) { counted.add(c.key); v.count = 0; }
    v.count++; v.seq = st.seq; if (!v.current || s.tl.viewing != null) v.preview = c.full ?? c.preview;
    s.values[c.key] = v;
  }
  for (const k of Object.keys(s.values)) { const v = s.values[k]; if (v.preview !== undefined) roll(v, v.preview, { still: true }); }
  s.flushes = Math.max(s.flushes, s.tl.head);
  s.tl.rev++;
}

function onStep(s, d, M) {
  s.tl.viewing = d.to; s.tl.target = null;
  const dir = d.direction === "back" ? "down" : "up";
  applyChanges(s, d.changes, d.waves, { dir });
  reconcile(s, M, d.to, dir);
  s.inexact = {};
  for (const k of d.inexact ?? []) if (has(M, k)) s.inexact[k] = true;
  s.tl.rev++;
}

function onResume(s, d, M) {
  s.tl.viewing = null; s.tl.target = null;
  if (typeof d.head === "number") s.tl.head = d.head;
  applyChanges(s, d.changes, d.waves, { dir: "up" });
  reconcile(s, M, s.tl.head, "up");
  s.inexact = {};
  s.tl.rev++;
}

// What every key showed at `seq`, from the timeline (values.js valueAt), rolled in if it differs.
function reconcile(s, M, seq, dir) {
  const keys = new Set();
  for (const st of s.tl.steps) for (const c of st.changes ?? []) if (c?.key && has(M, c.key)) keys.add(c.key);
  for (const k of keys) {
    const want = valueAt(s.tl.steps, k, seq); if (!want) continue;
    const v = { ...blank(), ...(s.values[k] ?? {}) };
    if (want.error) { if (v.error !== want.error) { v.error = want.error; s.values[k] = v; } continue; }
    if (v.preview === want.preview && !v.error) continue;
    const prev = v.preview;
    v.preview = want.preview; delete v.error;
    roll(v, want.preview, { dir, prev });
    s.values[k] = v;
  }
}

// ---- module replacement --------------------------------------------------------------------------------------
/** Which plate a module path is drawn on (its index in the graph's modules), or -1. */
export function modIndex(G, m) { return G.modules.findIndex(x => x === m || x.endsWith(`/${m}`) || m.endsWith(`/${x}`)); }

function onHmr(s, d, M) {
  const h = s.hmr;
  if (d.phase === "plan") {
    const p = d.plan ?? {};
    const marks = {};
    for (const [g] of PLAN_GROUPS) if (g !== "added") for (const k of p[g] ?? []) marks[k] = g;
    for (const mv of p.moved ?? []) marks[mv.from] = "moved";
    const planned = {};
    for (const mod of d.modules ?? []) { const i = modIndex(M.G, mod); if (i >= 0) planned[i] = true; }
    // what will be added: ghost tokens in a tray on the plate they will land on
    const incoming = {};
    for (const k of p.added ?? []) {
      const n = d.graph?.nodes?.find(n => n.key === k); if (!n || n.site) continue;
      const mi = modIndex(M.G, String(k).split("|")[0]); if (mi < 0) continue;
      (incoming[mi] ??= []).push({ key: k, name: n.name, kind: n.kind, question: !!n.question, async: !!n.async });
    }
    s.hmr = { plan: { id: d.id, modules: [...(d.modules ?? [])], plan: p, graphNo: d.graphNo }, phase: "plan", error: null, swapped: false, pendingDone: null, marks, planned, incoming };
    s.tl.hmrs.push({ seq: s.tl.head, id: d.id });
    s.tl.rev++;
    return;
  }
  if (d.phase === "apply") h.phase = "apply";
  else if (d.phase === "done") {
    h.phase = "done";
    if (h.swapped) applyChanges(s, (d.changes ?? []).filter(c => c && has(M, c.key)), d.waves, {});
    else h.pendingDone = d.changes ?? [];
  } else if (d.phase === "failed") {
    h.phase = "failed"; h.error = d.error ?? null;
    h.marks = {}; h.planned = {}; h.incoming = {};
  }
}

function onSwapped(s) {
  s.hmr.swapped = true;
  s.hmr.marks = {}; s.hmr.planned = {}; s.hmr.incoming = {};
  for (const k of Object.keys(s.values)) { const v = s.values[k]; if (v.preview !== undefined) v.anim = null; }
}

// ---- in: the mirror, then the transient effects --------------------------------------------------------------
/**
 * Handles a message on the JS side: enriches it, applies it to the mirror, plays its transient effects (rings,
 * comets, orbs, sounds, toasts), and returns it for the store (`live := s => reduce(s, m, model)`), or null when the
 * map ignores it. The page's hooks (`setLiveHooks`): `post` (to the host), `apply` (play the apply phase and swap soon),
 * `cancelSwap`.
 */
export function ingest(raw, M, extra) {
  if (!raw || typeof raw.type !== "string") return null;
  const m = enrich(raw, M, extra);
  if (!m) return null;
  const was = { flying: { ...S.flying }, pending: S.values[m.key]?.pending, current: S.values[m.key]?.current };
  reduce(S, m, M);
  try { play(m, M, was); } catch (e) { console.error(e); }
  return m;
}

const hooks = { post: () => {}, apply: () => {}, cancelSwap: () => {} };
/** The transport and the swap timer, for the effects that talk back. */
export function setLiveHooks(h) { Object.assign(hooks, h); }

function play(m, M, was) {
  switch (m.type) {
    case "reset": clearPulses(); clearOrbs(); hooks.cancelSwap(); return;
    case "flight": {
      const next = S.flying[m.key] ?? 0;
      for (const id of chipIds(M, m.key)) { if (m.state === "start") orb(id, "start"); else if (!next) orb(id, m.state); }
      sfx(({ start: "flightStart", land: "land", abandon: "abandon" })[m.state] ?? "");
      // the engine doesn't include a question's first answer in its flush changes
      if (m.state === "land" && (was.pending || !was.current)) hooks.post({ type: "snapshot?" });
      return;
    }
    case "flush": beat("liveBadge"); return wave(m.waves, M, true);
    case "step": rewind(m.direction); sfx("rewind", m.direction); return wave(m.waves, M, false);
    case "resume": rewind("forward"); sfx("rewind", "forward"); return wave(m.waves, M, false);
    case "~done": return wave(m.waves, M, false);
    case "travel-denied":
      toast(`<span class="micro">time</span> can't travel to <b class="mono">#${esc(m.to)}</b>: ${esc(m.reason ?? "denied")}`);
      shake("scrub"); sfx("denied");
      return;
    case "snapshot":
      if (Array.isArray(m.flights)) {
        for (const k of Object.keys(was.flying)) for (const id of chipIds(M, k)) anchorOf(id)?.querySelector(".orb")?.remove();
        for (const k of Object.keys(S.flying)) for (const id of chipIds(M, k)) orb(id, "start");
      }
      return;
    case "revert": for (const id of chipIds(M, m.key)) revert(id); return;
    case "hmr":
      if (m.phase === "plan") { hooks.cancelSwap(); sfx("plan"); }
      else if (m.phase === "apply") { sfx("hmr"); hooks.apply(M); }
      else if (m.phase === "done" && m.waves) wave(m.waves, M, false);
      else if (m.phase === "failed") {
        hooks.cancelSwap();
        toast(`<span class="micro" style="color:var(--fail)">reload failed</span> ${esc(m.error ?? "")}${m.fallback === "reload" ? " · reloading the page" : ""}`, 3600);
        sfx("denied");
      }
      return;
  }
}

// rings on every changed token at its wave's moment; for a flush, comets from what it read and a note per family
function wave(w, M, flush) {
  if (!w) return;
  if (flush) for (const id of w.cause) fire(id);
  let comets = 0;
  for (const x of w.ids) {
    if (!anchorOf(x.id)) continue;
    if (flush) for (const from of x.via) if (comets++ < 30) comet(from, x.id, Math.max(0, x.at - w.T), w.T, "#fff");
    ring(x.id, x.at);
    if (flush) { const n = M.nodes.get(x.id); if (n) note(famOf(n), x.at / 1000); }
  }
}

// ---- reads for the views (pure, over a state the store hands in) ----------------------------------------------
/** The reload plan's line for a key: "kept (unchanged)", "moved to x (renamed)", or "". */
export function planReason(hmr, key) {
  const p = hmr?.plan?.plan; if (!p || !key) return "";
  for (const [g, name] of PLAN_GROUPS) if (p[g]?.includes(key)) return `${name.toLowerCase()} (${p.reasons?.[key] ?? "?"})`;
  const m = p.moved?.find(m => m.from === key);
  return m ? `moved to ${keyName(m.to)} (${p.reasons?.[key] ?? p.reasons?.[m.to] ?? "moved"})` : "";
}
/** "waiting on a, b" for a held write. */
export const heldText = (h, none) => (h?.by?.length ? h.by.map(keyName).join(", ") : none);
/** Whether a key glows: a request in the air or an action running. */
export const isFlying = (live, key) => (live.flying[key] ?? 0) > 0 || Object.values(live.runs).includes(key);
/** A boundary's report, by its region's key or id. */
export const boundaryOf = (live, key, id) => live.boundaries[key] ?? live.boundaries[id] ?? null;

// ---- small marks, as map.html wrote them (an icon and text: innerHTML, escaped) ---------------------------------
/** A failed value's badge on its token. */
export const lverrHTML = err => `${ICON.warn}<span>${esc(String(err).slice(0, 60))}</span>`;
/** A held write's mark under its token. */
export const heldHTML = h => `${ICON.lock}<b>held</b><span>${esc(h?.by?.length ? `waiting on ${h.by.map(keyName).join(", ")}` : "waiting")}</span>`;
/** A tripped boundary's tag in its frame's label. */
export const tripHTML = (kind, error) => kind === "loading" ? `${ICON.hour}<b>showing fallback</b><span>pending</span>`
  : `${ICON.warn}<b>showing fallback</b><span>${esc(error ? String(error).slice(0, 120) : "failed")}</span>`;
const PLAN_ICON = Object.fromEntries([...PLAN_GROUPS.map(([g, , icon]) => [g, icon]), ["moved", "move"]]);
/** The badge icon of a token's group in the reload plan. */
export const planIconHTML = group => ICON[PLAN_ICON[group]] ?? "";
/** The ghost tokens of what a module replacement will add to a plate. */
export const incomingHTML = ns => `<span class="micro">incoming</span>` + ns.map(n => {
  const kk = kindOf(n);
  return `<span class="chip k-${kk} s-${SHAPE[kk] ?? "plug"} ghost${n.async ? " async" : ""}"><span class="pb">${ICON.plus}</span><span class="sh"></span><span class="tok"></span><span class="ico">${ICON[ICON_OF[kk]] ?? ICON.plug}</span><span class="n">${esc(n.name)}</span></span>`;
}).join("");
/** The reload plan as the Reload tab lists it: its groups (with what each means) and the moves. */
export function planView(hmr) {
  const p = hmr?.plan?.plan ?? {};
  const item = k => ({ key: k, name: keyName(k), reason: p.reasons?.[k] ?? "" });
  const groups = PLAN_GROUPS.filter(([g]) => p[g]?.length).map(([g, name, icon, what]) => ({ group: g, title: `${name} · ${p[g].length}`, icon, what, items: p[g].map(item) }));
  const moved = (p.moved ?? []).map(m => ({ from: keyName(m.from), to: keyName(m.to), reason: p.reasons?.[m.from] ?? p.reasons?.[m.to] ?? "" }));
  const phase = hmr?.phase ?? "";
  return {
    groups, moved, phase,
    phaseName: ({ plan: "plan", apply: "applying", done: "done", failed: "failed" })[phase] ?? phase,
    modules: (hmr?.plan?.modules ?? []).join(", "),
    text: phase === "plan" ? "An edit was saved. This is what will happen when it is applied; the tokens on the map are marked." : phase === "failed" ? `It failed: ${hmr.error ?? ""}` : phase === "apply" ? "Applying: kept state stays pinned, reset state flips, derived values re-run." : "Applied: the map now shows the new graph.",
  };
}
/** `x != null` as JS means it (RX's `!=` is strict: a missing key's `undefined` is not `null`). */
export const present = x => x != null;
