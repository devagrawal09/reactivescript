// The placement fuzz (docs/RESULTS.md, "Slice 6", "Placement fuzz"): `node --experimental-strip-types
// scripts/frames-fuzz.ts --seeds N --start S [--rust FRAMES_SERVER] [--jobs K] [--out DIR]`. Runs frames/fuzz/run.ts
// on each seed (K at a time, default 4), writes DIR/summary.json (default .out/frames-fuzz/run-S-N/) with the outcome
// tallies, refusals by code, client-only programs by PL reason, divergence classes, and the coverage of recipes and
// scenario features; every non-agreeing seed keeps its files and traces in DIR/seed-<n>/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSeed, type SeedResult } from '../frames/fuzz/run.ts';
import { closeBrowser } from '../frames/harness.ts';

const args = process.argv.slice(2);
const opt = (name: string, d?: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const seeds = Number(opt('--seeds', '100')), start = Number(opt('--start', '1')), jobs = Number(opt('--jobs', '4'));
const rust = opt('--rust');
const out = opt('--out', fileURLToPath(new URL('../.out/frames-fuzz/run-' + start + '-' + seeds + '/', import.meta.url)))!;
mkdirSync(out, { recursive: true });
const results: SeedResult[] = [];
let next = start;
const worker = async () => {
  while (next < start + seeds) {
    const seed = next++;
    let r: SeedResult;
    try { r = await runSeed(seed, { rust, out }); }
    catch (e) { r = { seed, outcome: 'generator-bug', problems: ['runner: ' + String((e as Error)?.stack ?? e)] }; }
    results.push(r);
    if (r.outcome !== 'agree' && r.outcome !== 'refused' && r.outcome !== 'client-only') console.log('seed', seed, r.outcome, (r.classes ?? []).join('; '), (r.problems ?? [])[0]?.slice(0, 300) ?? '');
    if (results.length % 25 === 0) console.log(results.length + '/' + seeds);
  }
};
await Promise.all(Array.from({ length: jobs }, worker));
await closeBrowser();
results.sort((a, b) => a.seed - b.seed);
const tally = (k: SeedResult['outcome']) => results.filter(r => r.outcome === k).length;
const count = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort());
const summary = {
  start, seeds, total: results.length, rust: !!rust,
  agree: tally('agree'), 'client-only': tally('client-only'), refused: tally('refused'), divergent: tally('divergent'), invalid: tally('invalid'), 'generator-bug': tally('generator-bug'),
  refusals: count(results.filter(r => r.refusal).map(r => r.refusal!)),
  clientOnly: count(results.filter(r => r.outcome === 'client-only').flatMap(r => r.reasons ?? [])),
  classes: count(results.flatMap(r => r.classes ?? [])),
  divergentSeeds: results.filter(r => r.outcome === 'divergent').map(r => r.seed),
  invalidSeeds: results.filter(r => r.outcome === 'invalid').map(r => r.seed),
  generatorBugSeeds: results.filter(r => r.outcome === 'generator-bug').map(r => r.seed),
  coverage: count(results.filter(r => r.outcome === 'agree' || r.outcome === 'client-only').flatMap(r => r.features ?? [])),
  steps: results.reduce((n, r) => n + (r.outcome === 'agree' || r.outcome === 'client-only' ? r.steps ?? 0 : 0), 0),
  requests: results.reduce((n, r) => n + (r.outcome === 'agree' || r.outcome === 'client-only' ? r.requests ?? 0 : 0), 0),
  serverRoots: results.reduce((n, r) => n + (r.outcome === 'agree' ? r.roots ?? 0 : 0), 0),
  // R against N on every program the legs ran (divergent ones included, against N's own run).
  rustEqual: results.filter(r => r.rust === 'equal').length,
  rustDiffers: results.filter(r => r.rust === 'differs').map(r => r.seed),
};
writeFileSync(out + 'summary.json', JSON.stringify(summary, null, 2) + '\n');
writeFileSync(out + 'results.json', JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ total: summary.total, agree: summary.agree, 'client-only': summary['client-only'], refused: summary.refused, divergent: summary.divergent, invalid: summary.invalid, 'generator-bug': summary['generator-bug'] }));
