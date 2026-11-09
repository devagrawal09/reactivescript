// Regenerates crates/runtime/tests/fixtures/slice2c-units.json: each program of
// unit-programs.json (and the tracker demo with Show + For, fuzz/generate-slice2c.mjs
// `trackerDemoC`) with the trace Solid (fuzz/solid.mjs, dist/prod) gives it, in a fresh
// strict 'slice2c' worker, as fuzz/run.mjs runs it. An invalid program is an error.
// The mechanism programs were found with mark-reduce.mjs from the first seeds marks.mjs
// lists for each site (docs/slice2c-fuzz/marks-1-1000.txt): parkChildren 12, die-on-spot 13,
// deferZombie 12, laneFrameMember-cancel 21, holdFrame-node 13, zombie-rerun-at-commit 37,
// commit-retires-frame 12, removalStagedBy 37 and 980 (980 with --disagree), dissolve-retires-frame 13,
// laneSeam-retires-frame 12, parked-frame-dies-with-owner 83, map-create-all-abort 23,
// map-abort-2903 92, map-small-commit 17, map-small-duplicate-decline 133,
// map-shallowView 96, map-fallback 2, writeRow-setSignal 1, index-setSignal 4. Three are
// hand-written: owners/cleanups/disposal, a function-child Show's stale read, a keyed Show.
// Usage (repository root, Node 24):
//   node docs/slice2c-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/slice2c-units.json
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {trackerDemoC}=await import(pathToFileURL(process.cwd()+'/fuzz/generate-slice2c.mjs').href);
const progs=JSON.parse(readFileSync(new URL('./unit-programs.json',import.meta.url),'utf8'));
progs.tracker_demo=trackerDemoC().ops;
const run=ops=>new Promise((res,rej)=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'slice2c'}});w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.once('error',rej);w.postMessage(ops)});
const out={};for(const [k,ops] of Object.entries(progs))out[k]={ops,expected:await run(ops)};
console.log(JSON.stringify(out));
