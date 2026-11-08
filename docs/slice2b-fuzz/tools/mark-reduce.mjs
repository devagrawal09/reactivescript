// Reduces a --slice2b seed's program while it still reaches a site mark of the marked
// Solid copy (marks.mjs builds out/solid-mark; run it once with no arguments) and stays
// a valid program on the strict oracle (fuzz/worker.mjs, strict 'slice2b', dist/prod).
// Each candidate runs in fresh workers. This is how the mechanism programs of
// unit-programs.json were found; the observations at their ends were kept from the seed.
// Usage (repository root, Node 24):
//   node docs/slice2b-fuzz/tools/marks.mjs            # once: builds out/solid-mark
//   node docs/slice2b-fuzz/tools/mark-reduce.mjs MARK SEED > out/reduced.json
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const [mark,seed]=process.argv.slice(2);
const dir=process.cwd()+'/out/solid-mark/';
// The worker marks.mjs writes for its runs (fuzz/solid.mjs over the marked copy).
writeFileSync(dir+'mark-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import('./register.mjs');const hits=new Map();globalThis.__M=m=>hits.set(m,(hits.get(m)??0)+1);
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
parentPort.on('message',async ops=>{let error=null;try{await run(ops)}catch(e){error=String(e)}parentPort.postMessage({m:Object.fromEntries(hits),error})});`);
const {generateSlice2b}=await import(pathToFileURL(process.cwd()+'/fuzz/generate-slice2b.mjs').href);
const env={...process.env,SOLID_SIGNALS_URL:pathToFileURL(dir+'index.ts').href};
const marked=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+dir+'mark-worker.mjs'),{env});
 const t=setTimeout(()=>{w.terminate();res({m:{},error:'timeout'})},5000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
const strict=ops=>new Promise(res=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'slice2b'}});
 const t=setTimeout(()=>{w.terminate();res({invalid:'timeout'})},5000);w.on('message',m=>{if('progress'in m)return;clearTimeout(t);w.terminate();res(m)});w.once('error',e=>res({invalid:String(e)}));w.postMessage(ops)});
// fuzz/run.mjs `valid2b`: every reference names an earlier definition.
function valid(ops){const nodes=new Set(),setters=new Set(),stores=new Set();
 const ek=['a','b','test','yes','no','expr','of','where','with','key'];
 const expr=e=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(expr);
  if(e.op==='read'&&!nodes.has(e.id)||e.op==='store'&&!stores.has(e.id))return false;
  return ek.every(k=>!(k in e)||expr(e[k]))&&(!e.fields||Array.isArray(e.fields)||Object.values(e.fields).every(expr))&&(!e.items||e.items.every(expr))};
 const edits=s=>(s.edits??[]).every(ed=>['set','push','insert'].every(k=>!(k in ed)||expr(ed[k])))&&(!('returns'in s)||expr(s.returns));
 const step=st=>'write'in st?setters.has(st.write):'update'in st?setters.has(st.update)&&expr(st.expr):'store'in st?stores.has(st.store)&&edits(st)
  :'refresh'in st?nodes.has(st.refresh):'refresh_store'in st?stores.has(st.refresh_store):'read'in st?expr(st.read):false;
 for(const o of ops){if(o.expr&&!expr(o.expr))return false;if(o.derive&&!expr(o.derive.expr))return false;
  if(['read','latest','pending'].includes(o.op)&&!('expr'in o)&&!nodes.has(o.id))return false;
  if(o.op==='refresh'&&!('store'in o?stores.has(o.store):nodes.has(o.id)))return false;
  if(['write','update'].includes(o.op)&&!setters.has(o.id))return false;
  if(o.op==='store_set'&&!(stores.has(o.id)&&edits(o)))return false;
  if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
  if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='signal'||o.op==='memo'&&o.optimistic)setters.add(o.id);
  if(o.op==='store')stores.add(o.id)}return true}
const ok=async ops=>valid(ops)&&((await marked(ops)).m[mark]??0)>0&&!(await strict(ops)).invalid;
let out=generateSlice2b(+seed);if(!await ok(out))throw Error(`seed ${seed} does not reach ${mark}`);
let size=Math.ceil(out.length/2);
while(size>=1){let changed=false;for(let i=0;i<out.length;i+=size){const c=out.slice(0,i).concat(out.slice(i+size));if(await ok(c)){out=c;changed=true;break}}if(!changed)size=Math.floor(size/2)}
console.log(JSON.stringify(out));process.exit(0);
