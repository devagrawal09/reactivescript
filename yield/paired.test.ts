// The solid-yield explicit generator dialect as a third frontend (spike; docs/YIELD.md). The counter and the issue
// tracker are written in idiomatic solid-yield (yield/fixtures/*.yield.tsx), translated by yield/lower.ts into the
// Solid TSX that solid-yield itself maps them to, and lowered onto the pinned RX AST. Evidence: canonical facts equal
// to the handwritten RX and to the Solid TSX twin, a detected fact change, and identical exact frames on solid-yield's
// own runtime (the reference: its yield rule, Solid's DOM compiler, solid-yield's render, in jsdom), the compiled and
// interpreted RX lowered from yield, and the compiled and interpreted handwritten RX.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { transform } from "@solidjs/compiler";
import { transform as yieldRule } from "vite-plugin-solid-yield";
import { loadTsxModules } from "../tsx/modules.ts";
import { semanticFacts } from "../tsx/rx/facts.ts";
import { checkModules, compileModules, lowerViews, STRING_RENDERER, type ModuleSet } from "../tsx/rx/compiler.ts";
import { createApp, flush, Runtime } from "../tsx/rx/runtime.ts";
import { loadYieldModules, YieldError } from "./lower.ts";

const fixture = (name: string) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const API: Record<string, string> = { "api.d.rx": "export fn assignIssue(id: number): string" };
const checked = (set: ModuleSet, name: string) => {
  assert.deepEqual(set.diags, [], name + " loads");
  assert.deepEqual(checkModules(set).diags, [], name + " checks");
  return set;
};
const fromYield = (name: string) => checked(loadYieldModules(name + ".tsx", p => (p === name + ".tsx" ? fixture(name + ".yield.tsx") : API[p])), name + ".yield.tsx");
const load = (file: string, text = fixture(file)) => checked(loadTsxModules(file, p => (p === file ? text : API[p])), file);
const outRoot = fileURLToPath(new URL("../.out/", import.meta.url));
const renderer = fileURLToPath(new URL("../tsx/test-renderer.ts", import.meta.url));

/** Click the n-th button, or answer the assignment request for one issue. */
type Step = { click: number } | { answer: number; owner?: string; failure?: string };
const COUNTER: Step[] = [{ click: 0 }, { click: 0 }];
const TRACKER: Step[] = [
  { click: 1 }, { answer: 1, owner: "dev" }, { click: 2 }, { answer: 2, failure: "offline" },
  { click: 0 }, { click: 1 }, { answer: 3, owner: "dev" },
];
const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise<void>(done => setImmediate(done)); flush(); } };
const answer = (app: ReturnType<typeof createApp>, s: Extract<Step, { answer: number }>) => {
  const f = app.flights.get("assignIssue:" + s.answer);
  assert.ok(f, "issue " + s.answer + " has an open request");
  if (s.failure) f.reject(new Error(s.failure)); else f.resolve(s.owner);
};

/** The reference: solid-yield's yield rule, then Solid's DOM compiler, mounted by solid-yield's render in jsdom. */
async function solidYield(name: string, script: Step[]): Promise<string[]> {
  const dom = new JSDOM("<!doctype html><div id=root></div>");
  const keys = ["window", "document", "Node", "Element", "HTMLElement", "Text", "Event", "MouseEvent", "DocumentFragment", "Comment", "SVGElement", "MutationObserver"];
  for (const k of keys) (globalThis as any)[k] = (dom.window as any)[k];
  mkdirSync(outRoot, { recursive: true });
  const dir = mkdtempSync(outRoot + "yield-");
  const app = createApp();
  (globalThis as any).__yieldAssignIssue = (...args: unknown[]) => (app.api("assignIssue")(...args) as any).first;
  try {
    const source = fixture(name + ".yield.tsx");
    const ruled = yieldRule(source, { filename: name + ".tsx", sourceMap: false });
    assert.ok(ruled, "the yield rule rewrites the holes");
    const code = transform(ruled.code, { filename: name + ".tsx", generate: "dom", moduleName: "@solidjs/web" }).code
      .replaceAll('"./api"', '"data:text/javascript,export const assignIssue=(...args)=>globalThis.__yieldAssignIssue(...args)"');
    writeFileSync(dir + "/main.mts", code);
    const mod = await import(pathToFileURL(dir + "/main.mts").href);
    const { render } = await import("solid-yield");
    const root = document.getElementById("root")!;
    const dispose = render(mod.default, root);
    try {
      await settle();
      const frames = [root.textContent!];
      for (const s of script) {
        if ("click" in s) (root.querySelectorAll("button")[s.click] as HTMLElement).click(); else answer(app, s);
        await settle();
        frames.push(root.textContent!);
      }
      return frames;
    } finally { (dispose as () => void)?.(); }
  } finally {
    delete (globalThis as any).__yieldAssignIssue;
    for (const k of keys) delete (globalThis as any)[k];
    rmSync(dir, { recursive: true, force: true });
  }
}

async function compiled(set: ModuleSet, script: Step[]): Promise<string[]> {
  mkdirSync(outRoot, { recursive: true });
  const dir = mkdtempSync(outRoot + "yield-rx-");
  try {
    const built = compileModules(set);
    for (const [n, c] of lowerViews(built.files, "universal")) writeFileSync(dir + "/" + n, c.replaceAll(STRING_RENDERER, renderer));
    const mod = await import(pathToFileURL(dir + "/" + built.entry).href);
    const app = createApp();
    const dispose = app.mount(mod.default(app));
    const buttons = (node: any): any[] => node?.tag === "button" ? [node] : (node?.children ?? []).flatMap(buttons);
    try {
      await settle();
      const frames = [app.frame()];
      for (const s of script) {
        if ("click" in s) buttons(app.root)[s.click].props.onClick(); else answer(app, s);
        await settle();
        frames.push(app.frame());
      }
      return frames;
    } finally { dispose(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function interpreted(set: ModuleSet, script: Step[]): string[] {
  const rt = new Runtime(set);
  const frames = [rt.step([]).at(-1)!.frame];
  const found = (items: any[]): any[] => items.flatMap((item: any) => item.k === "el" && item.tag === "button" ? [item]
    : found(item.children ?? item.inst?.items ?? item.committed?.inst?.items ?? item.committedRows?.flatMap((r: any) => r.inst.items) ?? []));
  try {
    for (const s of script) {
      if ("click" in s) {
        found(rt.view.items)[s.click].attrs.find((a: any) => a.name === "onClick").node.compute(rt)();
        frames.push(rt.handler([]).at(-1)!.frame);
      } else frames.push(rt.land('"assignIssue:' + s.answer + '"', s.failure ? new Error(s.failure) : s.owner, !!s.failure).at(-1)!.frame);
    }
    return frames;
  } finally { rt.root.dispose(); }
}

for (const [name, script, expected] of [
  ["counter", COUNTER, ["0", "2", "4"]],
  ["tracker", TRACKER, [
    "Filter: all2 openCrash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake",
    "Filter: all2 openCrash on save: metakeSlow search: anatakeTypo in footer: nobodytake",
    "Filter: all1 openCrash on save: devtakeSlow search: anatakeTypo in footer: nobodytake",
    "Filter: all1 openCrash on save: devtakeSlow search: metakeTypo in footer: nobodytake",
    "Filter: all1 openCrash on save: devtakeSlow search: anatakeTypo in footer: nobodytakeCould not assign #2",
    "Filter: open1 openTypo in footer: nobodytakeCould not assign #2",
    "Filter: open1 openTypo in footer: metakeCould not assign #2",
    "Filter: open0 openNothing to triage",
  ]],
] as [string, Step[], string[]][]) {
  test("yield " + name + ": canonical facts equal the handwritten RX and the Solid TSX twin", () => {
    const facts = semanticFacts(fromYield(name));
    assert.deepEqual(facts.diagnostics, []);
    assert.ok(facts.modules[0].computations.some(c => c.kind === "action"), "an $event lowers to an action");
    assert.deepEqual(facts, semanticFacts(load(name + ".rx")));
    assert.deepEqual(facts, semanticFacts(load(name + ".tsx")));
  });
  test("yield " + name + ": snapshotting a read in the handwritten RX is a fact difference", () => {
    const rx = fixture(name + ".rx");
    const changed = name === "counter" ? rx.replace("doubled = count * 2", "doubled = peek(count) * 2")
      : rx.replace('issue => mode == "all"', 'issue => peek(mode) == "all"');
    assert.notEqual(changed, rx);
    assert.notDeepEqual(semanticFacts(fromYield(name)), semanticFacts(load(name + ".rx", changed)));
  });
  test("yield " + name + " frames: solid-yield runtime", async () => {
    assert.deepEqual(await solidYield(name, script), expected);
  });
  test("yield " + name + " frames: compiled RX from yield", async () => {
    assert.deepEqual(await compiled(fromYield(name), script), expected);
  });
  test("yield " + name + " frames: interpreted RX from yield", () => {
    assert.deepEqual(interpreted(fromYield(name), script), expected);
  });
  test("yield " + name + " frames: compiled handwritten RX", async () => {
    assert.deepEqual(await compiled(load(name + ".rx"), script), expected);
  });
  test("yield " + name + " frames: interpreted handwritten RX", () => {
    assert.deepEqual(interpreted(load(name + ".rx"), script), expected);
  });
}

test("yield counter: an $event is an action, so the plain-handler Solid counter is a different program", () => {
  const plain = readFileSync(new URL("../tsx/fixtures/paired/counter.tsx", import.meta.url), "utf8");
  assert.notDeepEqual(semanticFacts(fromYield("counter")), semanticFacts(load("counter.tsx", plain)));
});

const counter = fixture("counter.yield.tsx");
const refused = (source: string, at: string, message: RegExp) => {
  assert.ok(source.includes(at), "the refusal site exists: " + at);
  assert.throws(() => loadYieldModules("main.tsx", p => (p === "main.tsx" ? source : API[p])), (error: unknown) => {
    assert.ok(error instanceof YieldError, String(error));
    assert.equal(error.start, source.indexOf(at), "refused at " + at + ": " + error.message);
    assert.match(error.message, message);
    return true;
  });
};
test("yield refusals: forms outside the subset, or that would behave differently from RX, are refused at their source", () => {
  refused(counter.replace("const increment = $event(", "const now = yield* count;\n  const increment = $event("), "yield* count;\n", /a setup never reads/);
  refused(counter.replace("yield* setCount((yield* count) + 1);", "setCount((yield* count) + 1);"), "setCount((yield* count) + 1);", /returns a receipt/);
  refused(counter.replace("yield* setCount((yield* count) + 1);", "try { yield* setCount(1); } catch (e) {}"), "try {", /no-try-catch/);
  refused(counter.replace("{yield* doubled}</button>", "{yield* doubled}<Counter /></button>"), "<Counter />", /never tagged/);
  refused(counter.replace("$event(function* () {", "$event(async function* () {"), "async function* () {", /never async/);
  refused(counter.replace("import { $event,", "import { $effect, $event,"), "$effect", /effects are not in the yield subset/);
  refused(counter.replace("const increment = $event(function* () {", "const increment = $event(function* (step: number) {"), "increment}", /events with parameters/);
  refused(counter.replace("return view(function* () {", "return view(function* () {\n    const n = 1;"), "function* () {\n    const n", /a view has no body/);
  const tracker = fixture("tracker.yield.tsx");
  refused(tracker.replace("function* () {\n        yield* setStatus", "(cause) => new Error(String(cause)), function* () {\n        yield* setStatus"), "(cause) =>", /only an absorbing handler/);
  refused(tracker.replace("import { $event,", "import { $optimisticStore, $event,"), "$optimisticStore", /createOptimisticStore/);
  refused(tracker.replace("const owner: string | undefined =", "const owner ="), "owner = yield*", /annotate the attempt's result/);
  refused(tracker.replace('yield* setStatus("");', 'yield* setStatus(yield* mode);'), "yield* mode);", /read before the attempt/);
});
