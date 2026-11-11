// node --experimental-strip-types scripts/frames-corpus.ts --out DIR [--start S] [--seeds N] [--max M]
// Writes rust-solid's crates/runtime/tests/fixtures/frames/: what Solid's own server (the native split, N, on
// frames/leg-server.ts) answered, request by request, for the tracker-frames slice's scenario (plus a request without
// fetch metadata, refused 403) and for placement-fuzz programs with server roots (seeds S.., in order, each one that
// adds a site recipe not yet covered, up to M). Each fixture is `{ name, plan, answers, exchanges, hosts,
// document }`: the plan v2.2, the answer script recorded from N's server host log, every request (method, target, header
// pairs, body) with Solid's response (status, headers, body chunks as flushed) in arrival order, N's host log and its
// document's outermost server calls. `cargo test --test frames` replays them against rust-solid's frames server without
// Node.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildProgram, closeBrowser, runLeg, startNodeLeg, type FramesProgram, type LegLog, type Step } from '../frames/harness.ts';
import { answerScript, loadSlice } from '../frames/slice.ts';
import { siteNames } from '../frames/sites.ts';
import { chooserFor, emit, generate, hostSpec, sitesOf } from '../frames/fuzz/gen.ts';
import { loadModules } from '../tsx/rx/compiler.ts';
import { resolvePlanFrames, type FramesPlan } from '../plan/resolve-frames.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const out = flag('--out');
if (!out) { console.error('--out DIR is required'); process.exit(2); }
const start = Number(flag('--start') ?? 1), seeds = Number(flag('--seeds') ?? 200), max = Number(flag('--max') ?? 10);
mkdirSync(out, { recursive: true });

type Sites = Record<string, string>;
/** Runs N's program on the steps (or records them with the chooser) and returns its server's full log. */
async function record(p: FramesProgram, names: Sites, run: { steps: Step[] } | { chooser: Parameters<typeof runLeg>[3]['chooser'] }, extra?: (port: number) => Promise<void>) {
  const b = buildProgram(p);
  const ids = Object.fromEntries([...b.functions].map(([id, f]) => [f.name, id]));
  const sites = Object.fromEntries(Object.entries(names).map(([f, s]) => [ids[f] ?? f, s]));
  const server = await startNodeLeg(b);
  try {
    const t = await runLeg(server, b, p.entry, { sites, ...run });
    if (!t.ok) throw new Error(t.problems.join('; '));
    if (extra) await extra(server.port);
    return { trace: t, log: await server.log() };
  } finally { await server.close(); }
}

function fixture(name: string, plan: FramesPlan, log: LegLog) {
  const incoming = log.incoming ?? [];
  if (incoming.length !== log.wire.length) throw new Error(name + ': ' + incoming.length + ' requests for ' + log.wire.length + ' wire records');
  const exchanges = log.wire.map((w, i) => ({ request: incoming[i], response: { status: w.status, headers: w.headers, chunks: w.chunks } }));
  writeFileSync(out + '/' + name + '.json', JSON.stringify({ name, plan, answers: answerScript(log.hosts as never), exchanges, hosts: log.hosts, document: log.document }, null, 1) + '\n');
  console.log(name, exchanges.length, 'exchanges');
}

// ---- the slice, and the 403
const slice = loadSlice('tracker-frames');
{
  const { log } = await record(slice.programs.N, siteNames(slice.plan, true), { steps: slice.steps }, async port => {
    const r = await fetch('http://127.0.0.1:' + port + '/_server/data/claim-59b2922c', { method: 'POST', body: '[3]', headers: { 'x-server-function-format': '8' } });
    if (r.status !== 403) throw new Error('the request without fetch metadata answered ' + r.status);
    await r.arrayBuffer();
  });
  fixture('tracker-frames', slice.plan, log);
}

// ---- placement-fuzz programs with server roots
const covered = new Set<string>();
let written = 0;
for (let seed = start; seed < start + seeds && written < max; seed++) {
  const p = generate(seed);
  if (p.outside) continue;
  const files = emit(p);
  let plan: FramesPlan;
  try { plan = resolvePlanFrames(loadModules('app.rx', (f: string) => files[f.replace(/^.*\//, '')]) as never, { stem: 'app' }) as FramesPlan; } catch { continue; }
  if (!plan.serverComponents.length) continue;
  const recipes = p.sites.map(s => s.recipe + Object.keys(s.variant).map(k => '+' + k).join(''));
  const fresh = recipes.filter(r => !covered.has(r));
  if (!fresh.length) continue;
  const hosts = hostSpec(p);
  const T: FramesProgram = { modules: { 'app.tsx': files['app.tsx'] }, entry: 'app.tsx', hosts };
  const N: FramesProgram = { modules: { 'app.server.tsx': files['app.server.tsx'], 'app.split.tsx': files['app.split.tsx'] }, entry: 'app.split.tsx', hosts };
  let steps: Step[];
  try { steps = (await record(T, sitesOf(p, false), { chooser: chooserFor(p) })).trace.steps; } catch { continue; }
  let log: LegLog;
  try { log = (await record(N, sitesOf(p, true), { steps })).log; } catch { continue; }
  for (const r of recipes) covered.add(r);
  fixture('seed-' + seed, plan, log);
  written++;
}
await closeBrowser();
console.log('covered', [...covered].sort().join(', '));
