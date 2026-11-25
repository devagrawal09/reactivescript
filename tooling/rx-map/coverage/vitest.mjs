import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeEach } from "vitest";
import { attach } from "../live.mjs";
import { createCollector } from "../coverage.mjs";

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
const encode = payload => JSON.stringify(payload, null, 2) + "\n";

// Vitest evaluates setup files again for each spec, even if the worker is reused.
// A file-scoped collector keeps isolation and also works in pools that never run
// a process exit handler. Exclusive creation prevents PID/worker collisions.
const collector = createCollector({ graphs: () => globalThis.__RX__?.graphs ?? [], tool: "vitest" });
const bridge = attach(collector.feed);
let root = process.cwd();
const dir = () => resolve(root, process.env.RX_COVERAGE_DIR || ".rx-coverage");
bridge.post({ type: "snapshot?" });

beforeEach(({ task, onTestFinished }) => {
  const file = task.file;
  if (file.filepath.endsWith(file.name)) root = resolve(file.filepath.slice(0, -file.name.length) || root);
  const names = [task.name];
  for (let suite = task.suite; suite && suite !== file; suite = suite.suite) names.unshift(suite.name);
  const name = names.join(" > ");
  collector.begin(name);
  bridge.post({ type: "snapshot?" });
  onTestFinished(() => {
    const failed = task.result?.state === "fail";
    const error = failed ? task.result.errors?.map(e => e.message ?? String(e)).join("\n") : undefined;
    collector.end({ failed, error });
    if (!failed) return;
    const traces = join(dir(), "traces");
    mkdirSync(traces, { recursive: true });
    const path = join(traces, `${slug(file.name) || "file"}--${slug(name) || "test"}.rxtrace.json`);
    writeFileSync(path, encode(collector.trace()));
    console.error(`rx trace: ${relative(root, path)}`);
  });
});

afterAll(() => {
  bridge.detach();
  const output = dir(), json = encode(collector.result());
  mkdirSync(output, { recursive: true });
  for (let n = 1; ; n++) {
    try { writeFileSync(join(output, `run-${process.pid}-${n}.json`), json, { flag: "wx" }); break; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
});
