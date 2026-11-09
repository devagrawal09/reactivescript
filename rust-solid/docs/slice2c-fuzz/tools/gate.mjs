// Byte gate for fuzz/solid.mjs changes (docs/SLICE2B-DESIGN.md sec. 3.5, docs/SLICE2B-COVERAGE.md).
// Runs every program of a legacy generator through the OLD oracle (a copy of the pre-change
// fuzz/solid.mjs + fuzz/worker.mjs in out/gate-old/) and the NEW one, each program in a fresh
// worker with the same workerData run.mjs gives that mode, and compares the whole result
// message ({expected} or {invalid, detail}) as JSON. Any difference is printed and fails.
//   SOLID_SIGNALS_URL=file://.../dist/prod/index.js node gate.mjs m1|slice1|slice2a|slice2b FIRST LAST [JOBS]
// (docs/slice2c-fuzz copy: adds slice2b, run with workerData {strict:'slice2b'} as run.mjs does.)
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const [mode,a,b,jobs='8']=process.argv.slice(2);
const gen={m1:async()=>(await import(new URL('fuzz/generate.mjs',root))).generate,
 slice1:async()=>(await import(new URL('fuzz/generate-slice1.mjs',root))).generateSlice1,
 slice2a:async()=>(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a,
 slice2b:async()=>(await import(new URL('fuzz/generate-slice2b.mjs',root))).generateSlice2b}[mode];
if(!gen||!process.env.SOLID_SIGNALS_URL)throw Error('usage: SOLID_SIGNALS_URL=... node gate.mjs m1|slice1|slice2a FIRST LAST [JOBS]');
const g=await gen(),wd=mode==='slice2a'?[{workerData:{strict:true}}]:mode==='slice2b'?[{workerData:{strict:'slice2b'}}]:[];
const once=(file,ops)=>new Promise(res=>{const w=new Worker(new URL(file,root),...wd);let progress;
 const t=setTimeout(()=>{w.terminate();res(JSON.stringify({invalid:'oracle-timeout',progress}))},1500);
 w.on('message',m=>{if('progress'in m){progress=m.progress;return}clearTimeout(t);w.terminate();res(JSON.stringify(m))});
 w.once('error',e=>{clearTimeout(t);res(JSON.stringify({invalid:'oracle-error',detail:e.stack}))});w.postMessage(ops)});
// The only tolerated difference is the oracle's own stack-frame locations inside an
// oracle-error detail (the old copy lives at another path and its lines moved); it is
// counted and listed separately, never silently merged into `same`.
const frames=x=>x.replace(/file:\/\/\S*?\/(fuzz|out\/gate-old)\/(solid|worker)\.mjs:\d+:\d+/g,'<oracle>/$2.mjs');
let next=+a,diff=0,same=0;const kinds={},frameOnly=[],timeouts=[];
async function lane(){while(next<=+b){const s=next++;const ops=g(s);
 const [o,n]=await Promise.all([once('out/gate-old/worker.mjs',ops),once('fuzz/worker.mjs',ops)]);
 const k=JSON.parse(o).invalid??'trace';kinds[k]=(kinds[k]??0)+1;
 // A timeout on both sides compares equal without comparing traces: listed for a rerun.
 if(k==='oracle-timeout'||JSON.parse(n).invalid==='oracle-timeout')timeouts.push(s);
 if(o===n)same++;else if(JSON.parse(o).invalid==='oracle-error'&&frames(o)===frames(n))frameOnly.push(s);else{diff++;console.log('DIFF seed',s,'\n old',o.slice(0,400),'\n new',n.slice(0,400))}}}
await Promise.all(Array.from({length:+jobs},lane));
console.log(JSON.stringify({mode,first:+a,last:+b,same,oracleErrorFrameOnly:frameOnly,diff,kinds,timeouts:timeouts.sort((x,y)=>x-y)}));
if(diff)process.exitCode=1;
