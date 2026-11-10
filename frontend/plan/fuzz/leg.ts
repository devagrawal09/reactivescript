// One JS leg of the plan fuzz, in a fresh worker thread (a fresh Solid and module graph per run, as rust-solid's
// oracle workers): native Solid (the TSX compiled by Solid's universal transform), compiled RX (the upstream compiler
// on its runtime), or the plan built by solid-plan.ts, all on the recording host of host.ts. It replays a scenario, or
// records one with the generator's chooser. Posts the trace (and, when recording, the steps).
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { createHost, type HostSig, type ScenarioStep } from './host.ts';

export type LegInput = {
  leg: 'native' | 'rx' | 'plan';
  /** native: the compiled module; rx: the compiled entry module. Both import the renderer, solid shim and api by path. */
  entry?: string;
  plan?: unknown;
  hosts: HostSig[];
  /** Declared action names in declaration order (native's creation order). */
  actions: string[];
  steps?: ScenarioStep[];
  /** rx only, a root-cause probe: lower RX's optimistic sources as native does, `createOptimistic(fn)`, instead of
   *  upstream's guess layer over a computed signal (rt.ts `question`, AC-3). Never used for a verdict of agreement. */
  directOptimistic?: boolean;
  /** rx only, a root-cause probe: the entry's `w$x.path(keys, value)` calls are rewritten (run.ts) to
   *  `w$x.pathIn(() => keys, () => value)`, and a structured source's writer evaluates both inside the store setter,
   *  where the TSX twin evaluates `draft.a[i].b = v`. Never used for a verdict of agreement. */
  pathInSetter?: boolean;
  /** Recording: the case the generator's chooser is rebuilt from. */
  record?: { case: unknown; maxSteps: number; chooser?: string };
  /** plan only (docs/EVAL.md): compile eval sites with eval/compile.ts; the leg reports every request it compiled. */
  compile?: boolean;
  /** Recording without a generated case: explicit steps whose frames are observed (the eval slice). */
  script?: ScenarioStep[];
  /** The eval legs: an exception the reactive graph throws outside any boundary (a refused evaluation) fails the step
   *  with its message (host.ts reportError), instead of ending the worker. */
  catchUncaught?: boolean;
};

const input = workerData as LegInput;
const host = createHost();
(globalThis as any).__planFuzzHost = host;
if (input.catchUncaught) process.on('uncaughtException', e => host.reportError(e));
const api = host.api(input.hosts);
(globalThis as any).__planFuzzApi = api;
let component: () => unknown;
let created = 0;
/** The eval requests the plan leg compiled, in first-use order (docs/EVAL.md; the Rust leg's table). */
const requests: unknown[] = [];
const wrap = (name: () => string) => (run: (...a: unknown[]) => Promise<unknown>) => {
  const f = (...a: unknown[]) => { const p = run(...a); host.watchAction(name(), p); return p; };
  return f;
};
if (input.leg === 'native') {
  let anonymous = 0;
  (globalThis as any).__planFuzzAction = (run: (...a: unknown[]) => Promise<unknown>, named?: string) => {
    created++;
    if (named) return wrap(() => named)(run);
    const k = anonymous++;
    if (k >= input.actions.length) throw new Error('native created more actions than the program declares');
    return wrap(() => input.actions[k])(run);
  };
  const mod = await import(pathToFileURL(input.entry!).href);
  component = () => mod.default();
} else if (input.leg === 'rx') {
  const { createApp } = await import('../../tsx/rx/runtime.ts');
  const app: any = createApp({ api });
  // RX registers each declared action by name right after creating it (`__rt.reg(name, { value })`).
  const names = new WeakMap<object, string>();
  const action = app.action, reg = app.reg;
  app.action = (gen: unknown) => { const f: any = wrap(() => { const n = names.get(f); if (n === undefined) throw new Error('an RX action was called before it was registered'); return n; })(action(gen)); created++; return f; };
  app.reg = (name: string, e: { value?: unknown }) => { if (typeof e?.value === 'function') names.set(e.value as object, name); return reg(name, e); };
  if (input.directOptimistic) {
    const { createOptimistic } = await import('solid-js');
    const question = app.question;
    app.question = (name: string, compute: (prev: unknown) => unknown, opts: unknown, mode: { optimistic: boolean; structured: boolean }, key?: string) => {
      if (!mode.optimistic || mode.structured || opts !== undefined || key !== undefined) return question(name, compute, opts, mode, key);
      const [get, guess] = (createOptimistic as any)(() => compute(undefined));
      const no = () => { throw new Error('the probe lowers only guesses to an optimistic source'); };
      return [get, { set: no, path: no, guess }];
    };
  }
  if (input.pathInSetter) {
    // upstream rt.ts `source`, structured branch (ST-1, ST-2a), with `pathIn` beside `path`.
    const { createSignal, createStore } = await import('solid-js');
    const source = app.source;
    app.source = (name: string, init: unknown) => {
      if (typeof init !== 'object' || init === null) return source(name, init);
      const [store, setStore] = (createStore as any)(init); const [get, set] = (createSignal as any)(store);
      const at = (d: any, keys: (string | number)[], v: () => unknown) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v(); };
      return [get, {
        set: (v: unknown) => { if (typeof v === 'function') { setStore(v); set(store); } else if (typeof v === 'object' && v !== null) { setStore(() => v); set(store); } else set(v); },
        path: (keys: (string | number)[], v: unknown) => setStore((d: any) => at(d, keys, () => v)),
        pathIn: (keys: () => (string | number)[], v: () => unknown) => setStore((d: any) => at(d, keys(), v)),
        guess: () => { throw new Error('OPTIMISTIC_NO_QUESTION'); },
      }];
    };
  }
  const mod = await import(pathToFileURL(input.entry!).href);
  component = mod.default(app);
} else {
  const { planComponent } = await import('../solid-plan.ts');
  let compile;
  if (input.compile) {
    const { compileOrThrow } = await import('../../eval/runtime.ts');
    compile = (request: Parameters<typeof compileOrThrow>[0]) => {
      if (!requests.some(r => JSON.stringify(r) === JSON.stringify(request))) requests.push(request);
      return compileOrThrow(request);
    };
  }
  component = planComponent(input.plan as never, api as never, { renderer: host.R, onAction: host.watchAction, ...(compile ? { compile } : {}) });
}
let chooser;
if (input.record) {
  // The generator's chooser: gen.ts's, or another generator module's (gen-async.ts, plan v2.1).
  const { chooserFor } = await import(input.record.chooser ? pathToFileURL(input.record.chooser).href : './gen.ts');
  chooser = chooserFor(input.record.case as never);
} else if (input.script) {
  const script = input.script;
  chooser = (_live: unknown, index: number) => { const s = script[index]; if (!s) return null; const { frame: _, ...step } = s; return step as never; };
}
const out = await host.run(component, { host: input.hosts, steps: input.steps }, chooser, input.record?.maxSteps ?? input.script?.length ?? 0);
parentPort!.postMessage({ ...out, created, ...(input.compile ? { requests } : {}) });
