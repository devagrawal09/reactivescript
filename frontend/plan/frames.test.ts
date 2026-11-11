// Plan v2.2's builder (plan/docs/PLAN-V2.md, "v2.2"; docs/SLICE6-FRAMES.md 4.6, 6.4, 6.6): it is additive (a program
// with no v2.2 form emits its v2 or v2.1 plan byte for byte through it), it refuses the forms v2.2 cannot represent by
// code from RX and TSX alike, and the PL pins show the difference each client-keeping rule prevents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadTsxModules } from "../tsx/modules.ts";
import { TsxError } from "../tsx/lower.ts";
import { loadModules } from "../tsx/rx/compiler.ts";
import { resolvePlanV2 } from "./resolve-v2.ts";
import { FramesRefusal, resolvePlanFrames } from "./resolve-frames.ts";
import { generate as generatePlanCase, emit as emitPlanCase } from "./fuzz/gen.ts";
import { generateAsync, emitAsync } from "./fuzz/gen-async.ts";
import { generate as generateFrames, emit as emitFrames, OUTSIDE_CODE, type Outside } from "../frames/fuzz/gen.ts";
import { PINS, runPin } from "../frames/pins.ts";
import { closeBrowser, type Trace } from "../frames/harness.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const emitCli = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "plan/emit.ts", ...args], { cwd: root, encoding: "utf8" });
const outcome = (f: () => unknown) => {
  try { return JSON.stringify(f(), null, 2); }
  catch (e) { return "refused: " + ((e as { code?: string }).code ?? "") + " " + (e as Error).message; }
};
const code = (f: () => unknown) => {
  try { f(); return "plan"; }
  catch (e) { return e instanceof FramesRefusal || (e instanceof TsxError && e.code) ? (e as { code: string }).code : "other: " + (e as Error).message; }
};

test.after(() => closeBrowser());

test("v2.2 additivity: like, tracker and tracker-async emit their saved plans byte for byte through --schema 2.2", () => {
  const saved: Record<string, string> = { like: "like.plan-v2.json", tracker: "tracker.plan.json", "tracker-async": "tracker-async.plan.json" };
  for (const [slice, plan] of Object.entries(saved)) {
    const want = readFileSync(root + "plan/" + plan, "utf8");
    for (const ext of ["rx", "tsx"]) {
      const r = emitCli("--schema", "2.2", "slices/" + slice + "/" + slice + "." + ext);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, want, slice + "." + ext + " through the v2.2 builder");
    }
  }
});

test("v2.2 additivity: plan fuzz programs (seeds 1..60, v2 and v2.1) emit the same plan or refusal through the frames builder", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const [what, files, async] of [["v2", emitPlanCase(generatePlanCase(seed)), false], ["v2.1", emitAsync(generateAsync(seed)), true]] as const) {
      const read = (p: string) => (files as Record<string, string>)[p.replace(/^.*\//, "")];
      const before = outcome(() => resolvePlanV2(loadTsxModules("App.tsx", read, async ? { async } : {}), async ? { async: true } : {}));
      const frames = outcome(() => resolvePlanFrames(loadTsxModules("App.tsx", read, { async: true, frames: true }), { stem: "App" }));
      assert.equal(frames, before, what + " seed " + seed + " (TSX)");
      const rxBefore = outcome(() => resolvePlanV2(loadModules("App.rx", read) as never, async ? { async: true } : {}));
      const rxFrames = outcome(() => resolvePlanFrames(loadModules("App.rx", read) as never, { stem: "App" }));
      assert.equal(rxFrames, rxBefore, what + " seed " + seed + " (RX)");
    }
  }
});

test("v2.2 refusals: each refused form gets its diagnostic code from RX and from TSX alike", () => {
  // A placeable program from the placement fuzz, with one form added.
  let seed = 1;
  while (generateFrames(seed).outside) seed++;
  const base = generateFrames(seed);
  const cases: [string, string, (f: Record<string, string>) => void][] = [];
  for (const o of ["ambiguous", "body", "children", "wire"] as Outside[]) {
    const withForm = emitFrames({ ...base, outside: o });
    cases.push([o, OUTSIDE_CODE[o], f => Object.assign(f, withForm)]);
  }
  cases.push(["a JS host without a side", "FRAMES_CLIENT_JS", f => { f["db.d.rx"] = f["db.d.rx"].replace("export server pure fn rowsOf", "export pure fn rowsOf"); }]);
  cases.push(["declared rejections", "FRAMES_ERROR_CLASS", f => { f["db.d.rx"] = "export error Conflict\n" + f["db.d.rx"].replace("export server fn claimRow(id: number): string", "export server fn claimRow(id: number): string rejects(Conflict)"); }]);
  cases.push(["a component never applied", "FRAMES_MODULES", f => {
    f["app.rx"] = f["app.rx"].replace("export default component App", "component Spare(props) {\n  <i>spare</i>\n}\n\nexport default component App");
    f["app.tsx"] = f["app.tsx"].replace("export default function App", "function Spare() {\n  return <i>spare</i>;\n}\n\nexport default function App");
  }]);
  const plain = emitFrames(base);
  assert.equal(code(() => resolvePlanFrames(loadModules("app.rx", (p: string) => plain[p.replace(/^.*\//, "")]) as never, { stem: "app" })), "plan", "the base program places");
  for (const [what, want, edit] of cases) {
    const files = { ...plain };
    edit(files);
    assert.notDeepEqual(files, plain, what + " edits the program");
    const read = (p: string) => files[p.replace(/^.*\//, "")];
    assert.equal(code(() => resolvePlanFrames(loadModules("app.rx", read) as never, { stem: "app" })), want, what + " (RX)");
    assert.equal(code(() => resolvePlanFrames(loadTsxModules("/fuzz/app.tsx", read, { frames: true }), { stem: "app" })), want, what + " (TSX)");
  }
});

const ran = (t: Trace, name: string) => assert.deepEqual(t.problems, [], name + " ran clean");
const hosts = (t: Trace) => t.hosts.map(h => h.step + ":" + h.host + JSON.stringify(h.args));

test("PL pin PL-3c: a server root over two questions re-asks both hosts where the twin asks one", async () => {
  const pin = PINS["PL-3c"];
  const t = await runPin(pin, "T"), f = await runPin(pin, "F");
  ran(t, "T"); ran(f, "F");
  assert.deepEqual(f.frames, t.frames, "the frames agree");
  assert.deepEqual(hosts(t), ["0:rowOf[1]", "0:countOpen[]", "1:rowOf[2]", "3:claimRow[2]", "4:countOpen[]"]);
  assert.deepEqual(hosts(f), ["0:rowOf[1]", "0:countOpen[]", "1:rowOf[2]", "1:countOpen[]", "3:claimRow[2]", "4:rowOf[2]", "4:countOpen[]"]);
});

test("PL pin PL-3d: a server root whose markup reads client state makes a request per change, and its frame lags", async () => {
  const pin = PINS["PL-3d"];
  const t = await runPin(pin, "T"), f = await runPin(pin, "F");
  ran(t, "T"); ran(f, "F");
  assert.deepEqual(t.requests, []);
  assert.deepEqual(t.frames, ["modeOne all", "modeOne open", "modeOne all"]);
  assert.deepEqual(f.requests.map(r => [r.site, r.args]), [["Card$server", [1, "open"]], ["Card$server", [1, "all"]]]);
  assert.deepEqual(f.frames, ["modeOne all", "modeOne all", "modeOne open", "modeOne open", "modeOne all"]);
});

test("PL pin PL-5: a stateful island under a server row keeps its state across a refresh the twin's row does not survive", async () => {
  const pin = PINS["PL-5"];
  const t = await runPin(pin, "T"), f = await runPin(pin, "F");
  ran(t, "T"); ran(f, "F");
  assert.equal(t.frames.at(-1), "takeOne offTwo offThree off", "the twin's For re-creates its rows: the toggle starts over");
  assert.equal(f.frames.at(-1), "takeOne onTwo offThree off", "the server row's island keeps its state");
  assert.deepEqual(f.frames.slice(0, -1), t.frames.slice(0, -1));
});

test("frames tier, TSX boundary: a \"use server\" function is outside the subset without the tier; with it, its forms are checked by code", () => {
  let seed = 1;
  while (generateFrames(seed).outside) seed++;
  const files = emitFrames(generateFrames(seed));
  const load = (tsx: string, options: { async?: boolean; frames?: boolean }) =>
    () => loadTsxModules("/fuzz/app.tsx", (p: string) => p.endsWith("app.tsx") ? tsx : files[p.replace(/^.*\//, "")], options);
  assert.match(code(load(files["app.tsx"], { async: true })), /^other: .*outside the verified subset|^other: .*async/, "the async tier alone refuses a server function");
  assert.equal(code(load(files["app.tsx"], { frames: true })), "plan");
  const untyped = files["app.tsx"].replace("async function act(id: number) {", "async function act(id) {");
  assert.notEqual(untyped, files["app.tsx"]);
  assert.equal(code(load(untyped, { frames: true })), "FRAMES_WIRE_TYPE");
  const awaitless = files["app.tsx"].replace('  "use server";\n  const v = await rowsOf();', '  "use server";\n  const v = rowsOf();');
  assert.notEqual(awaitless, files["app.tsx"]);
  assert.equal(code(load(awaitless, { frames: true })), "FRAMES_SERVER_FN_BODY");
});
