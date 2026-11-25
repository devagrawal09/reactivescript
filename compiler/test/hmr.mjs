import assert from "node:assert/strict";
import { test } from "node:test";
import { planHmr, prepareCarry, finishCarry } from "../hmr.mjs";

const file = "main.rx", key = `${file}|Row|value`;
const graph = sites => ({
  nodes: [{ id: "s", key, file, kind: "source", name: "value", line: 1 }],
  modules: [file], edges: [],
  lines: { [file]: { 1: "source value := 0" } },
  regions: sites.map(key => ({ kind: "children", name: "Row", key })),
});
const readers = (...values) => new Map([[key, new Set(values.map(value => ({
  ownerPath: ["<App>", "<Row>"], hmrValue: () => ({ value }),
}))) ]]);

test("repeated sources at one unchanged site pair by mount order", () => {
  const g = graph(["row"]);
  const frame = prepareCarry(g, g, planHmr(g, g), readers(3, 7), new Set([file]));
  const group = frame.carry.get(key);
  assert.deepEqual(group.entries.map(seed => seed.value), [3, 7]);
  group.used = 2;
  assert.deepEqual(finishCarry(frame, readers(3, 7)), []);
  assert.deepEqual(finishCarry(frame, readers(3)), [key]);
});

test("repeated sources at ambiguous or edited sites are not paired", () => {
  for (const [g, next] of [[graph(["row", "other"]), graph(["row", "other"])], [graph(["row"]), graph(["other"])]]) {
    const frame = prepareCarry(g, next, planHmr(g, next), readers(3, 7), new Set([file]));
    assert.equal(frame.carry.size, 0);
    assert.deepEqual([...frame.fallback], [key]);
  }
});
