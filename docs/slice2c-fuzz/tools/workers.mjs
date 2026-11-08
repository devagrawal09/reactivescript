// Oracle-only pass over --slice2c programs: each program in a fresh strict ('slice2c') worker
// exactly as fuzz/run.mjs's oracle (fuzz/worker.mjs, 1500 ms), JOBS at a time. Writes one
// line per seed (the trace, or {invalid, detail}) and prints validity per family.
//   node workers.mjs FIRST LAST OUT [JOBS]
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const [a,b,o,jobs='4']=process.argv.slice(2);
const {generateSlice2c,slice2cFamily}=await import(new URL('fuzz/generate-slice2c.mjs',root));
const once=ops=>new Promise(res=>{const w=new Worker(new URL('fuzz/worker.mjs',root),{workerData:{strict:'slice2c'}});let progress;
 const t=setTimeout(()=>{w.terminate();res({invalid:'oracle-timeout',progress})},1500);
 w.on('message',m=>{if('progress'in m){progress=m.progress;return}clearTimeout(t);w.terminate();res(m)});
 w.once('error',e=>{clearTimeout(t);res({invalid:'oracle-error',detail:e.stack})});w.postMessage(ops)});
const lines=[],fam={};let next=+a;
async function lane(){while(next<=+b){const s=next++;const m=await once(generateSlice2c(s));const f=slice2cFamily(s);fam[f]??={valid:0,invalid:{}};
 if(m.invalid){fam[f].invalid[m.invalid]=(fam[f].invalid[m.invalid]??[]).concat(s);lines[s-a]=JSON.stringify({seed:s,invalid:m.invalid,detail:m.detail,progress:m.progress})}
 else{fam[f].valid++;lines[s-a]=JSON.stringify(m.expected)}}}
await Promise.all(Array.from({length:+jobs},lane));
writeFileSync(o,lines.join('\n'));console.log(JSON.stringify(fam,null,1));
