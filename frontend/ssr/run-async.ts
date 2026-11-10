// Slice 5, async data (docs/RESULTS.md, "Slice 5: async data"): one program with async data (plan v2.1), Rust's server
// output against Solid's own, and both hydrated by Solid's client.
//  1. Solid renders the TSX twin on the server (stream-leg.ts): renderToStream under a server answer policy (a fixed
//     script, or the SSR fuzz's chooser), and renderToString. The realized answers become the script Rust replays.
//  2. Rust renders the plan: `ssr PLAN` (renderToString) and `ssr PLAN --stream ANSWERS` (renderToStream). The HTML,
//     the stream's chunks and its event log (chunks, settlements, end) must be Solid's byte for byte, and both must make
//     the same host requests.
//  3. Chromium hydrates (browser.ts): each stream is fed chunk by chunk, hydrated after the shell (and again after the
//     last chunk), and a continuation scenario runs on; Solid's stream is the control the continuation is recorded on
//     and every other run replays. Each renderToString HTML is hydrated and replays the scenario native Solid recorded
//     from mount (nothing async is serialized: the client asks for its data itself).
// Nothing is filtered or normalized; every difference is kept with its class.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { transform } from '@solidjs/compiler';
import { loadTsxModules } from '../tsx/modules.ts';
import { checkModules, STRING_RENDERER, type ModuleSet } from '../tsx/rx/compiler.ts';
import { resolvePlanV2 } from '../plan/resolve-v2.ts';
import { asyncHostSigs, emitAsync, type AsyncCase } from '../plan/fuzz/gen-async.ts';
import type { HostSig, ScenarioStep } from '../plan/fuzz/host.ts';
import type { ServerAnswer, StreamEvent } from './stream-core.ts';
import type { ServerChooser, StreamLegOutput } from './stream-leg.ts';
import { apiModule, clientModule, type Browser, type Build, type StreamHydration } from './browser.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const STREAM_LEG = here('./stream-leg.ts'), LEG = here('../plan/fuzz/leg.ts');
const RENDERER = here('../plan/fuzz/renderer.ts'), SOLID = here('../plan/fuzz/solid-native.ts'), GEN_ASYNC = here('../plan/fuzz/gen-async.ts');
const tmpRoot = here('../.out/ssr/tmp/');

export type RustStream = { chunks: string[]; events: StreamEvent[]; requests: { host: string; call: number; args: unknown[] }[]; renderErrors?: string[] };
export type RustString = { html: string; requests?: { host: string; call: number; args: unknown[] }[]; renderErrors?: string[] };

/** agree: every byte and request is Solid's, and every hydration ran clean. stream / html: a stream or an HTML differs.
 *  hydration: a hydration run failed. ssr-refused: Rust refused the plan or the script (an explicit diagnostic; not
 *  agreement). refused: the emitter refused the program. invalid: Solid's own render, or the scenario recording,
 *  failed. generator-bug: the twins do not load, or emit different plans. */
export type AsyncSsrStatus = 'agree' | 'stream' | 'html' | 'hydration' | 'ssr-refused' | 'refused' | 'invalid' | 'generator-bug';
export type AsyncSsrOutcome = {
  seed: number; family: string; status: AsyncSsrStatus; detail?: string; classes: string[];
  files: Record<string, string>; plan?: unknown; answers?: ServerAnswer[];
  solid?: StreamLegOutput; rust?: { stream?: RustStream | { error: string }; string?: RustString | { error: string } };
  scenario?: ScenarioStep[]; continuation?: ScenarioStep[];
  browser?: Record<string, StreamHydration>;
  /** What the control runs (Solid's own output) observed besides frames: elements the client created fresh or left
   *  unclaimed, console messages. Not verdicts: each Rust run must observe the same. */
  notes?: string[];
};

function load(name: string, files: Record<string, string>): ModuleSet {
  const set = loadTsxModules(name, p => files[p], { async: true });
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

/** Solid's own server renders of `tsx` (stream-leg.ts), on the production server builds. */
export async function solidServerAsync(tsx: string, hosts: string[], dir: string, policy: { script: ServerAnswer[] } | { chooser: ServerChooser }, timeoutMs = 20000): Promise<StreamLegOutput> {
  const r = await worker<StreamLegOutput>(STREAM_LEG, { tsx, hosts, dir, ...policy }, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'], timeoutMs);
  return 'invalid' in r ? { error: 'server leg ' + r.invalid + ': ' + (r.detail ?? '') } : r;
}

function rust<T>(bin: string, args: string[], timeoutMs: number): T | { error: string } {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 26 });
  if ((r.status !== 0 && r.status !== 1) || !r.stdout) return { error: 'ssr binary failed: ' + r.status + ' ' + r.signal + ' ' + r.stderr };
  return JSON.parse(r.stdout);
}

/** Rust's renderToString of a plan: `ssr PLAN`. */
export const rustStringRender = (bin: string, planFile: string, timeoutMs = 20000) => rust<RustString>(bin, [planFile], timeoutMs);
/** Rust's renderToStream of a plan under an answer script: `ssr PLAN --stream ANSWERS`. */
export const rustStreamRender = (bin: string, planFile: string, answersFile: string, timeoutMs = 20000) => rust<RustStream>(bin, [planFile, '--stream', answersFile], timeoutMs);

/** Records a scenario from mount on native Solid with gen-async's chooser (plan/fuzz/leg.ts), as the plan fuzz does. */
async function recordNative(c: AsyncCase, files: Record<string, string>, hosts: HostSig[], dir: string, timeoutMs: number): Promise<ScenarioStep[] | { invalid: string }> {
  const native = transform(files['App.tsx'], { filename: 'App.tsx', generate: 'universal', moduleName: STRING_RENDERER }).code
    .replaceAll('"' + STRING_RENDERER + '"', JSON.stringify(RENDERER)).replaceAll('"solid-js"', JSON.stringify(SOLID)).replaceAll('"./api"', '"./api.mjs"');
  writeFileSync(dir + '/native.mts', native);
  writeFileSync(dir + '/api.mjs', hosts.map(h => 'export const ' + h.name + ' = globalThis.__planFuzzApi.' + h.name + ';').join('\n') + '\n');
  const rec = await worker<{ result: { frames: string[] } | { error: string }; steps?: ScenarioStep[] }>(LEG,
    { leg: 'native', entry: dir + '/native.mts', hosts, actions: c.actions.map(a => a.name), record: { case: c, maxSteps: 200, chooser: GEN_ASYNC } },
    ['--experimental-strip-types', '--conditions=browser', '--disable-warning=ExperimentalWarning'], timeoutMs);
  if ('invalid' in rec) return { invalid: 'oracle-' + rec.invalid };
  if ('error' in rec.result) return { invalid: /reactivity halted/i.test(rec.result.error) ? 'oracle-halted' : 'oracle-error: ' + rec.result.error };
  return rec.steps!;
}

export type AsyncSsrOptions = { rust: string; browser?: Browser; dev?: boolean; keep?: string; timeoutMs?: number; hydrate?: boolean };

/** Byte comparison of a Rust stream against Solid's: the chunks and the event log. */
export function compareStreams(solid: { chunks: string[]; events: StreamEvent[] }, rust: RustStream): string | undefined {
  if (JSON.stringify(solid.events) === JSON.stringify(rust.events)) return undefined;
  const n = Math.max(solid.events.length, rust.events.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(solid.events[i]), b = JSON.stringify(rust.events[i]);
    if (a === b) continue;
    let k = 0;
    while (k < (a ?? '').length && a[k] === b?.[k]) k++;
    return 'event ' + i + ' differs at ' + k + ': solid ' + (a ?? 'nothing').slice(Math.max(0, k - 60), k + 120) + ' / rust ' + (b ?? 'nothing').slice(Math.max(0, k - 60), k + 120);
  }
  return 'events differ';
}

/** One program: its TSX twin (Solid renders and hydrates it), its plan (or the refusal), and a server answer policy. */
export async function runAsyncSsrProgram(p: {
  seed: number; family: string; files: Record<string, string>; tsx: string; hostSigs: HostSig[];
  plan?: unknown; refused?: string; policy: { script: ServerAnswer[] } | { chooser: ServerChooser };
  /** The scenario from mount (native Solid's), replayed after hydrating each renderToString HTML. */
  fromMount?: ScenarioStep[];
  /** A fixed continuation after the stream's hydration (the tracker-async slice); else one is recorded on the control. */
  continuation?: { steps: ScenarioStep[]; streamFrames: string[] };
  /** The continuation chooser of a generated program (gen-async.ts). */
  record?: AsyncCase;
}, opts: AsyncSsrOptions, dir: string): Promise<AsyncSsrOutcome> {
  const hosts = p.hostSigs.map(h => h.name);
  const out: AsyncSsrOutcome = { seed: p.seed, family: p.family, status: 'agree', classes: [], files: p.files, plan: p.plan };
  const solid = await solidServerAsync(p.tsx, hosts, dir + '/server', p.policy, opts.timeoutMs);
  out.solid = solid;
  if ('error' in solid) return { ...out, status: 'invalid', classes: ['oracle-ssr-error'], detail: solid.error };
  if (solid.timeouts) return { ...out, status: 'invalid', classes: ['oracle-set-timeout'], detail: 'Solid scheduled ' + solid.timeouts + ' setTimeout(s)' };
  if (!solid.stream || 'error' in solid.stream) return { ...out, status: 'invalid', classes: ['oracle-stream-error'], detail: solid.stream && 'error' in solid.stream ? solid.stream.error : 'no stream' };
  if (solid.stream.status !== 'ended') return { ...out, status: 'invalid', classes: ['oracle-stream-' + solid.stream.status] };
  if (!solid.string || 'error' in solid.string) return { ...out, status: 'invalid', classes: ['oracle-string-error'], detail: solid.string && 'error' in solid.string ? solid.string.error : 'no html' };
  out.answers = solid.stream.answers;
  if (p.refused !== undefined) return { ...out, status: 'refused', detail: p.refused };
  writeFileSync(dir + '/app.plan.json', JSON.stringify(p.plan, null, 2) + '\n');
  writeFileSync(dir + '/answers.json', JSON.stringify(solid.stream.answers, null, 2) + '\n');
  const rs = rustStreamRender(opts.rust, dir + '/app.plan.json', dir + '/answers.json', opts.timeoutMs);
  const rh = rustStringRender(opts.rust, dir + '/app.plan.json', opts.timeoutMs);
  out.rust = { stream: rs, string: rh };
  if ('error' in rs) return { ...out, status: 'ssr-refused', detail: 'stream: ' + rs.error };
  if ('error' in rh) return { ...out, status: 'ssr-refused', detail: 'string: ' + rh.error };
  const streamDiff = compareStreams(solid.stream, rs);
  if (streamDiff) out.classes.push('stream differs');
  const solidRequests = solid.stream.answers.map(a => ({ host: a.host, call: a.call, args: a.args }));
  if (JSON.stringify(solidRequests) !== JSON.stringify(rs.requests)) out.classes.push('stream requests differ');
  if (rh.html !== solid.string.html) out.classes.push('html differs');
  if (JSON.stringify(solid.string.requests) !== JSON.stringify(rh.requests ?? [])) out.classes.push('string requests differ');
  if (JSON.stringify(rs.renderErrors ?? []) !== '[]') out.classes.push('rust render errors: ' + rs.renderErrors!.join('; '));
  if (out.classes.length) {
    out.detail = streamDiff;
    out.status = out.classes.includes('stream differs') || out.classes.some(c => c.startsWith('stream requests')) ? 'stream' : 'html';
    return out;
  }
  if (opts.browser && opts.hydrate !== false) {
    const client = clientModule(p.tsx), api = apiModule(hosts);
    const served = Object.fromEntries(hosts.map(h => [h, solid.stream && !('error' in solid.stream) ? solid.stream.answers.filter(a => a.host === h).length : 0]));
    const streamPage = (chunks: string[], when: 'shell' | 'end', build: Build) => ({ chunks, when, script: solid.script!, client, api, build, offsets: served });
    out.browser = {};
    out.notes = [];
    // The control: Solid's stream, in each mode (hydrated after the shell or after the last chunk; production build,
    // and the dev build after the shell). Each control run records the continuation with the program's chooser (a
    // fresh chooser per run: Solid's own outcome can depend on when it hydrates), or checks a fixed one; the Rust run
    // of the same mode replays it and must observe what the control observed: the frames, the hydrated DOM, the
    // elements the client created or left unclaimed, the console.
    const modes: [string, 'shell' | 'end', Build][] = [['stream', 'shell', 'prod'], ['stream-end', 'end', 'prod'], ...(opts.dev ? [['stream-dev', 'shell', 'dev'] as [string, 'shell' | 'end', Build]] : [])];
    for (const [name, when, build] of modes) {
      const c = await opts.browser.hydrateStream({ ...streamPage(solid.stream.chunks, when, build), steps: p.continuation?.steps,
        chooser: p.continuation ? undefined : p.record });
      out.browser['solid-' + name] = c;
      if (!c.ok) return { ...out, status: 'invalid', classes: ['oracle-hydration (solid-' + name + '): ' + c.problems[0]] };
      if (p.continuation && when === 'shell' && JSON.stringify(c.streamFrames) !== JSON.stringify(p.continuation.streamFrames))
        return { ...out, status: 'invalid', classes: ['oracle-hydration (solid-' + name + '): stream frames ' + JSON.stringify(c.streamFrames)] };
      if (name === 'stream') out.continuation = c.steps;
      else if (JSON.stringify(c.steps) !== JSON.stringify(out.browser['solid-stream'].steps))
        out.notes.push('solid-' + name + ' continuation: differs from solid-stream\'s (Solid\'s outcome depends on when it hydrates)');
      for (const [k, v] of [['fresh', c.fresh], ['unclaimed', c.unclaimed], ['console', c.console]] as const)
        if (v.length) out.notes.push('solid-' + name + ' ' + k + ': ' + v[0]);
      const r = await opts.browser.hydrateStream({ ...streamPage(rs.chunks, when, build), steps: c.steps });
      out.browser['rust-' + name] = r;
      const differs = r.ok ? (['streamFrames', 'frames', 'settledHtml', 'fresh', 'unclaimed', 'console'] as const).find(k => JSON.stringify(r[k]) !== JSON.stringify(c[k])) : undefined;
      if (!r.ok) out.classes.push('hydration (rust-' + name + '): ' + r.problems[0]);
      else if (differs) out.classes.push('hydration (rust-' + name + '): ' + differs + ' differ from the control');
    }
    if (p.fromMount) {
      const stringPage = (html: string) => ({ chunks: [html], when: 'end' as const, script: solid.script!, client, api, build: 'prod' as Build, offsets: {}, steps: p.fromMount, fromMount: true });
      const c = await opts.browser.hydrateStream(stringPage(solid.string.html));
      out.browser['solid-string'] = c;
      if (!c.ok) {
        // Solid's own HTML, hydrated, does not replay native Solid's scenario: an oracle failure. Rust's HTML (byte for
        // byte Solid's) must still fail the same way, or it is a Rust difference.
        const r = await opts.browser.hydrateStream(stringPage(rh.html));
        out.browser['rust-string'] = r;
        const same = (['problems', 'streamFrames', 'frames', 'settledHtml', 'fresh', 'unclaimed', 'console'] as const).every(k => JSON.stringify(r[k]) === JSON.stringify(c[k]));
        if (!same) return { ...out, status: 'hydration', classes: ['hydration (rust-string): differs from the failing control: ' + (r.problems[0] ?? 'ok')] };
        return { ...out, status: 'invalid', classes: ['oracle-hydration (solid-string): ' + c.problems[0]], notes: [...(out.notes ?? []), 'rust-string failed exactly as solid-string'] };
      }
      for (const [k, v] of [['fresh', c.fresh], ['unclaimed', c.unclaimed], ['console', c.console]] as const)
        if (v.length) out.notes.push('solid-string ' + k + ': ' + v[0]);
      const r = await opts.browser.hydrateStream(stringPage(rh.html));
      out.browser['rust-string'] = r;
      const differs = r.ok ? (['streamFrames', 'frames', 'settledHtml', 'fresh', 'unclaimed', 'console'] as const).find(k => JSON.stringify(r[k]) !== JSON.stringify(c[k])) : undefined;
      if (!r.ok) out.classes.push('hydration (rust-string): ' + r.problems[0]);
      else if (differs) out.classes.push('hydration (rust-string): ' + differs + ' differ from the control');
    }
    if (out.classes.length) out.status = 'hydration';
  }
  return out;
}

/** A generated program (gen-async.ts): its TSX twin, its plan (TSX and RX must emit the same), the SSR fuzz's server
 *  chooser, and the scenario native Solid records from mount. */
export async function runAsyncSsrCase(c: AsyncCase, opts: AsyncSsrOptions): Promise<AsyncSsrOutcome> {
  const files = emitAsync(c);
  const base = { seed: c.seed, family: c.family, status: 'agree' as AsyncSsrStatus, classes: [], files };
  const api = { 'api.d.rx': files['api.d.rx'] };
  let tsxSet: ModuleSet, rxSet: ModuleSet;
  try { tsxSet = load('App.tsx', { 'App.tsx': files['App.tsx'], ...api }); } catch (e) { return { ...base, status: 'generator-bug', classes: ['generator: TSX'], detail: String((e as Error).message) }; }
  try { rxSet = load('App.rx', { 'App.rx': files['App.rx'], ...api }); } catch (e) { return { ...base, status: 'generator-bug', classes: ['generator: RX'], detail: String((e as Error).message) }; }
  const plans = [rxSet, tsxSet].map(set => { try { return JSON.stringify(resolvePlanV2(set, { async: true }), null, 2); } catch (e) { return 'refused: ' + (e as Error).message; } });
  if (plans[0] !== plans[1]) return { ...base, status: 'generator-bug', classes: ['emitter: TSX and RX plans differ'], detail: plans.join('\n----\n') };
  const refused = plans[0].startsWith('refused: ') ? plans[0].slice(9) : undefined;
  mkdirSync(tmpRoot, { recursive: true });
  const dir = opts.keep ?? mkdtempSync(tmpRoot + 'async-');
  mkdirSync(dir, { recursive: true });
  try {
    const hostSigs = asyncHostSigs(c);
    let fromMount: ScenarioStep[] | undefined;
    if (opts.browser && opts.hydrate !== false && !refused) {
      const rec = await recordNative(c, files, hostSigs, dir, opts.timeoutMs ?? 20000);
      if (!Array.isArray(rec)) return { ...base, status: 'invalid', classes: [rec.invalid] };
      fromMount = rec;
    }
    const o = await runAsyncSsrProgram({ seed: c.seed, family: c.family, files, tsx: files['App.tsx'], hostSigs, plan: refused ? undefined : JSON.parse(plans[0]), refused,
      policy: { chooser: { seed: c.seed, hosts: c.hosts } }, fromMount, record: c }, opts, dir);
    return { ...o, scenario: fromMount };
  } finally { if (!opts.keep) rmSync(dir, { recursive: true, force: true }); }
}
