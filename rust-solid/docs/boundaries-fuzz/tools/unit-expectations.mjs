// Solid's traces for the --boundaries unit programs (unit-programs.json): each program on fuzz/solid.mjs in a fresh
// strict worker (worker.mjs strict 'boundaries'), as fuzz/run.mjs runs the oracle. Prints the fixture
// crates/runtime/tests/fixtures/boundaries-units.json: { name: { ops, expected } }. Fails on an invalid program.
// Usage (rust-solid/): node docs/boundaries-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/boundaries-units.json
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
const programs = JSON.parse(readFileSync(new URL('./unit-programs.json', import.meta.url), 'utf8'));
const oracle = ops => new Promise((res, rej) => { const w = new Worker(new URL('../../../fuzz/worker.mjs', import.meta.url), { workerData: { strict: 'boundaries' } });
  const t = setTimeout(() => { w.terminate(); rej(new Error('oracle timeout')) }, 10000);
  w.on('message', m => { if ('progress' in m) return; clearTimeout(t); w.terminate(); m.invalid ? rej(new Error(m.invalid + ' ' + (m.detail ?? ''))) : res(m.expected) }); w.postMessage(ops) });
const out = {};
for (const [name, ops] of Object.entries(programs)) out[name] = { ops, expected: await oracle(ops) };
console.log(JSON.stringify(out));
