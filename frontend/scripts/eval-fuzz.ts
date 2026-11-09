// npm run eval-fuzz -- --seeds N --start S [--jobs J] [--rust PLAN_TRACE] [--out DIR]
// The eval fuzz (docs/EVAL.md, "Eval fuzz") over seeds S..S+N-1: each plan fuzz program split into an enclosing
// component and evaluated code (eval/fuzz/gen.ts), run as a static twin on native Solid, through createEval on native
// Solid, as a plan on solid-plan.ts and on Rust's plan-trace with the host's eval table; every leg must give the static
// twin's result and full host log. Writes DIR (default .out/eval-fuzz/run-S-N/): summary.json, summary.md, and for each
// program that does not agree a directory with its files, plan, scenario, eval table and every leg's trace.
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runEvalSeed, type EvalFuzzOutcome } from '../eval/fuzz/run.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const seeds = Number(flag('--seeds') ?? 100), start = Number(flag('--start') ?? 1), jobs = Number(flag('--jobs') ?? 4);
const rust = flag('--rust') ?? (process.env.RUST_SOLID ? process.env.RUST_SOLID + '/target/debug/plan-trace' : undefined);
if (!rust || !existsSync(rust)) { console.error('the Rust leg needs plan-trace: pass --rust PATH or set RUST_SOLID (missing: ' + rust + ')'); process.exit(2); }
const out = flag('--out') ?? fileURLToPath(new URL('../.out/eval-fuzz/run-' + start + '-' + seeds + '/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const outcomes: EvalFuzzOutcome[] = [];
let next = start;
const worker = async () => {
  for (;;) {
    const seed = next++;
    if (seed >= start + seeds) return;
    const o = await runEvalSeed(seed, { rust });
    outcomes.push(o);
    if (o.status !== 'agree') {
      console.log('seed', seed, o.status, o.classes.join(' + '), o.status === 'refused' ? o.detail : '');
      const dir = out + 'seed-' + seed + '/';
      mkdirSync(dir, { recursive: true });
      const { generateEval } = await import('../eval/fuzz/gen.ts');
      for (const [name, text] of Object.entries(generateEval(seed).files)) writeFileSync(dir + name, text);
      if (o.plan) writeFileSync(dir + 'app.plan.json', JSON.stringify(o.plan, null, 2) + '\n');
      if (o.scenario) writeFileSync(dir + 'app.scenario.json', JSON.stringify(o.scenario, null, 2) + '\n');
      if (o.table) writeFileSync(dir + 'app.evals.json', JSON.stringify(o.table) + '\n');
      if (o.traces) writeFileSync(dir + 'traces.json', JSON.stringify(o.traces) + '\n');
      writeFileSync(dir + 'outcome.json', JSON.stringify({ seed, family: o.family, mode: o.mode, syntax: o.syntax, status: o.status, classes: o.classes, detail: o.detail, baseRefusal: o.baseRefusal }, null, 2) + '\n');
    }
  }
};
await Promise.all(Array.from({ length: jobs }, worker));
outcomes.sort((a, b) => a.seed - b.seed);

const tally: Record<string, number> = { agree: 0, refused: 0, divergent: 0, invalid: 0, 'generator-bug': 0 };
const classes: Record<string, { count: number; seeds: number[] }> = {};
const refusals: Record<string, { count: number; seeds: number[] }> = {};
const shapes: Record<string, number> = {};
const bindingKinds: Record<string, number> = {};
let steps = 0, entries = 0, codes = 0, reloads = 0;
const add = (m: Record<string, { count: number; seeds: number[] }>, k: string, seed: number) => { m[k] ??= { count: 0, seeds: [] }; m[k].count++; if (m[k].seeds.length < 20) m[k].seeds.push(seed); };
for (const o of outcomes) {
  tally[o.status]++;
  for (const k of o.classes) add(classes, k, o.seed);
  if (o.status === 'refused') add(refusals, o.detail ?? '', o.seed);
  if (o.status === 'agree') {
    const shape = o.mode + ' / ' + o.syntax + (o.reload ? ' / reload' : '');
    shapes[shape] = (shapes[shape] ?? 0) + 1;
    reloads += o.scenario!.steps.filter(x => x.type === 'click' && 'target' in x && x.target.text === 'reload').length;
    steps += o.scenario!.steps.length; entries += o.traces!.static!.log.length; codes += o.table!.evals.length;
    for (const b of (o.table!.evals[0] as { plan?: { bindings?: { kind: string }[]; hosts: unknown[] } }).plan?.bindings ?? []) bindingKinds[b.kind] = (bindingKinds[b.kind] ?? 0) + 1;
    bindingKinds.host = (bindingKinds.host ?? 0) + ((o.table!.evals[0] as { plan?: { hosts: unknown[] } }).plan?.hosts.length ?? 0);
  }
}
const summary = {
  start, seeds, total: outcomes.length, ...tally,
  agreeing: { scenarioSteps: steps, logEntriesPerLeg: entries, evaluatedCodes: codes, codeChanges: reloads },
  shapes: Object.fromEntries(Object.entries(shapes).sort()), bindingKinds: Object.fromEntries(Object.entries(bindingKinds).sort()),
  classes, refusals,
};
writeFileSync(out + 'summary.json', JSON.stringify(summary, null, 1) + '\n');
writeFileSync(out + 'summary.md', [
  '# Eval fuzz: seeds ' + start + '..' + (start + seeds - 1), '',
  'Static twin (native Solid), createEval (native Solid), the plan (solid-plan.ts) and Rust `plan-trace` must give the same result and full host log.', '',
  ...Object.entries(tally).map(([k, n]) => '- ' + k + ': ' + n),
  '- agreeing programs: ' + steps + ' scenario steps (' + reloads + ' of them change the code), ' + entries + ' host log entries per leg', '',
  '## Shapes (agreeing: mode / code syntax)', '', ...Object.entries(summary.shapes).map(([k, n]) => '- ' + k + ': ' + n), '',
  '## Bindings (agreeing programs, by kind)', '', ...Object.entries(summary.bindingKinds).map(([k, n]) => '- ' + k + ': ' + n), '',
  '## Classes', '', ...(Object.keys(classes).length ? Object.entries(classes).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
  '## Refusals (the code was refused; every eval leg fails with it; not agreement)', '', ...(Object.keys(refusals).length ? Object.entries(refusals).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']),
].join('\n') + '\n');
console.log(JSON.stringify({ total: summary.total, ...tally, classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.count])) }, null, 1));
console.log('wrote ' + out);
process.exitCode = tally.divergent || tally['generator-bug'] || tally.invalid ? 1 : 0;
