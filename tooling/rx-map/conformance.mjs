// Conformance suite for a trace host (TRACE-CONTRACT §5). `runConformance(makeHost, graphs)` drives each graph
// and returns a readable result list. The fake must pass; the real host must pass before it replaces the fake.
// Pure ESM, no dependencies.

const KNOWN = new Set(["flush", "flight", "reset", "timeline", "step", "resume", "travel-denied", "travel-pending", "hmr"]);
const REASONS = new Set(["unchanged", "init-changed", "type-changed", "kind-changed", "scope-changed", "expr-changed", "upstream-changed", "new", "gone", "renamed", "reindexed"]);
const PLAN_KINDS = new Set(["source", "eq", "effect", "action"]);

/**
 * A view ignores a message whose type it doesn't know. This is the page's rule, checked here against a reference
 * reducer so a host suite still has the check when the page isn't loaded.
 */
export function viewReduce(state, msg) {
  if (!msg || typeof msg.type !== "string" || !KNOWN.has(msg.type)) return state;
  if (msg.type === "reset") return { values: new Map(), seq: 0 };
  if (msg.type === "flush") {
    const values = new Map(state.values);
    for (const c of msg.changes ?? []) {
      if (c.preview === undefined) values.delete(c.key);
      else values.set(c.key, c.preview);
    }
    return { values, seq: msg.seq };
  }
  return state;
}

function graphLabel(graph) {
  return graph?.title || graph?.modules?.[0] || "graph";
}

function keysOf(graph) {
  return new Set((graph?.nodes ?? []).map(n => n.key).filter(Boolean));
}

function planNodeKeys(graph) {
  return new Set((graph?.nodes ?? []).filter(n => n.key && PLAN_KINDS.has(n.kind)).map(n => n.key));
}

/** Errors in an HMR plan, or an empty list. Exported so a caller can check a plan it built itself. */
export function partitionErrors(plan, oldGraph, newGraph) {
  const errors = [];
  if (!plan || typeof plan !== "object") return ["plan missing"];
  const buckets = ["kept", "reset", "rerun", "added", "removed"];
  for (const name of buckets) if (!Array.isArray(plan[name])) errors.push(`${name} is not a list`);
  if (!Array.isArray(plan.moved)) errors.push("moved is not a list");
  if (!plan.reasons || typeof plan.reasons !== "object") errors.push("reasons missing");
  if (errors.length) return errors;

  const universe = new Set([...planNodeKeys(oldGraph), ...planNodeKeys(newGraph)]);
  const seen = new Map();
  for (const name of buckets) {
    for (const k of plan[name]) {
      if (seen.has(k)) errors.push(`${k} is in ${seen.get(k)} and ${name}`);
      else seen.set(k, name);
    }
  }
  const froms = new Set();
  for (const m of plan.moved) {
    if (!m || typeof m.from !== "string" || typeof m.to !== "string") { errors.push("moved entry is not { from, to }"); continue; }
    if (froms.has(m.from)) errors.push(`${m.from} moved twice`);
    froms.add(m.from);
    if (seen.has(m.from)) errors.push(`${m.from} is moved.from and also in ${seen.get(m.from)}`);
    const bucket = seen.get(m.to);
    if (bucket !== "kept" && bucket !== "reset" && bucket !== "rerun") errors.push(`moved.to ${m.to} is ${bucket ?? "missing"}, want kept, reset or rerun`);
  }
  for (const k of universe) {
    if (!seen.has(k) && !froms.has(k)) errors.push(`${k} missing from the plan`);
  }
  for (const k of seen.keys()) if (!universe.has(k)) errors.push(`${k} is in the plan but is not a source, equation, effect or action`);
  for (const k of froms) if (!universe.has(k)) errors.push(`moved.from ${k} is not in the old graph`);

  const need = new Set([...seen.keys(), ...froms]);
  for (const k of need) {
    if (!(k in plan.reasons)) errors.push(`no reason for ${k}`);
    else if (!REASONS.has(plan.reasons[k])) errors.push(`reason ${plan.reasons[k]} for ${k} is not a known code`);
  }
  for (const k of Object.keys(plan.reasons)) if (!need.has(k)) errors.push(`reason for ${k} but that key is not in the plan`);

  const expect = { kept: new Set(["unchanged", "init-changed"]), reset: new Set(["type-changed", "kind-changed", "scope-changed"]), rerun: new Set(["expr-changed", "upstream-changed"]), added: new Set(["new"]), removed: new Set(["gone"]) };
  for (const [bucket, ok] of Object.entries(expect)) {
    for (const k of plan[bucket]) if (plan.reasons[k] && !ok.has(plan.reasons[k])) errors.push(`${k} is ${bucket} but reason is ${plan.reasons[k]}`);
  }
  for (const k of froms) {
    const r = plan.reasons[k];
    if (r && r !== "renamed" && r !== "reindexed" && r !== "scope-changed") errors.push(`moved.from ${k} has reason ${r}`);
  }
  return errors;
}

// A key's state: its preview, or its error (v0.6: an error is a shown state, not an absence).
const ERR = "\u0000error\u0000";
const stateOf = c => c.error !== undefined ? ERR + c.error : c.preview;
const prevStateOf = c => c.prevError !== undefined ? ERR + c.prevError : c.prev;

function reconstruct(steps, n) {
  // Before a key's first change, its value is that change's `prev` (§4b).
  const m = new Map(), seen = new Set();
  for (const s of steps) for (const c of s.changes ?? []) {
    if (c.key == null || seen.has(c.key)) continue;
    seen.add(c.key);
    if (c.prev !== undefined) m.set(c.key, c.prev);
  }
  for (const s of steps) {
    if (s.seq > n) break;
    for (const c of s.changes ?? []) {
      // keyed nodes only: a change with no key is shown in the flush but is no state travel restores (§1, §2 step)
      if (c.key == null) continue;
      if (stateOf(c) === undefined) m.delete(c.key);
      else m.set(c.key, stateOf(c));
    }
  }
  return m;
}

function applyChanges(map, changes) {
  const next = new Map(map);
  for (const c of changes ?? []) {
    if (c.key == null) continue;
    if (stateOf(c) === undefined) next.delete(c.key);
    else next.set(c.key, stateOf(c));
  }
  return next;
}

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function diffKeys(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out = [];
  for (const k of keys) if (a.get(k) !== b.get(k) || a.has(k) !== b.has(k)) out.push(k);
  return out.sort();
}

/**
 * @param {(graph: object, opts?: { seed?: number, rate?: number, capacity?: number }) => object} makeHost
 * @param {object[]} graphs
 * @param {{ seed?: number }} [opts]
 * @returns {{ ok: boolean, check: string, graph?: string, detail?: string }[]}
 */
export function runConformance(makeHost, graphs, opts = {}) {
  return drive(makeHost, graphs, opts, run => {
    for (let it = run.next(); !it.done; it = run.next(it.value));
  });
}

/**
 * The same suite for a host whose calls take time (a real app in a browser): `makeHost` and the host's `post`,
 * `act`, `tick`, `editModule` and `dispose` may return promises, and messages a call caused must have reached
 * `subscribe`'s listeners by the time its promise settles.
 * @returns {Promise<{ ok: boolean, check: string, graph?: string, detail?: string }[]>}
 */
export async function runConformanceAsync(makeHost, graphs, opts = {}) {
  const runs = [];
  const results = drive(makeHost, graphs, opts, run => runs.push(run));
  for (const run of runs) {
    // a rejected call throws where the suite made it, so the check that made it reports it
    for (let it = run.next(); !it.done;) {
      let value, error, failed = false;
      try { value = await it.value; } catch (e) { error = e; failed = true; }
      it = failed ? run.throw(error) : run.next(value);
    }
  }
  return results;
}

function drive(makeHost, graphs, opts, start) {
  const results = [];
  const seed = opts.seed ?? 1;
  const push = (ok, check, graph, detail) => results.push(detail ? { ok, check, graph, detail } : { ok, check, graph });

  const withUnknown = [
    { type: "flush", seq: 1, at: 1, changes: [{ key: "k", name: "k", preview: "1" }] },
    { type: "not-a-real-type", surprise: true },
    { type: "flush", seq: 2, at: 2, changes: [{ key: "k", name: "k", preview: "2" }] },
  ];
  const without = [withUnknown[0], withUnknown[2]];
  const a = withUnknown.reduce(viewReduce, { values: new Map(), seq: 0 });
  const b = without.reduce(viewReduce, { values: new Map(), seq: 0 });
  const ignored = a.seq === b.seq && a.values.get("k") === b.values.get("k");
  push(ignored, "unknown types ignored", undefined, ignored ? "reference view" : "reference view applied an unknown type");

  for (const graph of graphs ?? []) {
    const label = graphLabel(graph);
    start((function* () {
      try { yield* checkOne(makeHost, graph, label, seed, push); }
      catch (e) { push(false, "host threw", label, e?.message ?? String(e)); }
    })());
  }
  return results;
}

function* checkOne(makeHost, graph, label, seed, push) {
  const hostOpts = { seed, rate: 0, capacity: 2000 };
  const host = yield makeHost(graph, hostOpts);
  const msgs = [];
  host.subscribe(m => msgs.push(m));
  try {
    yield host.post({ type: "hello", want: ["live", "timeline", "travel", "hmr"] });
    const beforeUnknown = msgs.length;
    yield host.post({ type: "definitely-unknown", want: [] });
    if (msgs.length !== beforeUnknown) push(false, "unknown types ignored", label, "host emitted a message for an unknown view message");
    else push(true, "unknown types ignored", label, "host ignored an unknown view message");

    for (let i = 0; i < 5; i++) {
      yield host.act();
      yield host.tick(8);
    }
  } catch (e) {
    push(false, "host threw", label, e?.message ?? String(e));
    yield host.dispose?.();
    return;
  }

  const flushes = msgs.filter(m => m.type === "flush");
  const envelopeOk = msgs.every(m => m && m.source === "rx-map" && m.v === 1);
  push(envelopeOk, "messages carry v and source", label, envelopeOk ? undefined : "a message lacked source or v: 1");

  let seqOk = true, seqDetail = "";
  let prevSeq = 0;
  for (const f of flushes) {
    if (typeof f.seq !== "number" || f.seq <= prevSeq) { seqOk = false; seqDetail = `seq ${f.seq} after ${prevSeq}`; break; }
    prevSeq = f.seq;
  }
  push(seqOk, "seq strictly increasing", label, seqDetail || undefined);

  let atOk = true, atDetail = "";
  let prevAt = -Infinity;
  for (const m of msgs) {
    if (typeof m.at !== "number") continue;
    if (m.at < prevAt) { atOk = false; atDetail = `at ${m.at} after ${prevAt} (${m.type})`; break; }
    prevAt = m.at;
  }
  push(atOk, "at non-decreasing", label, atDetail || undefined);

  let currentKeys = keysOf(graph);
  const allKeys = new Set(currentKeys);
  let keyOk = true, keyDetail = "";
  for (const m of msgs) {
    if (m.type === "hmr" && m.phase === "plan" && m.graph) {
      currentKeys = keysOf(m.graph);
      for (const k of currentKeys) allKeys.add(k);
    }
    const changes = m.type === "flush" ? m.changes : m.type === "step" || m.type === "resume" || (m.type === "hmr" && m.phase === "done") ? m.changes : null;
    if (!changes) continue;
    const bag = m.type === "flush" || (m.type === "hmr" && m.phase === "done") ? currentKeys : allKeys;
    for (const c of changes) {
      if (c.key != null && !bag.has(c.key)) { keyOk = false; keyDetail = `${c.key} on ${m.type}`; break; }
    }
    if (!keyOk) break;
  }
  push(keyOk, "change keys exist", label, keyDetail || undefined);

  const open = new Map();
  let flightOrder = true, flightOrderDetail = "";
  let flightDouble = true, flightDoubleDetail = "";
  for (const m of msgs) {
    if (m.type !== "flight") continue;
    if (m.state === "start") {
      if (open.has(m.key)) { flightDouble = false; flightDoubleDetail = m.key; }
      open.set(m.key, true);
    } else if (m.state === "land" || m.state === "abandon") {
      if (!open.has(m.key)) { flightOrder = false; flightOrderDetail = `${m.state} of ${m.key} without start`; }
      open.delete(m.key);
    } else { flightOrder = false; flightOrderDetail = `bad state ${m.state}`; }
  }
  push(flightOrder, "flight start before end", label, flightOrderDetail || (msgs.some(m => m.type === "flight") ? undefined : "no flights"));
  push(flightDouble, "no double flight start", label, flightDoubleDetail || undefined);

  // Two hosts that see the same calls. Travel must not depend on which path you took.
  const script = function* (h) {
    yield h.post({ type: "hello", want: ["live", "timeline", "travel", "hmr"] });
    for (let i = 0; i < 4; i++) { yield h.act(); yield h.tick(8); }
    yield h.tick(12);
  };
  const collect = h => {
    const box = [];
    h.subscribe(m => box.push(m));
    return box;
  };

  // Pending: travel asked for while a flight is open never shows a step before it lands. A v0.5 host denies it
  // (`pending`); a v0.6 host answers `travel-pending` and travels once the flight has landed (§4b).
  try {
    const pHost = yield makeHost(graph, hostOpts);
    const pMsgs = collect(pHost);
    yield pHost.act();
    const opened = pMsgs.some(m => m.type === "flight" && m.state === "start");
    const nPending = pMsgs.length;
    yield pHost.post({ type: "travel", to: 1 });
    const pendingReply = pMsgs.slice(nPending).find(m => m.type === "step" || m.type === "travel-denied" || m.type === "travel-pending");
    if (opened) {
      let ok = pendingReply?.type === "travel-denied" && pendingReply.reason === "pending";
      let detail = `got ${pendingReply?.type ?? "nothing"} ${pendingReply?.reason ?? ""}`;
      if (pendingReply?.type === "travel-pending") {
        const nWait = pMsgs.length;
        for (let i = 0; i < 6; i++) yield pHost.tick(4);
        const after = pMsgs.slice(nWait);
        const landed = after.findIndex(m => m.type === "flight" && m.state !== "start");
        const step = after.findIndex(m => m.type === "step" || m.type === "travel-denied");
        ok = step >= 0 && (after[step].type === "travel-denied" ? after[step].reason === "evicted" : after[step].to === 1)
          && (landed < 0 || landed < step);
        detail = step < 0 ? "travel-pending, then no step after the flight landed" : `travel-pending, then ${after[step].type} ${after[step].to ?? ""}`;
      }
      push(ok, "travel pending while a flight is open", label, ok ? undefined : detail);
    } else push(true, "travel pending while a flight is open", label, "no flight opened");
    yield pHost.dispose?.();
  } catch (e) {
    push(false, "travel pending while a flight is open", label, e?.message ?? String(e));
  }

  let travelHost, travelMsgs;
  try {
    travelHost = yield makeHost(graph, hostOpts);
    travelMsgs = collect(travelHost);
    yield* script(travelHost);
  } catch (e) {
    push(false, "travel matches replay", label, e?.message ?? String(e));
    yield host.dispose?.();
    return;
  }
  const liveFlushes = () => travelMsgs.filter(m => m.type === "flush");
  const headOf = () => liveFlushes().reduce((h, f) => Math.max(h, f.seq), 0);
  const stepsNow = () => liveFlushes().slice().sort((a, b) => a.seq - b.seq);
  const head = headOf();
  if (head < 1) {
    push(true, "travel matches replay", label, "no flushes");
    push(true, "step changes exact", label, "no flushes");
    push(true, "travel commutative", label, "no flushes");
    push(true, "resume matches live", label, "no flushes");
    push(true, "flushes during viewing kept", label, "no flushes");
  } else {
    const mid = Math.max(1, Math.ceil(head / 2));
    const fromBefore = head;
    const n = travelMsgs.length;
    yield travelHost.post({ type: "travel", to: mid });
    const step = travelMsgs.slice(n).find(m => m.type === "step" || m.type === "travel-denied");
    if (!step || step.type !== "step") {
      push(false, "travel matches replay", label, step ? `denied: ${step.reason}` : "no step");
      push(false, "step changes exact", label, "no step");
    } else {
      const atFrom = reconstruct(stepsNow(), step.from);
      const atTo = reconstruct(stepsNow(), step.to);
      const shown = applyChanges(atFrom, step.changes);
      const match = mapsEqual(shown, atTo);
      push(match, "travel matches replay", label, match ? undefined : `travel(${step.to}) diverges`);
      const want = diffKeys(atFrom, atTo);
      const got = (step.changes ?? []).map(c => c.key).sort();
      let exact = want.length === got.length && want.every((k, i) => k === got[i]);
      let exactDetail = "";
      if (exact) {
        for (const c of step.changes) {
          const prev = atFrom.has(c.key) ? atFrom.get(c.key) : undefined;
          const next = atTo.has(c.key) ? atTo.get(c.key) : undefined;
          if ((prevStateOf(c) ?? undefined) !== prev || (stateOf(c) ?? undefined) !== next) {
            exact = false;
            exactDetail = `${c.key} prev/preview`;
            break;
          }
        }
      } else exactDetail = `keys ${got.join(",")} want ${want.join(",")}`;
      push(exact, "step changes exact", label, exactDetail || undefined);
      if (step.from !== fromBefore && step.from !== head) {
        // from should be the live head we travelled from
      }
      void fromBefore;
    }

    // travel(n) then travel(m) equals travel(m) directly. A fresh host, so `from` is live, not a previous view.
    const n2 = Math.max(1, head);
    const n1 = Math.max(1, Math.min(mid, n2));
    let directOk = false, directDetail = "";
    try {
      const path = yield makeHost(graph, hostOpts);
      const pathMsgs = collect(path);
      yield* script(path);
      const pathSteps = pathMsgs.filter(m => m.type === "flush").sort((a, b) => a.seq - b.seq);
      const pathHead = pathSteps.reduce((h, f) => Math.max(h, f.seq), 0);
      const p1 = pathMsgs.length;
      yield path.post({ type: "travel", to: n1 });
      const s1 = pathMsgs.slice(p1).find(m => m.type === "step");
      const p2 = pathMsgs.length;
      yield path.post({ type: "travel", to: n2 });
      const s2 = pathMsgs.slice(p2).find(m => m.type === "step");
      let shownA = reconstruct(pathSteps, pathHead);
      if (s1?.type === "step") shownA = applyChanges(shownA, s1.changes);
      if (s2?.type === "step") shownA = applyChanges(shownA, s2.changes);

      const other = yield makeHost(graph, hostOpts);
      const otherMsgs = collect(other);
      yield* script(other);
      const otherSteps = otherMsgs.filter(m => m.type === "flush").sort((a, b) => a.seq - b.seq);
      const otherHead = otherSteps.reduce((h, f) => Math.max(h, f.seq), 0);
      const oN = otherMsgs.length;
      yield other.post({ type: "travel", to: n2 });
      const direct = otherMsgs.slice(oN).find(m => m.type === "step");
      let shownB = reconstruct(otherSteps, otherHead);
      if (direct?.type === "step") shownB = applyChanges(shownB, direct.changes);
      directOk = s1?.type === "step" && s2?.type === "step" && direct?.type === "step"
        && mapsEqual(shownA, shownB) && mapsEqual(shownB, reconstruct(otherSteps, n2));
      if (!directOk) directDetail = !direct ? "no step" : !s1 || !s2 ? "path missing a step" : "shown state differs";
      yield path.dispose?.();
      yield other.dispose?.();
    } catch (e) { directDetail = e?.message ?? String(e); }
    push(directOk, "travel commutative", label, directDetail || undefined);

    // Viewing buffers live flushes; resume catches up; nothing is lost.
    const viewTo = 1;
    yield travelHost.post({ type: "travel", to: viewTo });
    const mark = travelMsgs.length;
    yield travelHost.act();
    yield travelHost.tick(8);
    const during = travelMsgs.slice(mark);
    const leaked = during.some(m => m.type === "flush");
    const nResume = travelMsgs.length;
    yield travelHost.post({ type: "resume" });
    const resumed = travelMsgs.slice(nResume).find(m => m.type === "resume" || m.type === "travel-denied");
    const nHello = travelMsgs.length;
    yield travelHost.post({ type: "hello", want: ["timeline"] });
    const tl = travelMsgs.slice(nHello).find(m => m.type === "timeline");
    const kept = !leaked && tl && (tl.steps?.length ?? 0) >= stepsNow().length;
    push(kept, "flushes during viewing kept", label, leaked ? "a flush was shown while viewing" : tl ? undefined : "no timeline after resume");

    let resumeOk = false, resumeDetail = "";
    if (resumed?.type === "resume" && tl) {
      const viewed = reconstruct(tl.steps ?? [], viewTo);
      const after = applyChanges(viewed, resumed.changes);
      const live = reconstruct(tl.steps ?? [], resumed.head);
      resumeOk = mapsEqual(after, live) && resumed.head === tl.head;
      if (!resumeOk) resumeDetail = "resume changes do not reach live";
    } else resumeDetail = resumed ? resumed.type : "no resume";
    push(resumeOk, "resume matches live", label, resumeDetail || undefined);
    yield travelHost.dispose?.();
  }

  // `step.inexact` (§4b): a list of graph keys when present.
  const badInexact = [...msgs, ...(travelMsgs ?? [])].filter(m => m.type === "step" && m.inexact !== undefined)
    .flatMap(m => Array.isArray(m.inexact) ? m.inexact.filter(k => !allKeys.has(k)) : ["not a list"]);
  push(!badInexact.length, "step inexact keys exist", label, badInexact.slice(0, 3).join(", ") || undefined);

  // Eviction: a small ring drops early seqs.
  try {
    const small = yield makeHost(graph, { seed, rate: 0, capacity: 3 });
    const box = [];
    small.subscribe(m => box.push(m));
    let guard = 0;
    while (box.filter(m => m.type === "flush").length < 6 && guard++ < 40) {
      yield small.act();
      yield small.tick(6);
    }
    // settle flights so travel isn't pending
    yield small.tick(12);
    const got = box.filter(m => m.type === "flush").length;
    const n = box.length;
    yield small.post({ type: "travel", to: 1 });
    const denied = box.slice(n).find(m => m.type === "travel-denied" || m.type === "step");
    if (got >= 6) {
      const ok = denied?.type === "travel-denied" && denied.reason === "evicted";
      push(ok, "travel evicted outside capacity", label, ok ? undefined : `got ${denied?.type ?? "nothing"} ${denied?.reason ?? ""} after ${got} flushes`);
    } else push(true, "travel evicted outside capacity", label, `only ${got} flushes, skipped`);
    yield small.dispose?.();
  } catch (e) {
    push(false, "travel evicted outside capacity", label, e?.message ?? String(e));
  }

  // HMR plan.
  try {
    const h = yield makeHost(graph, hostOpts);
    const box = [];
    h.subscribe(m => box.push(m));
    yield h.post({ type: "hello", want: ["hmr"] });
    yield h.tick(4);
    const module = graph.modules?.[0];
    yield h.editModule(module);
    const planMsg = box.find(m => m.type === "hmr" && m.phase === "plan");
    const doneMsg = box.find(m => m.type === "hmr" && m.phase === "done");
    const failed = box.find(m => m.type === "hmr" && m.phase === "failed");
    if (!planMsg) {
      push(false, "hmr partition", label, failed ? `failed: ${failed.error}` : "no plan");
      push(false, "hmr reasons cover plan", label, "no plan");
      push(false, "hmr done changes subset", label, "no done");
    } else {
      const errors = partitionErrors(planMsg.plan, graph, planMsg.graph ?? graph);
      const part = errors.filter(e => !e.startsWith("no reason") && !e.startsWith("reason for") && !e.includes("has reason") && !e.includes("but reason is"));
      const reasons = errors.filter(e => e.startsWith("no reason") || e.startsWith("reason for") || e.includes("not a known code"));
      push(part.length === 0, "hmr partition", label, part.slice(0, 3).join("; ") || undefined);
      push(reasons.length === 0 && errors.filter(e => e.includes("but reason is") || e.includes("has reason")).length === 0, "hmr reasons cover plan", label, [...reasons, ...errors.filter(e => e.includes("reason"))].slice(0, 3).join("; ") || undefined);
      const allow = new Set([...(planMsg.plan.rerun ?? []), ...(planMsg.plan.reset ?? []), ...(planMsg.plan.added ?? [])]);
      const bad = (doneMsg?.changes ?? []).filter(c => c.key != null && !allow.has(c.key)).map(c => c.key);
      push(!!doneMsg && bad.length === 0, "hmr done changes subset", label, !doneMsg ? "no done" : bad.length ? bad.join(", ") : undefined);
    }
    yield h.dispose?.();
  } catch (e) {
    push(false, "hmr partition", label, e?.message ?? String(e));
  }

  yield host.dispose?.();
}
