import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "@solidjs/compiler";
import { loadTsxModules } from "../tsx/modules.ts";
import { loadYieldModules } from "../yield/lower.ts";
import { checkModules, compileModules, lowerViews, STRING_RENDERER, type ModuleSet } from "../tsx/rx/compiler.ts";
import { createApp, flush } from "../tsx/rx/runtime.ts";

export type Scalar = string | number | boolean;
export type Host = { name: string; parameters: ("string" | "number" | "boolean")[]; returns: "string" | "number" | "boolean"; async: true };
export type Step = ({ type: "mount" } | { type: "click"; element: number } |
  { type: "resolve"; host: string; call: number; value: Scalar } |
  { type: "reject"; host: string; call: number; error: string }) & { frame: string };
export type Scenario = { version: 1; name: string; fixture: string; host: Host[]; steps: Step[] };
export type Leg = "native" | "tsx" | "rx" | "yield";
const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; } };
const renderer = fileURLToPath(new URL("../tsx/test-renderer.ts", import.meta.url));
const outRoot = fileURLToPath(new URL("../.out/", import.meta.url));

export function loadScenario(path: string): Scenario {
  const s = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  assert.equal(s.version, 1);
  assert.equal(typeof s.name, "string");
  assert.match(s.fixture, /^[a-z][a-z0-9-]*$/);
  assert.equal(s.steps[0]?.type, "mount");
  assert.equal(s.steps.filter(s => s.type === "mount").length, 1);
  assert.equal(new Set(s.host.map(h => h.name)).size, s.host.length);
  for (const h of s.host) {
    assert.match(h.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.equal(h.async, true);
    assert.ok(["number", "string", "boolean"].includes(h.returns));
    assert.ok(h.parameters.every(p => ["number", "string", "boolean"].includes(p)));
  }
  for (const step of s.steps) {
    assert.equal(typeof step.frame, "string");
    assert.ok(["mount", "click", "resolve", "reject"].includes(step.type));
    if (step.type === "click") assert.ok(Number.isInteger(step.element) && step.element >= 0);
    if (step.type === "resolve" || step.type === "reject") {
      const h = s.host.find(h => h.name === step.host);
      assert.ok(h, "declared host " + step.host);
      assert.ok(Number.isInteger(step.call) && step.call >= 1);
      if (step.type === "resolve") assert.equal(typeof step.value, h.returns);
      else assert.equal(typeof step.error, "string");
    }
  }
  return s;
}

export function loadFixture(scenarioPath: string, leg: Exclude<Leg, "native">, source?: string): ModuleSet {
  const s = loadScenario(scenarioPath);
  const entry = resolve(dirname(scenarioPath), s.fixture + (leg === "yield" ? ".yield.tsx" : "." + leg));
  const set = (leg === "yield" ? loadYieldModules : loadTsxModules)(entry, p => p === entry && source !== undefined ? source : read(p));
  assert.deepEqual(set.diags, [], leg + " loads");
  assert.deepEqual(checkModules(set).diags, [], leg + " checks");
  return set;
}

type Call = { resolve: (value: Scalar) => void; reject: (error: Error) => void; done: boolean };
function hosts(s: Scenario) {
  const calls = new Map<string, Call[]>();
  const api = Object.fromEntries(s.host.map(h => {
    calls.set(h.name, []);
    return [h.name, (...args: unknown[]) => {
      assert.equal(args.length, h.parameters.length, h.name + " argument count");
      args.forEach((a, i) => assert.equal(typeof a, h.parameters[i]));
      // Never key requests by arguments: every invocation owns a new promise (SF-2c).
      return new Promise<Scalar>((resolve, reject) => calls.get(h.name)!.push({ resolve, reject, done: false }));
    }];
  }));
  return { api, calls };
}
const elements = (node: any): any[] => node?.kind === "el"
  ? [...(typeof node.props?.onClick === "function" ? [node] : []), ...node.children.flatMap(elements)] : [];
const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise<void>(done => setImmediate(done)); flush(); } };

/** Check the fixed frame after every step on the selected JS leg. */
export async function runScenario(scenarioPath: string, leg: Leg): Promise<string[]> {
  const s = loadScenario(scenarioPath);
  const { api, calls } = hosts(s);
  const app = createApp({ api });
  mkdirSync(outRoot, { recursive: true });
  const dir = mkdtempSync(outRoot + "slice-");
  let dispose: (() => void) | undefined;
  try {
    let files: Map<string, string>, entry: string;
    if (leg === "native") {
      const input = resolve(dirname(scenarioPath), s.fixture + ".tsx");
      const native = transform(readFileSync(input, "utf8"), { filename: basename(input), generate: "universal", moduleName: STRING_RENDERER }).code;
      files = new Map([["native.mts", native.replaceAll('"./api"', '"./api.mjs"')], ["api.mjs",
        s.host.map(h => "export let " + h.name + ";").join("\n") + "\nexport function bind(api) {" + s.host.map(h => h.name + " = api." + h.name + ";").join("") + "}"]]);
      entry = "native.mts";
    } else {
      const built = compileModules(loadFixture(scenarioPath, leg));
      files = lowerViews(built.files, "universal");
      entry = built.entry;
    }
    for (const [name, code] of files) writeFileSync(dir + "/" + name, code.replaceAll(STRING_RENDERER, renderer));
    const mod = await import(pathToFileURL(dir + "/" + entry).href);
    if (leg === "native") (await import(pathToFileURL(dir + "/api.mjs").href)).bind(api);
    const frames: string[] = [];
    for (const [index, step] of s.steps.entries()) {
      if (step.type === "mount") dispose = app.mount(leg === "native" ? () => mod.default() : mod.default(app));
      else if (step.type === "click") {
        const target = elements(app.root)[step.element];
        assert.ok(target, "clickable element " + step.element);
        target.props.onClick();
      } else {
        const call = calls.get(step.host)?.[step.call - 1];
        assert.ok(call, step.host + " call #" + step.call + " was issued");
        assert.equal(call.done, false, "a request may settle only once");
        call.done = true;
        if (step.type === "resolve") call.resolve(step.value);
        else call.reject(new Error(step.error));
      }
      await settle();
      assert.equal(app.asyncError, null, "no uncaught runtime error");
      const frame = app.frame();
      frames.push(frame);
      assert.equal(frame, step.frame, s.name + " / " + leg + " / step " + index);
    }
    for (const [name, requests] of calls) assert.ok(requests.every(c => c.done), name + " has no unscripted requests");
    return frames;
  } finally { dispose?.(); rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [path, ...legs] = process.argv.slice(2);
  assert.ok(path, "usage: node --experimental-strip-types --conditions=browser --conditions=development slices/run-js.ts SCENARIO [native tsx rx yield]");
  for (const leg of (legs.length ? legs : ["native", "tsx", "rx", "yield"])) {
    assert.ok(["native", "tsx", "rx", "yield"].includes(leg));
    console.log(leg, await runScenario(resolve(path), leg as Leg));
  }
}
