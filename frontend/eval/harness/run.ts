// The eval legs (docs/EVAL.md, "Gate"): one program with eval sites, written four ways, run on one recording host
// (plan/fuzz/host.ts) and compared exactly, frames and full host log:
//
//   static       the same code written statically as native components (Static.tsx: each code string a component,
//                the code switch the keyed Show createEval is specified as), compiled by Solid's universal transform;
//   eval-native  the program's TSX (App.tsx) with createEval, the interfaces the frontend derived written into the
//                calls (eval/inject.ts), compiled by Solid's transform; createEval compiles each code string at run
//                time (eval/compile.ts) and runs its plan with solid-plan.ts;
//   eval-plan    the plan emitted from App.rx (and, byte-identically, App.tsx), run by solid-plan.ts, compiling eval
//                sites the same way;
//   rust         the same plan on rust-solid's `plan-trace PLAN SCENARIO EVALS`, where EVALS is the host's table of
//                compiled plans (or refusals) for every eval request the eval-plan leg made.
//
// The scenario is recorded on the static leg (explicit steps, or the plan fuzz's chooser) and replayed on all legs.
// Nothing is filtered or normalized.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { transform } from '@solidjs/compiler';
import { loadTsxModules } from '../../tsx/modules.ts';
import { checkModules, STRING_RENDERER } from '../../tsx/rx/compiler.ts';
import { resolvePlanV2, type Plan } from '../../plan/resolve-v2.ts';
import type { HostSig, Scenario, ScenarioStep, Trace } from '../../plan/fuzz/host.ts';
import { RUST_UNSUPPORTED, RUST_UNSUPPORTED_CLASS } from '../../plan/fuzz/run.ts';
import { compileEval, type EvalRequest } from '../compile.ts';
import { injectInterfaces } from '../inject.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RENDERER = here('../../plan/fuzz/renderer.ts'), SOLID = here('../../plan/fuzz/solid-native.ts'), LEG = here('../../plan/fuzz/leg.ts');
const EVAL_NATIVE = here('./eval-native.ts');
const tmpRoot = here('../../.out/eval/tmp/');
export const EVAL_LEGS = ['static', 'eval-native', 'eval-plan', 'rust'] as const;
export type EvalLeg = (typeof EVAL_LEGS)[number];

export type EvalProgram = {
  name: string;
  /** App.rx and App.tsx (the program, with eval sites), Static.tsx (its static twin), api.d.rx. */
  files: Record<string, string>;
  hosts: HostSig[];
  /** Replay this scenario, or record one on the static leg: explicit steps (frames observed) or the plan fuzz's
   *  chooser for a generated case. */
  scenario?: Scenario; script?: ScenarioStep[]; record?: unknown;
  /** Plan v2.1 (docs/EVAL.md, "Async data"): the enclosing program is emitted with the v2.1 builder and the TSX async
   *  tier, a recorded scenario is format 2.1, and a Rust refusal of a v2.1 plan is `rust-unsupported`. */
  async?: boolean;
  /** Recording with another generator's chooser (plan/fuzz/gen-async.ts). */
  chooser?: string;
};
/** The host's table for the Rust leg (docs/EVAL.md, "Rust"): every eval request and its compiled plan or refusal. */
export type EvalTable = { version: 1; evals: (EvalRequest & ({ plan: Plan } | { refused: { code: string; message: string; line?: number }[] }))[] };
export type EvalOutcome = {
  name: string;
  /** agree: every leg equals the static leg. refused: the code was refused (every eval leg fails with the refusal).
   *  divergent: a leg differs otherwise. invalid: the static leg (the oracle) failed while recording. generator-bug:
   *  the program does not load, or App.rx and App.tsx emit different plans. */
  status: 'agree' | 'refused' | 'divergent' | 'invalid' | 'generator-bug' | 'rust-unsupported';
  classes: string[]; detail?: string;
  /** rust-unsupported (plan v2.1 only): the JS legs agree with the static twin and Rust refused a v2.1 plan. */
  rustUnsupported?: string;
  plan?: Plan; scenario?: Scenario; table?: EvalTable; traces?: Partial<Record<EvalLeg, Trace>>;
};

function leg(input: object, timeoutMs: number): Promise<(Trace & { steps?: ScenarioStep[]; requests?: EvalRequest[] }) | { invalid: string; detail?: string }> {
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

/** Solid's universal transform, with the leg's renderer, solid-js and eval modules. */
export function compileNative(tsx: string, filename: string): string {
  return transform(tsx, { filename, generate: 'universal', moduleName: STRING_RENDERER }).code
    .replaceAll('"' + STRING_RENDERER + '"', JSON.stringify(RENDERER)).replaceAll('"solid-js"', JSON.stringify(SOLID))
    .replaceAll('"./api"', '"./api.mjs"').replaceAll('"reactivescript-tsx/eval"', JSON.stringify(EVAL_NATIVE));
}

/** The plan of a program with eval sites, from App.rx and from App.tsx: they must be byte-identical. */
export function emitPlans(files: Record<string, string>, async = false): { plan: string } | { error: string } {
  const plans: string[] = [];
  for (const name of ['App.rx', 'App.tsx']) {
    try {
      const set = loadTsxModules(name, p => files[p], async ? { async } : {});
      if (set.diags.length) throw new Error(set.diags.map(d => d.code + ': ' + d.msg).join('; '));
      const diags = checkModules(set).diags;
      if (diags.length) throw new Error(diags.map(d => d.code + ' (' + d.line + '): ' + d.msg).join('; '));
      plans.push(JSON.stringify(resolvePlanV2(set, async ? { async } : {}), null, 2));
    } catch (e) { return { error: name + ': ' + (e as Error).message }; }
  }
  if (plans[0] !== plans[1]) return { error: 'App.rx and App.tsx emit different plans' };
  return { plan: plans[0] };
}

/** The Rust leg's table: each request compiled again by eval/compile.ts, in the order the eval-plan leg made them. */
export function evalTable(requests: EvalRequest[]): EvalTable {
  return { version: 1, evals: requests.map(r => {
    const c = compileEval(r);
    return c.ok ? { ...r, plan: c.plan } : { ...r, refused: c.diagnostics };
  }) };
}

const strip = (t: Trace & { steps?: unknown; created?: unknown; requests?: unknown }): Trace => ({ result: t.result, log: t.log });

export async function runEvalProgram(p: EvalProgram, opts: { rust?: string; timeoutMs?: number; keep?: string } = {}): Promise<EvalOutcome> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const out: EvalOutcome = { name: p.name, status: 'agree', classes: [] };
  const emitted = emitPlans(p.files, p.async);
  if ('error' in emitted) return { ...out, status: 'generator-bug', classes: ['outer plan'], detail: emitted.error };
  const plan = JSON.parse(emitted.plan) as Plan;
  out.plan = plan;
  let evalTsx: string;
  try { evalTsx = injectInterfaces('App.tsx', f => p.files[f], p.async ? { async: true } : {}); } catch (e) { return { ...out, status: 'generator-bug', classes: ['inject'], detail: (e as Error).message }; }
  mkdirSync(tmpRoot, { recursive: true });
  const dir = opts.keep ?? mkdtempSync(tmpRoot + 'case-');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(dir + '/static.mts', compileNative(p.files['Static.tsx'], 'Static.tsx'));
    writeFileSync(dir + '/eval.mts', compileNative(evalTsx, 'App.tsx'));
    writeFileSync(dir + '/App.injected.tsx', evalTsx);
    writeFileSync(dir + '/api.mjs', p.hosts.map(h => 'export const ' + h.name + ' = globalThis.__planFuzzApi.' + h.name + ';').join('\n') + '\n');
    writeFileSync(dir + '/app.plan.json', emitted.plan + '\n');
    const common = { hosts: p.hosts, actions: [], catchUncaught: true };

    let scenario: Scenario, record: Trace | undefined;
    if (p.scenario) scenario = p.scenario;
    else {
      const rec = await leg({ ...common, leg: 'native', entry: dir + '/static.mts', ...(p.record ? { record: { case: p.record, maxSteps: 200, ...(p.chooser ? { chooser: p.chooser } : {}) } } : { script: p.script }) }, timeoutMs);
      if ('invalid' in rec) return { ...out, status: 'invalid', classes: ['oracle-' + rec.invalid], detail: rec.detail };
      if ('error' in rec.result) return { ...out, status: 'invalid', classes: [/reactivity halted/.test(rec.result.error) ? 'oracle-halted' : 'oracle-error'], detail: rec.result.error };
      scenario = { version: p.async ? 2.1 : 2, name: p.name, fixture: 'app', host: p.hosts, steps: rec.steps! };
      record = strip(rec);
    }
    out.scenario = scenario;
    writeFileSync(dir + '/app.scenario.json', JSON.stringify(scenario, null, 2) + '\n');
    const traces: Partial<Record<EvalLeg, Trace>> = {};
    const replay = async (l: 'static' | 'eval-native' | 'eval-plan') => {
      const r = await leg({ ...common, leg: l === 'eval-plan' ? 'plan' : 'native', steps: scenario.steps, entry: dir + (l === 'static' ? '/static.mts' : '/eval.mts'), plan, compile: l === 'eval-plan' }, timeoutMs);
      return 'invalid' in r ? { trace: { result: { error: 'leg ' + r.invalid + ': ' + (r.detail ?? '') }, log: [] }, requests: [] } : { trace: strip(r), requests: r.requests ?? [] };
    };
    traces.static = (await replay('static')).trace;
    if (record && JSON.stringify(traces.static) !== JSON.stringify(record)) out.classes.push('static: recording and replay differ');
    if (!record && 'error' in traces.static.result) out.classes.push('static: ' + traces.static.result.error);
    traces['eval-native'] = (await replay('eval-native')).trace;
    const viaPlan = await replay('eval-plan');
    traces['eval-plan'] = viaPlan.trace;
    out.table = evalTable(viaPlan.requests);
    writeFileSync(dir + '/app.evals.json', JSON.stringify(out.table) + '\n');
    // Plan v2.1: a v2.1 plan (the enclosing one, or one in the table) the Rust consumer refuses by its version is
    // reported as rust-unsupported, never compared and never agreement.
    const v21 = plan.version === 2.1 || out.table.evals.some(e => 'plan' in e && e.plan.version === 2.1);
    let rustUnsupported: string | undefined;
    if (opts.rust) {
      const r = spawnSync(opts.rust, [dir + '/app.plan.json', dir + '/app.scenario.json', dir + '/app.evals.json'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28 });
      if ((r.status !== 0 && r.status !== 1) || !r.stdout) {
        if (p.async && v21 && r.status === 1 && !r.stdout && RUST_UNSUPPORTED.test(r.stderr)) rustUnsupported = r.stderr.trim();
        else traces.rust = { result: { error: 'plan-trace failed: ' + r.status + ' ' + r.signal + ' ' + r.stderr }, log: [] };
      } else traces.rust = JSON.parse(r.stdout);
    }
    const unsupported = (o: EvalOutcome): EvalOutcome => rustUnsupported === undefined ? o
      : { ...o, rustUnsupported, classes: [...o.classes, RUST_UNSUPPORTED_CLASS], status: o.status === 'agree' ? 'rust-unsupported' : o.status };
    out.traces = traces;
    const refusals = out.table.evals.filter(e => 'refused' in e);
    for (const l of ['eval-native', 'eval-plan', 'rust'] as const) {
      const t = traces[l];
      if (!t || JSON.stringify(t) === JSON.stringify(traces.static)) continue;
      out.classes.push(l + ': ' + (JSON.stringify(t.result) === JSON.stringify(traces.static.result) ? 'host log' : 'result'));
    }
    if (refusals.length) {
      // A refused evaluation is never agreement. Every eval leg must fail with the refusal (an EvalRefused, the same
      // diagnostics), and the static twin is kept as the program the code would have been.
      const message = (t?: Trace) => t && 'error' in t.result ? t.result.error : '';
      const first = refusals[0] as { refused: { code: string; message: string; line?: number }[] };
      const expected = 'eval refused: ' + first.refused.map(d => d.code + (d.line !== undefined ? ' (line ' + d.line + ')' : '') + ': ' + d.message).join('; ');
      const legs = (['eval-native', 'eval-plan', 'rust'] as const).filter(l => traces[l]);
      const wrong: string[] = legs.filter(l => !message(traces[l]).includes(expected));
      // The two JS legs fail identically, log included (Rust's log ends where its run fails: compared by message).
      if (JSON.stringify(traces['eval-native']) !== JSON.stringify(traces['eval-plan'])) wrong.push('eval-native and eval-plan');
      return unsupported({ ...out, status: wrong.length ? 'divergent' : 'refused', classes: wrong.map(l => l + ': not the refusal'), detail: expected });
    }
    if (out.classes.length) out.status = 'divergent';
    return unsupported(out);
  } finally { if (!opts.keep) rmSync(dir, { recursive: true, force: true }); }
}
