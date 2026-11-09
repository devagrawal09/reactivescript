// Slice 2: the tracker contract (docs/SCENARIO-FORMAT.md, version 2). The same tracker in TSX, RX and yield must have
// equal canonical facts, and native Solid plus all three compiled frontends must render the scenario's exact frames.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { semanticFacts } from "../tsx/rx/facts.ts";
import { loadYieldModules, YieldError } from "../yield/lower.ts";
import { loadFixture, loadScenario, runScenario, type Leg } from "./run-js.ts";

const tracker = fileURLToPath(new URL("./tracker/tracker.scenario.json", import.meta.url));
const expected = (path: string) => (JSON.parse(readFileSync(path, "utf8")).steps as { frame: string }[]).map(s => s.frame);
const outRoot = fileURLToPath(new URL("../.out/", import.meta.url));
/** A changed copy of the tracker scenario in a scratch directory, with the native fixture beside it. */
let scratch: string | undefined;
function variant(change: (s: any) => void): string {
  mkdirSync(outRoot, { recursive: true });
  scratch ??= mkdtempSync(outRoot + "tracker-variant-");
  cpSync(fileURLToPath(new URL("./tracker/tracker.tsx", import.meta.url)), scratch + "/tracker.tsx");
  const s = JSON.parse(readFileSync(tracker, "utf8"));
  change(s);
  writeFileSync(scratch + "/variant.scenario.json", JSON.stringify(s));
  return scratch + "/variant.scenario.json";
}
const removeVariant = () => { if (scratch) rmSync(scratch, { recursive: true, force: true }); scratch = undefined; };

test("tracker: TSX, RX and yield have equal canonical facts", () => {
  const facts = (["tsx", "rx", "yield"] as const).map(leg => semanticFacts(loadFixture(tracker, leg)));
  for (const f of facts) assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(facts[0], facts[1]);
  assert.deepEqual(facts[2], facts[1]);
  const m = facts[0].modules[0];
  const C = "/program/component:Tracker::";
  assert.ok(m.symbols.includes(C + "action:claim!io"), "claim is a declared action in every frontend");
  const computations = m.computations;
  assert.deepEqual(computations.find(c => c.kind === "question")?.reads, [C + "source:issues tracked.list"], "the optimistic list tracks the store list");
  assert.deepEqual(computations.find(c => c.kind === "memo" && c.name === "visible")?.reads, [C + "source:shown? tracked", C + "source:mode tracked"]);
  const claim = computations.find(c => c.kind === "action" && c.name === "claim");
  assert.deepEqual(claim?.writes, [C + "source:shown? optimistic", C + "source:issues write path", C + "source:status write"]);
  assert.deepEqual(claim?.calls, ["/program::import:assignIssue!io"]);
  const row = computations.find(c => c.kind === "handler" && c.region === "/program/component:Tracker/then/for");
  assert.deepEqual(row?.calls, [C + "action:claim!io"], "each row's button calls claim");
});

test("tracker: snapshotting the filter in the RX is a detected fact change", () => {
  const rx = readFileSync(new URL("./tracker/tracker.rx", import.meta.url), "utf8");
  const changed = rx.replace('issue => mode == "all"', 'issue => peek(mode) == "all"');
  assert.notEqual(changed, rx);
  assert.notDeepEqual(semanticFacts(loadFixture(tracker, "rx", changed)), semanticFacts(loadFixture(tracker, "rx")));
});

for (const [label, leg] of [["native Solid", "native"], ["compiled TSX", "tsx"], ["compiled RX", "rx"], ["compiled yield", "yield"]] as const) {
  test("tracker frames: " + label, async () => {
    assert.deepEqual(await runScenario(tracker, leg as Leg), expected(tracker));
  });
}

test("scenario v2: v1 files validate unchanged; malformed v2 steps are refused", () => {
  for (const v1 of ["./like/like.scenario.json", "./like/s-infer-1.scenario.json"]) assert.equal(loadScenario(fileURLToPath(new URL(v1, import.meta.url))).version, 1);
  try {
    for (const [change, message] of [
      [(s: any) => { s.version = 3; }, /version 1 or 2/],
      [(s: any) => { s.steps[1].element = 0; }, /element or target, not both/],
      [(s: any) => { s.steps[1].target.row = "1"; }, /target fields/],
      [(s: any) => { s.steps[1].target.index = -1; }, /target index/],
      [(s: any) => { delete s.steps[3].args; }, /args match/],
      [(s: any) => { s.steps[3].args = ["3"]; }, /Expected values to be strictly equal/],
      [(s: any) => { s.version = 1; }, /click targets are version 2/],
      [(s: any) => { s.version = 1; s.steps = s.steps.filter((x: any) => x.type !== "click"); }, /args are version 2/],
    ] as const) assert.throws(() => loadScenario(variant(change)), message);
  } finally { removeVariant(); }
});

test("scenario v2: a wrong request argument or a missing target fails the run", async () => {
  try {
    await assert.rejects(runScenario(variant(s => { s.steps[3].args = [1]; }), "native"), /call #2 arguments/);
    await assert.rejects(runScenario(variant(s => { s.steps[2].target.parent = "Typo in footer: metake"; }), "native"), /0 match/);
    await assert.rejects(runScenario(variant(s => { s.steps[1].target.index = 1; }), "native"), /1 match/);
  } finally { removeVariant(); }
});

const yieldSource = readFileSync(new URL("./tracker/tracker.yield.tsx", import.meta.url), "utf8");
const API: Record<string, string> = { "api.d.rx": "export fn assignIssue(id: number): string" };
const refused = (source: string, at: string, message: RegExp) => {
  assert.ok(source.includes(at), "the refusal site exists: " + at);
  assert.throws(() => loadYieldModules("main.tsx", p => (p === "main.tsx" ? source : API[p])), (error: unknown) => {
    assert.ok(error instanceof YieldError, String(error));
    assert.equal(error.start, source.indexOf(at), "refused at " + at + ": " + error.message);
    assert.match(error.message, message);
    return true;
  });
};
test("yield rows: row events and called actions stay inside the subset; other forms are refused at their source", () => {
  const take = "const take = $event(function* () { yield* claim(yield* issue.id); });";
  assert.ok(yieldSource.includes(take));
  refused(yieldSource.replace(take, take + "\n                const [n, setN] = yield* $signal(0);"), "const [n, setN]", /row-owned state is not in the yield subset/);
  refused(yieldSource.replace(take, "const take = $event(function* (n: number) { yield* claim(n); });"), "function* (n: number)", /takes no parameters/);
  const reset = 'const reset = $event(function* () { yield* setShown((list) => list); });\n  const toggle = $event(function* () {';
  const both = yieldSource.replace("const toggle = $event(function* () {", reset + " yield* reset();")
    .replace("<button onClick={yield* toggle}>", "<button onClick={yield* reset}>x</button><button onClick={yield* toggle}>");
  refused(both, "reset}>x", /either bound\/passed or called as an action/);
  refused(yieldSource.replace("const toggle = $event(function* () {", reset + " yield* setShown((list) => list); yield* reset();"), "reset();", /nested actions are not verified/);
  refused(yieldSource.replace(take, take + "\n                const again = $event(function* () { yield* take(); });"), "take();", /bound in its row's view, not called/);
});
