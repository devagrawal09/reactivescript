// node --experimental-strip-types scripts/frames-classify.ts RUN_DIR [--replays N]
// Sorts a placement-fuzz run's divergent seeds into the suspected Solid issues they show (docs/scratch/
// solid-rc21-issues.md, issues 8 to 11), by symptom, from each seed's saved result (the twin's recorded steps and
// requests, the problems of the legs that diverged) and its split. It does not change the run's outcomes: the summary
// keeps every divergent seed as divergent; this only groups them for the report. The rules, first match wins:
//   9  the oracle split's page threw NotReadyError (an island's handler, issue 9);
//   11 only the frames seen within steps differ (an intermediate frame the twin never shows, issue 11);
//   8  at the first divergent step a request an action issued (its server call, or a refresh issued when the call's
//      answer landed) is outstanding or lands: a server component's change and an action's refresh hold each other
//      (issue 8);
//   10 the split has a server root under a Show and the mode was toggled at or before that step (issue 10);
//   8  a server root's call is outstanding or lands at that step (a frame's switch and refetch held together);
//   ?  anything else (unclassified; read the seed).
// With --replays N (default 3), every divergent seed is first replayed N times on the twin T and on the oracle split N
// against the twin's recorded frames: a seed whose own twin does not replay its recording every time is `unstable`
// (Solid's outcome depends on timing there, on the all-client app too), whatever its symptom; the others' counts are
// kept as evidence (`replays`: how many N replays reproduced the divergence).
// Writes RUN_DIR/families.json: { families: { family: [seeds] }, replays: { seed: { T, N } } } and prints it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { emit, generate, hostSpec, sitesOf } from '../frames/fuzz/gen.ts';
import { buildProgram, closeBrowser, runLeg, startNodeLeg, type Step as HStep } from '../frames/harness.ts';

type Step = { type: string; site?: string; call?: number; target?: { text: string } };
type Req = { step: number; site: string; call: number };
const dir = process.argv[2];
if (!dir) { console.error('usage: frames-classify.ts RUN_DIR [--replays N]'); process.exit(2); }
const ri = process.argv.indexOf('--replays');
const replays = ri >= 0 ? Number(process.argv[ri + 1]) : 3;
/** How many of `n` replays of leg `which` on the recorded steps ran clean (every frame the twin's). */
async function replay(seed: number, steps: HStep[], which: 'T' | 'N', n: number): Promise<number> {
  const p = generate(seed), files = emit(p), hosts = hostSpec(p);
  const prog = which === 'T' ? { modules: { 'app.tsx': files['app.tsx'] }, entry: 'app.tsx', hosts } : { modules: { 'app.server.tsx': files['app.server.tsx'], 'app.split.tsx': files['app.split.tsx'] }, entry: 'app.split.tsx', hosts };
  const b = buildProgram(prog);
  const ids = Object.fromEntries([...b.functions].map(([id, f]) => [f.name, id]));
  const sites = Object.fromEntries(Object.entries(sitesOf(p, which === 'N')).map(([f, s]) => [ids[f] ?? f, s]));
  let clean = 0;
  for (let i = 0; i < n; i++) {
    const srv = await startNodeLeg(b);
    try { if ((await runLeg(srv, b, prog.entry, { sites, steps })).ok) clean++; } finally { await srv.close(); }
  }
  return clean;
}
const evidence: Record<number, { T: string; N: string }> = {};
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')) as { seed: number; outcome: string; classes?: string[] }[];
const families: Record<string, number[]> = {};
const add = (f: string, seed: number) => (families[f] ??= []).push(seed);
for (const r of results.filter(r => r.outcome === 'divergent')) {
  const d = join(dir, 'seed-' + r.seed);
  if (!existsSync(join(d, 'result.json'))) { add('?', r.seed); continue; }
  const res = JSON.parse(readFileSync(join(d, 'result.json'), 'utf8')) as { problems: string[]; classes: string[]; tTrace: { steps: Step[]; requests: Req[] } };
  const split = readFileSync(join(d, 'app.split.tsx'), 'utf8');
  if (replays > 0) {
    const t = await replay(r.seed, res.tTrace.steps as HStep[], 'T', replays), n = await replay(r.seed, res.tTrace.steps as HStep[], 'N', replays);
    evidence[r.seed] = { T: t + '/' + replays + ' clean', N: (replays - n) + '/' + replays + ' diverge' };
    if (t < replays) { add('unstable', r.seed); continue; }
  }
  if (res.problems.some(p => p.includes('NotReadyError'))) { add('9', r.seed); continue; }
  if (res.classes.every(c => /seen$/.test(c))) { add('11', r.seed); continue; }
  const m = res.problems.map(p => /step (\d+)/.exec(p)).find(Boolean);
  const k = m ? Number(m[1]) : res.tTrace.steps.length - 1;
  const steps = res.tTrace.steps;
  const deliveredAt = new Map<string, number>();
  steps.forEach((s, i) => { if (s.type === 'deliver') deliveredAt.set(s.site + '#' + s.call, i); });
  const live = (q: Req) => q.step <= k && (deliveredAt.get(q.site + '#' + q.call) ?? Infinity) >= k;
  const actSteps = new Set(steps.map((s, i) => s.type === 'deliver' && s.site === 'take/act' ? i : -1).filter(i => i >= 0));
  const byAction = (q: Req) => q.site === 'take/act' || actSteps.has(q.step);
  const roots = new Set<string>([
    ...(split.includes('RecordView$server(') ? ['pick'] : []), ...(split.includes('CountView$server(') ? ['total'] : []),
    ...(split.includes('TopList$server(') ? ['top'] : []), ...(split.includes('Card$server(') ? ['Card.c'] : []),
  ]);
  const underShow = /<Show when=\{mode\(\) === "all"\}><(Frame\d+|Card\$frame)\b/.test(split);
  const toggled = steps.slice(1, k + 1).some(s => s.type === 'click' && /^Mode: /.test(s.target?.text ?? ''));
  const reqs = res.tTrace.requests.filter(live);
  if (reqs.some(byAction)) add('8', r.seed);
  else if (underShow && toggled) add('10', r.seed);
  else if (reqs.some(q => roots.has(q.site))) add('8', r.seed);
  else add('?', r.seed);
}
for (const f of Object.keys(families)) families[f].sort((a, b) => a - b);
await closeBrowser();
writeFileSync(join(dir, 'families.json'), JSON.stringify({ families, replays: evidence }, null, 1) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(families).map(([f, s]) => [f, { count: s.length, seeds: s }]))));
