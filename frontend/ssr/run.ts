// Slice 5, one program: Rust's server HTML against Solid's own, and both hydrated by Solid's client (docs/RESULTS.md,
// "Slice 5: server rendering"). For a program (its TSX twin, and its plan or the plan's refusal):
//  1. Solid renders the TSX on the server: compiled { generate: "ssr", hydratable: true }, renderToString in a fresh
//     worker on the production server builds (server-leg.ts).
//  2. Rust renders the plan: rust-solid's `ssr` binary (the port of the server builds plus the compiler's SSR lowering of
//     the plan's canonical TSX twin). The HTML must be Solid's byte for byte.
//  3. Chromium loads each HTML, Solid's hydratable client build of the same TSX hydrates it, and the scenario runs on
//     (browser.ts): no mismatch, every frame the scenario's. Solid's HTML is the control.
// Nothing is filtered or normalized; every difference is kept with its class.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { transform } from '@solidjs/compiler';
import { loadTsxModules } from '../tsx/modules.ts';
import { checkModules, STRING_RENDERER, type ModuleSet } from '../tsx/rx/compiler.ts';
import { resolvePlanV2 } from '../plan/resolve-v2.ts';
import { emit, type Case } from '../plan/fuzz/gen.ts';
import { hostSigs } from '../plan/fuzz/run.ts';
import type { HostSig, Scenario, ScenarioStep } from '../plan/fuzz/host.ts';
import { apiModule, clientModule, type Browser, type Build, type Hydration } from './browser.ts';
import type { ServerOutput } from './server-leg.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SERVER_LEG = here('./server-leg.ts'), LEG = here('../plan/fuzz/leg.ts');
const RENDERER = here('../plan/fuzz/renderer.ts'), SOLID = here('../plan/fuzz/solid-native.ts');
const tmpRoot = here('../.out/ssr/tmp/');

/** agree: the HTML is Solid's byte for byte, and both hydrate and replay the scenario. html: the HTML differs.
 *  hydration: an HTML is byte-identical but a hydration run fails (its problems are listed). ssr-refused: the Rust
 *  server renderer refused the plan (an explicit diagnostic; not agreement). refused: the emitter refused the program.
 *  invalid: Solid's own server render or the scenario recording failed. generator-bug: the twins do not load, or emit
 *  different plans. */
export type SsrStatus = 'agree' | 'html' | 'hydration' | 'ssr-refused' | 'refused' | 'invalid' | 'generator-bug';
export type SsrOutcome = {
  seed: number; family: string; status: SsrStatus; detail?: string; classes: string[];
  files: Record<string, string>; plan?: unknown; scenario?: Scenario;
  solid?: ServerOutput; rust?: { html: string } | { error: string };
  browser?: Partial<Record<'rust' | 'solid' | 'rust-dev', Hydration>>;
};

function load(name: string, files: Record<string, string>): ModuleSet {
  const set = loadTsxModules(name, p => files[p]);
  if (set.diags.length) throw new Error(set.diags.map(d => d.code + ': ' + d.msg).join('; '));
  const checked = checkModules(set).diags;
  if (checked.length) throw new Error(checked.map(d => d.code + ' (' + d.file + ':' + d.line + '): ' + d.msg).join('; '));
  return set;
}

function worker<T>(file: string, data: object, execArgv: string[], timeoutMs: number): Promise<T | { invalid: string; detail?: string }> {
  return new Promise(resolve => {
    const w = new Worker(file, { workerData: data, execArgv, stderr: true, stdout: true });
    let err = '';
    w.stderr.on('data', d => { err += d; });
    w.stdout.on('data', () => {});
    const timer = setTimeout(() => { void w.terminate(); resolve({ invalid: 'timeout' }); }, timeoutMs);
    w.once('message', m => { clearTimeout(timer); void w.terminate(); resolve(m); });
    w.once('error', e => { clearTimeout(timer); resolve({ invalid: 'error', detail: String(e.stack ?? e) + err }); });
    w.once('exit', code => { clearTimeout(timer); resolve({ invalid: 'exit', detail: 'worker exited ' + code + ' ' + err }); });
  });
}

/** Solid's own server render of `tsx` (server-leg.ts), on the production server builds. */
export async function solidServer(tsx: string, hosts: string[], dir: string, timeoutMs = 20000): Promise<ServerOutput> {
  const r = await worker<ServerOutput>(SERVER_LEG, { tsx, hosts, dir }, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'], timeoutMs);
  return 'invalid' in r ? { error: 'server leg ' + r.invalid + ': ' + (r.detail ?? '') } : r;
}

/** Rust's server render of a plan: `ssr PLAN` prints {"html"} or {"error"}. */
export function rustServer(bin: string, planFile: string, timeoutMs = 20000): { html: string } | { error: string } {
  const r = spawnSync(bin, [planFile], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 26 });
  if ((r.status !== 0 && r.status !== 1) || !r.stdout) return { error: 'ssr binary failed: ' + r.status + ' ' + r.signal + ' ' + r.stderr };
  return JSON.parse(r.stdout);
}

/** Records the scenario of a generated case on native Solid (the plan fuzz's chooser and recording host, the universal
 *  build of the TSX twin), as plan/fuzz/run.ts does. */
async function record(c: Case, files: Record<string, string>, hosts: HostSig[], dir: string, timeoutMs: number): Promise<ScenarioStep[] | { invalid: string }> {
  const native = transform(files['App.tsx'], { filename: 'App.tsx', generate: 'universal', moduleName: STRING_RENDERER }).code
    .replaceAll('"' + STRING_RENDERER + '"', JSON.stringify(RENDERER)).replaceAll('"solid-js"', JSON.stringify(SOLID)).replaceAll('"./api"', '"./api.mjs"');
  writeFileSync(dir + '/native.mts', native);
  writeFileSync(dir + '/api.mjs', hosts.map(h => 'export const ' + h.name + ' = globalThis.__planFuzzApi.' + h.name + ';').join('\n') + '\n');
  const rec = await worker<{ result: { frames: string[] } | { error: string }; steps?: ScenarioStep[]; created: number }>(LEG,
    { leg: 'native', entry: dir + '/native.mts', hosts, actions: c.actions.map(a => a.name), record: { case: c, maxSteps: 200 } },
    ['--experimental-strip-types', '--conditions=browser', '--disable-warning=ExperimentalWarning'], timeoutMs);
  if ('invalid' in rec) return { invalid: 'oracle-' + rec.invalid };
  if ('error' in rec.result) return { invalid: /reactivity halted/.test(rec.result.error) ? 'oracle-halted' : 'oracle-error: ' + rec.result.error };
  return rec.steps!;
}

export type SsrOptions = { rust: string; browser?: Browser; build?: Build; dev?: boolean; keep?: string; timeoutMs?: number };

/** One program: `tsx` is the TSX twin Solid renders and hydrates (its plan, or the plan's refusal, is `plan`); the
 *  scenario's frames are the oracle after hydration. */
export async function runSsrProgram(p: { seed: number; family: string; files: Record<string, string>; tsx: string; hosts: string[]; plan?: unknown; refused?: string; scenario: ScenarioStep[] }, opts: SsrOptions, dir: string): Promise<SsrOutcome> {
  const out: SsrOutcome = { seed: p.seed, family: p.family, status: 'agree', classes: [], files: p.files, plan: p.plan };
  const solid = await solidServer(p.tsx, p.hosts, dir + '/server', opts.timeoutMs);
  out.solid = solid;
  if ('error' in solid) return { ...out, status: 'invalid', classes: ['oracle-ssr-error'], detail: solid.error };
  if (p.refused !== undefined) return { ...out, status: 'refused', detail: p.refused };
  writeFileSync(dir + '/app.plan.json', JSON.stringify(p.plan, null, 2) + '\n');
  const rust = rustServer(opts.rust, dir + '/app.plan.json', opts.timeoutMs);
  out.rust = rust;
  if ('error' in rust) return { ...out, status: 'ssr-refused', detail: rust.error };
  if (rust.html !== solid.html) out.classes.push('html differs');
  if (opts.browser) {
    const client = clientModule(p.tsx), api = apiModule(p.hosts);
    const page = (html: string, build: Build = opts.build ?? 'prod') => ({ html, script: solid.script, client, api, steps: p.scenario, build });
    out.browser = { rust: await opts.browser.hydrate(page(rust.html)), solid: await opts.browser.hydrate(page(solid.html)) };
    if (opts.dev) out.browser['rust-dev'] = await opts.browser.hydrate(page(rust.html, 'dev'));
    for (const [k, h] of Object.entries(out.browser)) if (!h.ok) out.classes.push('hydration (' + k + '): ' + h.problems[0]);
  }
  if (out.classes.length) out.status = out.classes.includes('html differs') ? 'html' : 'hydration';
  return out;
}

/** A generated case: its TSX twin (the canonical twin by construction: the generator coerces integer and conditional
 *  holes), its plan, and the scenario recorded on native Solid. */
export async function runSsrCase(c: Case, opts: SsrOptions): Promise<SsrOutcome> {
  const files = emit(c);
  const base = { seed: c.seed, family: c.family, status: 'agree' as SsrStatus, classes: [], files };
  const api = { 'api.d.rx': files['api.d.rx'] };
  let tsxSet: ModuleSet, rxSet: ModuleSet;
  try { tsxSet = load('App.tsx', { 'App.tsx': files['App.tsx'], ...api }); } catch (e) { return { ...base, status: 'generator-bug', classes: ['generator: TSX'], detail: String((e as Error).message) }; }
  try { rxSet = load('App.rx', { 'App.rx': files['App.rx'], ...api }); } catch (e) { return { ...base, status: 'generator-bug', classes: ['generator: RX'], detail: String((e as Error).message) }; }
  const plans = [rxSet, tsxSet].map(set => { try { return JSON.stringify(resolvePlanV2(set), null, 2); } catch (e) { return 'refused: ' + (e as Error).message; } });
  if (plans[0] !== plans[1]) return { ...base, status: 'generator-bug', classes: ['emitter: TSX and RX plans differ'], detail: plans.join('\n----\n') };
  const refused = plans[0].startsWith('refused: ') ? plans[0].slice(9) : undefined;
  mkdirSync(tmpRoot, { recursive: true });
  const dir = opts.keep ?? mkdtempSync(tmpRoot + 'case-');
  mkdirSync(dir, { recursive: true });
  try {
    const hosts = hostSigs(c);
    const steps = await record(c, files, hosts, dir, opts.timeoutMs ?? 20000);
    if (!Array.isArray(steps)) return { ...base, status: 'invalid', classes: [steps.invalid] };
    const scenario: Scenario = { version: 2, name: 'ssr fuzz seed ' + c.seed, fixture: 'app', host: hosts, steps };
    const o = await runSsrProgram({ seed: c.seed, family: c.family, files, tsx: files['App.tsx'], hosts: hosts.map(h => h.name), plan: refused ? undefined : JSON.parse(plans[0]), refused, scenario: steps }, opts, dir);
    return { ...o, scenario };
  } finally { if (!opts.keep) rmSync(dir, { recursive: true, force: true }); }
}
