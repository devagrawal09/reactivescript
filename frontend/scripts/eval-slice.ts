// node --experimental-strip-types --conditions=browser scripts/eval-slice.ts [--steps FILE] [--rust-fixture FILE]
// Records the eval slice (docs/EVAL.md, "Gate") on its static twin and writes its artifacts: eval.scenario.json (the
// steps, from --steps or the saved scenario, with the frames native Solid shows), eval.plan.json (the plan eval.rx and
// eval.tsx emit) and eval.evals.json (the host's eval table, every request the plan leg compiled). With --rust-fixture
// it also writes the Rust consumer's fixture: plan, scenario, table and the static twin's trace. The test
// (slices/eval.test.ts) re-derives all of them and requires the saved ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { runEvalProgram } from '../eval/harness/run.ts';
import { slice, sliceFiles, sliceHosts, slicePath } from '../slices/eval/load.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const steps = flag('--steps') ? JSON.parse(readFileSync(flag('--steps')!, 'utf8')) : JSON.parse(slice('eval.scenario.json')).steps;
const o = await runEvalProgram({ name: 'eval: code strings that change over time', files: sliceFiles(), hosts: sliceHosts, script: steps });
if (o.status !== 'agree') { console.error(o.status, o.classes, o.detail); process.exit(1); }
const scenario = { ...o.scenario!, fixture: 'eval' };
writeFileSync(slicePath('eval.scenario.json'), JSON.stringify(scenario, null, 2) + '\n');
writeFileSync(slicePath('eval.plan.json'), JSON.stringify(o.plan, null, 2) + '\n');
writeFileSync(slicePath('eval.evals.json'), JSON.stringify(o.table, null, 2) + '\n');
const rust = flag('--rust-fixture');
if (rust) writeFileSync(rust, JSON.stringify({ plan: o.plan, scenario, evals: o.table, trace: o.traces!.static }) + '\n');
console.log('eval slice: ' + scenario.steps.length + ' steps, ' + o.table!.evals.length + ' evaluated codes, ' + o.traces!.static!.log.length + ' host log entries');
