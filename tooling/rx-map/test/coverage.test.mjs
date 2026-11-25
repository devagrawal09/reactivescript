import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../graph.mjs";
import { createMcp } from "../mcp.mjs";
import { collectBrowserCoverage, createCollector, ignored, merge, rebase, report, rxCoverage, summary, uncovered, universe,
  untyped, untypedFailures } from "../coverage.mjs";
import { rxMap } from "../vite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const rxc = process.env.RXC ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync) ?? "rxc";
const module = "fixtures/coverage.rx";
const fixture = name => JSON.parse(readFileSync(join(here, "fixtures", `${name}.json`), "utf8"));
const built = new Map();
const graphOf = file => built.get(file) ?? built.set(file, buildGraph(
  JSON.parse(execFileSync(rxc, ["model", file], { cwd: here, encoding: "utf8" })), { root: here })).get(file);
const graph = () => graphOf(module);
const key = name => graph().nodes.find(n => n.name === name).key;
const region = kind => graph().regions.find(r => r.kind === kind).key;
const counts = g => Object.fromEntries(Object.entries(summary(rebase(merge(), g))).filter(([, v]) => typeof v === "object")
  .map(([k, v]) => [k, v.total]));
const ids = g => universe(g).map(p => p.id);

test("universe covers tracked dependencies, each live arm and each optimistic outcome", () => {
  assert.deepEqual(counts(fixture("tracker")), { node: 28, edge: 17, loading: 5, errored: 8, guess: 0, action: 9, all: 67 });
  assert.deepEqual(counts(fixture("users")), { node: 8, edge: 5, loading: 1, errored: 1, guess: 6, action: 3, all: 24 });
  const g = graph(), paths = universe(g);
  assert.deepEqual(paths.map(x => x.id), paths.map(x => x.id).sort());
  // rename's and reload's catch-alls take every declared class: only `ok` is left of each action (v0.3)
  assert.deepEqual(counts(g), { node: 3, edge: 2, loading: 1, errored: 2, guess: 3, action: 2, all: 13 });
  assert.match(g.nodes.find(n => n.name === "save").decl.line, /rejects\(NotFound \| Conflict\)/);
  assert.ok(g.edges.some(e => e.type === "write" && e.op === "optimistic"));
  assert.deepEqual(paths.find(p => p.id === `errored:${region("errored")}:NotFound`),
    { id: `errored:${region("errored")}:NotFound`, kind: "errored", module, line: 18,
      label: "errored (e) shows its NotFound fallback", target: region("errored") });
  const dead = structuredClone(g);
  const arms = dead.regions.find(r => r.kind === "errored").arms;
  assert.deepEqual(arms.at(-1), { cls: "_", line: 20, dead: true });
  assert.ok(!ids(dead).includes(`errored:${region("errored")}:_`));
  const read = dead.edges.find(e => e.type === "read" && e.mode === "tracked");
  read.probe = "pending";
  assert.equal(counts(dead).edge, 1);
});

test("collector classifies boundaries, action and guess outcomes, and node and edge changes", () => {
  const page = key("page"), users = key("users"), label = key("label"), rename = key("rename");
  const loading = region("loading"), errored = region("errored"), pair = `${rename}->${users}`;
  const c = createCollector({ graphs: [graph()], tool: "test" });
  const f = c.feed;
  c.begin("a test");
  f({ type: "flush", seq: 1, changes: [{ key: page + "~i2", preview: "1" }] });
  assert.deepEqual(c.result().hits, {});
  f({ type: "flight", key: users, state: "start" });
  f({ type: "flight", key: users, state: "land" });
  f({ type: "flush", seq: 2, changes: [{ key: users, preview: "A" }, { key: label, preview: "A!" }] });
  assert.equal(c.result().hits[`node:${users}`].n, 1);
  assert.equal(c.result().hits[`node:${label}`], undefined);
  f({ type: "step", changes: [{ key: page, preview: "2" }] });
  f({ type: "resume", changes: [{ key: page, preview: "2" }] });
  f({ type: "hmr", phase: "done", changes: [{ key: page, preview: "2" }] });
  f({ type: "flush", seq: 3, changes: [{ key: page, preview: "1" }] });
  assert.equal(c.result().hits[`node:${page}`], undefined);
  f({ type: "flush", seq: 4, origin: "hmr 2", changes: [{ key: page, preview: "2" }] });
  assert.equal(c.result().hits[`node:${page}`], undefined);
  f({ type: "flush", seq: 5, order: [users, page], changes: [{ key: users, preview: "B" }, { key: page, preview: "3" }] });
  assert.equal(c.result().hits[`edge:${page}->${users}`], undefined);
  f({ type: "flight", key: users, state: "start", cause: [{ key: page + "~i2" }] });
  f({ type: "flush", seq: 6, order: [page, users, label], changes: [
    { key: page, preview: "4" }, { key: users, error: "NotFound: failed" }, { key: label, preview: "C!" },
  ] });
  f({ type: "snapshot", boundaries: [{ region: loading, state: "fallback" }, { region: errored, state: "error" }] });
  assert.equal(c.result().hits[`errored:${errored}:NotFound`], undefined);
  f({ type: "boundary", region: errored, state: "ok" });
  f({ type: "boundary", region: errored, state: "error", error: "NotFound: missing" });
  f({ type: "boundary", region: errored, state: "error", error: "Conflict: busy" });
  for (const [id, outcome] of [[1, "confirmed"], [2, "reverted"], [3, "superseded"]]) {
    f({ type: "run", key: rename, id, state: "start" });
    f({ type: "held", key: users });
    if (outcome !== "confirmed") f({ type: "revert", key: users, reason: outcome });
    f({ type: "run", key: rename, id, state: id === 2 ? "error" : "end", error: "NotFound: missing" });
  }
  f({ type: "run", key: rename, id: 4, state: "error", error: "Conflict: busy" });
  f({ type: "run", key: rename, id: 5, state: "error", error: "Unlisted: ignored" });
  f({ type: "run", key: key("reload"), id: 6, state: "end" });
  c.end({ failed: true, error: "oops" });
  assert.deepEqual(uncovered(c.result()), []);
  for (const outcome of ["confirmed", "reverted", "superseded"])
    assert.deepEqual(c.result().hits[`guess:${pair}:${outcome}`], { n: 1, by: ["a test"] });
  assert.equal(c.result().hits[`edge:${page}->${users}`].n, 2);
  assert.equal(c.result().runs[0].failed, 1);
  assert.equal(c.result().runs[0].tests, 1);
  assert.equal(c.trace().error, "oops");
  assert.equal(c.trace().messages[0].seq, 1);
  assert.equal(c.trace(5).messages[0].seq, 5);
  assert.deepEqual(c.trace(100).messages, []);
});

test("snapshot, first previous value, release, and reset", () => {
  const graphs = [];
  const c = createCollector({ graphs, tool: "test" });
  graphs.push(graph());
  const users = key("users"), rename = key("rename"), page = key("page");
  const pair = `${rename}->${users}`;
  c.feed({ type: "snapshot", values: [{ key: page, preview: "0" }],
    runs: [{ key: rename, id: 1 }], held: [{ key: users }] });
  c.feed({ type: "released", key: users });
  c.feed({ type: "run", key: rename, id: 1, state: "end" });
  c.feed({ type: "flush", changes: [{ key: users, prev: "A", preview: "B" }, { key: page, preview: "1" }] });
  c.feed({ type: "reset" });
  c.feed({ type: "flush", changes: [{ key: page, preview: "0" }] });
  assert.deepEqual(c.result().hits[`guess:${pair}:confirmed`], { n: 1, by: [] });
  assert.equal(c.result().hits[`edge:${page}->${users}`].n, 1);
  assert.equal(c.result().hits[`node:${page}`].n, 1);
});

test("boundary state names the selected arm, with an error-preview fallback for old traces", () => {
  const region = "app||errored";
  const arms = [{ cls: "Conflict", line: 3 }, { cls: "Offline", line: 4 }, { cls: "_", line: 5 }];
  const graph = { modules: ["app.rx"], nodes: [], edges: [], regions: [{ mod: 0, id: "b", key: region, kind: "errored", arms }] };
  const c = createCollector({ graphs: [graph] });
  const error = (error, extra) => ({ region, state: "error", error, ...extra });
  c.feed({ type: "snapshot", boundaries: [error("Offline: lost", { arm: "Conflict" })] });
  c.feed({ type: "boundary", ...error("Offline: lost") });
  c.feed({ type: "boundary", ...error("Panic: unexpected") });
  assert.deepEqual(Object.keys(c.result().hits).sort(), ["Conflict", "Offline", "_"].map(a => `errored:${region}:${a}`));
  arms[2].dead = true;
  const noDefault = createCollector({ graphs: [graph] });
  noDefault.feed({ type: "boundary", ...error("Conflict: derived", { arm: "_" }) });
  assert.deepEqual(noDefault.result().hits, {});
});

test("store settle diagnostics distinguish confirmed, superseded, and rejected runs", () => {
  const keyForRun = key("rename"), users = key("users"), pair = `${keyForRun}->${users}`;
  const c = createCollector({ graphs: [graph()], tool: "test" });
  const run = (id, state) => c.feed({ type: "run", id, key: keyForRun, state, origin: "action rename" });
  const revert = id => c.feed({ type: "revert", key: users, reason: "superseded", runId: id, origin: "action rename" });
  c.begin("settle");
  run(1, "start"); run(1, "end"); revert(1); revert(1);
  assert.deepEqual(c.result().hits[`guess:${pair}:confirmed`], { n: 1, by: ["settle"] });
  assert.equal(c.result().hits[`guess:${pair}:superseded`], undefined);
  run(2, "start"); revert(2); run(2, "end");
  run(3, "start"); revert(3); run(3, "error");
  run(4, "start"); run(4, "error"); revert(4);
  run(5, "start");
  c.feed({ type: "flush", changes: [{ key: users, preview: "['Anne']" }] });
  revert(5);
  c.feed({ type: "flush", changes: [{ key: users, preview: "['Anne']" }] });
  run(5, "end");
  c.end();
  assert.deepEqual(c.result().hits[`guess:${pair}:confirmed`], { n: 2, by: ["settle"] });
  assert.deepEqual(c.result().hits[`guess:${pair}:superseded`], { n: 1, by: ["settle"] });
  assert.deepEqual(c.result().hits[`guess:${pair}:reverted`], { n: 2, by: ["settle"] });
});

test("merge laws, deterministic attribution cap, stale report, and rebase", () => {
  const id = `node:${key("users")}`, base = rebase(merge(), graph());
  const run = (offset, n) => ({ ...base, hits: { [id]: { n,
    by: Array.from({ length: 8 }, (_, i) => `name-${String(i + offset).padStart(2, "0")}`) } }, runs: [{ tool: "test", tests: n }] });
  const a = run(8, 2), b = run(0, 3), c = run(4, 1);
  assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
  assert.deepEqual({ ...merge(a, b, c), runs: [] }, { ...merge(c, b, a), runs: [] });
  assert.deepEqual(merge(a, b, c).hits[id], { n: 6, by: b.hits[id].by });
  const stale = merge(a, { ...merge(), hits: { invalid: { n: 1, by: [] } } });
  assert.match(report(stale), /stale: invalid/);
  assert.equal(rebase(stale, graph()).hits.invalid, undefined);
  assert.deepEqual(rebase(merge(), graph()).paths, base.paths);
});

test("report uses reviewer wording and filters the uncovered list", () => {
  const file = rebase(merge(), graph()), text = report(file);
  for (const line of [
    /fixtures\/coverage.rx:18 +no test makes errored \(e\) show its NotFound fallback/,
    /fixtures\/coverage.rx:5 +no test changes users/,
    /fixtures\/coverage.rx:5 +no test carries a change from page to users/,
    /fixtures\/coverage.rx:22 +no test shows loading on\(page\)/,
    /fixtures\/coverage.rx:8 +no test sees rename's guess on users reverted/,
    /fixtures\/coverage.rx:8 +no test makes rename succeed/,
    /Program total +0\/3 +0\/2 +0\/1 +0\/2 +0\/3 +0\/2 +0\/13/,
    /Untyped failures \(not in the percentage\):\n  `load` \(fixtures\/coverage-api.d.rx:5\) can fail with an untyped error — declare its `rejects\(…\)` in fixtures\/coverage-api.d.rx/,
  ]) assert.match(text, line);
  assert.doesNotMatch(text, /reject with/);
  assert.deepEqual(uncovered(file, { module, limit: 1 }).map(p => p.kind), ["errored"]);
  assert.deepEqual(JSON.parse(report(file, { module, kind: "edge", json: true })).uncovered.map(p => p.kind), ["edge", "edge"]);
});

test("untyped failures are not paths; a declared rejection, `Error` included, is", () => {
  const g = graph(), reload = key("reload");
  assert.deepEqual(untypedFailures(g), [{ id: key("load"), callee: "load", file: "fixtures/coverage-api.d.rx", line: 5, fix: "d.rx",
    actions: ["reload"], modules: [module] }]);
  // without its catch-all, reload rejects with purge's deliberate `rejects(Error)`; load's defaulted Error is no path
  const open = structuredClone(g);
  delete open.nodes.find(n => n.name === "reload").catches;
  assert.deepEqual(ids(open).filter(id => id.startsWith(`action:${reload}`)), [`action:${reload}:ok`, `action:${reload}:rejected:Error`]);
  // a TS module's defaulted declaration: untyped, fixed with @reactivescript/js
  const load = open.nodes.find(n => n.name === "load");
  load.decl = { line: "export fn load(page: number): Promise<string>", from: "src/api.ts", origin: "default", helpers: [], at: 12 };
  const file = rebase(merge(), open);
  assert.match(report(file), /`load` \(src\/api.ts:12\) can fail with an untyped error — declare `rejects\(\[\.\.\.\], fn\)` with @reactivescript\/js/);
  assert.equal(summary(file).untyped, 1);
  // a `rejects([…], fn)` helper types it
  load.decl = { ...load.decl, origin: "helper", helpers: ["rejects"], line: "export fn load(page: number): Promise<string> rejects(NotFound)" };
  assert.deepEqual(untypedFailures(open), []);
  assert.ok(ids(open).includes(`action:${reload}:rejected:NotFound`));
  // so does the import's own `fails` (MO-11e narrows a defaulted fact)
  load.decl = { ...load.decl, origin: "default", helpers: [], line: "export fn load(page: number): Promise<string>" };
  open.lines[module][load.line] += " fails Conflict";
  assert.deepEqual(untypedFailures(open), []);
  assert.ok(ids(open).includes(`action:${reload}:rejected:Conflict`));
  // a plain call into JS is no failure (R-f-2): nothing to type; an awaited one is, declared Promise or not
  open.lines[module][load.line] = open.lines[module][load.line].replace(" fails Conflict", "");
  load.decl.line = "export fn load(page: number): string";
  assert.deepEqual(untypedFailures(open).map(u => u.callee), ["load"]);
  for (const [n, text] of Object.entries(open.lines[module])) open.lines[module][n] = text.replace("await load(", "void load(");
  assert.deepEqual(untypedFailures(open), []);
  // an undeclared JS import (no .d.rx, no TS module) that the action awaits: located at its import
  delete load.decl;
  for (const [n, text] of Object.entries(open.lines[module])) open.lines[module][n] = text.replace("void load(", "await load(");
  assert.deepEqual(untypedFailures(open), [{ id: key("load"), callee: "load", file: module, line: load.line, fix: "js",
    actions: ["reload"], modules: [module] }]);
});

test("an action's own catches fold into its outcomes", () => {
  const rename = key("rename"), rejected = g => ids(g).filter(id => id.startsWith(`action:${rename}:rejected:`));
  const g = structuredClone(graph()), node = g.nodes.find(n => n.name === "rename");
  assert.deepEqual(node.catches, [{ classes: null }]);
  assert.deepEqual(rejected(g), []);
  node.catches = [{ classes: ["NotFound"] }];
  assert.deepEqual(rejected(g), [`action:${rename}:rejected:Conflict`]);
  node.catches = [{ classes: ["NotFound"] }, { classes: ["Conflict"] }];
  assert.deepEqual(rejected(g), []);
  node.catches = [
    { classes: ["NotFound"], arms: [{ cls: "NotFound", line: 11 }] },
    { classes: null },
    { classes: null, arms: [{ cls: "NotFound", line: 15 }, { cls: "Conflict", line: 16 }, { cls: "_", line: 17 }] },
    { classes: null, arms: [{ cls: "_", line: 21, dead: true }] },
  ];
  const catchIds = ids(g).filter(id => id.startsWith(`action:${rename}:caught:`));
  assert.deepEqual(catchIds, [`action:${rename}:caught:Conflict:1`, `action:${rename}:caught:NotFound:0`,
    `action:${rename}:caught:NotFound:1`, `action:${rename}:caught:_:1`]);
  const c = createCollector({ graphs: [g] });
  c.feed({ type: "run", state: "start", id: 1, key: rename });
  c.feed({ type: "caught", key: rename, id: 1, site: 1, class: "NotFound", at: 1 });
  c.feed({ type: "caught", key: rename, id: 1, site: 1, class: "_", at: 2 });
  c.feed({ type: "caught", key: rename, id: 1, site: 2, class: "_", at: 3 });
  c.feed({ type: "run", state: "end", id: 1, key: rename });
  assert.equal(c.result().hits[catchIds[2]]?.n, 1);
  assert.equal(c.result().hits[catchIds[1]], undefined);
  assert.equal(c.result().hits[catchIds[3]]?.n, 1);
  assert.equal(c.result().hits[`action:${rename}:caught:_:2`], undefined);
  assert.equal(c.result().hits[`action:${rename}:ok`]?.n, 1);
  delete node.catches;   // a model without the field (an older rxc): v0.2's paths
  assert.deepEqual(rejected(g), [`action:${rename}:rejected:Conflict`, `action:${rename}:rejected:NotFound`]);
  // A class arm for NotFound doesn't take the deliberate `Error`.
  const reload = g.nodes.find(n => n.name === "reload");
  reload.catches = [{ classes: ["NotFound"] }];
  assert.ok(ids(g).includes(`action:${key("reload")}:rejected:Error`));
});

test("rx-coverage-ignore: a reason, an optional kind, warnings for the rest", () => {
  const file = rebase(merge(), graphOf("fixtures/coverage-ignore.rx")), m = "fixtures/coverage-ignore.rx";
  assert.deepEqual(ignored(file).map(p => [p.line, p.kind, p.ignored]), [
    [3, "node", "set once at boot"],
    [10, "edge", "its inputs are boot constants"], [10, "edge", "its inputs are boot constants"], [10, "edge", "its inputs are boot constants"],
    [14, "errored", "a 404 can't reach this page"], [15, "errored", "these inputs cannot conflict"],
  ]);
  // the kind selector: line 10's node (title) is not ignored, its edges are
  assert.deepEqual(uncovered(file).map(p => [p.line, p.kind]), [[5, "node"], [7, "node"], [10, "node"]]);
  const s = summary(file);
  assert.deepEqual([s.all, s.ignored], [{ covered: 0, total: 3 }, 6]);
  assert.deepEqual(Object.values(file.warnings).map(w => [w.line, w.message]), [
    [4, "rx-coverage-ignore errored matches no coverage path on line 5"],
    [6, "rx-coverage-ignore needs a reason (`// rx-coverage-ignore: why`): not honoured"],
    [8, "rx-coverage-ignore matches no coverage path on line 9"],
  ]);
  const text = report(file);
  assert.match(text, /Ignored \(not in the percentage\):\nfixtures\/coverage-ignore.rx:3 +a changes — ignored \(set once at boot\)/);
  assert.match(text, /fixtures\/coverage-ignore.rx:14 +errored \(e\) shows its NotFound fallback — ignored \(a 404 can't reach this page\)/);
  assert.match(text, /warning: fixtures\/coverage-ignore.rx:6 +rx-coverage-ignore needs a reason/);
  const json = JSON.parse(report(file, { json: true }));
  assert.equal(json.ignored.length, 6);
  assert.equal(json.warnings.length, 3);
  // the collector's own file carries them, and merge keeps them
  const c = createCollector({ graphs: [graphOf("fixtures/coverage-ignore.rx")], tool: "test" });
  const merged = merge(c.result(), rebase(merge(), graph()));
  assert.equal(ignored(merged, { module: m }).length, 6);
  assert.equal(Object.keys(merged.warnings).length, 3);
  assert.deepEqual(untyped(merged).map(u => u.callee), ["load"]);
  assert.deepEqual(merge(merged, merged).untyped, merged.untyped);
});

test("MCP rebases file on its served graph, filters by module and kind, and caps uncovered", async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-coverage-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const served = fixture("tracker"), result = rebase(merge(), served);
  const path = Object.values(result.paths).find(p => p.kind === "node");
  const dir = join(root, ".rx-coverage");
  mkdirSync(dir);
  writeFileSync(join(dir, "coverage.json"), JSON.stringify({ ...merge(), hits: { [path.id]: { n: 1, by: ["test"] } } }));
  const receive = createMcp({ root, getProject: () => ({ load: () => ({ graph: served }) }) });
  const call = async (name, args = {}) => {
    const { result } = await receive({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { format: "json", ...args } } });
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  assert.deepEqual((await call("coverage")).all, { covered: 1, total: 67 });
  assert.equal((await call("coverage", { module: path.module })).node.covered, 1);
  const all = await call("uncovered");
  assert.equal(all.length, 50);
  assert.match(all[0].id, /^errored:/);
  const filtered = await call("uncovered", { kind: "node", module: path.module });
  assert.ok(filtered.every(x => x.file === path.module && x.id.startsWith("node:") && x.line > 0));
});

test("MCP coverage counts ignored paths and lists untyped failures; uncovered leaves ignored out", async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-coverage-mcp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".rx-coverage"));
  writeFileSync(join(root, ".rx-coverage/coverage.json"), JSON.stringify(merge()));
  const call = async (served, name) => {
    const receive = createMcp({ root, getProject: () => ({ load: () => ({ graph: served }) }) });
    const { result } = await receive({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { format: "json" } } });
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const both = await call(graph(), "coverage");
  assert.deepEqual(both.untyped.count, 1);
  assert.deepEqual(both.untyped.list[0], { callee: "load", file: "fixtures/coverage-api.d.rx", line: 5, actions: ["reload"],
    text: "`load` (fixtures/coverage-api.d.rx:5) can fail with an untyped error — declare its `rejects(…)` in fixtures/coverage-api.d.rx" });
  const ig = graphOf("fixtures/coverage-ignore.rx");
  const summaryIgnored = await call(ig, "coverage");
  assert.deepEqual([summaryIgnored.ignored, summaryIgnored.all.total, summaryIgnored.untyped.count], [6, 3, 0]);
  assert.deepEqual((await call(ig, "uncovered")).map(x => x.line), [5, 7, 10]);
});

test("CLI merge, threshold, and trace; Playwright result writer", async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-coverage-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(here, "../rx-map.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  const c = createCollector({ graphs: [graph()], tool: "browser" });
  c.begin("Browser test");
  c.feed({ type: "boundary", region: region("loading"), state: "fallback" });
  c.end();
  const result = await collectBrowserCoverage({ evaluate: async () => c.result() }, join(root, "browser.json"));
  assert.equal(summary(result).all.covered, 1);
  assert.equal(run("coverage", "merge", "browser.json", "browser.json", "-o", "merged.json").status, 0);
  const below = run("coverage", "report", "merged.json", "--json", "--min", "10");
  assert.equal(below.status, 1);
  assert.deepEqual(JSON.parse(below.stdout).program.all, { covered: 1, total: 13 });
  assert.deepEqual(JSON.parse(below.stdout).untyped.map(u => u.callee), ["load"]);
  writeFileSync(join(root, "test.rxtrace.json"), JSON.stringify(c.trace()));
  const replay = run("trace", "test.rxtrace.json", "-o", "replay.html");
  assert.equal(replay.status, 0, replay.stderr);
  assert.match(readFileSync(join(root, "replay.html"), "utf8"), /<!doctype html>/i);
});

test("Vite allows the linked Vitest setup entry only when opted in", async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-linked-map-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scope = join(root, "node_modules/@reactivescript");
  mkdirSync(scope, { recursive: true });
  symlinkSync(resolve(here, ".."), join(scope, "map"), "junction");
  const setup = "@reactivescript/map/coverage/vitest";
  const realSetup = realpathSync(join(scope, "map/coverage/vitest.mjs")).replace(/\\/g, "/");
  const allow = [root];
  const config = { root, test: { setupFiles: ["./test-setup.ts"] }, server: { fs: { allow } } };
  await rxMap().configResolved(config);
  assert.deepEqual(allow, [root]);
  config.test.setupFiles.push(setup);
  await rxMap().configResolved(config);
  await rxCoverage().configResolved(config);
  assert.deepEqual(allow, [root, realSetup]);
});
