// Structural sanity check of the tier-C op encoding (docs/SLICE2C-COVERAGE.md, tracker anchor):
// runs fuzz/generate-slice2c.mjs trackerDemoC() (tracker.tsx with Show + For) on the oracle,
// takes the render effects' latest values after each script step - the header inserts hm/hu,
// the Show insert `body` (the For's mapped rows, or the Show's pass number on the fallback),
// each row's IssueRow inserts B@<pass>.L#<row>.t/.a, and the status insert - renders them as the
// demo's frame strings and compares with EXPECTED of frontend/tsx/demo.test.ts. Each prefix
// runs in a FRESH worker. Not a parity score.   node docs/slice2c-fuzz/tools/tracker-demo.mjs
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {trackerDemoC}=await import(new URL('fuzz/generate-slice2c.mjs',root));
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
const {ops,frames}=trackerDemoC();
const once=(o,strict)=>new Promise((res,rej)=>{const w=new Worker(new URL('fuzz/worker.mjs',root),strict?{workerData:{strict:'slice2c'}}:undefined);
 w.on('message',m=>{if('progress'in m)return;w.terminate();m.expected?res(m.expected):rej(Error(JSON.stringify(m)))});w.postMessage(o)});
const whole=await once(ops,true);console.log('worker trace (strict slice2c):',whole.length,'events');
const got=[];
for(const f of frames){const t=await once(ops.slice(0,f+1),false);
 // Last applied values before the teardown (the trailing cleanups of the root disposal).
 let cut=t.length;while(cut>0&&/cleanup/.test(t[cut-1][0]))cut--;
 const last={};let pass=0;for(const e of t.slice(0,cut)){if(e[0]==='effect')last[e[1]]=e[2];if(e[0]==='branch'&&e[1]==='B')pass=e[3]?e[2]:0}
 const body=last.body,rows=Array.isArray(body)?body.map(s=>titles[last['B@'+pass+'.L#'+s+'.t']]+': '+names[last['B@'+pass+'.L#'+s+'.a']]+'take').join(''):'Nothing to triage';
 got.push('Filter: '+(last.hm?'open':'all')+last.hu+' open'+rows+(last.foot?'Could not assign #'+last.foot:''))}
let ok=0;got.forEach((g,i)=>{const same=g===EXPECTED[i];if(same)ok++;console.log((same?'ok  ':'DIFF')+' '+i+' '+g+(same?'':'\n     expected '+EXPECTED[i]))});
console.log(ok+'/'+EXPECTED.length+' frames match');if(ok!==EXPECTED.length)process.exitCode=1;
