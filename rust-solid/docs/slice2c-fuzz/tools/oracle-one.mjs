// Runs one program (a JSON op array, or {ops}) on fuzz/solid.mjs in a FRESH worker, as the
// --slice2c oracle does, and prints the trace one event per line plus any error the run threw
// and any [REACTIVITY_HALTED] error an effect logged (first stack lines). For repros.
//   node docs/slice2c-fuzz/tools/oracle-one.mjs FILE.json [strict]
// With "strict", the program also goes through fuzz/worker.mjs strict 'slice2c' and the
// worker's verdict ({expected} / {invalid}) is printed.
import {Worker} from 'node:worker_threads';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [file,mode]=process.argv.slice(2);let ops=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(ops))ops=ops.ops;
mkdirSync('out',{recursive:true});
writeFileSync('out/oracle-one-worker.mjs',`import {parentPort} from 'node:worker_threads';
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
let logged='';console.error=(...a)=>{for(const x of a)logged+=(x instanceof Error?x.stack:String(x))+'\\n'};
parentPort.on('message',async ops=>{let thrown='',trace=null;try{trace=await run(ops,()=>{})}catch(e){thrown=String(e&&e.stack)}parentPort.postMessage({trace:JSON.stringify(trace),thrown,logged})});`);
const r=await new Promise(res=>{const w=new Worker(new URL('file://'+process.cwd()+'/out/oracle-one-worker.mjs'));const t=setTimeout(()=>{w.terminate();res({thrown:'timeout'})},5000);
 w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
for(const e of JSON.parse(r.trace??'null')??[])console.log(JSON.stringify(e));
const head=s=>s.split('\n').slice(0,6).join('\n');
if(r.thrown)console.log('THROWN',head(r.thrown));if(r.logged)console.log('LOGGED',head(r.logged));
if(mode==='strict'){const v=await new Promise(res=>{const w=new Worker(new URL('fuzz/worker.mjs',pathToFileURL(process.cwd()+'/')),{workerData:{strict:'slice2c'}});
 w.on('message',m=>{if('progress'in m)return;w.terminate();res(m)});w.postMessage(ops)});console.log('STRICT',JSON.stringify(v.invalid?{invalid:v.invalid,detail:String(v.detail).slice(0,300)}:{events:v.expected.length}))}
