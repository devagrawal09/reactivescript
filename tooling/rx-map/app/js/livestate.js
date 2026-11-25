// Live mode's state, as one plain object, and the one reducer that changes it. Ported from map.html's onLive and its
// handlers (onFlight, onFlush, applyChanges, onSnapshot, onTimeline, onStep, onResume, reconcile, onHmr, …).
//
// A message goes in in two steps (live.rx dispatch):
//  1. `prepare(raw, M)`: what follows from the message and the model alone, before the write: unknown keys dropped,
//     the causal waves (ring / comet timings) worked out, an hmr plan's graph stored (`putGraph`, a side effect: it
//     happens once, here, and the message carries its number).
//  2. `live := s => reduce(s, m, M)`: one functional write per message. Solid hands the updater the store's draft,
//     with every earlier message of the burst already applied (W-6), so whatever depends on the state (a flight's
//     default `at`, an hmr message for a plan that is no longer current, whether a landed flight should ask for a
//     snapshot, which orbs a snapshot moves) is decided here, in arrival order. `reduce` MUTATES that draft and returns
//     nothing: returning a fresh state would copy the timeline (up to 2000 steps) per message. It must stay
//     deterministic and free of effects (no clocks, no randomness, no DOM, no sound, no posting).
// The transient effects (rings, comets, orbs, sounds, toasts, the hmr apply, `snapshot?` to the host) are records the
// reducer appends to `s.fx` (numbered by `s.fxSeq`); live.rx plays them after the commit (`playFx`, from an effect on
// `live.fxSeq`), in order, each once.
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
import { regionByRef } from "./model.js";
import { caughtPairs } from "./edges.js";
import { isRecording } from "./env.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A fresh, empty live state (a new object every call). */
export function freshLive() {
  return {
    // key → { preview?, error?, last?, appShows, pending, count, seq, origin, current, shown, old, anim, delay, roll }
    // (a failure keeps the value the app may still show as `last`; `appShows`: the bridge said so (a change's `shown`))
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
    hmr: { plan: null, phase: null, error: null, swapped: false, pendingDone: null, marks: {}, planned: {}, incoming: {}, seen: {}, reseeded: [] },
    // calls across the trust boundary, in arrival order (the last CALLS_MAX): a question's ask, an action's run
    // { id, kind: "ask" | "run", key, fns: [{ key, name, id }], at, end, outcome, error, args, cause, inferred,
    //   seqStart, seqEnd, settle, runId, n }
    calls: [],
    callSeq: 0,
    trips: 0,          // errored boundaries tripped so far (a rejection followed by one was not swallowed)
    swallow: null,     // the newest rejection swallowed by a re-ask: { n, id, text, fnKey } (the toast)
    swallowN: 0,
    runN: {},          // action key → runs seen (an action's "#3")
    // the transient effects still to play (playFx), each numbered: { n, k, … }
    fx: [],
    fxSeq: 0,
  };
}

const has = (M, key) => key != null && M.keyIds.has(key);
const idsOf = (M, key) => M.keyIds.get(key) ?? [];
const chipIds = (M, key) => idsOf(M, key).filter(id => anchorOf(id)?.classList.contains("chip"));
const lastAt = s => s.tl.steps.length ? s.tl.steps[s.tl.steps.length - 1].at : 0;
const del = (o, k) => { if (k in o) delete o[k]; };

// ---- prepare: what follows from the message and the model alone (no state), before the write -----------------
/**
 * The message as the reducer takes it, or null when the map ignores it (not a message; a flight or held write for a
 * key the map doesn't draw). Stores an hmr plan's graph (`putGraph`) and puts its number on the message.
 */
export function prepare(raw, M) {
  if (!raw || typeof raw.type !== "string") return null;
  const m = { ...raw };
  if ((m.type === "flight" || m.type === "held") && !has(M, m.key)) return null;
  if (m.type === "flush" || m.type === "step" || m.type === "resume" || m.type === "~done") {
    m.changes = (m.changes ?? []).filter(c => c && has(M, c.key));
    m.waves = waves(M, m.changes, m.type === "flush", m.cause, m.order);
  }
  if (m.type === "hmr" && m.phase === "plan") m.graphNo = m.graph?.nodes ? putGraph(m.graph) : -1;
  if (m.type === "hmr" && m.phase === "done") {
    // used only if the swap has happened by then (the reducer decides); otherwise ~done brings them in later
    m.known = (m.changes ?? []).filter(c => c && has(M, c.key));
    m.waves = waves(M, m.known, false);
  }
  return m;
}

// a transient effect to play after the commit
function emit(s, r) {
  s.fxSeq++;
  s.fx.push({ n: s.fxSeq, ...r });
  if (s.fx.length > 600) s.fx.splice(0, 300);   // played long ago (a burst longer than that loses its oldest)
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
/**
 * Applies one prepared message to `s` IN PLACE (the store's draft: `live := s => reduce(s, m, model)`), and queues
 * its transient effects on `s.fx`. Returns nothing. `M` is the model the keys are looked up in.
 */
export function reduce(s, m, M) {
  switch (m.type) {
    case "reset": return onReset(s);
    case "flight": callFlight(s, m, M); return onFlight(s, m);
    case "flush": return onFlush(s, m);
    case "timeline": return onTimeline(s, m, M);
    case "step": return onStep(s, m, M);
    case "resume": return onResume(s, m, M);
    case "travel-denied": s.tl.target = null; s.tl.rev++; emit(s, { k: "denied", to: m.to, reason: m.reason ?? null }); return;
    case "hmr": return onHmr(s, m, M);
    case "snapshot": return onSnapshot(s, m, M);
    case "revert": emit(s, { k: "revert", key: m.key }); return;
    case "boundary": s.boundaries[m.region] = { state: m.state, error: m.error ?? null }; if (isTrip(M, m.region, m.state)) s.trips++; return;
    case "held": s.held[m.key] = { by: [...(m.by ?? [])], since: m.at ?? null }; return;
    case "released": del(s.held, m.key); return;   // a key not held: nothing to do
    case "run": callRun(s, m, M); if (m.state === "start") s.runs[m.id] = m.key; else del(s.runs, m.id); return;
    case "~target": s.tl.target = m.seq; s.tl.rev++; return;
    case "~connected": s.connected = m.ok; return;
    case "~flushes": s.flushes = m.n; return;
    case "~swapped": return onSwapped(s);
    case "~done":
      s.hmr.pendingDone = null;
      applyChanges(s, m.changes, m.waves, { seq: s.tl.viewing ?? s.tl.head });
      emit(s, { k: "wave", w: m.waves });
      return;
  }
}

function onReset(s) {
  const f = freshLive();
  for (const k of Object.keys(f)) {
    if (k === "connected" || k === "fx" || k === "fxSeq" || k === "swallowN") continue;
    if (isRecording() && (k === "tl" || k === "flushes")) continue;
    s[k] = f[k];
  }
  emit(s, { k: "reset" });
}

function onFlight(s, m) {
  const at = m.at ?? lastAt(s);
  const v = s.values[m.key];
  // the engine doesn't include a question's first answer in its flush changes: a landing asks for a snapshot
  const ask = m.state === "land" && (!!v?.pending || !v?.current);
  const k = s.flying[m.key] ?? 0;
  const next = m.state === "start" ? k + 1 : Math.max(0, k - 1);
  if (next) s.flying[m.key] = next; else del(s.flying, m.key);
  const fl = s.tl.flights;
  if (m.state === "start") fl.push({ key: m.key, start: at, end: null, state: null });
  else {
    for (let i = fl.length - 1; i >= 0; i--) if (fl[i].key === m.key && fl[i].end == null) { fl[i].end = at; fl[i].state = m.state; break; }
  }
  if (fl.length > 400) fl.splice(0, fl.length - 400);
  s.tl.rev++;
  emit(s, { k: "flight", key: m.key, state: m.state, next, ask });
}

// ---- calls across the trust boundary ---------------------------------------------------------------------------
// The bridge doesn't see a JS call; it sees what makes it: a question asking (a flight) and an action running. Which
// JS imports / server fns each one calls is static: the graph's `call` edges from its nodes (through plain fns) to
// world nodes.
const CALLS_MAX = 500;
const fnCache = new WeakMap();   // model → key → fns
/** The JS imports / server fns a question or action calls (static, from the graph): [{ key, name, id }]. */
export function callFns(M, key) {
  let byKey = fnCache.get(M);
  if (!byKey) fnCache.set(M, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key);
  const out = new Map(), seen = new Set(), todo = [...idsOf(M, key)];
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of M.out.get(id) ?? []) {
      if (e.type !== "call") continue;
      const n = M.nodes.get(e.to);
      if (!n) continue;
      if (n.world) { if (!out.has(n.key ?? n.id)) out.set(n.key ?? n.id, { key: n.key ?? "", name: n.name, id: n.id }); }
      // through a plain helper, not into another action (that one has runs of its own) or a component
      else if (n.kind === "fn") todo.push(n.id);
    }
  }
  const fns = [...out.values()];
  byKey.set(key, fns);
  return fns;
}
const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const show = v => clip(typeof v === "string" ? v : (() => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } })(), 40);
const causeName = c => (c?.key ? keyName(c.key) : String(c?.name ?? "?").replace(/^rx:/, "").split("|").pop());
const causeText = c => `${causeName(c)}${c?.prev !== undefined || c?.value !== undefined ? ` ${c.prev !== undefined ? show(c.prev) : "?"}→${c.value !== undefined ? show(c.value) : "?"}` : ""}`;
// the action running now (the newest open run), as "action save #3"
function runningNow(s) {
  for (let i = s.calls.length - 1; i >= 0; i--) { const c = s.calls[i]; if (c.kind === "run" && c.outcome === "pending") return `action ${keyName(c.key)} #${c.n}`; }
  return "";
}
function addCall(s, c) {
  s.callSeq++;
  s.calls.push({ id: s.callSeq, end: null, outcome: "pending", error: "", settle: false, seqEnd: null, ...c });
  if (s.calls.length > CALLS_MAX) s.calls.splice(0, s.calls.length - CALLS_MAX);
}
// the flush a call landed in: the last step if it already changed the key; else the next flush (closeCall's settle)
function closeCall(s, c, outcome, at, error) {
  c.outcome = outcome; c.end = at; c.error = error ?? "";
  c.seqEnd = s.tl.head;
  const last = s.tl.steps.at(-1);
  const inLast = c.kind === "ask" && last && last.seq > (c.seqStart ?? 0) && (last.changes ?? []).some(x => x.key === c.key);
  // an action's writes (and an errored one's catch) commit as it ends; an ask's answer (or its error) in a flush that
  // changes its key. A superseded ask lands nowhere.
  c.settle = c.kind === "run" || (outcome !== "stale" && !inLast);
}
function callFlight(s, m, M) {
  const at = m.at ?? lastAt(s);
  if (m.state === "start") {
    const parts = [], inferred = [];
    if (typeof m.origin === "string" && m.origin) parts.push(m.origin);
    const cause = Array.isArray(m.cause) ? m.cause : [];
    if (cause.length) parts.push(`re-asked: ${cause.map(causeText).join(", ")}`);
    else if (!s.calls.some(c => c.kind === "ask" && c.key === m.key)) parts.push("first ask");
    else parts.push("re-asked (no cause sent)");
    // a refresh inside an action: the action running at that moment, if any (inferred: nothing links them)
    const run = runningNow(s);
    if (run && !cause.length) { parts.push(`during ${run}`); inferred.push("during"); }
    // what makes two asks "the same" in the list (repeats collapse): the interaction, the names that re-asked it (not
    // their values), the action it ran during
    const ck = [m.origin ?? "", cause.length ? cause.map(causeName).join(",") : parts.at(-1), run.replace(/ #\d+$/, "")].join("|");
    addCall(s, { kind: "ask", key: m.key, fns: callFns(M, m.key), at, args: cause.map(causeText).join(", "),
      cause: parts.join(" · "), inferred: inferred.length > 0, seqStart: s.tl.head, flightId: m.id ?? null, ck });
    return;
  }
  // land: the newest ask of this key in the air; abandon (superseded, stale, rejected): the oldest. An id, when sent, decides.
  const open = s.calls.filter(c => c.kind === "ask" && c.key === m.key && c.outcome === "pending");
  if (!open.length) return;
  const c = (m.id != null && open.find(c => c.flightId === m.id)) || (m.state === "land" ? open.at(-1) : open[0]);
  closeCall(s, c, m.state === "land" ? "ok" : typeof m.error === "string" ? "rejected" : "stale", at, m.error);
  if (c.outcome === "rejected") c.trips = s.trips;
  if (c.outcome === "ok") swallowed(s, c);
}
// A rejected ask, then an ask of the same key that landed, with no errored boundary tripped in between: the app never
// showed the rejection (the re-ask swallowed it). Marked on the rejected call; the newest case is toasted, once.
function swallowed(s, ok) {
  for (let i = s.calls.length - 1; i >= 0; i--) {
    const c = s.calls[i];
    if (c === ok || c.kind !== "ask" || c.key !== ok.key) continue;
    if (c.outcome === "ok" && c.id < ok.id) break;   // an earlier landing: what came before it was settled then
    if (c.outcome !== "rejected" || c.swallowedBy || c.trips !== s.trips || c.id > ok.id) continue;
    c.swallowedBy = ok.id;
    const fn = c.fns[0];
    s.swallowN++;
    s.swallow = { n: s.swallowN, id: c.id, fnKey: fn?.key ?? "", name: fn?.name ?? keyName(c.key),
      why: String(c.error ?? "").split(":")[0].trim() || "an error" };
  }
}
/** Whether a boundary report is an errored boundary showing its fallback (a failure the app showed). */
const isTrip = (M, ref, state) => state === "error" || (state === "fallback" && regionByRef(M, ref)?.kind === "errored");
function callRun(s, m, M) {
  const at = m.at ?? lastAt(s);
  if (m.state === "start") {
    const n = s.runN[m.key] = (s.runN[m.key] ?? 0) + 1;
    const args = Array.isArray(m.args) ? m.args.map(show).join(", ") : m.args !== undefined ? show(m.args) : "";
    // what ran it: the interaction, if the bridge sent one; else who can call it (the graph's call edges: inferred)
    let cause = typeof m.origin === "string" && m.origin ? m.origin : "", inferred = false;
    if (!cause) {
      const by = [...new Set(idsOf(M, m.key).flatMap(id => (M.inc.get(id) ?? []).filter(e => e.type === "call").map(e => M.A.label(e.from))))];
      cause = by.length ? `called from ${by.slice(0, 2).join(" or ")}${by.length > 2 ? " …" : ""}` : "";
      inferred = by.length > 0;
    }
    addCall(s, { kind: "run", key: m.key, fns: has(M, m.key) ? callFns(M, m.key) : [], at, args, cause: `action ${keyName(m.key)} #${n}${cause ? ` · ${cause}` : ""}`, inferred, seqStart: s.tl.head, runId: m.id, n, ck: cause });
    return;
  }
  const c = s.calls.findLast(c => c.kind === "run" && c.runId === m.id && c.outcome === "pending");
  if (c) closeCall(s, c, m.state === "error" ? "rejected" : "ok", at, m.state === "error" ? String(m.error ?? "error") : "");
}
// the first flush after a call ended: the one it landed in, if it changes the ask's key / comes in the run's turn (≤ 50 ms)
function settleCalls(s, m) {
  if (typeof m.seq !== "number") return;
  for (const c of s.calls) {
    if (!c.settle) continue;
    c.settle = false;
    const near = typeof m.at !== "number" || typeof c.end !== "number" || Math.abs(m.at - c.end) <= 50;
    if (c.kind === "ask" ? (m.changes ?? []).some(x => x.key === c.key) : near) c.seqEnd = m.seq;
  }
}

function onFlush(s, m) {
  emit(s, { k: "flush", w: m.waves });
  s.flushes++;
  settleCalls(s, m);
  // a module replacement's own step: what changed in it (a kept name that changed was reseeded: verified, not predicted)
  if (s.hmr.plan && m.origin === `hmr ${s.hmr.plan.id}`) for (const c of m.changes) s.hmr.seen[c.key] = { prev: c.prev ?? null, preview: c.preview ?? null, error: c.error ?? null };
  if (typeof m.seq === "number") {
    s.tl.steps.push({ seq: m.seq, at: m.at, origin: m.origin, cause: m.cause, changes: m.changes, order: m.order });
    if (!isRecording() && s.tl.steps.length > s.tl.capacity) s.tl.steps.splice(0, s.tl.steps.length - s.tl.capacity);
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
// A failure. What the app may still show: the bridge's `shown` (authoritative: the app shows that preview), else the
// value the map had (a failed re-ask: a question keeps its last answer unless a boundary shows its fallback); a first
// ask that fails has none.
function fail(v, error, shown, last = v.preview ?? v.last) {
  v.error = error; v.pending = false;
  v.appShows = typeof shown === "string";
  const keep = v.appShows ? shown : last;
  delete v.preview;
  if (keep !== undefined) v.last = keep; else delete v.last;
}
const blank = () => ({ count: 0, pending: false, seq: null, origin: null, current: false, shown: null, old: "", anim: null, delay: 0, roll: 0 });

// the changes of a flush, a step or a resume: values (and their badges' roll)
function applyChanges(s, changes, w, { flush = false, dir = "up", seq } = {}) {
  for (const c of changes) {
    const v = { ...blank(), ...(s.values[c.key] ?? {}) };
    if (flush) { v.count++; v.seq = seq ?? null; }
    else v.seq = s.tl.viewing ?? s.tl.head;
    v.origin = c.origin ?? v.origin ?? null;
    if (typeof c.error === "string") fail(v, c.error, c.shown);
    else if (typeof c.preview === "string") { v.preview = c.full ?? c.preview; delete v.error; delete v.last; v.appShows = false; }
    if ("pending" in c) v.pending = !!c.pending;
    if (v.preview !== undefined && typeof c.error !== "string") roll(v, v.preview, { dir, delay: w?.delays?.[c.key] ?? 0, prev: c.prev });
    s.values[c.key] = v;
  }
}

function onSnapshot(s, d, M) {
  for (const { key, preview, full, error, pending, shown } of d.values ?? []) {
    if (!has(M, key) || (typeof preview !== "string" && typeof error !== "string" && !pending)) continue;
    const v = { ...blank(), ...(s.values[key] ?? {}) };
    if (typeof error === "string") fail(v, error, shown, typeof preview === "string" ? full ?? preview : v.preview ?? v.last);
    else { v.preview = full ?? preview; delete v.error; delete v.last; v.appShows = false; }
    v.pending = !!pending; v.current = true; v.seq = v.seq ?? s.tl.head;
    if (v.preview !== undefined) roll(v, v.preview, { still: true });
    s.values[key] = v;
  }
  if (Array.isArray(d.held)) {
    s.held = {};
    for (const h of d.held) if (h?.key && has(M, h.key)) s.held[h.key] = { by: [...(h.by ?? [])], since: h.since ?? null };
  }
  if (Array.isArray(d.flights)) {
    const off = Object.keys(s.flying);
    s.flying = {};
    for (const { key, since } of d.flights) {
      if (!has(M, key)) continue;
      s.flying[key] = 1;
      if (!s.tl.flights.some(f => f.key === key && f.end == null)) s.tl.flights.push({ key, start: since ?? lastAt(s), end: null, state: null });
      if (!s.calls.some(c => c.kind === "ask" && c.key === key && c.outcome === "pending"))
        addCall(s, { kind: "ask", key, fns: callFns(M, key), at: since ?? lastAt(s), args: "", cause: "in the air when the map opened", inferred: false, seqStart: s.tl.head, flightId: null });
    }
    // the orbs: off the keys that were in the air, on the ones that are
    emit(s, { k: "orbs", off, on: Object.keys(s.flying) });
    // an ask the map saw start that is no longer in the air: it ended unseen
    for (const c of s.calls) if (c.kind === "ask" && c.outcome === "pending" && !s.flying[c.key]) { c.outcome = "unseen"; c.seqEnd = s.tl.head; }
  }
  if (Array.isArray(d.boundaries)) {
    s.boundaries = {};
    for (const b of d.boundaries) if (b?.region) { s.boundaries[b.region] = { state: b.state, error: b.error ?? null }; if (isTrip(M, b.region, b.state)) s.trips++; }
  }
  if (Array.isArray(d.runs)) {
    s.runs = {};
    for (const r of d.runs) s.runs[r.id] = r.key;
    for (const c of s.calls) if (c.kind === "run" && c.outcome === "pending" && !(c.runId in s.runs)) { c.outcome = "unseen"; c.seqEnd = s.tl.head; }
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
  for (const st of s.tl.steps) for (const c of st.changes ?? []) if (c?.key && has(M, c.key) && (typeof c.preview === "string" || typeof c.error === "string") && (s.tl.viewing == null || st.seq <= s.tl.viewing)) {
    const v = { ...blank(), ...(s.values[c.key] ?? {}) };
    if (!counted.has(c.key)) { counted.add(c.key); v.count = 0; }
    v.count++; v.seq = st.seq;
    if (!v.current || s.tl.viewing != null) {
      if (typeof c.error === "string") fail(v, c.error, c.shown);
      else { v.preview = c.full ?? c.preview; delete v.error; delete v.last; v.appShows = false; }
    }
    s.values[c.key] = v;
  }
  for (const k of Object.keys(s.values)) { const v = s.values[k]; if (v.preview !== undefined) roll(v, v.preview, { still: true }); }
  s.flushes = Math.max(s.flushes, s.tl.head);
  s.tl.rev++;
}

function onStep(s, d, M) {
  s.tl.viewing = d.to; s.tl.target = null;
  emit(s, { k: "step", direction: d.direction, w: d.waves });
  const dir = d.direction === "back" ? "down" : "up";
  applyChanges(s, d.changes, d.waves, { dir });
  reconcile(s, M, d.to, dir);
  s.inexact = {};
  for (const k of d.inexact ?? []) if (has(M, k)) s.inexact[k] = true;
  s.tl.rev++;
}

function onResume(s, d, M) {
  s.tl.viewing = null; s.tl.target = null;
  emit(s, { k: "resume", w: d.waves });
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
    if (want.error) {
      // the value the app still showed then: the timeline's, else (the same failure) what the map holds
      const last = want.last ?? (v.error === want.error ? v.last : undefined);
      if (v.error === want.error && v.preview === undefined && v.last === last && !!v.appShows === !!want.shown) continue;
      fail(v, want.error, want.shown ? last : undefined, last);
      s.values[k] = v;
      continue;
    }
    if (v.preview === want.preview && !v.error) continue;
    const prev = v.preview;
    v.preview = want.preview; delete v.error; delete v.last; v.appShows = false;
    roll(v, want.preview, { dir, prev });
    s.values[k] = v;
  }
}

// ---- module replacement --------------------------------------------------------------------------------------
/** Which plate a module path is drawn on (its index in the graph's modules), or -1. */
export function modIndex(G, m) { return G.modules.findIndex(x => x === m || x.endsWith(`/${m}`) || m.endsWith(`/${x}`)); }

function onHmr(s, d, M) {
  const h = s.hmr;
  // apply / done / failed speak of a plan: not the current one, they are stale
  if (d.phase !== "plan" && (!h.plan || d.id !== h.plan.id)) return;
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
    s.hmr = { plan: { id: d.id, modules: [...(d.modules ?? [])], plan: p, graphNo: d.graphNo }, phase: "plan", error: null, swapped: false, pendingDone: null, marks, planned, incoming, seen: {}, reseeded: [] };
    s.tl.hmrs.push({ seq: s.tl.head, id: d.id });
    s.tl.rev++;
    emit(s, { k: "plan" });
    return;
  }
  if (d.phase === "apply") { h.phase = "apply"; emit(s, { k: "apply" }); }
  else if (d.phase === "done") {
    h.phase = "done";
    // v0.7: the keys whose state could not be carried (the host fell back to a refresh for them)
    h.fallback = d.fallback ?? null;
    h.uncarried = Array.isArray(d.uncarried) ? [...d.uncarried] : [];
    h.uncarriedReasons = d.uncarriedReasons ?? {};
    // verify, don't predict: a name the plan said it would keep whose value came back changed (in the replacement's
    // own step, or in `done`'s changes) was reseeded; one the host could not carry is listed under Not carried
    const changed = {};
    for (const [k, v] of Object.entries(h.seen ?? {})) changed[k] = v;
    for (const c of d.changes ?? []) if (c?.key) changed[c.key] = { prev: c.prev ?? null, preview: c.preview ?? null, error: c.error ?? null };
    h.reseeded = (h.plan.plan?.kept ?? []).filter(k => !h.uncarried.includes(k) && changed[k]
      && (changed[k].error != null || changed[k].prev == null || changed[k].prev !== changed[k].preview));
    if (h.swapped) { applyChanges(s, d.known ?? [], d.waves, {}); emit(s, { k: "wave", w: d.waves }); }
    else h.pendingDone = d.changes ?? [];
  } else if (d.phase === "failed") {
    h.phase = "failed"; h.error = d.error ?? null;
    h.marks = {}; h.planned = {}; h.incoming = {};
    emit(s, { k: "failed", error: d.error ?? null, fallback: d.fallback ?? null });
  }
}

function onSwapped(s) {
  s.hmr.swapped = true;
  s.hmr.marks = {}; s.hmr.planned = {}; s.hmr.incoming = {};
  for (const k of Object.keys(s.values)) { const v = s.values[k]; if (v.preview !== undefined) v.anim = null; }
}

// ---- out: the transient effects, after the commit ------------------------------------------------------------
const hooks = { post: () => {}, apply: () => {}, cancelSwap: () => {} };
/** The transport and the swap timer, for the effects that talk back. */
export function setLiveHooks(h) { Object.assign(hooks, h); }

let played = 0;   // the last fx record played (fxSeq only grows: a reset keeps it)
/**
 * Plays the effects queued on the committed state `s` since the last call, in order, each once (live.rx runs it from
 * an effect on `live.fxSeq`). `M` is the model drawn now. The hooks (`setLiveHooks`): `post` (to the host), `apply`
 * (play the apply phase with the plan, and swap soon), `cancelSwap`.
 */
export function playFx(s, M) {
  if (isRecording()) return;
  for (const r of s.fx) {
    if (r.n <= played) continue;
    played = r.n;
    try { play(r, s, M); } catch (e) { console.error(e); }
  }
}

function play(r, s, M) {
  switch (r.k) {
    case "reset": clearPulses(); clearOrbs(); hooks.cancelSwap(); return;
    case "flight":
      for (const id of chipIds(M, r.key)) { if (r.state === "start") orb(id, "start"); else if (!r.next) orb(id, r.state); }
      sfx(({ start: "flightStart", land: "land", abandon: "abandon" })[r.state] ?? "");
      if (r.ask) hooks.post({ type: "snapshot?" });
      return;
    case "flush": beat("liveBadge"); return wave(r.w, M, true);
    case "step": rewind(r.direction); sfx("rewind", r.direction); return wave(r.w, M, false);
    case "resume": rewind("forward"); sfx("rewind", "forward"); return wave(r.w, M, false);
    case "wave": return wave(r.w, M, false);
    case "denied":
      toast(`<span class="micro">time</span> can't travel to <b class="mono">#${esc(r.to)}</b>: ${esc(r.reason ?? "denied")}`);
      shake("scrub"); sfx("denied");
      return;
    case "orbs":
      for (const k of r.off) for (const id of chipIds(M, k)) anchorOf(id)?.querySelector(".orb")?.remove();
      for (const k of r.on) for (const id of chipIds(M, k)) orb(id, "start");
      return;
    case "revert": for (const id of chipIds(M, r.key)) revert(id); return;
    case "plan": hooks.cancelSwap(); sfx("plan"); return;
    case "apply": sfx("hmr"); hooks.apply(M, s.hmr); return;
    case "failed":
      hooks.cancelSwap();
      toast(`<span class="micro" style="color:var(--fail)">reload failed</span> ${esc(r.error ?? "")}${r.fallback === "reload" ? " · reloading the page" : ""}`, 3600);
      sfx("denied");
      return;
  }
}

/** What `__RX_VIEW__.values()` returns: every key's preview, read from the (committed) state handed in. */
export const previewsOf = s => Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k, v.preview]));

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
  if (hmr?.uncarried?.includes(key)) return `not carried (${hmr.uncarriedReasons?.[key] ?? "refresh"})`;
  const p = hmr?.plan?.plan; if (!p || !key) return "";
  if (hmr.reseeded?.includes(key)) return "reseeded (the plan said kept; its value changed)";
  for (const [g, name] of PLAN_GROUPS) if (p[g]?.includes(key)) return `${name.toLowerCase()} (${p.reasons?.[key] ?? "?"})`;
  const m = p.moved?.find(m => m.from === key);
  return m ? `moved to ${keyName(m.to)} (${p.reasons?.[key] ?? p.reasons?.[m.to] ?? "moved"})` : "";
}
/** "waiting on a, b" for a held write. */
export const heldText = (h, none) => (h?.by?.length ? h.by.map(keyName).join(", ") : none);
/**
 * How each failing key shows: { stale, last, error, badge }. `stale`: a failed re-ask while the app still shows the
 * last value: the bridge said so (`shown` on the change), or it had a value and no tripped errored boundary caught it
 * (edges.js caughtPairs: the boundaries it notifies or whose sites read it, as the caught-by arrows). Otherwise (a
 * first ask failed, a boundary shows its fallback for it) a plain failure.
 */
export function failView(M, values, boundaries) {
  const out = {};
  let caught = null;
  for (const [k, v] of Object.entries(values)) {
    if (typeof v.error !== "string") continue;
    let stale = v.last !== undefined;
    if (stale && !v.appShows) {
      caught ??= new Set(caughtPairs(M, values, boundaries).map(p => M.nodes.get(p[0])?.key));
      if (caught.has(k)) stale = false;
    }
    out[k] = { stale, last: stale ? v.last : "", error: v.error, told: !!v.appShows,
      badge: stale ? { preview: v.last, old: "", anim: null, delay: 0 } : null };
  }
  return out;
}
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
  // after `done`: a kept name that was reseeded or not carried is not listed as kept
  const off = new Set([...(hmr?.reseeded ?? []), ...(hmr?.uncarried ?? [])]);
  const keysOf = g => (p[g] ?? []).filter(k => g !== "kept" || !off.has(k));
  const groups = PLAN_GROUPS.filter(([g]) => keysOf(g).length).map(([g, name, icon, what]) => ({ group: g, title: `${name} · ${keysOf(g).length}`, icon, what, items: keysOf(g).map(item) }));
  const reseeded = (hmr?.reseeded ?? []).map(k => ({ key: k, name: keyName(k), reason: "listed kept; its value changed" }));
  const moved = (p.moved ?? []).map(m => ({ from: keyName(m.from), to: keyName(m.to), reason: p.reasons?.[m.from] ?? p.reasons?.[m.to] ?? "" }));
  const phase = hmr?.phase ?? "";
  return {
    groups, moved, phase, reseeded,
    // v0.7: what the host could not carry over (a refresh fallback re-initialised it)
    uncarried: (hmr?.uncarried ?? []).map(k => ({ key: k, name: keyName(k), reason: hmr.uncarriedReasons?.[k] ?? "uncarried" })), fallback: hmr?.fallback ?? "",
    phaseName: ({ plan: "plan", apply: "applying", done: "done", failed: "failed" })[phase] ?? phase,
    modules: (hmr?.plan?.modules ?? []).join(", "),
    text: phase === "plan" ? "An edit was saved. This is what will happen when it is applied; the tokens on the map are marked." : phase === "failed" ? `It failed: ${hmr.error ?? ""}` : phase === "apply" ? "Applying: kept state stays pinned, reset state flips, derived values re-run." : (hmr?.uncarried?.length ? "Applied, with a refresh fallback: the map now shows the new graph; the names under Not carried lost their state."
      : hmr?.reseeded?.length ? "Applied: the map now shows the new graph; the names under Reseeded were planned kept but came back with a new value."
      : "Applied: the map now shows the new graph."),
  };
}
/** The Calls tab: newest first, filtered to the calls of one import (by key; "" for all), and the imports that have calls. */
export function callsView(live, fnKey) {
  const calls = live.calls ?? [];
  let now = lastAt(live);
  for (const c of calls) now = Math.max(now, c.at ?? 0, c.end ?? 0);
  const ago = t => { const d = Math.max(0, now - (t ?? now)); return d < 1 ? "now" : d < 1000 ? `${Math.round(d)}ms ago` : d < 60000 ? `${(d / 1000).toFixed(1)}s ago` : `${Math.floor(d / 60000)}m ago`; };
  const fns = new Map();
  for (const c of calls) for (const f of c.fns) if (f.key && !fns.has(f.key)) fns.set(f.key, { key: f.key, name: f.name, n: 0 });
  for (const c of calls) for (const f of c.fns) if (fns.has(f.key)) fns.get(f.key).n++;
  const rows = [];
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (fnKey && !c.fns.some(f => f.key === fnKey)) continue;
    const pending = c.outcome === "pending";
    const seq = pending ? c.seqStart : c.seqEnd ?? c.seqStart;
    rows.push({
      id: c.id, kind: c.kind, key: c.key, name: keyName(c.key), fns: c.fns.map(f => ({ key: f.key, name: f.name })),
      when: ago(c.at), args: c.args ?? "", cause: c.cause ?? "", inferred: !!c.inferred,
      dur: pending ? "in the air" : typeof c.end === "number" && typeof c.at === "number" ? `${Math.max(0, Math.round(c.end - c.at))} ms` : "",
      outcome: c.outcome, badge: ({ ok: "ok", rejected: "rejected", stale: "stale", pending: c.kind === "run" ? "running" : "pending", unseen: "ended" })[c.outcome] ?? c.outcome,
      error: c.error ?? "", seq: typeof seq === "number" ? seq : -1,
      seqText: typeof seq !== "number" ? "" : pending ? `from #${seq}` : `#${seq}`,
      swallowed: !!c.swallowedBy, n: 1, span: "", group: "", members: [], same: `${c.kind}|${c.key}|${c.ck ?? c.cause}|${c.fns.map(f => f.key).join(",")}`,
    });
  }
  // repeats collapse: consecutive calls that landed ok, of the same question or action, for the same kind of cause
  // (a poll, a ticker) are one row, "×N" over a time range; the group (by its oldest call) expands
  const out = [];
  for (const r of rows) {
    const head = out.at(-1);
    if (head && r.outcome === "ok" && head.outcome === "ok" && r.same === head.same) {
      if (!head.members.length) head.members.push({ ...head, members: [] });
      head.members.push(r);
      head.n++;
      head.group = `${r.id}`;
      head.span = `${r.when} – ${head.members[0].when}`;
    } else out.push(r);
  }
  return { rows: out, fns: [...fns.values()].sort((a, b) => a.name.localeCompare(b.name)), total: calls.length };
}
/** `x != null` as JS means it (RX's `!=` is strict: a missing key's `undefined` is not `null`). */
export const present = x => x != null;
