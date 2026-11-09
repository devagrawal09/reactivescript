// One --slice2b program on the oracle (a fresh strict 'slice2b' worker, as fuzz/run.mjs
// runs it) and on target/debug/slice1-driver: agreement, and the first differing event
// with context. FILE is a JSON op array or a fuzz failure/reduced file with an `ops` field.
// Usage (repository root, Node 24, after `cargo build`):
//   node docs/slice2b-fuzz/tools/replay-diff.mjs FILE [context]
import {Worker} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [file,ctx='6']=process.argv.slice(2);
let ops=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(ops))ops=ops.ops;
const oracle=await new Promise(res=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'slice2b'}});
 w.on('message',m=>{if('progress'in m)return;w.terminate();res(m)});w.once('error',e=>{w.terminate();res({invalid:'oracle-error',detail:String(e.stack)})});w.postMessage(ops)});
const r=spawnSync('target/debug/slice1-driver',{input:JSON.stringify(ops)+'\n',encoding:'utf8'});
const actual=JSON.parse(r.stdout);
if(oracle.invalid){console.log('invalid',oracle.invalid,String(oracle.detail??'').slice(0,400));process.exit(2)}
const e=oracle.expected,a=actual;
if(JSON.stringify(e)===JSON.stringify(a)){console.log('agree',e.length,'events');process.exit(0)}
if(a.driver_error){console.log('rust',a.driver_error);process.exit(1)}
const i=e.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(a[i]));
for(let j=Math.max(0,i-+ctx);j<i;j++)console.log('   ',JSON.stringify(e[j]));
console.log('S>>',JSON.stringify(e[i]));console.log('R>>',JSON.stringify(a[i]));
for(let j=i+1;j<Math.min(Math.max(e.length,a.length),i+Number(ctx));j++)console.log('S  ',JSON.stringify(e[j]),'| R',JSON.stringify(a[j]));
process.exit(1);
