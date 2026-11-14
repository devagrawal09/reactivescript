// Runs a React component (.react.tsx) through a slice scenario on React 19 itself: the React leg of the React frontend's
// differential check. The source is compiled with Babel (TypeScript, the automatic JSX runtime) and, unless
// `compiler: false`, with React Compiler 1.0.0 first, so the program that runs is the one the frontend analyzed. Steps,
// host calls and frames follow slices/run-js.ts: a frame is the rendered text, clicks pick live onClick elements in
// document order (or by text and parent text), and every request settles exactly once.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "@babel/core";
import ReactCompiler from "babel-plugin-react-compiler";
import TypeScript from "@babel/plugin-transform-typescript";
import Jsx from "@babel/plugin-transform-react-jsx";

const here = dirname(fileURLToPath(import.meta.url));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export function compileReact(source: string, filename: string, { compiler = true } = {}): string {
  const out = transformSync(source, {
    filename, babelrc: false, configFile: false, sourceType: "module",
    plugins: [
      ...(compiler ? [[ReactCompiler, { panicThreshold: "all_errors", target: "19" }]] : []),
      [TypeScript, { isTSX: true, allExtensions: true }],
      [Jsx, { runtime: "automatic" }],
    ],
  });
  return out!.code!;
}

type Host = { name: string; parameters: string[]; returns?: string };
type Target = { text: string; parent?: string; index: number };
type Step = { type: "mount" | "click" | "resolve" | "reject"; frame: string; element?: number; target?: Target; host?: string; call?: number; value?: unknown; error?: string; args?: unknown[] };
export type Scenario = { name: string; host: Host[]; steps: Step[] };
type Call = { args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void; done: boolean };

const textOf = (n: any): string => typeof n === "string" ? n : (n.children ?? []).map(textOf).join("");
function clickables(n: any, parent: any, out: { node: any; parent: any }[] = []) {
  if (typeof n === "string") return out;
  if (typeof n.type === "string" && typeof n.props.onClick === "function") out.push({ node: n, parent });
  for (const c of n.children ?? []) clickables(c, typeof n.type === "string" ? n : parent, out);
  return out;
}

/** Frames of `scenario` on React. `record` returns frames without comparing them. `prune` (for generated scenarios)
 * records too, drops steps React cannot take (no such clickable, no such request yet), fills in each settled request's
 * arguments, resolves requests left open with a default value, and writes the kept steps and their frames back into
 * `scenario.steps`. `pending` receives, for each step taken, how many requests are still open after it. */
export async function runReact(sourcePath: string, scenario: Scenario, { compiler = true, record = false, prune = false, pending }: { compiler?: boolean; record?: boolean; prune?: boolean; pending?: number[] } = {}): Promise<string[]> {
  if (prune) record = true;
  const { act } = await import("react");
  const TestRenderer = (await import("react-test-renderer")).default;
  const calls = new Map<string, Call[]>(scenario.host.map(h => [h.name, []]));
  const api = Object.fromEntries(scenario.host.map(h => [h.name, (...args: unknown[]) => {
    assert.equal(args.length, h.parameters.length, h.name + " argument count");
    return new Promise((resolve, reject) => calls.get(h.name)!.push({ args, resolve, reject, done: false }));
  }]));
  const out = resolve(here, ".out");
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(out + "/run-");
  const quiet = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("react-test-renderer is deprecated")) quiet(...a); };
  let root: any;
  try {
    const code = compileReact(readFileSync(sourcePath, "utf8"), sourcePath).replaceAll('"./api"', '"./api.mjs"');
    writeFileSync(dir + "/main.mjs", code);
    writeFileSync(dir + "/api.mjs", scenario.host.map(h => "export let " + h.name + ";").join("\n") +
      "\nexport function bind(api) {" + scenario.host.map(h => h.name + " = api." + h.name + ";").join("") + "}");
    (await import(pathToFileURL(dir + "/api.mjs").href)).bind(api);
    const Component = (await import(pathToFileURL(dir + "/main.mjs").href)).default;
    const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setImmediate(r)); }); };
    const frames: string[] = [], kept: Step[] = [];
    for (const [index, step] of scenario.steps.entries()) {
      if (step.type === "mount") await act(async () => { root = TestRenderer.create((await import("react")).createElement(Component)); });
      else if (step.type === "click") {
        const live = clickables(root.toTree() ? root.root : root.root, undefined);
        const pick = step.target
          ? live.filter(c => textOf(c.node) === step.target!.text && (step.target!.parent === undefined || (c.parent && textOf(c.parent) === step.target!.parent)))[step.target.index]
          : live[step.element!];
        if (!pick && prune) continue;
        assert.ok(pick, "clickable " + JSON.stringify(step.target ?? step.element) + " at step " + index);
        await act(async () => { pick.node.props.onClick(); });
      } else {
        const call = calls.get(step.host!)?.[step.call! - 1];
        if (prune && (!call || call.done)) continue;
        if (prune) step.args = call!.args;
        assert.ok(call, step.host + " call #" + step.call + " was issued");
        assert.equal(call.done, false, "a request settles once");
        if (step.args) assert.deepEqual(call.args, step.args, step.host + " call #" + step.call + " arguments");
        call.done = true;
        await act(async () => { step.type === "resolve" ? call.resolve(step.value) : call.reject(new Error(step.error)); });
      }
      await settle();
      const frame = textOf(root.root);
      frames.push(frame);
      kept.push({ ...step, frame });
      pending?.push([...calls.values()].flat().filter(c => !c.done).length);
      if (!record) assert.equal(frame, step.frame, scenario.name + " / react / step " + index);
    }
    if (prune) {
      const fallback: Record<string, unknown> = { number: 0, string: "x", boolean: true };
      for (const h of scenario.host) for (const [i, call] of calls.get(h.name)!.entries()) if (!call.done) {
        call.done = true;
        await act(async () => { call.resolve(fallback[h.returns ?? "number"]); });
        await settle();
        const frame = textOf(root.root);
        frames.push(frame);
        kept.push({ type: "resolve", host: h.name, call: i + 1, args: call.args, value: fallback[h.returns ?? "number"], frame });
        pending?.push([...calls.values()].flat().filter(c => !c.done).length);
      }
      scenario.steps = kept;
    }
    for (const [name, requests] of calls) assert.ok(requests.every(c => c.done), name + " has no unscripted requests");
    return frames;
  } finally {
    if (root) await act(async () => root.unmount());
    console.error = quiet;
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, scenarioPath] = process.argv.slice(2);
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  const frames = await runReact(resolve(source), scenario, { record: true, compiler: !process.argv.includes("--no-compiler") });
  frames.forEach((f, i) => console.log(i, f === scenario.steps[i].frame ? "same" : "DIFF", JSON.stringify(f), "solid:", JSON.stringify(scenario.steps[i].frame)));
}
