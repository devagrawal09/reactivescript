// One placement-fuzz program, every leg (docs/RESULTS.md, "Slice 6", "Placement fuzz"):
//   1. emit plan v2.2 from the RX and the TSX twin: identical plans or identical refusals; the inferred placement must
//      equal the generator's model, and the oracle's split (N) must state it (extract);
//   2. record the scenario on T (the all-client twin) with the generator's chooser;
//   3. replay it on N (the explicit split from the generator's model), J (the plan's canonical split) and, with
//      `rust`, R (rust-solid's frames server, J's client);
//   4. compare: N against T (frames, frames seen, server host log, requests apart from the wire id), J and R against N
//      (all of that, the DOM, and every wire record byte for byte), and G4 on every server-only component.
// Outcomes: agree, refused (by code), client-only (no server root; the legs still run), invalid (T failed),
// generator-bug, divergent (with classes).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { transform } from '@solidjs/compiler';
import { loadTsxModules } from '../../tsx/modules.ts';
import { TsxError } from '../../tsx/lower.ts';
import { loadModules } from '../../tsx/rx/compiler.ts';
import { FramesRefusal, resolvePlanFrames, type FramesPlan } from '../../plan/resolve-frames.ts';
import { splitTsx } from '../../plan/split.ts';
import { buildProgram, runLeg, startNodeLeg, startRustLeg, type Step, type Trace } from '../harness.ts';
import { siteNames } from '../sites.ts';
import { answerScript } from '../slice.ts';
import { extractPlacement, projectPlacement } from '../extract.ts';
import { OUTSIDE_CODE, chooserFor, emit, expectedPlacement, generate, hostSpec, sitesOf } from './gen.ts';

export type Outcome = 'agree' | 'refused' | 'client-only' | 'invalid' | 'generator-bug' | 'divergent';
export type SeedResult = {
  seed: number; outcome: Outcome; classes?: string[]; refusal?: string; reasons?: string[]; problems?: string[];
  steps?: number; requests?: number; hosts?: number; roots?: number; features?: string[];
  /** R against N (the same steps; N's own run when N diverged from T): every compared artifact equal, or not. */
  rust?: 'equal' | 'differs';
};

const noId = (t: Trace) => t.requests.map(({ id: _id, ...r }) => r);
/** A failed leg's class: the kind of its problems (the problems themselves are kept in full in the seed's result). */
const kinds = (problems: string[]) => [...new Set(problems.map(p =>
  /^step \d+: frame /.test(p) ? 'frame' : /is not a held request$/.test(p) ? 'request not held' : /^requests left held/.test(p) ? 'requests left held'
    : /^pageerror: /.test(p) ? 'pageerror ' + p.slice(11).split(/[:\s]/)[0] : /^keyed server elements not adopted/.test(p) ? 'server elements not adopted'
    : /^browser: /.test(p) ? 'browser' : p.slice(0, 60)))];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function clientTemplates(source: string, component: string): string[] {
  const code = transform(source, { filename: 't.tsx', generate: 'dom', hydratable: true }).code;
  const defs = new Map([...code.matchAll(/var (_tmpl\$\d*) = \/\* @__PURE__ \*\/ _\$template\((`[^`]*`)\)/g)].map(m => [m[1], m[2]]));
  const start = code.indexOf('function ' + component + '(');
  if (start < 0) return [];
  const ends = ['\nfunction ', '\nexport '].map(k => code.indexOf(k, start + 1)).filter(i => i > 0);
  const body = code.slice(start, ends.length ? Math.min(...ends) : undefined);
  return [...new Set([...body.matchAll(/(_tmpl\$\d*)\b/g)].map(m => defs.get(m[1])!).filter(Boolean))];
}

export async function runSeed(seed: number, opts: { rust?: string; out?: string; build?: 'prod' | 'dev' } = {}): Promise<SeedResult> {
  const p = generate(seed);
  const files = emit(p);
  const hosts = hostSpec(p);
  const dump = (r: SeedResult, extra: Record<string, unknown> = {}) => {
    if (opts.out && r.outcome !== 'agree' && r.outcome !== 'refused' && r.outcome !== 'client-only') {
      const d = join(opts.out, 'seed-' + seed);
      mkdirSync(d, { recursive: true });
      for (const [k, v] of Object.entries(files)) writeFileSync(join(d, k), v);
      writeFileSync(join(d, 'result.json'), JSON.stringify({ ...r, ...extra }, null, 1));
    }
    return r;
  };
  // ---- 1. emit
  const read = (path: string) => { const f = path.replace(/^.*\//, ''); return files[f]; };
  const emitOne = (load: () => unknown) => {
    try { return { plan: resolvePlanFrames(load() as never, { stem: 'app' }) as FramesPlan }; }
    // A refusal compares by its v2.2 code: the builder's (FramesRefusal) or the TSX boundary's for the same form
    // (TsxError.code); any other failure by its message.
    catch (e) { return { refusal: e instanceof FramesRefusal || (e instanceof TsxError && e.code) ? (e as { code: string }).code : String((e as Error).message).slice(0, 160) }; }
  };
  const fromRx = emitOne(() => loadModules('app.rx', (path: string) => read(path)));
  const fromTsx = emitOne(() => loadTsxModules('/fuzz/app.tsx', read, { frames: true }));
  if (!same(fromRx, fromTsx)) return dump({ seed, outcome: 'generator-bug', problems: ['the RX and TSX twins emit differently', JSON.stringify(fromRx).slice(0, 400), JSON.stringify(fromTsx).slice(0, 400)] });
  // The refusal family: both twins refuse the added form with its code; any other refusal is the generator's.
  if (p.outside) {
    if (fromRx.refusal === OUTSIDE_CODE[p.outside]) return { seed, outcome: 'refused', refusal: fromRx.refusal };
    return dump({ seed, outcome: 'generator-bug', problems: ['expected ' + OUTSIDE_CODE[p.outside] + ' (' + p.outside + ')', JSON.stringify(fromRx).slice(0, 400)] });
  }
  if (!fromRx.plan) return dump({ seed, outcome: 'generator-bug', problems: ['an unexpected refusal', String(fromRx.refusal)] });
  const plan = fromRx.plan;
  if (plan.version !== 2.2) return dump({ seed, outcome: 'generator-bug', problems: ['not a v2.2 plan'] });
  const classes: string[] = [];
  const problems: string[] = [];
  // ---- G1
  const expected = expectedPlacement(p);
  if (!same(plan.placement, expected)) { classes.push('G1: placement'); problems.push('placement ' + JSON.stringify(plan.placement), 'expected ' + JSON.stringify(expected)); }
  let extracted: unknown;
  try { extracted = extractPlacement({ 'app.server.tsx': files['app.server.tsx'], 'app.split.tsx': files['app.split.tsx'] }, 'app'); }
  catch (e) { extracted = 'extract: ' + (e as Error).message; }
  if (!same(extracted, projectPlacement(expected))) { classes.push('G1: extract'); problems.push('extract ' + JSON.stringify(extracted)); }
  // ---- 2. record on T
  const programs = {
    T: { modules: { 'app.tsx': files['app.tsx'] }, entry: 'app.tsx', hosts },
    N: { modules: { 'app.server.tsx': files['app.server.tsx'], 'app.split.tsx': files['app.split.tsx'] }, entry: 'app.split.tsx', hosts },
    J: { modules: splitTsx(plan, 'app'), entry: 'app.split.tsx', hosts },
  };
  const run = async (name: 'T' | 'N' | 'J' | 'R', steps?: Step[], answers?: unknown, check = true): Promise<Trace> => {
    const prog = programs[name === 'R' ? 'J' : name];
    const b = buildProgram(prog);
    const ids = Object.fromEntries([...b.functions].map(([id, f]) => [f.name, id]));
    const names = name === 'T' ? sitesOf(p, false) : name === 'N' ? sitesOf(p, true) : siteNames(plan, true);
    const sites = Object.fromEntries(Object.entries(names).map(([f, s]) => [ids[f] ?? f, s]));
    let server;
    if (name === 'R') {
      const d = join(opts.out ?? '/tmp', 'rust-' + seed);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'plan.json'), JSON.stringify(plan));
      writeFileSync(join(d, 'answers.json'), JSON.stringify(answers));
      server = await startRustLeg(opts.rust!, join(d, 'plan.json'), join(d, 'answers.json'));
    } else server = await startNodeLeg(b);
    try {
      return await runLeg(server, b, prog.entry, steps ? { sites, steps, build: opts.build, check } : { sites, chooser: chooserFor(p), build: opts.build });
    } catch (e) {
      return { ok: false, problems: [String((e as Error).message)], steps: [], frames: [], seen: [], requests: [], hosts: [], dom: [], wire: [], modules: [], console: [] };
    } finally {
      const err = server.stderr();
      await server.close();
      if (err && name === 'R') problems.push('R stderr: ' + err.slice(0, 600));
    }
  };
  const t = await run('T');
  if (!t.ok) return dump({ seed, outcome: 'invalid', problems: t.problems });
  const steps = t.steps;
  const n = await run('N', steps);
  const j = await run('J', steps);
  if (!n.ok) { classes.push(...kinds(n.problems).map(k => 'N: ' + k)); problems.push(...n.problems.slice(0, 5)); }
  if (!j.ok) { classes.push(...kinds(j.problems).map(k => 'J: ' + k)); problems.push(...j.problems.slice(0, 5)); }
  const cmp = (label: string, a: Trace, b: Trace, keys: (keyof Trace)[]) => {
    for (const k of keys) if (!same(a[k], b[k])) { classes.push(label + ': ' + String(k)); problems.push(label + ' ' + String(k) + ': ' + JSON.stringify(a[k]).slice(0, 600) + ' vs ' + JSON.stringify(b[k]).slice(0, 600)); }
  };
  if (n.ok) {
    cmp('N/T', n, t, ['frames', 'seen', 'hosts']);
    if (!same(noId(n), noId(t))) { classes.push('N/T: requests'); problems.push('requests ' + JSON.stringify(noId(n)).slice(0, 600) + ' vs ' + JSON.stringify(noId(t)).slice(0, 600)); }
  }
  // The split legs are compared with each other whether or not they agree with the twin: when N or J diverged from T,
  // N and J are replayed on the same steps without the frame check (each records its own frames and stops only where a
  // step cannot run), and J and R are compared with that run of N, problems included.
  const split = n.ok && j.ok;
  const nRef = split ? n : await run('N', steps, undefined, false);
  const jRef = split ? j : await run('J', steps, undefined, false);
  const splitKeys: (keyof Trace)[] = ['frames', 'seen', 'requests', 'hosts', 'dom', 'wire'];
  if (!same(jRef.problems, nRef.problems)) { classes.push('J/N: problems'); problems.push('J/N problems: ' + JSON.stringify(jRef.problems).slice(0, 600) + ' vs ' + JSON.stringify(nRef.problems).slice(0, 600)); }
  cmp('J/N', jRef, nRef, splitKeys);
  let r: Trace | undefined;
  let rust: SeedResult['rust'];
  if (opts.rust) {
    const before = classes.length;
    r = await run('R', steps, answerScript(nRef.hosts), split);
    if (!same(r.problems, nRef.problems)) { classes.push(...kinds(r.problems).map(k => 'R: ' + k), 'R/N: problems'); problems.push('R/N problems: ' + JSON.stringify(r.problems).slice(0, 600) + ' vs ' + JSON.stringify(nRef.problems).slice(0, 600)); }
    cmp('R/N', r, nRef, splitKeys);
    rust = classes.length === before ? 'equal' : 'differs';
  }
  // ---- G4: no server-only component's client templates in a split leg's graph; present in the twin's.
  const serverOnly = plan.placement.server.map(s => s.component).filter(c => !plan.placement.client.some(x => x.component === c));
  for (const c of new Set(serverOnly)) {
    for (const tpl of clientTemplates(files['app.tsx'], c)) {
      for (const [name, tr] of [['N', n], ['J', j], ['R', r]] as const) if (tr?.ok && tr.modules.some(m => m.text.includes(tpl))) { classes.push('G4: ' + name); problems.push(name + ' ships ' + c + "'s " + tpl); }
      if (!t.modules.some(m => m.text.includes(tpl))) { classes.push('G4: control'); problems.push('T does not ship ' + tpl); }
    }
    if ([n, j, r].some(tr => tr?.modules.some(m => /\/db(\.|$)/.test(m.url)))) classes.push('G4: db');
  }
  const features = [...new Set(p.sites.map(s => s.recipe + (s.show ? '+show' : '') + Object.keys(s.variant).map(k => '+' + k).join('')))];
  const base = { seed, steps: steps.length, requests: t.requests.length, hosts: t.hosts.length, roots: plan.serverComponents.length, features, ...(rust ? { rust } : {}) };
  if (classes.length) return dump({ ...base, outcome: 'divergent', classes: [...new Set(classes)], problems: problems.slice(0, 20) }, { tTrace: { steps: t.steps, frames: t.frames, requests: t.requests } });
  if (!plan.serverComponents.length) return { ...base, outcome: 'client-only', reasons: [...new Set(plan.placement.client.filter(c => c.reason !== 'entry').map(c => c.reason))].sort() };
  return { ...base, outcome: 'agree' };
}
