// Regenerates crates/runtime/tests/fixtures/slice2a-units.json: each program of
// unit-programs.json with the trace Solid (fuzz/solid.mjs, dist/prod) gives it.
// Usage (repository root, Node 24):
//   node docs/slice2a-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/slice2a-units.json
// Each program runs in a fresh worker, as fuzz/run.mjs does.
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
const progs=JSON.parse(readFileSync(new URL('./unit-programs.json',import.meta.url),'utf8'));
const run=ops=>new Promise((res,rej)=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:true}});w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.once('error',rej);w.postMessage(ops)});
const out={};for(const [k,ops] of Object.entries(progs))out[k]={ops,expected:await run(ops)};
console.log(JSON.stringify(out));
