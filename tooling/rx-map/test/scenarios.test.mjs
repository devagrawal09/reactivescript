// scenarios.mjs (SLICE9-COVERAGE-CONTRACT §2 "Scenario runner", §6): a scenario over an example runs on the compiled
// dev build with the bridge, and the coverage file it writes has hits for that example. Then the checked-in report
// (test/fixtures/scenario-coverage.txt) is what a full run gives. Skipped when the runner's inputs (a Solid dev build
// with attribution, Playwright and its Chromium) are missing: the runner says so and exits 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runner = resolve(here, "../scenarios.mjs");
const run = (...args) => spawnSync(process.execPath, [runner, "--quiet", ...args], { encoding: "utf8", timeout: 300_000 });
const missing = r => r.status === 2 && /no Solid dev build|no runtime dev build|Playwright not found|Executable doesn't exist/.test(r.stderr);

test("a scenario over examples/users.rx passes and its coverage file has hits there", t => {
  const dir = mkdtempSync(join(tmpdir(), "rx-scenarios-"));
  try {
    const out = join(dir, "coverage.json");
    const r = run("--coverage", out, "S-app-users");
    if (missing(r)) return t.skip(r.stderr.trim());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS S-app-users/m);
    const file = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(file.rxCoverage, 1);
    assert.deepEqual(file.modules, ["examples/users.rx"]);
    assert.equal(file.runs.length, 1);
    assert.equal(file.runs[0].tests, 1);
    assert.equal(file.runs[0].failed, 0);
    const hits = Object.keys(file.hits).filter(id => file.paths[id]?.module === "examples/users.rx");
    assert.ok(hits.length > 0, "no hits in examples/users.rx");
    for (const id of ["node:examples/users.rx||users", "loading:examples/users.rx|/component:App/errored/loading", "action:examples/users.rx||rename:ok"])
      assert.ok(file.hits[id]?.n > 0 && file.hits[id].by.includes("S-app-users / Frames"), `${id} not hit by the scenario`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("test/fixtures/scenario-coverage.txt is what the scenarios give (node scenarios.mjs --update)", t => {
  const r = run("--check");
  if (missing(r)) return t.skip(r.stderr.trim());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
