// Same traces as eq.mjs, but each program in a fresh worker exactly as fuzz/run.mjs's
// oracle (fuzz/worker.mjs, 1500 ms). Checks that the in-process coverage run sees the
// same traces as the fuzz oracle.   node workers.mjs slice1|slice2a FIRST LAST OUT
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const [mode,a,b,o]=process.argv.slice(2);
const gen=mode==='slice1'?(await import(new URL('fuzz/generate-slice1.mjs',root))).generateSlice1:(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a;
const r=[];
for(let s=+a;s<=+b;s++){const ops=gen(s);r.push(await new Promise(res=>{const w=new Worker(new URL('fuzz/worker.mjs',root),{workerData:{strict:true}});const t=setTimeout(()=>{w.terminate();res(JSON.stringify({invalid:'oracle-timeout'}))},1500);w.on('message',m=>{if('progress'in m)return;clearTimeout(t);w.terminate();res(m.invalid?JSON.stringify({invalid:m.invalid}):JSON.stringify(m.expected))});w.on('error',e=>{clearTimeout(t);res(JSON.stringify({invalid:'oracle-error'}))});w.postMessage(ops)}))}
writeFileSync(o,r.join('\n'));
