// Coverage of Solid's universal.js / solid.js (Show, For) / web.js event code by --render
// programs: NODE_V8_COVERAGE=<dir> node docs/render-fuzz/tools/cov-run.mjs FIRST LAST, then
// docs/render-fuzz/tools/cov-report.mjs <dir> <url suffix> [first-last line]. Each program runs
// in a fresh worker (cov-worker.mjs, --conditions=browser) that exits on its own, so each
// worker writes its own coverage file.
import {Worker} from 'node:worker_threads';
import {generateRender} from '../../../fuzz/generate-render.mjs';
const [a,b]=process.argv.slice(2).map(Number);const kinds={};
for(let s=a;s<=b;s++){
 const k=await new Promise(res=>{let m;const w=new Worker(new URL('./cov-worker.mjs',import.meta.url),{execArgv:['--conditions=browser'],workerData:generateRender(s)});
  w.once('message',x=>{m=x});w.once('error',()=>{m='oracle-error'});w.once('exit',()=>res(m??'exit'))});
 kinds[k]=(kinds[k]??0)+1;
}
console.log(JSON.stringify(kinds));
