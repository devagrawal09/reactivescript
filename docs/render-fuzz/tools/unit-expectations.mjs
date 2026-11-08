// Regenerates crates/runtime/tests/fixtures/render-units.json: each hand-written renderer
// program of unit-programs.json (written by unit-programs.mjs) with the log Solid gives it
// (fuzz/universal.mjs on @solidjs/universal, solid-js and @solidjs/web, dist/prod), in a fresh
// render worker as fuzz/run.mjs --render runs it. An invalid program is an error.
// Usage (repository root, Node 24):
//   node docs/render-fuzz/tools/unit-programs.mjs > docs/render-fuzz/tools/unit-programs.json
//   node docs/render-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/render-units.json
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
const progs=JSON.parse(readFileSync(new URL('./unit-programs.json',import.meta.url),'utf8'));
const run=ops=>new Promise((res,rej)=>{const w=new Worker(new URL('../../../fuzz/render-worker.mjs',import.meta.url),{execArgv:['--conditions=browser']});w.on('message',m=>{w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.once('error',rej);w.postMessage(ops)});
const out={};for(const [k,ops] of Object.entries(progs))out[k]={ops,expected:await run(ops)};
console.log(JSON.stringify(out));
