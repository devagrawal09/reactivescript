// graph.mjs: each control-flow region gets its own header (`head`), read off the source. Nested boundaries must not
// borrow the catch of the boundary inside them (round-2: IssueDetail's outer `errored (e)` read as `e: NotFound`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, controlHeads } from "../graph.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const rxc = process.env.RXC ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync) ?? "rxc";

test("nested errored boundaries keep their own catch", () => {
  const model = JSON.parse(execFileSync(rxc, ["model", "fixtures/boundaries.rx"], { cwd: here, encoding: "utf8" }));
  const g = buildGraph(model, { root: here });
  const heads = g.regions.filter(r => r.kind === "errored" || r.kind === "loading").map(r => [r.kind, r.head?.text, r.head?.line]);
  assert.deepEqual(heads, [["errored", "errored (e)", 9], ["errored", "errored (e: NotFound)", 13], ["loading", "loading on(issueId)", 16]]);
});

test("controlHeads works from a graph and its lines alone", () => {
  const lines = ["{errored fallback(e) {", "  <p/>", "} {", "  {errored fallback(e: A | B) {", "    <p/>", "  } {", "    <h2>{x}</h2>", "  }}", "}}"];
  const g = {
    regions: [{ id: "r0", mod: 0, kind: "program" }, { id: "r1", mod: 0, kind: "errored", parent: "r0" }, { id: "r2", mod: 0, kind: "errored", parent: "r1" }],
    nodes: [{ id: "n", region: "r2", line: 7 }],
  };
  controlHeads(g, () => lines);
  assert.equal(g.regions[1].head.text, "errored (e)");
  assert.equal(g.regions[2].head.text, "errored (e: A | B)");
});
