// The plan fuzz for one program (plan/docs/PLAN-V2.md, "Plan fuzz"): load the TSX and RX twins through their
// frontends and the pinned checker, emit the v2 plan from each (they must be byte-identical), record a scenario on
// native Solid with the generator's chooser, then replay it on four legs: native Solid, compiled RX, the plan built by
// solid-plan.ts, and the Rust plan v2 consumer (`plan-trace`). Each leg yields its result and full host log; all must
// equal native's exactly. Nothing is filtered or normalized.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser/src-js/index';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { transform } from '@solidjs/compiler';
import { loadTsxModules } from '../../tsx/modules.ts';
import { checkModules, compileModules, lowerViews, STRING_RENDERER, type ModuleSet } from '../../tsx/rx/compiler.ts';
import { resolvePlanV2 } from '../resolve-v2.ts';
import type { HostSig, Scenario, ScenarioStep, Trace } from './host.ts';
import { emit, emitYield, HOST_TYPE, lastNoYield, type Case } from './gen.ts';
import { loadYieldModules } from '../../yield/lower.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RENDERER = here('./renderer.ts'), SOLID = here('./solid-native.ts'), LEG = here('./leg.ts');
const tmpRoot = here('../../.out/plan-fuzz/tmp/');
export const LEGS = ['native', 'rx', 'plan', 'rust'] as const;
/** The upstream RX classes: only compiled RX differs, and a probe (leg.ts directOptimistic, pathInSetter) that changes
 *  just that lowering removes the difference. */
export const UPSTREAM_RX = 'upstream: RX optimistic source is a guess layer over a computed signal (AC-3)';
export const UPSTREAM_RX_PATH = 'upstream: RX evaluates a path write\'s keys and value before the store setter';
const UPSTREAM = [UPSTREAM_RX, UPSTREAM_RX_PATH];

/** The probe's rewrite of compiled RX: `w$x.path(keys, value)` becomes `w$x.pathIn(() => (keys), () => (value))`. */
export function pathsInSetter(code: string): string {
  const calls: { callee: [number, number]; args: [number, number][] }[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.computed && n.callee.property?.name === 'path'
      && n.callee.object?.type === 'Identifier' && n.callee.object.name.startsWith('w$') && n.arguments.length === 2)
      calls.push({ callee: [n.callee.property.start, n.callee.property.end], args: n.arguments.map((a: any) => [a.start, a.end]) });
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(parseSync('probe.mjs', code).program);
  const edits = calls.flatMap(c => [{ at: c.callee, text: 'pathIn' }, ...c.args.map(a => ({ at: a, text: '() => (' + code.slice(a[0], a[1]) + ')' }))]);
  edits.sort((a, b) => b.at[0] - a.at[0]);
  let out = code;
  for (const e of edits) out = out.slice(0, e.at[0]) + e.text + out.slice(e.at[1]);
  return out;
}
export type Leg = (typeof LEGS)[number];
export type Outcome = {
  seed: number; family: string;
  /** agree: every leg equals native. upstream: only compiled RX differs, by the probed upstream class (UPSTREAM_RX);
   *  the plan legs agree. divergent: some leg differs otherwise. refused: the emitter refused (diagnostic).
   *  invalid: the oracle (native Solid, recording) failed (class as the rust fuzzers: oracle-error, -halted, -timeout).
   *  generator-bug: a twin does not load or check, or the twins' plans differ. */
  status: 'agree' | 'upstream' | 'divergent' | 'refused' | 'invalid' | 'generator-bug';
  classes: string[]; detail?: string; refusedClasses?: string[];
  files: Record<string, string>; plan?: unknown; scenario?: Scenario; traces?: Partial<Record<Leg, Trace>>;
  nodes?: Record<string, number>; features?: string[];
  /** The yield twin: its plan equals the RX plan ('same'), or it differs, or the yield frontend refused it, or the
   *  program has none (gen.ts emitYield: the dialect cannot spell it). */
  yield?: string;
};

function load(name: string, files: Record<string, string>): ModuleSet {
  const set = loadTsxModules(name, p => files[p]);
  if (set.diags.length) throw new Error(set.diags.map(d => d.code + ': ' + d.msg).join('; '));
  const checked = checkModules(set).diags;
  if (checked.length) throw new Error(checked.map(d => d.code + ' (' + d.file + ':' + d.line + '): ' + d.msg).join('; '));
  return set;
}

function leg(input: object, timeoutMs: number): Promise<(Trace & { steps?: ScenarioStep[]; created: number }) | { invalid: string; detail?: string }> {
  return new Promise(resolve => {
    const w = new Worker(LEG, { workerData: input, execArgv: ['--experimental-strip-types', '--conditions=browser', '--disable-warning=ExperimentalWarning'], stderr: true, stdout: true });
    let err = '';
    w.stderr.on('data', d => { err += d; });
    w.stdout.on('data', () => {});
    const timer = setTimeout(() => { void w.terminate(); resolve({ invalid: 'timeout' }); }, timeoutMs);
    w.once('message', m => { clearTimeout(timer); void w.terminate(); resolve(m); });
    w.once('error', e => { clearTimeout(timer); resolve({ invalid: 'error', detail: String(e.stack ?? e) + err }); });
    w.once('exit', code => { clearTimeout(timer); resolve({ invalid: 'exit', detail: 'worker exited ' + code + ' ' + err }); });
  });
}

const firstDifference = (a: Trace, b: Trace) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  const n = Math.max(a.log.length, b.log.length);
  for (let i = 0; i < n; i++) if (JSON.stringify(a.log[i]) !== JSON.stringify(b.log[i])) {
    const kind = (e: unknown) => Array.isArray(e) ? String(e[0]) : 'end';
    return { at: i, kind: kind(a.log[i]) + '-' + kind(b.log[i]) };
  }
  return { at: -1, kind: 'result' };
};

/** Plan node kinds a plan contains: expression ops, step ops (and their variants), view kinds, source kinds. */
export function planNodes(plan: any): Record<string, number> {
  const out: Record<string, number> = {};
  const count = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  const walk = (x: any, where: string) => {
    if (Array.isArray(x)) { x.forEach(y => walk(y, where)); return; }
    if (x === null || typeof x !== 'object') return;
    if (where === 'view' && typeof x.kind === 'string') count('view:' + x.kind + (x.kind === 'text' ? (x.value.op === 'literal' ? ':static' : ':dynamic') : ''));
    if (typeof x.op === 'string') {
      if (where === 'step') count('step:' + x.op + (x.op === 'write' ? (x.path ? ':path' : ':signal') : x.op === 'optimistic' ? ('updater' in x ? ':updater' : ':value') : ''));
      else count('expr:' + x.op);
    }
    for (const [k, v] of Object.entries(x)) {
      const next = k === 'steps' || k === 'body' && where === 'step' || k === 'catch' ? 'step'
        : k === 'markup' || k === 'children' || k === 'fallback' ? 'view' : where === 'step' && k !== 'steps' || where === 'view' && k !== 'children' ? 'expr' : where;
      if (k === 'events') { (v as any[]).forEach(e => { count('event:' + e.name); walk(e.steps, 'step'); }); continue; }
      if (where === 'view' && k === 'value' || where === 'view' && (k === 'when' || k === 'each')) { walk(v, 'expr'); continue; }
      walk(v, next);
    }
  };
  for (const s of plan.sources) { count('source:' + s.kind); walk(s.seed, 'expr'); }
  for (const m of plan.memos) { count('memo'); walk(m.value, 'expr'); }
  for (const a of plan.actions) { count('action'); walk(a.steps, 'step'); }
  walk(plan.markup, 'view');
  return out;
}

/** What a recorded scenario exercised, from its steps and native's log (requests are logged during the step that
 *  issues them): overlapping requests, a settlement out of issue order, a rejection, a filter toggle while a request is
 *  pending, two pending row requests for one row, a plain store write while a row action (its guess) is in flight. */
export function scenarioFeatures(c: Case, scenario: Scenario, log: unknown[]): string[] {
  const out = new Set<string>();
  const pending: { host: string; call: number; args: unknown[] }[] = [];
  let step = 0;
  const role = (h: string) => c.hosts.find(x => x.name === h)?.role;
  for (const e of log as unknown[][]) {
    if (e[0] === 'request') {
      pending.push({ host: e[1] as string, call: e[2] as number, args: e[3] as unknown[] });
      if (pending.length > 1) out.add('overlapping requests');
      const rows = pending.filter(p => role(p.host) === 'row');
      if (rows.some((p, i) => rows.some((q, j) => i < j && JSON.stringify(p.args) === JSON.stringify(q.args)))) out.add('two claims on one row');
    }
    if (e[0] !== 'step') continue;
    step = (e[1] as number) + 1;
    const next = scenario.steps[step];
    if (!next) continue;
    if (next.type === 'resolve' || next.type === 'reject') {
      const i = pending.findIndex(p => p.host === next.host && p.call === next.call);
      if (i > 0) out.add('settled out of order');
      if (next.type === 'reject') out.add('rejection');
      pending.splice(i, 1);
    } else if (next.type === 'click' && 'target' in next && pending.length) {
      if (next.target.text.startsWith('Filter: ')) out.add('filter toggle while pending');
      if (['poke', 'edit', 'add'].includes(next.target.text) && pending.some(p => role(p.host) === 'row' || role(p.host) === 'second')) out.add('store write under a live guess');
      if (next.target.text === 'inc' && pending.some(p => role(p.host) === 'scalar')) out.add('base write under a live guess');
    }
  }
  return [...out].sort();
}

/** One program for the four legs: its TSX and RX twins (App.tsx, App.rx) and host declarations (api.d.rx), and either
 *  a scenario to replay or the generated case whose chooser records one on native Solid. */
export type Program = {
  seed: number; family: string; files: Record<string, string>; hosts: HostSig[]; actions: string[];
  scenario?: Scenario; record?: Case;
};

export const hostSigs = (c: Case): HostSig[] => c.hosts.map(h => ({ name: h.name, parameters: h.params.map(p => HOST_TYPE[p]), returns: HOST_TYPE[h.returns], async: true }));

export async function runCase(c: Case, opts: { rust?: string; timeoutMs?: number; keep?: string } = {}): Promise<Outcome> {
  const files = emit(c), twin = emitYield(c), none = lastNoYield;
  const o = await runProgram({ seed: c.seed, family: c.family, files, hosts: hostSigs(c), actions: c.actions.map(a => a.name), record: c }, opts);
  if (o.status === 'generator-bug') return o;
  if (twin === undefined) return { ...o, yield: 'none: ' + none };
  // The yield twin emits through its own frontend; its plan (or refusal) must be the RX twin's.
  o.files = { ...o.files, 'App.yield.tsx': twin };
  let plan: string;
  try { plan = JSON.stringify(resolvePlanV2(loadYieldModules('App.yield.tsx', p => p === 'App.yield.tsx' ? twin : files[p])), null, 2); }
  catch (e) { plan = 'refused: ' + String((e as Error).message).split('\n')[0]; }
  const rx = o.plan ? JSON.stringify(o.plan, null, 2) : 'refused: ' + o.detail;
  if (plan === rx) return { ...o, yield: 'same' };
  if (plan.startsWith('refused: ') && !rx.startsWith('refused: ')) return { ...o, yield: 'refused by the yield frontend: ' + plan.slice(9) };
  return { ...o, yield: 'differs', status: 'divergent', classes: [...o.classes, 'emitter: the yield twin\'s plan differs'] };
}

export async function runProgram(p: Program, opts: { rust?: string; timeoutMs?: number; keep?: string } = {}): Promise<Outcome> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const files = p.files;
  const out: Outcome = { seed: p.seed, family: p.family, status: 'agree', classes: [], files };
  const api = { 'api.d.rx': files['api.d.rx'] };
  let tsxSet: ModuleSet, rxSet: ModuleSet;
  try { tsxSet = load('App.tsx', { 'App.tsx': files['App.tsx'], ...api }); } catch (e) { return { ...out, status: 'generator-bug', classes: ['generator: TSX'], detail: String((e as Error).message) }; }
  try { rxSet = load('App.rx', { 'App.rx': files['App.rx'], ...api }); } catch (e) { return { ...out, status: 'generator-bug', classes: ['generator: RX'], detail: String((e as Error).message) }; }
  let plan: unknown, refused: string | undefined;
  const plans: string[] = [];
  for (const set of [rxSet, tsxSet]) {
    try { plans.push(JSON.stringify(resolvePlanV2(set), null, 2)); } catch (e) { plans.push('refused: ' + (e as Error).message); }
  }
  if (plans[0] !== plans[1]) return { ...out, status: 'generator-bug', classes: ['emitter: TSX and RX plans differ'], detail: plans.join('\n----\n') };
  if (plans[0].startsWith('refused: ')) refused = plans[0].slice(9); else { plan = JSON.parse(plans[0]); out.plan = plan; out.nodes = planNodes(plan); }

  mkdirSync(tmpRoot, { recursive: true });
  const dir = opts.keep ?? mkdtempSync(tmpRoot + 'case-');
  mkdirSync(dir, { recursive: true });
  try {
    const native = transform(files['App.tsx'], { filename: 'App.tsx', generate: 'universal', moduleName: STRING_RENDERER }).code
      .replaceAll('"' + STRING_RENDERER + '"', JSON.stringify(RENDERER)).replaceAll('"solid-js"', JSON.stringify(SOLID)).replaceAll('"./api"', '"./api.mjs"');
    writeFileSync(dir + '/native.mts', native);
    writeFileSync(dir + '/api.mjs', p.hosts.map(h => 'export const ' + h.name + ' = globalThis.__planFuzzApi.' + h.name + ';').join('\n') + '\n');
    const built = compileModules(rxSet);
    for (const [name, code] of lowerViews(built.files, 'universal')) writeFileSync(dir + '/' + name, code.replaceAll(STRING_RENDERER, RENDERER));
    const common = { hosts: p.hosts, actions: p.actions };
    const strip = (t: Trace & { steps?: unknown; created?: unknown }): Trace => ({ result: t.result, log: t.log });

    // The scenario: given, or recorded on native Solid (the oracle) with the generator's chooser.
    let scenario: Scenario, record: Trace | undefined;
    if (p.scenario) scenario = p.scenario;
    else {
      const rec = await leg({ ...common, leg: 'native', entry: dir + '/native.mts', record: { case: p.record, maxSteps: 200 } }, timeoutMs);
      if ('invalid' in rec) return { ...out, status: 'invalid', classes: ['oracle-' + rec.invalid], detail: rec.detail };
      if ('error' in rec.result) {
        const halted = /reactivity halted/.test(rec.result.error);
        return { ...out, status: 'invalid', classes: [halted ? 'oracle-halted' : 'oracle-error'], detail: rec.result.error };
      }
      if (rec.created !== p.actions.length) return { ...out, status: 'generator-bug', classes: ['generator: native created ' + rec.created + ' actions'] };
      scenario = { version: 2, name: 'plan fuzz seed ' + p.seed, fixture: 'app', host: p.hosts, steps: rec.steps! };
      record = strip(rec);
    }
    out.scenario = scenario;
    writeFileSync(dir + '/app.scenario.json', JSON.stringify(scenario, null, 2) + '\n');
    const traces: Partial<Record<Leg, Trace>> = {};
    const replay = async (l: 'native' | 'rx' | 'plan') => {
      const r = await leg({ ...common, leg: l, steps: scenario.steps, entry: l === 'native' ? dir + '/native.mts' : l === 'rx' ? dir + '/' + built.entry : undefined, plan }, timeoutMs);
      return 'invalid' in r ? { result: { error: 'leg ' + r.invalid + ': ' + (r.detail ?? '') }, log: [] } : strip(r);
    };
    traces.native = await replay('native');
    if (record && JSON.stringify(traces.native) !== JSON.stringify(record)) out.classes.push('native: recording and replay differ');
    if (!record && 'error' in traces.native.result) out.classes.push('native: ' + traces.native.result.error);
    traces.rx = await replay('rx');
    if (plan) {
      traces.plan = await replay('plan');
      writeFileSync(dir + '/app.plan.json', plans[0] + '\n');
      if (opts.rust) {
        const r = spawnSync(opts.rust, [dir + '/app.plan.json', dir + '/app.scenario.json'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28 });
        if ((r.status !== 0 && r.status !== 1) || !r.stdout) traces.rust = { result: { error: 'plan-trace failed: ' + r.status + ' ' + r.signal + ' ' + r.stderr }, log: [] };
        else traces.rust = JSON.parse(r.stdout);
      }
    }
    out.traces = traces;
    if (p.record) out.features = scenarioFeatures(p.record, scenario, traces.native!.log);
    for (const l of ['rx', 'plan', 'rust'] as const) {
      const t = traces[l];
      if (!t) continue;
      const d = firstDifference(traces.native!, t);
      if (!d) continue;
      // RX alone differs: probe the one known upstream cause. If RX with its optimistic sources lowered as native's
      // createOptimistic(fn) gives native's exact trace, the difference is upstream's AC-3 guess layer (a node deeper
      // than native's), not the plan's: classified apart, never counted as agreement.
      if (l === 'rx') {
        const probe = async (o: { directOptimistic?: boolean; pathInSetter?: boolean }) => {
          const r = await leg({ ...common, leg: 'rx', steps: scenario.steps, entry: dir + '/' + (o.pathInSetter ? probeEntry : built.entry), ...o }, timeoutMs);
          return !('invalid' in r) && JSON.stringify(strip(r)) === JSON.stringify(traces.native);
        };
        const probeEntry = 'probe-' + built.entry;
        writeFileSync(dir + '/' + probeEntry, pathsInSetter(readFileSync(dir + '/' + built.entry, 'utf8')));
        if (await probe({ directOptimistic: true })) { out.classes.push(UPSTREAM_RX); continue; }
        if (await probe({ pathInSetter: true })) { out.classes.push(UPSTREAM_RX_PATH); continue; }
        if (await probe({ directOptimistic: true, pathInSetter: true })) { out.classes.push(UPSTREAM_RX, UPSTREAM_RX_PATH); continue; }
      }
      out.classes.push(l + ': ' + d.kind);
    }
    // A refused program has no plan legs; native and RX are still compared, and their differences kept apart.
    if (refused) return { ...out, status: 'refused', detail: refused, classes: [], refusedClasses: out.classes };
    if (out.classes.length) out.status = out.classes.every(k => UPSTREAM.includes(k)) ? 'upstream' : 'divergent';
    return out;
  } finally { if (!opts.keep) rmSync(dir, { recursive: true, force: true }); }
}
