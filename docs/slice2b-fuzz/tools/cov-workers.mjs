// Coverage of the Solid src copy with every program in a FRESH worker (as the fuzz oracle
// runs it), so no Solid module state (open transactions, lanes, unsettled flights) leaks
// from one program into the next program's coverage. Run under NODE_V8_COVERAGE=DIR; each
// worker writes its own coverage file there. With OUT, the traces are written one per line
// (comparable with workers.mjs / eq.mjs output: the TS copy must give the dist traces).
//   NODE_V8_COVERAGE=$PWD/out/X node cov-workers.mjs slice1|slice2a|slice2b FIRST LAST [JOBS [OUT]]
// (from the repository root; uses out/solid-src and the parity register.mjs/hooks.mjs).
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const cwd=process.cwd(),root=pathToFileURL(cwd+'/');
const [mode,a,b,jobs='4',o]=process.argv.slice(2);
const genFile={slice1:['generate-slice1.mjs','generateSlice1'],slice2a:['generate-slice2a.mjs','generateSlice2a'],slice2b:['generate-slice2b.mjs','generateSlice2b']}[mode];
const gen=(await import(new URL('fuzz/'+genFile[0],root)))[genFile[1]];
writeFileSync(cwd+'/out/cov-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import(${JSON.stringify(pathToFileURL(cwd+'/docs/slice1-fuzz/parity/tools/register.mjs').href)});
const {run}=await import(${JSON.stringify(pathToFileURL(cwd+'/fuzz/solid.mjs').href)});
parentPort.on('message',async ops=>{let r;try{r=JSON.stringify(await run(ops))}catch(e){r=JSON.stringify({error:String(e)})}parentPort.postMessage(r)});`);
const env={...process.env,SOLID_SIGNALS_URL:pathToFileURL(cwd+'/out/solid-src/index.ts').href};
const once=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+cwd+'/out/cov-worker.mjs'),{env});
 w.once('message',m=>{w.postMessage=null;w.terminate().then(()=>res(m))});w.postMessage(ops)});
let next=+a;const out=[];
async function lane(){while(next<=+b){const s=next++;out[s-a]=await once(gen(s))}}
await Promise.all(Array.from({length:+jobs},lane));
if(o)writeFileSync(o,out.join('\n'));console.log(out.length,'programs');
