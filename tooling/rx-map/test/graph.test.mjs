// graph.mjs: each control-flow region gets its own header (`head`), read off the source. Nested boundaries must not
// borrow the catch of the boundary inside them (round-2: IssueDetail's outer `errored (e)` read as `e: NotFound`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, controlHeads } from "../graph.mjs";
import { diffGraphs } from "../diff.mjs";
import { queryDiff, queryGraph } from "../query.mjs";

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

test("view outlines keep text and original site and region references", () => {
  const model = JSON.parse(execFileSync(rxc, ["model", "fixtures/outline.rx"], { cwd: here, encoding: "utf8" }));
  const g = buildGraph(model, { root: here });
  const app = g.regions.find(r => r.name === "App");
  assert.deepEqual(app.outline.slice(0, 3).map(p => p.text ?? (p.site && g.nodes.find(n => n.id === p.site).name)), ["Clicks: ", "{…}", " & 2!"]);
  assert.ok(app.outline.some(p => p.text === "More text © &notit; on two lines."));
  assert.ok(app.outline.some(p => p.br));
  assert.deepEqual(app.outline.filter(p => p.attr).map(p => [p.attr, p.text]), [
    ["placeholder", 'Enter "name"'], ["title", "A title"], ["aria-label", "The count"], ["alt", "Picture ©"], ["value", "42"],
  ]);
  assert.doesNotMatch(JSON.stringify(g.regions.map(r => r.outline)), /DO NOT INCLUDE|color: red|elsewhere/);
  assert.doesNotMatch(JSON.stringify(app.outline), /Milestone reached|Keep going|Hello|Given by caller|Wait a moment/);
  for (const [kind, text] of [["then", "Milestone reached:"], ["else", "Keep going!"], ["for", "Hello"], ["errored", "Wait a moment"], ["loading", "Ready:"], ["children", "Given by caller"]]) {
    const region = g.regions.find(r => r.kind === kind);
    const parent = g.regions.find(r => r.id === region.parent);
    assert.ok(region.outline.some(p => p.text?.includes(text)), kind);
    assert.ok(parent.outline.some(p => p.region === region.id), kind);
  }
  for (const r of g.regions) for (const p of r.outline) {
    if (p.site) assert.ok(g.nodes.some(n => n.id === p.site && n.region === r.id));
    if (p.region) assert.ok(g.regions.some(child => child.id === p.region && child.parent === r.id));
  }
  const count = g.nodes.find(n => n.name === "count");
  assert.match(queryGraph(g, "node", { key: count.key }).text, /view: Clicks:/);
  const loading = g.regions.find(r => r.kind === "loading");
  assert.match(queryGraph(g, "boundary", { key: loading.key }).text, /view: Ready:/);
  const edited = structuredClone(g);
  edited.regions.find(r => r.id === app.id).outline[0].text = "Total: ";
  const diff = diffGraphs(g, edited);
  assert.equal(diff.regions.find(r => r.id === app.id).status, "changed");
  assert.match(queryDiff(diff).text, /text changed fixtures\/outline\.rx/);
  assert.equal(diffGraphs(g, g).regions.find(r => r.id === app.id).status, "same");
});
