// Usage (rust-solid/): node docs/boundaries-fuzz/tools/hangcheck.mjs OPS.json...: whether Solid's oracle and the
// Rust driver each finish a --boundaries program within 10 s.
// For each program: does Solid's oracle finish within 10 s, and does the Rust driver?
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const F = new URL('../../../fuzz/', import.meta.url).href;
const oracle = ops => new Promise(res => { const w = new Worker(F + 'worker.mjs', { workerData: { strict: 'boundaries' } }); let done = false;
  const fin = r => { if (done) return; done = true; clearTimeout(t); w.terminate(); res(r) };
  const t = setTimeout(() => fin('hang>10s'), 10000);
  w.on('message', m => { if ('progress' in m) return; fin(m.invalid ?? 'ok') }); w.once('error', () => fin('error')) ; w.postMessage(ops) });
for (const f of process.argv.slice(2)) {
  const ops = JSON.parse(readFileSync(f, 'utf8'));
  const o = await oracle(ops);
  const r = spawnSync(new URL('../../../target/debug/slice1-driver', import.meta.url).pathname, { input: JSON.stringify(ops) + '\n', timeout: 10000, encoding: 'utf8' });
  console.log(f, 'solid:', o, 'rust:', r.error ? 'hang>10s' : r.status === 0 ? 'ok' : 'exit ' + r.status);
}
