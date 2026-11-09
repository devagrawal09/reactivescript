// Regenerates crates/runtime/tests/fixtures/strings-units.json: each program of
// unit-programs.json with the trace Solid (fuzz/solid.mjs, dist/prod) gives it, in a fresh
// strict 'strings' worker, as fuzz/run.mjs --strings runs it. An invalid program is an error.
// Usage (repository root, Node 24):
//   node docs/strings-fuzz/tools/unit-programs.mjs > docs/strings-fuzz/tools/unit-programs.json
//   node docs/strings-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/strings-units.json
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
const progs=JSON.parse(readFileSync(new URL('./unit-programs.json',import.meta.url),'utf8'));
const run=ops=>new Promise((res,rej)=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'strings'}});w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.once('error',rej);w.postMessage(ops)});
const out={};for(const [k,ops] of Object.entries(progs))out[k]={ops,expected:await run(ops)};
console.log(JSON.stringify(out));
