// Structural sanity check of the tier-B op encoding (docs/SLICE2B-DESIGN.md sec. 4,
// "tracker-demo"): runs fuzz/generate-slice2b.mjs trackerDemo() on the oracle in a strict
// worker, takes the render effects' latest values (head, body, foot) after each script
// step, renders them as the demo's frame strings, and compares with EXPECTED of
// frontend/tsx/demo.test.ts. Not a parity score.   node tracker-demo.mjs
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {trackerDemo}=await import(new URL('fuzz/generate-slice2b.mjs',root));
const EXPECTED=[
 "Filter: all2 openCrash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake",
 "Filter: all1 openCrash on save: metakeSlow search: anatakeTypo in footer: nobodytake",
 "Filter: all1 openCrash on save: devtakeSlow search: anatakeTypo in footer: nobodytake",
 "Filter: all1 openCrash on save: devtakeSlow search: metakeTypo in footer: nobodytake",
 "Filter: all1 openCrash on save: devtakeSlow search: anatakeTypo in footer: nobodytakeCould not assign #2",
 "Filter: open1 openTypo in footer: nobodytakeCould not assign #2",
 "Filter: open0 openNothing to triageCould not assign #2",
 "Filter: open0 openNothing to triage"];
const titles={1:'Crash on save',2:'Slow search',3:'Typo in footer'},names={0:'nobody',9:'me',7:'dev',6:'ana'};
const {ops,frames}=trackerDemo();
// The whole program in a strict worker (as run.mjs): it must be a valid trace.
const expected=await new Promise((res,rej)=>{const w=new Worker(new URL('fuzz/worker.mjs',root),{workerData:{strict:'slice2b'}});
 w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.postMessage(ops)});
console.log('worker trace:',expected.length,'events');
const render=(head,body,foot)=>'Filter: '+(head[0]?'open':'all')+head[1]+' open'+(Array.isArray(body)?body.map(r=>titles[r.v.t]+': '+names[r.v.a]+'take').join(''):'Nothing to triage')+(foot?'Could not assign #'+foot:'');
// Frame i: run the prefix ops[0..frames[i]] (a fresh fuzz/solid.mjs instance each;
// Solid module state is shared, as in eq.mjs) and take each render effect's last applied value before the teardown cleanups.
const got=[];
for(const f of frames){const {run:r}=await import(new URL('fuzz/solid.mjs?p'+f,root));
 const t=await r(ops.slice(0,f+1));const last={};const cut=t.length-t.slice().reverse().findIndex(e=>e[0]!=='effect_cleanup');
 for(const e of t.slice(0,cut))if(e[0]==='effect')last[e[1]]=e[2];got.push(render(last.head,last.body,last.foot))}
let ok=0;got.forEach((g,i)=>{const same=g===EXPECTED[i];if(same)ok++;console.log((same?'ok  ':'DIFF')+' '+i+' '+g+(same?'':'\n     expected '+EXPECTED[i]))});
console.log(ok+'/'+EXPECTED.length+' frames match');
