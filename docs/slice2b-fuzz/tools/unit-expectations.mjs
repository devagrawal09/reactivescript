// Regenerates crates/runtime/tests/fixtures/slice2b-units.json: each program of
// unit-programs.json (and the tracker demo, fuzz/generate-slice2b.mjs `trackerDemo`)
// with the trace Solid (fuzz/solid.mjs, dist/prod) gives it, in a fresh strict
// 'slice2b' worker, as fuzz/run.mjs runs it. An invalid program is an error.
// The mechanism programs were found with mark-reduce.mjs (seeds: optimistic_memo_take 30,
// kept_guess_restored 223, lane_outcome_truth_beneath_guess 7, opt_store_linked_lanes 12,
// derived_store_arrangement_rebase 16, derived_store_fold 17, derived_store_slot_take 40,
// derived_store_guess_flights 14, derived_store_staged_error 89) and extended with
// observations; check-marks.mjs lists the sites each reaches.
// Usage (repository root, Node 24):
//   node docs/slice2b-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/slice2b-units.json
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {trackerDemo}=await import(pathToFileURL(process.cwd()+'/fuzz/generate-slice2b.mjs').href);
const progs=JSON.parse(readFileSync(new URL('./unit-programs.json',import.meta.url),'utf8'));
progs.tracker_demo=trackerDemo().ops;
const run=ops=>new Promise((res,rej)=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'slice2b'}});w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.once('error',rej);w.postMessage(ops)});
const out={};for(const [k,ops] of Object.entries(progs))out[k]={ops,expected:await run(ops)};
console.log(JSON.stringify(out));
