// Usage (frontend/, Node 24): NODE_V8_COVERAGE=DIR node --experimental-strip-types --conditions=browser \
//   ../rust-solid/docs/boundaries-fuzz/tools/cov-plan.mjs SEED_DIR...
// Runs the plan leg (solid-plan.ts on the recording host) for seed dirs, each in a fresh worker; under
// NODE_V8_COVERAGE each worker writes its coverage. Prints per-seed agreement with traces.json's native.
import { Worker } from 'node:worker_threads';
import { readFileSync, existsSync } from 'node:fs';
const LEG = new URL('../../../../frontend/plan/fuzz/leg.ts', import.meta.url);
const dirs = process.argv.slice(2);
let ok = 0, bad = 0;
for (const d of dirs) {
  if (!existsSync(d + '/app.plan.json')) continue;
  const plan = JSON.parse(readFileSync(d + '/app.plan.json', 'utf8'));
  const sc = JSON.parse(readFileSync(d + '/app.scenario.json', 'utf8'));
  const native = existsSync(d + '/traces.json') ? JSON.parse(readFileSync(d + '/traces.json', 'utf8')).native : null;
  const r = await new Promise((res, rej) => { const w = new Worker(LEG, { workerData: { leg: 'plan', plan, hosts: sc.host, actions: plan.actions.map(a => a.name), steps: sc.steps } }); w.once('message', m => { w.terminate().then(() => res(m)); }); w.once('error', rej); });
  const same = native && JSON.stringify({ result: r.result, log: r.log }) === JSON.stringify(native);
  same ? ok++ : bad++;
}
console.log('ran', ok + bad, 'same as native', ok);
