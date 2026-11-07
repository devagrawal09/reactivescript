import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { semanticFacts } from "../tsx/rx/facts.ts";
import { loadFixture, runScenario, type Leg } from "./run-js.ts";

const like = fileURLToPath(new URL("./like/like.scenario.json", import.meta.url));

test("like: TSX, RX and yield have equal canonical facts", () => {
  const facts = (["tsx", "rx", "yield"] as const).map(leg => semanticFacts(loadFixture(like, leg)));
  for (const f of facts) assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(facts[0], facts[1]);
  assert.deepEqual(facts[2], facts[1]);
  const computations = facts[0].modules[0].computations;
  assert.deepEqual(computations.find(c => c.kind === "question")?.reads,
    ["/program/component:Like::source:likes tracked"]);
  const handler = computations.find(c => c.kind === "handler");
  assert.deepEqual(handler?.writes, ["/program/component:Like::source:shown? optimistic", "/program/component:Like::source:likes write"]);
  assert.deepEqual(handler?.calls, ["/program::import:save!io"]);
});

test("like: snapshotting the optimistic base is a detected fact change", () => {
  const rx = readFileSync(new URL("./like/like.rx", import.meta.url), "utf8");
  const changed = rx.replace("source shown = likes;", "source shown = peek likes;");
  assert.notEqual(changed, rx);
  assert.notDeepEqual(semanticFacts(loadFixture(like, "rx", changed)), semanticFacts(loadFixture(like, "rx")));
});

test("like: optimistic bodies keep unsupported routines outside the subset", () => {
  const source = readFileSync(new URL("./like/like.yield.tsx", import.meta.url), "utf8");
  const body = "function* () { return yield* likes; }";
  for (const [replacement, error] of [
    ["async function* () { return yield* likes; }", /never async/],
    ["function* (n: number) { return yield* likes; }", /takes no parameters/],
    ["function* () { const n = 1; return yield* likes; }", /one synchronous expression/],
    ["() => likes", /takes a function\*/],
  ] as const) {
    const changed = source.replace(body, replacement);
    assert.notEqual(changed, source);
    assert.throws(() => loadFixture(like, "yield", changed), error);
  }
});

const inferred = fileURLToPath(new URL("./like/s-infer-1.scenario.json", import.meta.url));
for (const leg of ["native", "rx"] as const) {
  test("upstream S-infer-1 frames: " + leg, async () => {
    assert.deepEqual(await runScenario(inferred, leg), ["no ", "yes ", "yes "]);
  });
}

for (const [label, leg] of [["native Solid", "native"], ["compiled TSX", "tsx"], ["compiled RX", "rx"], ["compiled yield", "yield"]] as const) {
  test("like frames: " + label, async () => {
    assert.deepEqual(await runScenario(like, leg as Leg), ["0", "1", "0", "1", "1"]);
  });
}
