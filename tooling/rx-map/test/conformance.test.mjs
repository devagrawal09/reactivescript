#!/usr/bin/env node
// Fake host against the fixtures, several seeds, plus a host built to fail specific checks.
// Also checks planHmr on synthetic graphs and on five real edits of examples/users.rx.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConformance, runConformanceAsync } from "../conformance.mjs";
import { createFakeHost } from "../fake.mjs";
import { planHmr } from "../hmr.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");
const rxc = process.env.RXC
  ?? [resolve(repo, "compiler/target/release/rxc"), "/home/lucifer/work/solidjs/reactivescript/compiler/target/release/rxc"].find(existsSync);

const fixtures = readdirSync(resolve(here, "fixtures")).filter(f => f.endsWith(".json")).sort().map(f => {
  const g = JSON.parse(readFileSync(resolve(here, "fixtures", f), "utf8"));
  g.title = f.replace(/\.json$/, "");
  return g;
});

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`);
  if (!ok) failed++;
};

function drive(seed, graph) {
  const host = createFakeHost(graph, { seed, rate: 0 });
  const msgs = [];
  host.subscribe(m => msgs.push(m));
  host.post({ type: "hello", want: ["live", "timeline", "travel", "hmr"] });
  for (let i = 0; i < 4; i++) { host.act(); host.tick(6); }
  host.editModule(graph.modules[0], "rename");
  host.dispose();
  return msgs;
}

const notes = fixtures.find(g => g.title === "notes");
const users = fixtures.find(g => g.title === "users");

for (const seed of [1, 3, 7]) {
  const a = JSON.stringify(drive(seed, notes));
  const b = JSON.stringify(drive(seed, notes));
  check(`deterministic seed ${seed}`, a === b, a === b ? "" : "two hosts diverged");
}
check("seeds differ", JSON.stringify(drive(1, notes)) !== JSON.stringify(drive(2, notes)));

for (const seed of [1, 3, 9, 42]) {
  const results = runConformance((g, o) => createFakeHost(g, o), fixtures, { seed });
  for (const r of results) {
    const where = r.graph ? `${r.graph}: ` : "";
    check(`${where}${r.check} (seed ${seed})`, r.ok, r.detail);
  }
}

// The fake actually flies, and a flush from an action carries cause, order and origin.
{
  const host = createFakeHost(notes, { seed: 3, rate: 4 });
  const msgs = [];
  host.subscribe(m => msgs.push(m));
  host.post({ type: "hello", want: ["live"] });
  host.tick(20);
  host.dispose();
  const flights = msgs.filter(m => m.type === "flight");
  const starts = flights.filter(m => m.state === "start");
  const ends = flights.filter(m => m.state === "land" || m.state === "abandon");
  check("notes opens and closes flights", starts.length > 0 && ends.length > 0, `${starts.length} starts, ${ends.length} ends`);
  const acted = msgs.filter(m => m.type === "flush" && typeof m.origin === "string" && m.origin.startsWith("action "));
  const meta = acted.length > 0 && acted.every(m => m.cause && Array.isArray(m.order) && m.origin);
  check("action flushes carry cause, order, origin", meta, acted.length ? "" : "no action flush");
}

// nextPage really ticks the number.
{
  const host = createFakeHost(users, { seed: 1, rate: 0 });
  const msgs = [];
  host.subscribe(m => msgs.push(m));
  host.act("examples/users.rx||nextPage");
  host.tick(8);
  host.dispose();
  const page = msgs.filter(m => m.type === "flush").flatMap(m => m.changes).find(c => c.name === "page");
  check("nextPage ticks page", page?.preview === "2" && page?.prev === "1", JSON.stringify(page));
}

// ---- synthetic plans ---------------------------------------------------------------------------------------------
function mini(nodes, lines, edges = []) {
  return {
    modules: ["m.rx"],
    nodes: nodes.map(n => ({ mod: 0, file: "m.rx", region: "0:r0", line: n.line ?? 1, ...n })),
    edges,
    regions: [{ id: "0:r0", mod: 0, kind: "program", parent: null }],
    lines: { "m.rx": lines },
  };
}
const read = (from, to) => ({ from, to, type: "read", mode: "tracked", probe: null });

{
  const old = mini(
    [{ id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }, { id: "b", kind: "eq", name: "b", key: "m.rx||b", line: 2 }, { id: "c", kind: "eq", name: "c", key: "m.rx||c", line: 3 }, { id: "go", kind: "action", name: "go", key: "m.rx||go", line: 4 }],
    { 1: "source a: number := 1", 2: "b = a", 3: "c = b", 4: "action go() { a := a + 1 }" },
    [read("a", "b"), read("b", "c")],
  );
  const same = planHmr(old, old);
  check("plan unchanged", same.reasons["m.rx||a"] === "unchanged" && same.reasons["m.rx||go"] === "unchanged" && same.kept.includes("m.rx||b"), JSON.stringify(same.reasons));

  const init = mini(old.nodes, { ...old.lines["m.rx"], 1: "source a: number := 2" }, old.edges);
  init.lines = { "m.rx": { 1: "source a: number := 2", 2: "b = a", 3: "c = b", 4: "action go() { a := a + 1 }" } };
  const initPlan = planHmr(old, init);
  check("plan init-changed keeps downstream", initPlan.reasons["m.rx||a"] === "init-changed" && initPlan.kept.includes("m.rx||a") && initPlan.reasons["m.rx||b"] === "unchanged", JSON.stringify(initPlan.reasons));

  const typed = mini(old.nodes, {}, old.edges);
  typed.lines = { "m.rx": { 1: "source a: string := 1", 2: "b = a", 3: "c = b", 4: "action go() { a := a + 1 }" } };
  const typePlan = planHmr(old, typed);
  check("plan type-changed resets and reruns downstream", typePlan.reasons["m.rx||a"] === "type-changed" && typePlan.reset.includes("m.rx||a") && typePlan.reasons["m.rx||b"] === "upstream-changed" && typePlan.reasons["m.rx||c"] === "upstream-changed", JSON.stringify(typePlan.reasons));

  const expr = mini(old.nodes, {}, old.edges);
  expr.lines = { "m.rx": { 1: "source a: number := 1", 2: "b = a + 1", 3: "c = b", 4: "action go() { a := a + 1 }" } };
  const exprPlan = planHmr(old, expr);
  check("plan expr-changed reruns upstream", exprPlan.reasons["m.rx||b"] === "expr-changed" && exprPlan.reasons["m.rx||c"] === "upstream-changed", JSON.stringify(exprPlan.reasons));

  const renamed = mini(
    [{ id: "b", kind: "eq", name: "bee", key: "m.rx||bee", line: 2 }, { id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }],
    {},
    [read("a", "b")],
  );
  renamed.lines = { "m.rx": { 1: "source a: number := 1", 2: "bee = a" } };
  const renPlan = planHmr(
    mini([{ id: "b", kind: "eq", name: "b", key: "m.rx||b", line: 2 }, { id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }], { 1: "source a: number := 1", 2: "b = a" }, [read("a", "b")]),
    renamed,
  );
  check("plan rename is a move", renPlan.moved.some(m => m.from === "m.rx||b" && m.to === "m.rx||bee") && renPlan.reasons["m.rx||b"] === "renamed" && renPlan.reasons["m.rx||bee"] === "unchanged" && renPlan.kept.includes("m.rx||bee"), JSON.stringify(renPlan));

  const reOld = mini(
    [{ id: "x1", kind: "eq", name: "x", key: "m.rx||x", line: 1 }, { id: "x2", kind: "eq", name: "x", key: "m.rx||x#1", line: 2 }],
    { 1: "x = 1", 2: "x = 2" },
  );
  const reNew = mini([{ id: "x2", kind: "eq", name: "x", key: "m.rx||x", line: 1 }], { 1: "x = 2" });
  const rePlan = planHmr(reOld, reNew);
  check("plan reindex shifts #n without reporting its reused destination twice", rePlan.moved.some(m => m.from === "m.rx||x#1" && m.to === "m.rx||x") && rePlan.reasons["m.rx||x#1"] === "reindexed" && rePlan.kept.includes("m.rx||x") && !rePlan.removed.includes("m.rx||x"), JSON.stringify(rePlan));

  const scoped = mini([{ id: "x", kind: "eq", name: "x", key: "m.rx|App|x", line: 4 }], { 4: "x = 1" });
  const scopePlan = planHmr(mini([{ id: "x", kind: "eq", name: "x", key: "m.rx||x", line: 1 }], { 1: "x = 1" }), scoped);
  check("plan scope-changed resets", scopePlan.moved.some(m => m.from === "m.rx||x" && m.to === "m.rx|App|x") && scopePlan.reset.includes("m.rx|App|x") && scopePlan.reasons["m.rx|App|x"] === "scope-changed", JSON.stringify(scopePlan.reasons));

  const kindNew = mini([{ id: "a", kind: "eq", name: "a", key: "m.rx||a", line: 1 }], { 1: "a = 1" });
  const kindPlan = planHmr(mini([{ id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }], { 1: "source a: number := 1" }), kindNew);
  check("plan kind-changed resets", kindPlan.reasons["m.rx||a"] === "kind-changed" && kindPlan.reset.includes("m.rx||a"), JSON.stringify(kindPlan.reasons));

  const added = mini(
    [{ id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }, { id: "e", kind: "source", name: "extra", key: "m.rx||extra", line: 2 }],
    { 1: "source a: number := 1", 2: "source extra: number := 0" },
  );
  const addPlan = planHmr(mini([{ id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }], { 1: "source a: number := 1" }), added);
  check("plan add and the complement", addPlan.added.includes("m.rx||extra") && addPlan.reasons["m.rx||extra"] === "new" && addPlan.reasons["m.rx||a"] === "unchanged");

  const gone = planHmr(added, mini([{ id: "a", kind: "source", name: "a", key: "m.rx||a", line: 1 }], { 1: "source a: number := 1" }));
  check("plan remove", gone.removed.includes("m.rx||extra") && gone.reasons["m.rx||extra"] === "gone");

  const actNew = mini([{ id: "go", kind: "action", name: "go", key: "m.rx||go", line: 1 }], { 1: "action go() { a := 2 }" });
  const actPlan = planHmr(mini([{ id: "go", kind: "action", name: "go", key: "m.rx||go", line: 1 }], { 1: "action go() { a := 1 }" }), actNew);
  check("plan action body reruns", actPlan.rerun.includes("m.rx||go") && actPlan.reasons["m.rx||go"] === "expr-changed");

  const hinted = planHmr(
    mini([{ id: "b", kind: "eq", name: "b", key: "m.rx||b", line: 1 }], { 1: "b = 1" }),
    mini([{ id: "b", kind: "eq", name: "bee", key: "m.rx||bee", line: 1 }], { 1: "bee = 1" }),
    { renamed: [{ from: "m.rx||b", to: "m.rx||bee" }] },
  );
  check("plan honors a rename hint", hinted.moved.some(m => m.from === "m.rx||b" && m.to === "m.rx||bee"));
}

// ---- real edits of users.rx --------------------------------------------------------------------------------------
function graphOf(file) {
  const out = execFileSync(process.execPath, [resolve(pkg, "rx-map.mjs"), file, "--json"], {
    cwd: repo,
    env: { ...process.env, RXC: rxc },
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  return JSON.parse(out);
}
function suffix(graph, name) {
  return graph.nodes.find(n => n.name === name && (n.kind === "source" || n.kind === "eq" || n.kind === "action"))?.key;
}

if (!rxc) {
  check("real edits", false, "rxc not found");
} else {
  const file = "/tmp/rx-trace-users.rx";
  const src = readFileSync(resolve(repo, "examples/users.rx"), "utf8");
  const variants = {
    rename: src.replace("status = ", "label = ").replace("{status}", "{label}"),
    expr: src.replace("total = len(users)", "total = len(users) + 1"),
    init: src.replace("source page: number := 1", "source page: number := 2"),
    type: src.replace('source saveError: string := ""', 'source saveError: string | null := ""'),
    addremove: src
      .replace("total = len(users)\n", "")
      .replace('status = pending? users ? "loading…" : `${total} users`', 'status = pending? users ? "loading…" : "ready"')
      .replace('source saveError: string := ""\n', 'source saveError: string := ""\nsource extra: number := 0\n'),
  };
  writeFileSync(file, src);
  const before = graphOf(file);
  const line = (title, plan, ok) => {
    check(title, ok, JSON.stringify({ kept: plan.kept.length, reset: plan.reset, rerun: plan.rerun, added: plan.added, removed: plan.removed, moved: plan.moved }));
    if (ok) console.log(`     ${title}`);
  };
  for (const [name, text] of Object.entries(variants)) {
    writeFileSync(file, text);
    const after = graphOf(file);
    const plan = planHmr(before, after);
    const reason = (n) => plan.reasons[suffix(after, n) ?? suffix(before, n)];
    if (name === "rename") {
      const from = suffix(before, "status");
      const to = suffix(after, "label");
      line("real edit rename status → label", plan, plan.moved.some(m => m.from === from && m.to === to) && plan.reasons[from] === "renamed" && plan.kept.includes(to));
    } else if (name === "expr") {
      line("real edit equation expression", plan, reason("total") === "expr-changed" && reason("status") === "upstream-changed");
    } else if (name === "init") {
      line("real edit source initialiser", plan, reason("page") === "init-changed" && plan.kept.includes(suffix(after, "page")) && reason("users") === "unchanged");
    } else if (name === "type") {
      line("real edit source type", plan, reason("saveError") === "type-changed" && plan.reset.includes(suffix(after, "saveError")));
    } else if (name === "addremove") {
      line("real edit add and remove", plan, plan.added.some(k => k.endsWith("|extra")) && plan.removed.some(k => k.endsWith("|total")) && reason("status") === "expr-changed");
    }
  }
}

// A host that corrupts the protocol must fail these checks, and not pass them.
const MUST_FAIL = [
  "seq strictly increasing",
  "at non-decreasing",
  "change keys exist",
  "flight start before end",
  "no double flight start",
  "step changes exact",
  "hmr partition",
  "hmr reasons cover plan",
  "hmr done changes subset",
];
function makeBroken(graph, opts) {
  const real = createFakeHost(graph, opts);
  return {
    post: real.post,
    tick: real.tick,
    act: real.act,
    editModule: real.editModule,
    dispose: real.dispose,
    subscribe(fn) {
      return real.subscribe(m => {
        if (m.type === "flush") fn({ ...m, seq: 1, at: m.seq > 1 ? 0 : m.at, changes: [...(m.changes ?? []), { key: "missing", name: "missing", preview: "1" }] });
        else if (m.type === "flight" && m.state === "start") { fn({ ...m, state: "land" }); fn(m); fn(m); }
        else if (m.type === "step") fn({ ...m, changes: [{ key: "bogus", name: "bogus", preview: "no" }] });
        else if (m.type === "hmr" && m.phase === "plan") {
          const plan = { ...m.plan, kept: [...(m.plan.kept ?? []), "dup"], removed: [...(m.plan.removed ?? []), "dup"], reasons: {} };
          fn({ ...m, plan });
        } else if (m.type === "hmr" && m.phase === "done") {
          fn({ ...m, changes: [...(m.changes ?? []), { key: "not-in-plan", name: "x", preview: "1" }] });
        } else fn(m);
      });
    },
  };
}
{
  const bad = runConformance(makeBroken, [users], { seed: 1 });
  const failedChecks = new Set(bad.filter(r => !r.ok && r.graph).map(r => r.check));
  for (const name of MUST_FAIL) check(`broken host fails ${name}`, failedChecks.has(name), [...failedChecks].join(", ") || "nothing failed");
  const passed = MUST_FAIL.filter(name => !failedChecks.has(name));
  if (passed.length) {
    for (const r of bad.filter(r => !r.ok)) console.log(`     broken: ${r.check}: ${r.detail ?? ""}`);
  }
}

// First-change prev (§4b): a key first changed at seq 3 had its `prev` at seqs 1-2. A host that replays without that
// rule (the key absent before its first change) fails the travel checks; one that follows it passes.
{
  const [k1, k2, k3] = users.nodes.filter(n => n.key && n.kind === "source").map(n => n.key);
  const ERR = "\u0000error\u0000";
  // `errors`: k3 shows an error at seq 2 and a value from seq 4; `errorState`: the host keeps the error as k3's state
  const scripted = (firstPrev, { errors = false, errorState = true } = {}) => () => {
    const subs = new Set(), steps = [];
    let viewing = null;
    const emit = m => { for (const f of subs) f({ source: "rx-map", v: 1, ...m }); };
    const valuesAt = n => {
      const m = new Map(), seen = new Set();
      if (firstPrev) for (const s of steps) for (const c of s.changes) if (!seen.has(c.key)) { seen.add(c.key); if (c.prev !== undefined) m.set(c.key, c.prev); }
      for (const s of steps) if (s.seq <= n) for (const c of s.changes) {
        const v = c.error !== undefined ? (errorState ? ERR + c.error : undefined) : c.preview;
        if (v === undefined) m.delete(c.key); else m.set(c.key, v);
      }
      return m;
    };
    const side = (v, value, error) => v === undefined ? {} : v.startsWith(ERR) ? { [error]: v.slice(ERR.length) } : { [value]: v };
    const diff = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k))
      .map(k => ({ key: k, name: k, ...side(a.get(k), "prev", "prevError"), ...side(b.get(k), "preview", "error") }));
    return {
      subscribe: f => (subs.add(f), () => subs.delete(f)),
      act() {
        const seq = steps.length + 1;
        const changes = [{ key: k1, name: "a", prev: String(seq - 1), preview: String(seq) }];
        if (seq === 3) changes.push({ key: k2, name: "b", prev: "\"before\"", preview: "\"after\"" });
        if (errors && seq === 2) changes.push({ key: k3, name: "c", error: "NotFound" });
        if (errors && seq === 4) changes.push({ key: k3, name: "c", preview: "1" });
        steps.push({ seq, at: seq, changes });
        if (viewing == null) emit({ type: "flush", seq, at: seq, changes });
      },
      tick() {},
      post(m) {
        const head = steps.length;
        if (m.type === "hello") emit({ type: "timeline", head, viewing, steps, capacity: 2000 });
        else if (m.type === "travel") {
          if (m.to < 1 || m.to > head) return emit({ type: "travel-denied", to: m.to, reason: "evicted" });
          const from = viewing ?? head;
          viewing = m.to;
          emit({ type: "step", from, to: m.to, direction: "back", changes: diff(valuesAt(from), valuesAt(m.to)) });
        } else if (m.type === "resume") {
          const from = viewing ?? head;
          viewing = null;
          emit({ type: "resume", head, changes: diff(valuesAt(from), valuesAt(head)) });
        }
      },
      editModule() { throw new Error("no hmr"); },
    };
  };
  const travelChecks = ["travel matches replay", "step changes exact", "travel commutative", "resume matches live"];
  const okOf = r => travelChecks.map(c => r.find(x => x.check === c && x.graph)?.ok);
  check("a host following first-change prev passes the travel checks", okOf(runConformance(scripted(true), [users])).every(Boolean));
  check("a host ignoring it fails them", !okOf(runConformance(scripted(false), [users]))[1]);
  // v0.6: an error is a shown state; step/resume changes carry `error`/`prevError` for it
  check("a host keeping errors as states passes the travel checks", okOf(runConformance(scripted(true, { errors: true }), [users])).every(Boolean));
  check("a host dropping them fails", !okOf(runConformance(scripted(true, { errors: true, errorState: false }), [users])).every(Boolean));
}

// The async runner (a host whose calls take time, e.g. a real app in a browser) reports what the sync one does, and
// a rejected call lands on the check that made it.
{
  const later = v => new Promise(r => setTimeout(() => r(v), 0));
  const slow = (g, o) => {
    const h = createFakeHost(g, o);
    return later({ ...h, post: m => later(h.post(m)), act: k => later(h.act(k)), tick: n => later(h.tick(n)),
      editModule: (m, x) => later(h.editModule(m, x)), dispose: () => later(h.dispose()) });
  };
  const sync = runConformance((g, o) => createFakeHost(g, o), fixtures, { seed: 1 });
  const async = await runConformanceAsync(slow, fixtures, { seed: 1 });
  check("async runner matches the sync runner", JSON.stringify(async) === JSON.stringify(sync),
    async.filter((r, i) => JSON.stringify(r) !== JSON.stringify(sync[i])).slice(0, 2).map(r => JSON.stringify(r)).join("; "));
  const rejecting = (g, o) => { const h = createFakeHost(g, o); return { ...h, editModule: () => Promise.reject(new Error("no hmr here")) }; };
  const r = await runConformanceAsync(rejecting, fixtures.slice(0, 1), { seed: 1 });
  check("async runner: a rejected call fails its check", r.some(x => !x.ok && x.check === "hmr partition" && x.detail === "no hmr here")
    && r.filter(x => x.check === "travel matches replay").every(x => x.ok), JSON.stringify(r.filter(x => !x.ok)));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
