import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "@solidjs/compiler";
import { loadTsxModules } from "../tsx/modules.ts";
import { loadYieldModules } from "../yield/lower.ts";
import { checkModules, compileModules, lowerViews, STRING_RENDERER, type ModuleSet } from "../tsx/rx/compiler.ts";
import { createApp, flush } from "../tsx/rx/runtime.ts";
import { planComponent } from "../plan/solid-plan.ts";
import { parseType } from "../eval/interface.ts";
import { conforms, type Type } from "../plan/types.ts";
export { conforms };

export type Scalar = string | number | boolean;
/** A host value: a scalar, or (format 2.1) an array or record of host values, as JSON. */
export type HostValue = Scalar | HostValue[] | { [key: string]: HostValue };
/** `returns` is a scalar type name; format 2.1 also allows a structured type (docs/SCENARIO-FORMAT.md, version 2.1). */
export type Host = { name: string; parameters: ("string" | "number" | "boolean")[]; returns: string; async: true };
/** Version 2: select a live clickable by its exact rendered text, optionally within a parent of exact text (a row). */
export type Target = { text: string; parent?: string; index: number };
export type Step = ({ type: "mount" } | { type: "click"; element: number } | { type: "click"; target: Target } |
  { type: "resolve"; host: string; call: number; args?: Scalar[]; value: HostValue } |
  { type: "reject"; host: string; call: number; args?: Scalar[]; error: string }) & { frame: string };
export type Scenario = { version: 1 | 2 | 2.1; name: string; fixture: string; host: Host[]; steps: Step[] };
/** plan: a v2 plan JSON (docs/PLAN-V2.md) built with Solid's primitives by plan/solid-plan.ts. */
export type Leg = "native" | "tsx" | "rx" | "yield" | "plan";
export type RunOptions = { record?: boolean; plan?: string };
const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; } };
const renderer = fileURLToPath(new URL("../tsx/test-renderer.ts", import.meta.url));
const outRoot = fileURLToPath(new URL("../.out/", import.meta.url));

/** The host's result type: a scalar name (every version), or a structured type (format 2.1 only). */
export const returnType = (s: Scenario, h: Host): Type => {
  if (s.version !== 2.1) assert.ok(["number", "string", "boolean"].includes(h.returns), "host results are scalars before version 2.1");
  return parseType(h.returns);
};

export function loadScenario(path: string): Scenario {
  const s = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  assert.ok(s.version === 1 || s.version === 2 || s.version === 2.1, "scenario version 1 or 2, or 2.1");
  assert.equal(typeof s.name, "string");
  assert.match(s.fixture, /^[a-z][a-z0-9-]*$/);
  assert.equal(s.steps[0]?.type, "mount");
  assert.equal(s.steps.filter(s => s.type === "mount").length, 1);
  assert.equal(new Set(s.host.map(h => h.name)).size, s.host.length);
  for (const h of s.host) {
    assert.match(h.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.equal(h.async, true);
    if (s.version === 2.1) { assert.equal(typeof h.returns, "string"); returnType(s, h); }
    else assert.ok(["number", "string", "boolean"].includes(h.returns), "host results are scalars before version 2.1");
    assert.ok(h.parameters.every(p => ["number", "string", "boolean"].includes(p)));
  }
  for (const step of s.steps) {
    assert.equal(typeof step.frame, "string");
    assert.ok(["mount", "click", "resolve", "reject"].includes(step.type));
    if (step.type === "click" && "target" in step) {
      // Version 2 only: exactly one of element / target.
      assert.ok(s.version === 2 || s.version === 2.1, "click targets are version 2");
      assert.ok(!("element" in step), "a click has element or target, not both");
      const t = step.target;
      assert.deepEqual(Object.keys(t).filter(k => !["text", "parent", "index"].includes(k)), [], "target fields");
      assert.equal(typeof t.text, "string");
      assert.ok(t.parent === undefined || typeof t.parent === "string");
      assert.ok(Number.isInteger(t.index) && t.index >= 0, "target index");
    } else if (step.type === "click") assert.ok(Number.isInteger(step.element) && step.element >= 0);
    if (step.type === "resolve" || step.type === "reject") {
      const h = s.host.find(h => h.name === step.host);
      assert.ok(h, "declared host " + step.host);
      assert.ok(Number.isInteger(step.call) && step.call >= 1);
      // Version 2 requires the settled request's arguments; version 1 has none.
      if (s.version === 1) assert.ok(!("args" in step), "args are version 2");
      else {
        assert.ok(Array.isArray(step.args) && step.args.length === h.parameters.length, "args match " + h.name);
        step.args.forEach((a, i) => assert.equal(typeof a, h.parameters[i]));
      }
      if (step.type === "resolve" && s.version === 2.1) assert.ok(conforms(step.value, returnType(s, h)), "resolved value conforms to " + h.returns);
      else if (step.type === "resolve") assert.equal(typeof step.value, h.returns);
      else assert.equal(typeof step.error, "string");
    }
  }
  return s;
}

export function loadFixture(scenarioPath: string, leg: Exclude<Leg, "native" | "plan">, source?: string): ModuleSet {
  const s = loadScenario(scenarioPath);
  const entry = resolve(dirname(scenarioPath), s.fixture + (leg === "yield" ? ".yield.tsx" : "." + leg));
  // Format 2.1 drives a plan v2.1 program: the TSX frontend's async tier is on (tsx/lower.ts LowerOptions).
  const reader = (p: string) => p === entry && source !== undefined ? source : read(p);
  const set = leg === "yield" ? loadYieldModules(entry, reader) : loadTsxModules(entry, reader, { async: s.version === 2.1 });
  assert.deepEqual(set.diags, [], leg + " loads");
  assert.deepEqual(checkModules(set).diags, [], leg + " checks");
  return set;
}

type Call = { args: unknown[]; resolve: (value: HostValue) => void; reject: (error: Error) => void; done: boolean };
function hosts(s: Scenario) {
  const calls = new Map<string, Call[]>();
  const api = Object.fromEntries(s.host.map(h => {
    calls.set(h.name, []);
    return [h.name, (...args: unknown[]) => {
      assert.equal(args.length, h.parameters.length, h.name + " argument count");
      args.forEach((a, i) => assert.equal(typeof a, h.parameters[i]));
      // Never key requests by arguments: every invocation owns a new promise (SF-2c).
      return new Promise<HostValue>((resolve, reject) => calls.get(h.name)!.push({ args, resolve, reject, done: false }));
    }];
  }));
  return { api, calls };
}
const elements = (node: any): any[] => node?.kind === "el"
  ? [...(typeof node.props?.onClick === "function" ? [node] : []), ...node.children.flatMap(elements)] : [];
/** Live clickables in the same order, each with its parent element (the mount root counts as an element). */
const clickables = (node: any, parent?: any): { node: any; parent: any }[] => node?.kind === "el"
  ? [...(typeof node.props?.onClick === "function" ? [{ node, parent }] : []), ...node.children.flatMap((c: any) => clickables(c, node))] : [];
const text = (node: any): string => node.kind === "text" ? node.text : node.children.map(text).join("");
function select(root: any, t: Target): any {
  const matches = clickables(root).filter(c => text(c.node) === t.text && (t.parent === undefined || (c.parent && text(c.parent) === t.parent)));
  assert.ok(matches[t.index], "clickable " + JSON.stringify(t) + " (" + matches.length + " match)");
  return matches[t.index].node;
}
const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise<void>(done => setImmediate(done)); flush(); } };

/** Check the fixed frame after every step on the selected JS leg. */
export async function runScenario(scenarioPath: string, leg: Leg, { record = false, plan }: RunOptions = {}): Promise<string[]> {
  const s = loadScenario(scenarioPath);
  assert.equal(leg === "plan", plan !== undefined, "a plan file is given exactly for the plan leg");
  const { api, calls } = hosts(s);
  const app = createApp({ api });
  mkdirSync(outRoot, { recursive: true });
  const dir = mkdtempSync(outRoot + "slice-");
  let dispose: (() => void) | undefined;
  try {
    let files = new Map<string, string>(), entry = "";
    if (leg === "plan") {
      // The plan's hosts must be the scenario's, in order, with the same types.
      const p = JSON.parse(readFileSync(plan!, "utf8"));
      // A v2.1 plan also says which hosts are pure (`"pure": true`), which a scenario's signature does not.
      if (s.version === 2.1) assert.ok(p.hosts.every((h: { pure?: unknown }) => h.pure === undefined || h.pure === true), "pure is true or absent");
      const signature = (h: { pure?: unknown }) => { if (s.version !== 2.1) return h; const { pure, ...rest } = h; return rest; };
      assert.deepEqual(p.hosts.map(signature), s.host.map(h => ({ name: h.name, params: h.parameters, returns: h.returns })), "plan hosts are the scenario's");
    } else if (leg === "native") {
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
    const mod = leg === "plan" ? { default: planComponent(JSON.parse(readFileSync(plan!, "utf8")), api as never) }
      : await import(pathToFileURL(dir + "/" + entry).href);
    if (leg === "native") (await import(pathToFileURL(dir + "/api.mjs").href)).bind(api);
    const frames: string[] = [];
    for (const [index, step] of s.steps.entries()) {
      if (step.type === "mount") dispose = app.mount(leg === "native" || leg === "plan" ? () => mod.default() : mod.default(app));
      else if (step.type === "click") {
        const target = "target" in step ? select(app.root, step.target) : elements(app.root)[step.element];
        assert.ok(target, "clickable element " + ("target" in step ? JSON.stringify(step.target) : step.element));
        target.props.onClick();
      } else {
        const call = calls.get(step.host)?.[step.call - 1];
        assert.ok(call, step.host + " call #" + step.call + " was issued");
        assert.equal(call.done, false, "a request may settle only once");
        if (step.args) assert.deepEqual(call.args, step.args, step.host + " call #" + step.call + " arguments");
        call.done = true;
        if (step.type === "resolve") call.resolve(step.value);
        else call.reject(new Error(step.error));
      }
      await settle();
      assert.equal(app.asyncError, null, "no uncaught runtime error");
      const frame = app.frame();
      frames.push(frame);
      // record (the CLI's --record, for authoring a scenario from native Solid) prints instead of comparing.
      if (record) console.log(index, JSON.stringify(frame)); else assert.equal(frame, step.frame, s.name + " / " + leg + " / step " + index);
    }
    for (const [name, requests] of calls) assert.ok(requests.every(c => c.done), name + " has no unscripted requests");
    return frames;
  } finally { dispose?.(); rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const record = process.argv.includes("--record");
  const [path, ...legs] = process.argv.slice(2).filter(a => a !== "--record");
  assert.ok(path, "usage: node --experimental-strip-types --conditions=browser --conditions=development slices/run-js.ts SCENARIO [--record] [native tsx rx yield plan=PLAN.json]");
  for (const leg of (legs.length ? legs : ["native", "tsx", "rx", "yield"])) {
    const plan = leg.startsWith("plan=") ? resolve(leg.slice(5)) : undefined;
    assert.ok(["native", "tsx", "rx", "yield"].includes(leg) || plan);
    console.log(leg, await runScenario(resolve(path), plan ? "plan" : leg as Leg, { record, plan }));
  }
}
