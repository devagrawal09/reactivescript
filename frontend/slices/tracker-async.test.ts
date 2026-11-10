// Plan v2.1, async data (plan/docs/PLAN-V2.md, "v2.1: async data"; docs/SCENARIO-FORMAT.md, version 2.1). The async
// tracker in TSX and RX must have equal canonical facts, native Solid plus the compiled TSX and RX legs must render the
// scenario's exact frames, both must emit one v2.1 plan byte for byte, and the plan alone, built with Solid's
// primitives, must render the same frames. The yield twin is refused with its documented diagnostics. v2.1 is additive:
// the v2.1 builder emits every v2 plan byte for byte, and the v2 builder and the default TSX subset still refuse async.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { semanticFacts } from "../tsx/rx/facts.ts";
import { loadTsxModules } from "../tsx/modules.ts";
import { TsxError } from "../tsx/lower.ts";
import { loadYieldModules, YieldError } from "../yield/lower.ts";
import { resolvePlanV2 } from "../plan/resolve-v2.ts";
import { emit, generate } from "../plan/fuzz/gen.ts";
import { runProgram, RUST_UNSUPPORTED_CLASS } from "../plan/fuzz/run.ts";
import { loadFixture, loadScenario, runScenario, type Leg } from "./run-js.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const scenario = here("./tracker-async/tracker-async.scenario.json");
const fixture = (ext: string) => here("./tracker-async/tracker-async." + ext);
const artifact = here("../plan/tracker-async.plan.json");
const root = here("..");
const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };
const expected = () => (JSON.parse(readFileSync(scenario, "utf8")).steps as { frame: string }[]).map(s => s.frame);
const emitCli = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "plan/emit.ts", ...args], { cwd: root, encoding: "utf8" });
const C = "/program/component:TrackerAsync::";

test("tracker-async: TSX and RX have equal canonical facts (async memo, affects, refresh, pending probe, boundaries)", () => {
  const [tsx, rx] = (["tsx", "rx"] as const).map(leg => semanticFacts(loadFixture(scenario, leg)));
  assert.deepEqual(tsx.diagnostics, []);
  assert.deepEqual(tsx, rx);
  const m = rx.modules[0];
  assert.deepEqual(m.regions, ["/program", "/program/component:TrackerAsync", "/program/component:TrackerAsync/errored",
    "/program/component:TrackerAsync/errored/loading", "/program/component:TrackerAsync/errored/loading/for", "/program/children:TrackerAsync"]);
  assert.ok(m.symbols.includes("/program::import:loadIssues"), "loadIssues is pure: no io flag");
  assert.deepEqual(m.computations.find(c => c.kind === "memo" && c.name === "issues")?.calls, ["/program::import:loadIssues"]);
  const claim = m.computations.find(c => c.kind === "action" && c.name === "claim");
  assert.deepEqual(claim?.writes, [C + "eq:issues affects", C + "eq:issues refresh", C + "source:status write"]);
  // The Errored fallback's retry handler is walked in the component's region, before the boundary's content.
  const retry = m.computations.find(c => c.kind === "handler" && c.region === "/program/component:TrackerAsync");
  assert.deepEqual(retry?.writes, [C + "eq:issues refresh"]);
  const probe = m.computations.find(c => c.kind === "reader" && c.region.endsWith("/errored/loading") && c.at === "{…}");
  assert.deepEqual(probe?.reads, [C + "eq:issues tracked pending"]);
});

for (const [label, leg] of [["native Solid", "native"], ["compiled TSX", "tsx"], ["compiled RX", "rx"]] as const) {
  test("tracker-async frames: " + label, async () => {
    assert.deepEqual(await runScenario(scenario, leg as Leg), expected());
  });
}

// The yield frontend lowers no async data (docs/YIELD.md, "Refused"); each async form is refused at its own site.
const yieldSource = readFileSync(fixture("yield.tsx"), "utf8");
const yieldRefusal = (source: string, at: string, message: RegExp) => {
  assert.ok(source.includes(at), "the refusal site exists: " + at);
  const entry = fixture("yield.tsx");
  assert.throws(() => loadYieldModules(entry, p => (p === entry ? source : read(p))), (error: unknown) => {
    assert.ok(error instanceof YieldError, String(error));
    assert.equal(error.start, source.indexOf(at), "refused at " + at + ": " + error.message);
    assert.match(error.message, message);
    return true;
  });
};
test("tracker-async: the yield twin is refused with its documented diagnostics, at each async form", () => {
  const head = "import { $event, $memo, $signal, affects, attempt, component, Errored, For, isPending, Loading, refresh, view }";
  assert.ok(yieldSource.includes(head));
  const without = (...names: string[]) => yieldSource.replace(head, head.replace(/\{ (.*) \}/, (_, list: string) =>
    "{ " + list.split(", ").filter(n => !names.includes(n)).join(", ") + " }"));
  yieldRefusal(yieldSource, "affects, attempt", /^.*: not in the yield subset: affects$/);
  yieldRefusal(without("affects"), "Errored, For", /Errored and typed failures are not in the yield subset yet/);
  yieldRefusal(without("affects", "Errored"), "isPending, Loading", /not in the yield subset: isPending/);
  yieldRefusal(without("affects", "Errored", "isPending"), "Loading, refresh", /Loading needs async sources, which the yield subset does not lower/);
  yieldRefusal(without("affects", "Errored", "isPending", "Loading"), "refresh, view", /refresh needs a question source, which the yield subset does not lower/);
  yieldRefusal(without("affects", "Errored", "isPending", "Loading", "refresh"), "yield* attempt(() => loadIssues())", /async memos \(attempt in \$memo\) are not in the yield subset/);
  // emit.ts refuses the twin too: no plan is printed.
  const r = emitCli(fixture("yield.tsx"));
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /not in the yield subset: affects/);
});

test("plan v2.1: TSX and RX emit the same tracker-async plan, byte-identical to tracker-async.plan.json", () => {
  const plans = ["rx", "tsx"].map(ext => { const r = emitCli(fixture(ext)); assert.equal(r.status, 0, r.stderr); return r.stdout; });
  assert.equal(plans[1], plans[0]);
  assert.equal(plans[0], readFileSync(artifact, "utf8"));
  const plan = JSON.parse(plans[0]);
  assert.equal(plan.version, 2.1);
  // --schema 2.1 is what the format-2.1 scenario selects.
  for (const ext of ["rx", "tsx"]) { const r = emitCli("--schema", "2.1", fixture(ext)); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, plans[0]); }
  // The plan's hosts are the scenario's signatures (plus the pure flag), in import order.
  assert.deepEqual(plan.hosts, [{ name: "assignIssue", params: ["number"], returns: "string" },
    { name: "loadIssues", params: [], returns: "{ id: number, title: string, assignee: string }[]", pure: true }]);
});

test("plan v2.1: the tracker-async plan alone, built with Solid primitives, renders the scenario frames", async () => {
  assert.deepEqual(await runScenario(scenario, "plan", { plan: artifact }), expected());
});

test("plan v2.1: Rust consumes the tracker-async plan freshly emitted from each accepted frontend (TSX, RX)", { skip: !process.env.RUST_SCENARIO }, () => {
  // rust-solid's `scenario` binary picks its consumer by the plan's version: 2.1 goes to the plan v2/v2.1 consumer
  // (rust-solid docs/PLAN-V2-CONSUMER.md, "Plan v2.1"), with Loading and Errored ported from Solid's boundaries. The
  // yield twin is refused, so TSX and RX are the accepted syntaxes; each plan is emitted fresh and must be the saved
  // artifact, and Rust must give the scenario's 18 recorded frames from it.
  const dir = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "tracker-async-rust-"));
  try {
    for (const ext of ["rx", "tsx"]) {
      const plan = join(dir, ext + ".plan.json");
      const r = emitCli(fixture(ext), plan);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(plan, "utf8"), readFileSync(artifact, "utf8"));
      const out = spawnSync(process.env.RUST_SCENARIO!, [plan, scenario], { encoding: "utf8" });
      assert.equal(out.status, 0, out.stderr);
      assert.deepEqual(JSON.parse(out.stdout), expected(), ext);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("plan v2.1: on the recording host, native Solid, compiled RX, the tracker-async plan and Rust give one full host log", async () => {
  // The plan fuzz's recording host (plan/fuzz/host.ts, Solid's production builds): every host call, request, settled
  // action, tree and frame. The plan built by solid-plan.ts must make native's calls entry for entry, not only its frames.
  const s = JSON.parse(readFileSync(scenario, "utf8"));
  const text = (ext: string) => readFileSync(ext === "api" ? here("./tracker-async/api.d.rx") : fixture(ext), "utf8");
  const rust = process.env.RUST_PLAN_TRACE;
  const o = await runProgram({ seed: 0, family: "tracker-async", async: true, files: { "App.tsx": text("tsx"), "App.rx": text("rx"), "api.d.rx": text("api") }, hosts: s.host, actions: ["claim"], scenario: s }, { rust });
  assert.deepEqual(Object.keys(o.traces!), rust ? ["native", "rx", "plan", "rust"] : ["native", "rx", "plan"]);
  assert.deepEqual(o.traces!.native!.result, { frames: expected() });
  assert.equal(o.traces!.native!.log.length, 399);
  // Rust (rust-solid's plan-trace, the plan v2.1 consumer) gives the same 399-entry log; a refusal of the version
  // (rust-unsupported) fails. Without a Rust binary the program agrees on the JS legs.
  for (const leg of rust ? ["rx", "plan", "rust"] as const : ["rx", "plan"] as const) assert.equal(JSON.stringify(o.traces![leg]), JSON.stringify(o.traces!.native), leg);
  assert.equal(o.status, "agree", o.classes.join(", "));
  assert.ok(!o.classes.includes(RUST_UNSUPPORTED_CLASS), "a Rust refusal of the version is not agreement");
  assert.deepEqual(o.classes, []);
});

test("plan v2.1 is additive: v2 plans are emitted byte for byte; the v2 builder and the default TSX subset refuse async", () => {
  // The tracker and like (v2) through the v2.1 builder and the TSX async tier: the saved v2 artifacts, byte for byte.
  for (const [dir, stem, saved] of [["tracker", "tracker", "tracker.plan.json"], ["like", "like", "like.plan-v2.json"]] as const)
    for (const ext of ["rx", "tsx", "yield.tsx"]) {
      const r = emitCli("--schema", "2.1", here("./" + dir + "/" + stem + "." + ext));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, readFileSync(here("../plan/" + saved), "utf8"), stem + "." + ext);
    }
  // Plan-fuzz programs (seeds 1..40): the v2.1 builder (and the TSX async tier) gives the v2 builder's plan or refusal.
  for (let seed = 1; seed <= 40; seed++) {
    const files = emit(generate(seed));
    const out = (file: string, async: boolean) => {
      const set = loadTsxModules(file, p => files[p], { async });
      try { return JSON.stringify(resolvePlanV2(set, { async }), null, 2); } catch (e) { return "refused: " + (e as Error).message; }
    };
    for (const file of ["App.rx", "App.tsx"]) assert.equal(out(file, true), out(file, false), "seed " + seed + " " + file);
  }
  // The v2 builder refuses the async program; the default TSX subset refuses its async primitives.
  const rx = emitCli("--schema", "2", fixture("rx"));
  assert.notEqual(rx.status, 0); assert.equal(rx.stdout, "");
  assert.match(rx.stderr, /host loadIssues must be declared fn loadIssues\(scalar…\): scalar/);
  assert.throws(() => loadTsxModules(fixture("tsx"), read), (e: unknown) => e instanceof TsxError && /outside the verified subset: affects/.test(e.message));
  // A version-2 scenario may not declare a structured host result.
  const dir = mkdtempSync(join(here("../.out/"), "async-v2-"));
  try {
    const s = JSON.parse(readFileSync(scenario, "utf8"));
    s.version = 2;
    writeFileSync(join(dir, "s.json"), JSON.stringify(s));
    assert.throws(() => loadScenario(join(dir, "s.json")), /host results are scalars before version 2.1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Forms v2.1 does not verify are refused, never emitted partially.
const rxSource = readFileSync(fixture("rx"), "utf8");
const tsxSource = readFileSync(fixture("tsx"), "utf8");
const loadRx = (text: string) => loadTsxModules(fixture("rx"), p => (p === fixture("rx") ? text : read(p)), { async: true });
const loadTsx = (text: string) => loadTsxModules(fixture("tsx"), p => (p === fixture("tsx") ? text : read(p)), { async: true });
test("plan v2.1: unsupported async shapes are refused by the builder and the TSX async tier", () => {
  for (const [from, to, error] of [
    ['loading fallback {', 'loading on(status) fallback {', /loading on\(…\) is outside plan v2.1/],
    ['<p>Could not load issues<button', '<p>{err.message}<button', /unresolved err/],
    ['errored fallback(err) {', 'errored fallback(status) {', /error name shadows a resolved name: status/],
    ['<em>{status}</em>', '<em>{status}</em><button onClick={() => { status := "" + issues.length }}>n</button>', /an async memo is read only in reactive contexts/],
    // The checker's own refusal (AC-4) is never turned into a plan.
    ['{ refresh issues }}>retry', '{ refresh status }}>retry', /"code":"INVALID_REFRESH_TARGET"/],
    ['affects issues;', 'affects status;', /refresh\/affects target an async memo in plan v2.1: status/],
    ['issues = await loadIssues();', 'issues = await loadIssues() -> [];', /an async memo is await host\(…\), without a first-paint value or a stream: issues/],
  ] as const) {
    const changed = rxSource.replace(from, to);
    assert.notEqual(changed, rxSource, from);
    assert.throws(() => resolvePlanV2(loadRx(changed), { async: true }), error, to);
  }
  // A refresh of a memo that is not async: the checker accepts it, plan v2.1 does not.
  const syncRefresh = rxSource.replace('source status := "";', 'source status := "";\n  count = issues.length;').replace('{ refresh issues }}>retry', '{ refresh count }}>retry');
  assert.throws(() => resolvePlanV2(loadRx(syncRefresh), { async: true }), /refresh targets an async memo in plan v2.1: count/);
  // TSX: Errored's reset and Loading's on have no RX spelling; a fallback may not read the error.
  for (const [from, to, error] of [
    ["fallback={(err) =>", "fallback={(err, reset) =>", /Errored's reset has no ReactiveScript spelling/],
    ['<p>Could not load issues<button', '<p>{err()}<button', /reading an Errored fallback's error is outside the verified subset/],
    ['<Loading fallback={<i>Loading issues…</i>}>', '<Loading on={status()} fallback={<i>Loading issues…</i>}>', /on is outside the verified subset/],
    ["refresh(issues);\n", "refresh(status);\n", /refresh takes an async memo/],
  ] as const) {
    const changed = tsxSource.replace(from, to);
    assert.notEqual(changed, tsxSource, from);
    assert.throws(() => loadTsx(changed), error, to);
  }
});
