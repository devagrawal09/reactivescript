// npm run plan-fuzz-corpus -- --start S --seeds N --max K --out DIR [--rust PLAN_TRACE]
// Picks at most K agreeing plan-fuzz programs from seeds S..S+N-1, greedily, so that together they cover every plan
// node kind and scenario feature the run covers (then the programs with the most scenario features), and writes each
// as DIR/seed-<n>.json: its plan, its recorded scenario and native Solid's full trace. rust-solid's `cargo test --test plan_fuzz` replays them through the Rust consumer.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { generate } from '../plan/fuzz/gen.ts';
import { runCase, type Outcome } from '../plan/fuzz/run.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const start = Number(flag('--start') ?? 1), seeds = Number(flag('--seeds') ?? 200), max = Number(flag('--max') ?? 10);
const out = flag('--out'), rust = flag('--rust') ?? (process.env.RUST_SOLID ? process.env.RUST_SOLID + '/target/debug/plan-trace' : undefined);
if (!out || !rust) { console.error('usage: plan-fuzz-corpus.ts --out DIR --rust PLAN_TRACE [--start S --seeds N --max K]'); process.exit(2); }
const keys = (o: Outcome) => [...Object.keys(o.nodes ?? {}), ...(o.features ?? []).map(f => 'scenario:' + f), 'family:' + o.family];
const agreeing: Outcome[] = [];
for (let seed = start; seed < start + seeds; seed++) {
  const o = await runCase(generate(seed), { rust });
  if (o.status === 'agree') agreeing.push(o);
}
const covered = new Set<string>(), chosen: Outcome[] = [];
while (chosen.length < max) {
  let best: Outcome | undefined, gain = 0;
  for (const o of agreeing) {
    if (chosen.includes(o)) continue;
    const g = keys(o).filter(k => !covered.has(k)).length;
    if (g > gain || (g === gain && g > 0 && best && o.traces!.native!.log.length < best.traces!.native!.log.length)) { best = o; gain = g; }
  }
  // Everything covered: fill up with the programs that exercise the most scenario features (then the shortest logs).
  if (!best) best = agreeing.filter(o => !chosen.includes(o)).sort((a, b) => (b.features?.length ?? 0) - (a.features?.length ?? 0) || a.traces!.native!.log.length - b.traces!.native!.log.length)[0];
  if (!best) break;
  chosen.push(best);
  keys(best).forEach(k => covered.add(k));
}
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^seed-\d+\.json$/.test(f)) rmSync(out + '/' + f);
for (const o of chosen) writeFileSync(out + '/seed-' + o.seed + '.json', JSON.stringify({ seed: o.seed, family: o.family, plan: o.plan, scenario: o.scenario, native: o.traces!.native }) + '\n');
const all = new Set(agreeing.flatMap(keys));
console.log(JSON.stringify({ agreeing: agreeing.length, chosen: chosen.map(o => o.seed), covered: covered.size, of: all.size, missing: [...all].filter(k => !covered.has(k)) }));
