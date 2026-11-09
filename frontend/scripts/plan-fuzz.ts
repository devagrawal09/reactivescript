// npm run plan-fuzz -- --seeds N --start S [--jobs J] [--rust PLAN_TRACE] [--out DIR]
// The plan fuzz (plan/docs/PLAN-V2.md, "Plan fuzz") over seeds S..S+N-1: for each generated program, native Solid,
// compiled RX, the plan built by plan/solid-plan.ts and the Rust plan v2 consumer must give the same result and the same
// full host log. Writes DIR (default .out/plan-fuzz/run-S-N/): summary.json, summary.md, and for each program that does
// not agree a directory with its TSX, RX, host declarations, plan, scenario and every leg's trace.
// The Rust leg is `plan-trace` from --rust, or $RUST_SOLID/target/debug/plan-trace; without one the run fails.
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../plan/fuzz/gen.ts';
import { runCase, type Outcome } from '../plan/fuzz/run.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const seeds = Number(flag('--seeds') ?? 100), start = Number(flag('--start') ?? 1), jobs = Number(flag('--jobs') ?? 4);
const rust = flag('--rust') ?? (process.env.RUST_SOLID ? process.env.RUST_SOLID + '/target/debug/plan-trace' : undefined);
if (!rust || !existsSync(rust)) { console.error('the Rust leg needs plan-trace: pass --rust PATH or set RUST_SOLID (missing: ' + rust + ')'); process.exit(2); }
const out = flag('--out') ?? fileURLToPath(new URL('../.out/plan-fuzz/run-' + start + '-' + seeds + '/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const outcomes: Outcome[] = [];
let next = start;
const worker = async () => {
  for (;;) {
    const seed = next++;
    if (seed >= start + seeds) return;
    const o = await runCase(generate(seed), { rust });
    outcomes.push(o);
    if (o.status !== 'agree') {
      console.log('seed', seed, o.status, o.classes.join(' + '), o.status === 'refused' ? o.detail : '');
      const dir = out + 'seed-' + seed + '/';
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(o.files)) writeFileSync(dir + name, text);
      if (o.plan) writeFileSync(dir + 'app.plan.json', JSON.stringify(o.plan, null, 2) + '\n');
      if (o.scenario) writeFileSync(dir + 'app.scenario.json', JSON.stringify(o.scenario, null, 2) + '\n');
      if (o.traces) writeFileSync(dir + 'traces.json', JSON.stringify(o.traces) + '\n');
      writeFileSync(dir + 'outcome.json', JSON.stringify({ seed, family: o.family, status: o.status, classes: o.classes, detail: o.detail }, null, 2) + '\n');
    }
  }
};
await Promise.all(Array.from({ length: jobs }, worker));
outcomes.sort((a, b) => a.seed - b.seed);

const tally: Record<string, number> = { agree: 0, upstream: 0, divergent: 0, refused: 0, invalid: 0, 'generator-bug': 0 };
const classes: Record<string, { count: number; seeds: number[] }> = {};
const refusals: Record<string, { count: number; seeds: number[] }> = {};
/** Native vs RX differences on refused programs (no plan legs): informational, kept apart from the classes. */
const refusedClasses: Record<string, { count: number; seeds: number[] }> = {};
const families: Record<string, Record<string, number>> = {};
/** Plan node kinds: in how many agreeing programs each occurs, and how often in all. */
const coverage: Record<string, { programs: number; nodes: number }> = {};
const features: Record<string, number> = {};
/** Yield twins: how many programs have one and emit the RX plan, and why the others have none. */
const yieldTwins: Record<string, number> = {};
let steps = 0, entries = 0;
for (const o of outcomes) {
  tally[o.status]++;
  if (o.yield) yieldTwins[o.yield] = (yieldTwins[o.yield] ?? 0) + 1;
  (families[o.family] ??= { total: 0, agree: 0 }).total++;
  if (o.status === 'agree') families[o.family].agree++;
  for (const k of o.classes) { classes[k] ??= { count: 0, seeds: [] }; classes[k].count++; if (classes[k].seeds.length < 20) classes[k].seeds.push(o.seed); }
  for (const k of o.refusedClasses ?? []) { refusedClasses[k] ??= { count: 0, seeds: [] }; refusedClasses[k].count++; if (refusedClasses[k].seeds.length < 20) refusedClasses[k].seeds.push(o.seed); }
  if (o.status === 'refused') { const k = o.detail ?? ''; refusals[k] ??= { count: 0, seeds: [] }; refusals[k].count++; if (refusals[k].seeds.length < 20) refusals[k].seeds.push(o.seed); }
  if (o.status === 'agree') {
    for (const [k, n] of Object.entries(o.nodes ?? {})) { coverage[k] ??= { programs: 0, nodes: 0 }; coverage[k].programs++; coverage[k].nodes += n; }
    steps += o.scenario!.steps.length; entries += o.traces!.native!.log.length;
    for (const f of o.features ?? []) features[f] = (features[f] ?? 0) + 1;
  }
}
const summary = {
  start, seeds, total: outcomes.length, ...tally,
  agreeing: { scenarioSteps: steps, logEntriesPerLeg: entries },
  families, classes, refusals, refusedClasses,
  yieldTwins: Object.fromEntries(Object.entries(yieldTwins).sort(([a], [b]) => a.localeCompare(b))),
  scenarioFeatures: Object.fromEntries(Object.entries(features).sort(([a], [b]) => a.localeCompare(b))),
  coverage: Object.fromEntries(Object.entries(coverage).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(out + 'summary.json', JSON.stringify(summary, null, 1) + '\n');
writeFileSync(out + 'summary.md', [
  '# Plan fuzz: seeds ' + start + '..' + (start + seeds - 1), '',
  'Native Solid, compiled RX, solid-plan.ts and Rust `plan-trace` must give the same result and full host log.', '',
  ...Object.entries(tally).map(([k, n]) => '- ' + k + ': ' + n),
  '- agreeing programs: ' + steps + ' scenario steps, ' + entries + ' host log entries per leg', '',
  '## Classes', '', ...(Object.keys(classes).length ? Object.entries(classes).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
  '## Refusals (the emitter refused; not agreement)', '', ...(Object.keys(refusals).length ? Object.entries(refusals).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
  '## Native vs RX on refused programs (informational)', '', ...(Object.keys(refusedClasses).length ? Object.entries(refusedClasses).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
  '## Yield twins (the same program in the yield dialect, where it can say it; its plan must be the RX plan)', '',
  ...Object.entries(summary.yieldTwins).map(([k, n]) => '- ' + k + ': ' + n), '',
  '## Scenario features (agreeing programs)', '', ...Object.entries(summary.scenarioFeatures).map(([k, n]) => '- ' + k + ': ' + n), '',
  '## Plan node coverage (agreeing programs containing the kind / occurrences)', '',
  ...Object.entries(summary.coverage).map(([k, v]) => '- ' + k + ': ' + v.programs + ' / ' + v.nodes),
].join('\n') + '\n');
console.log(JSON.stringify({ total: summary.total, ...tally, classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.count])) }, null, 1));
console.log('wrote ' + out);
process.exitCode = tally.divergent || tally['generator-bug'] || tally.invalid ? 1 : 0;
