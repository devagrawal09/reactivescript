// Reduces a --slice2b program that is INVALID on the oracle (oracle-error / -halted /
// -nonscalar / -timeout) while the invalid class and the first line of its detail stay the
// same; each candidate runs in a fresh strict ('slice2b') worker as in run.mjs. Used for the
// suspected-Solid-bug repros in docs/SLICE2B-COVERAGE.md.
//   node oracle-reduce.mjs SEED OUT.json
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {generateSlice2b}=await import(new URL('fuzz/generate-slice2b.mjs',root));
const [seed,o]=process.argv.slice(2);
const once=ops=>new Promise(res=>{const w=new Worker(new URL('fuzz/worker.mjs',root),{workerData:{strict:'slice2b'}});
 const t=setTimeout(()=>{w.terminate();res({invalid:'oracle-timeout'})},1500);
 w.on('message',m=>{if('progress'in m)return;clearTimeout(t);w.terminate();res(m)});w.once('error',e=>{clearTimeout(t);res({invalid:'oracle-error',detail:String(e.stack)})});w.postMessage(ops)});
const key=m=>m.invalid?m.invalid+' '+String(m.detail??'').split('\n')[0]:'valid';
let ops=generateSlice2b(+seed);const k0=key(await once(ops));if(k0==='valid')throw Error('seed '+seed+' is valid');console.error('class:',k0);
// Same reference checks as run.mjs valid2b, inlined: defined ids before use.
const refs=ops=>{const ids=new Set();const walk=e=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(walk);if((e.op==='read'||e.op==='store')&&'id'in e&&!ids.has(e.id))return false;return Object.entries(e).every(([k,v])=>k==='value'||walk(v))};
 for(const x of ops){if(x.op!=='store'&&x.op!=='signal'&&x.op!=='memo'&&'id'in x&&!ids.has(x.id))return false;const {id,value,seed:sd,...rest}=x;if(!walk(rest))return false;if(['store','signal','memo'].includes(x.op))ids.add(x.id)}return true};
let size=Math.ceil(ops.length/2);
while(size>=1){let changed=false;for(let i=0;i<ops.length;i+=size){const c=ops.slice(0,i).concat(ops.slice(i+size));if(!refs(c))continue;if(key(await once(c))===k0){ops=c;changed=true;break}}if(!changed)size=Math.floor(size/2)}
writeFileSync(o,JSON.stringify(ops,null,1));console.log(ops.length,'ops ->',o);
