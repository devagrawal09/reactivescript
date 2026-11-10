// node --experimental-strip-types --conditions=browser scripts/eval-slice.ts [--steps FILE] [--rust-fixture FILE] [--async]
// Records the eval slice (docs/EVAL.md, "Gate") on its static twin and writes its artifacts: eval.scenario.json (the
// steps, from --steps or the saved scenario, with the frames native Solid shows), eval.plan.json (the plan eval.rx and
// eval.tsx emit) and eval.evals.json (the host's eval table, every request the plan leg compiled). With --rust-fixture
// it also writes the Rust consumer's fixture: plan, scenario, table and the static twin's trace. The test
// (slices/eval.test.ts) re-derives all of them and requires the saved ones.
// --async records the async eval slice instead (slices/eval-async/, docs/EVAL.md "Async data"; plan v2.1, format 2.1):
// eval-async.scenario.json, eval-async.plan.json and eval-async.evals.json, checked by slices/eval-async.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { runEvalProgram } from '../eval/harness/run.ts';
import * as plain from '../slices/eval/load.ts';
import * as asyncSlice from '../slices/eval-async/load.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const async = process.argv.includes('--async');
const { slice, sliceFiles, sliceHosts, slicePath } = async ? asyncSlice : plain;
const stem = async ? 'eval-async' : 'eval';
const steps = flag('--steps') ? JSON.parse(readFileSync(flag('--steps')!, 'utf8')) : JSON.parse(slice(stem + '.scenario.json')).steps;
const name = async ? 'eval-async: code that loads its own data, code that reads the enclosing async memo, TSX-syntax code' : 'eval: code strings that change over time';
const o = await runEvalProgram({ name, files: sliceFiles(), hosts: sliceHosts, script: steps, ...(async ? { async } : {}) });
// The async slice's plans are v2.1 (no Rust leg is run here; slices/eval-async.test.ts runs rust-solid's plan-trace).
if (o.status !== 'agree') { console.error(o.status, o.classes, o.detail); process.exit(1); }
const scenario = { ...o.scenario!, fixture: stem };
writeFileSync(slicePath(stem + '.scenario.json'), JSON.stringify(scenario, null, 2) + '\n');
writeFileSync(slicePath(stem + '.plan.json'), JSON.stringify(o.plan, null, 2) + '\n');
writeFileSync(slicePath(stem + '.evals.json'), JSON.stringify(o.table, null, 2) + '\n');
const rust = flag('--rust-fixture');
if (rust) writeFileSync(rust, JSON.stringify({ plan: o.plan, scenario, evals: o.table, trace: o.traces!.static }) + '\n');
console.log(stem + ' slice: ' + scenario.steps.length + ' steps, ' + o.table!.evals.length + ' evaluated codes, ' + o.traces!.static!.log.length + ' host log entries');
