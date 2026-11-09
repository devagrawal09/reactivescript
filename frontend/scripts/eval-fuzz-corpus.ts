// node --experimental-strip-types --conditions=browser scripts/eval-fuzz-corpus.ts --start S --seeds N --max M --out DIR
// Picks eval fuzz programs (docs/EVAL.md, "Eval fuzz") that agree on every JS leg, covering both modes, both code
// syntaxes, code changes (reload), every binding kind and a refusal, and writes each as rust-solid's
// tests/fixtures/eval/seed-N.json: the plan, the scenario, the host's eval table and the static twin's trace (native
// Solid's result and host log), which the Rust consumer must give entry for entry (crates/runtime/tests/eval.rs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { runEvalSeed } from '../eval/fuzz/run.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const start = Number(flag('--start') ?? 1), seeds = Number(flag('--seeds') ?? 100), max = Number(flag('--max') ?? 8), out = flag('--out');
if (!out) { console.error('--out DIR is required'); process.exit(2); }
mkdirSync(out, { recursive: true });
const want = ['split', 'whole', 'rx', 'tsx', 'reload', 'read', 'store', 'action', 'host', 'refused'];
const covered = new Set<string>();
let kept = 0;
for (let seed = start; seed < start + seeds && kept < max; seed++) {
  const o = await runEvalSeed(seed);
  if (o.status !== 'agree' && o.status !== 'refused') { console.error('seed', seed, o.status, o.classes); process.exit(1); }
  const kinds = new Set<string>([o.mode, o.syntax, ...(o.reload ? ['reload'] : []), ...(o.status === 'refused' ? ['refused'] : [])]);
  for (const e of o.table?.evals ?? []) if ('plan' in e) { for (const b of e.plan.bindings ?? []) kinds.add(b.kind); if (e.plan.hosts.length) kinds.add('host'); }
  const fresh = [...kinds].filter(k => want.includes(k) && !covered.has(k));
  if (!fresh.length) continue;
  for (const k of fresh) covered.add(k);
  kept++;
  writeFileSync(out + '/seed-' + seed + '.json', JSON.stringify({ seed, status: o.status, ...(o.status === 'refused' ? { refusal: o.detail } : {}), plan: o.plan, scenario: o.scenario, evals: o.table, trace: o.traces!.static }) + '\n');
  console.log('seed', seed, o.status, [...kinds].join(' '));
}
const missing = want.filter(k => !covered.has(k));
if (missing.length) { console.error('not covered: ' + missing.join(', ')); process.exit(1); }
