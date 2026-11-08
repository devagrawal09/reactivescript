// Finds the smallest --slice2a program that reaches a cut-site MARK of the
// traced Solid copy (trace-copy.mjs: linkLanes, passTx, stageError), then
// reduces it while the mark is still reached. Each candidate runs in a fresh
// worker. This is how the linked_lanes, pass_scoped_transaction and staged_error
// programs of unit-programs.json were found (seeds 199, 10 and 83; the
// observations at their ends were appended by hand).
// Usage (repository root): node --import ./out/solid-trace/register.mjs \
//   docs/slice2a-fuzz/tools/mark-reduce.mjs MARK SEED
import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
const {generateSlice2a}=await import(process.cwd()+'/fuzz/generate-slice2a.mjs');
const [mark,seed]=process.argv.slice(2);
writeFileSync('out/solid-trace/mark-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import('./register.mjs');globalThis.__NID=0;globalThis.__TID=0;const lines=[];globalThis.__T=s=>lines.push(s);
const {run}=await import('./solid-trace.mjs');
parentPort.on('message',async ops=>{try{await run(ops);parentPort.postMessage({marks:lines.filter(l=>l.startsWith('MARK '))})}catch(e){parentPort.postMessage({error:String(e)})}});
`);
const once=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+process.cwd()+'/out/solid-trace/mark-worker.mjs'));w.once('message',m=>{w.terminate();res(m)});w.postMessage(ops)});
const test=async ops=>{for(let i=0;i<5;i++){const m=await once(ops);if(m.marks)return m.marks}throw Error('worker failed')};
function valid(ops){const nodes=new Set();const reads=e=>typeof e==='number'||(e.op!=='read'||nodes.has(e.id))&&['a','b'].every(k=>!(k in e)||reads(e[k]));
 for(const o of ops){if(['read','latest','pending','write','refresh'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='action'&&o.slices.some(s=>(s.writes??[]).some(w=>!nodes.has(w.id))))return false;if(o.expr&&!reads(o.expr))return false;if(['signal','memo'].includes(o.op))nodes.add(o.id)}return true}
const ok=async ops=>valid(ops)&&(await test(ops)).includes('MARK '+mark);
let out=generateSlice2a(+seed);if(!await ok(out))throw Error(`seed ${seed} does not reach ${mark}`);
let size=Math.ceil(out.length/2);while(size>=1){let changed=false;for(let i=0;i<out.length;i+=size){const c=out.slice(0,i).concat(out.slice(i+size));if(await ok(c)){out=c;changed=true;break}}if(!changed)size=Math.floor(size/2)}
console.log(JSON.stringify(out));process.exit(0);
