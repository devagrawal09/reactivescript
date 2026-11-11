import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTests, checkFuzz, checkPlanFuzz, checkEvalFuzz, checkSsrFuzz, checkAsyncFuzz, checkFramesFuzz, type Row } from "../scripts/report.ts";
const row: Row = { file: "/tmp/work/tsx/a.test.ts", name: "one", status: "pass" };
const expected = ["tsx/a.test.ts :: one"];
const summary = "ℹ tests 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n";
test("verifier: the exact passing test set is accepted", () => {
  assert.deepEqual(checkTests([row], expected, summary), []);
});
test("verifier: a missing, duplicate, renamed, failed, or skipped test fails the gate", () => {
  for (const rows of [[], [row, row], [{ ...row, name: "renamed" }], [{ ...row, status: "fail" }], [{ ...row, status: "skip" }], [{ ...row, status: "todo" }]])
    assert.ok(checkTests(rows, expected, summary).length);
});
test("verifier: a missing or incomplete runner summary fails the gate", () => {
  for (const text of ["", summary.replace("tests 1", "tests 2"), summary.replace("skipped 0", "skipped 1"), summary.replace("cancelled 0", "cancelled 1")])
    assert.ok(checkTests([row], expected, text).length);
});
test("verifier: only listed upstream fuzz differences are informational", () => {
  const finding = { seed: 14, status: "divergent", classes: ["upstream: interpreter vs compiled"] };
  const run = { start: 0, seeds: 200, tally: { ok: 199, divergent: 1 }, findings: [finding] };
  assert.deepEqual(checkFuzz(run, [14]), []);
  assert.ok(checkFuzz(run, []).length);
  for (const classes of [["adapter"], ["semantics"], ["upstream: interpreter vs compiled", "adapter"]])
    assert.ok(checkFuzz({ ...run, findings: [{ ...finding, classes }] }, [14]).length);
  assert.ok(checkFuzz({ ...run, seeds: 199 }, [14]).length);
  assert.ok(checkFuzz({ ...run, findings: [{ seed: 1, status: "generator-bug" }] }, [14]).length);
});
test("verifier: the plan fuzz summary must be complete, divergence-free and match its baseline", () => {
  const upstreamClass = "upstream: RX optimistic source is a guess layer over a computed signal (AC-3)";
  const baseline = { start: 1, seeds: 10, agree: 7, refused: 2, refusals: ["unsupported operator *"], upstream: { classes: [upstreamClass], seeds: [4] } };
  const run = { start: 1, seeds: 10, total: 10, agree: 7, upstream: 1, divergent: 0, refused: 2, invalid: 0, "generator-bug": 0,
    classes: { [upstreamClass]: { count: 1, seeds: [4] } }, refusals: { "unsupported operator *": { count: 2, seeds: [2, 9] } } };
  assert.deepEqual(checkPlanFuzz(run, baseline), []);
  for (const change of [
    { seeds: 9 }, { total: 9 }, { divergent: 1 }, { invalid: 1 }, { "generator-bug": 1 }, { agree: 6 }, { refused: 3 }, { upstream: 2 },
    { refusals: { "unsupported operator -": { count: 2, seeds: [2, 9] } } },
    { classes: { [upstreamClass]: { count: 1, seeds: [5] } } },
    { classes: { "plan: insertNode-getFirstChild": { count: 1, seeds: [4] } } },
  ]) assert.ok(checkPlanFuzz({ ...run, ...change }, baseline).length, JSON.stringify(change));
});
test("verifier: the eval fuzz summary must be complete, divergence-free and match its baseline", () => {
  const baseline = { start: 1, seeds: 10, agree: 8, refused: 2, refusals: ["eval refused: PLAN: unsupported operator *"] };
  const run = { start: 1, seeds: 10, total: 10, agree: 8, divergent: 0, refused: 2, invalid: 0, "generator-bug": 0, classes: {},
    refusals: { "eval refused: PLAN: unsupported operator *": { count: 2, seeds: [4, 6] } } };
  assert.deepEqual(checkEvalFuzz(run, baseline), []);
  for (const change of [
    { seeds: 9 }, { total: 9 }, { divergent: 1 }, { invalid: 1 }, { "generator-bug": 1 }, { agree: 7 }, { refused: 3 },
    { refusals: { "eval refused: UNBOUND (line 1): x": { count: 2, seeds: [4, 6] } } },
    { classes: { "rust: host log": { count: 1, seeds: [3] } } },
  ]) assert.ok(checkEvalFuzz({ ...run, ...change }, baseline).length, JSON.stringify(change));
});
test("verifier: the SSR fuzz summary must be complete, free of differences and match its baseline", () => {
  const refusal = "refused: unsupported operator *";
  const baseline = { start: 1, seeds: 10, agree: 8, refused: 2, refusals: [refusal] };
  const run = { start: 1, seeds: 10, total: 10, dev: true, agree: 8, html: 0, hydration: 0, "ssr-refused": 0, refused: 2, invalid: 0, "generator-bug": 0,
    refusals: { [refusal]: { count: 2, seeds: [4, 6] } } };
  assert.deepEqual(checkSsrFuzz(run, baseline), []);
  for (const change of [
    { seeds: 9 }, { total: 9 }, { dev: false }, { html: 1 }, { hydration: 1 }, { "ssr-refused": 1 }, { invalid: 1 }, { "generator-bug": 1 },
    { agree: 7 }, { refused: 3 }, { refusals: { "ssr-refused: a text hole whose type is not known statically": { count: 1, seeds: [3] } } },
  ]) assert.ok(checkSsrFuzz({ ...run, ...change }, baseline).length, JSON.stringify(change));
});
test("verifier: a plan v2.1 fuzz summary must be complete, divergence-free and match its baseline; rust-unsupported is counted apart", () => {
  const unsupported = "rust-unsupported: plan-trace refuses plan version 2.1";
  const baseline = { start: 1, seeds: 10, agree: 0, "rust-unsupported": 8, refused: 2, refusals: ["unsupported operator *"], classes: [unsupported] };
  const run = { schema: "2.1", start: 1, seeds: 10, total: 10, agree: 0, upstream: 0, divergent: 0, refused: 2, invalid: 0, "generator-bug": 0, "rust-unsupported": 8,
    classes: { [unsupported]: { count: 8, seeds: [1, 2] } }, refusals: { "unsupported operator *": { count: 2, seeds: [3, 9] } } };
  assert.deepEqual(checkAsyncFuzz("plan fuzz v2.1", run, baseline), []);
  for (const change of [
    { schema: undefined }, { seeds: 9 }, { total: 9 }, { divergent: 1 }, { invalid: 1 }, { "generator-bug": 1 }, { upstream: 1 },
    // A program counted as agreement instead of rust-unsupported (or the reverse) is a change of the baseline.
    { agree: 1, "rust-unsupported": 7 }, { refused: 3 },
    { refusals: { "unsupported operator -": { count: 2, seeds: [3, 9] } } },
    { classes: { "plan: request-step": { count: 1, seeds: [4] } } },
  ]) assert.ok(checkAsyncFuzz("plan fuzz v2.1", { ...run, ...change }, baseline).length, JSON.stringify(change));
});
test("verifier: the placement fuzz summary must be complete with the Rust leg, match its baseline, and diverge only on its listed seeds", () => {
  const baseline = { start: 1, seeds: 10, agree: 5, "client-only": 3, refused: 1, refusals: ["FRAMES_CHILDREN"],
    divergent: { "4": { issue: "a suspected Solid issue", classes: ["J: frame", "N: frame"] } } };
  const run = { start: 1, seeds: 10, total: 10, rust: true, agree: 5, "client-only": 3, refused: 1, divergent: 1, invalid: 0, "generator-bug": 0,
    refusals: { FRAMES_CHILDREN: 1 }, classes: { "J: frame": 1, "N: frame": 1 }, divergentSeeds: [4] };
  assert.deepEqual(checkFramesFuzz(run, baseline), []);
  for (const change of [
    { seeds: 9 }, { total: 9 }, { rust: false }, { invalid: 1 }, { "generator-bug": 1 },
    { agree: 4, "client-only": 4 }, { refused: 2 }, { refusals: { FRAMES_WIRE_TYPE: 1 } },
    // A new divergent seed, a listed one that no longer diverges, and an unlisted class all fail.
    { divergentSeeds: [4, 7] }, { divergentSeeds: [] }, { classes: { "R/N: wire": 1 } },
  ]) assert.ok(checkFramesFuzz({ ...run, ...change }, baseline).length, JSON.stringify(change));
});
