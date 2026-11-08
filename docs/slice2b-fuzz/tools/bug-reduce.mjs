// Reduces a program that makes the oracle throw (or halt) inside Solid to a 1-minimal one
// that still throws with the same signature: whole ops are deleted until no single deletion
// keeps it, then rows are dropped from array values (store values, seeds, flight answers,
// literals) the same way. Each candidate runs in a fresh worker on fuzz/solid.mjs over
// dist/prod, capturing the error a run throws and the `[REACTIVITY_HALTED]` error an
// effect's throw logs. Used for the suspected-Solid-bug repros in docs/slice2b-fuzz/port.
// Usage (repository root, Node 24):
//   node docs/slice2b-fuzz/tools/bug-reduce.mjs IN.json SIGNATURE OUT.json
// SIGNATURE is a substring of the error's first stack lines (e.g. "at resolveTx").
import {Worker} from 'node:worker_threads';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [inFile,sig,outFile]=process.argv.slice(2);
let ops=JSON.parse(readFileSync(inFile,'utf8'));if(!Array.isArray(ops))ops=ops.ops;
const src=`import {parentPort} from 'node:worker_threads';
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
let logged='';const err=console.error;console.error=(...a)=>{for(const x of a)if(x instanceof Error)logged+=x.stack+'\\n';};
parentPort.on('message',async ops=>{let thrown='';try{await run(ops,()=>{})}catch(e){thrown=String(e&&e.stack)}parentPort.postMessage({thrown,logged})});`;
writeFileSync('out/bug-worker.mjs',src);
const once=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+process.cwd()+'/out/bug-worker.mjs'));
 const t=setTimeout(()=>{w.terminate();res({thrown:'timeout',logged:''})},3000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.once('error',e=>{clearTimeout(t);res({thrown:String(e.stack),logged:''})});w.postMessage(ops)});
const head=s=>s.split('\n').slice(0,4).join('\n');
const hits=async ops=>{const r=await once(ops);return head(r.thrown).includes(sig)||head(r.logged).includes(sig)};
// fuzz/run.mjs `valid2b`, reduced to the references a deletion can break.
const valid=ops=>{const ids=new Set();const walk=e=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(walk);
 if((e.op==='read'||e.op==='store')&&'id'in e&&!ids.has(e.id))return false;return Object.entries(e).every(([k,v])=>k==='value'||k==='seed'||k==='reconcile'||walk(v))};
 for(const x of ops){if(['write','update','store_set','read','latest','pending'].includes(x.op)&&'id'in x&&!ids.has(x.id))return false;
  if(x.op==='refresh'&&!ids.has(x.store??x.id))return false;
  const {id,value,seed,...rest}=x;if(!walk(rest))return false;if(['store','signal','memo'].includes(x.op))ids.add(x.id)}return true};
if(!await hits(ops))throw Error('the program does not reach '+sig);
let changed=true;
while(changed){changed=false;
 for(let i=ops.length-1;i>=0;i--){const c=ops.slice(0,i).concat(ops.slice(i+1));if(valid(c)&&await hits(c)){ops=c;changed=true}}
 // Drop array elements inside op values one at a time.
 const paths=[];const collect=(v,p)=>{if(Array.isArray(v)){for(let j=0;j<v.length;j++){paths.push([...p,j]);collect(v[j],[...p,j])}}else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))collect(x,[...p,k])};
 ops.forEach((o,i)=>{for(const k of ['value','seed','reconcile'])if(k in o)collect(o[k],[i,k])});
 for(const p of paths.reverse()){const c=structuredClone(ops);let parent=c;for(const k of p.slice(0,-1))parent=parent[k];if(!Array.isArray(parent)||!(p.at(-1)in parent))continue;parent.splice(p.at(-1),1);if(await hits(c)){ops=c;changed=true}}
}
writeFileSync(outFile,JSON.stringify(ops,null,1));console.log(ops.length,'ops ->',outFile);process.exit(0);
