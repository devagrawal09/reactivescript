// docs/slice2c-fuzz copy of docs/slice2b-fuzz/tools/mark-reduce.mjs: reduces a --slice2c
// seed's program while it still reaches a site mark of the marked Solid copy (built by
// docs/slice2c-fuzz/tools/marks.mjs in out/solid-mark) and stays a valid program on the
// strict oracle (fuzz/worker.mjs, strict 'slice2c', dist/prod). Each candidate runs in
// fresh workers. Validity is fuzz/run.mjs `valid2c` (copied below). This is how the
// mechanism programs of unit-programs.json were found.
// Usage (repository root, Node 24):
//   node docs/slice2c-fuzz/tools/marks.mjs slice2c 1 1   # once: builds out/solid-mark
//   node docs/slice2c-fuzz/tools/mark-reduce.mjs MARK SEED > out/reduced.json
//   node docs/slice2c-fuzz/tools/mark-reduce.mjs MARK SEED --disagree BIN > out/reduced.json
// With --disagree, a candidate is kept only if BIN (a slice1-driver built from a mutant of
// the port, copied aside) also gives a trace different from the strict oracle's. That keeps a
// unit program sensitive to the mutated site; removal_staged_by-forced-false found
// a_zombie_whose_removal_the_hold_stages_is_off_screen (seed 980) this way.
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const argv=process.argv.slice(2),di=argv.indexOf('--disagree'),bin=di<0?null:argv.splice(di,2)[1];
const [mark,seed]=argv;
const dir=process.cwd()+'/out/solid-mark/';
writeFileSync(dir+'mark-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import('./register.mjs');const hits=new Map();globalThis.__M=m=>hits.set(m,(hits.get(m)??0)+1);
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
parentPort.on('message',async ops=>{let error=null;try{await run(ops)}catch(e){error=String(e)}parentPort.postMessage({m:Object.fromEntries(hits),error})});`);
const {generateSlice2c}=await import(pathToFileURL(process.cwd()+'/fuzz/generate-slice2c.mjs').href);
const env={...process.env,SOLID_SIGNALS_URL:pathToFileURL(dir+'index.ts').href};
const marked=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+dir+'mark-worker.mjs'),{env});
 const t=setTimeout(()=>{w.terminate();res({m:{},error:'timeout'})},8000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
const strict=ops=>new Promise(res=>{const w=new Worker(new URL('../../../fuzz/worker.mjs',import.meta.url),{workerData:{strict:'slice2c'}});
 const t=setTimeout(()=>{w.terminate();res({invalid:'timeout'})},5000);w.on('message',m=>{if('progress'in m)return;clearTimeout(t);w.terminate();res(m)});w.once('error',e=>res({invalid:String(e)}));w.postMessage(ops)});
// fuzz/run.mjs `valid2c`.
function valid2c(ops){const nodes=new Set(),setters=new Set(),stores=new Set(),owners=new Set(['root']);
 const ek=['a','b','test','yes','no','expr','of','where','with','key'],TOP={row:false,pass:false};
 // cx.row: a mapper row (or a function-child Show's value) is in scope (item/index); cx.pass:
 // inside a row or child pass (local).
 const expr=(e,cx)=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(x=>expr(x,cx));
  if(e.op==='read'&&!nodes.has(e.id)||e.op==='store'&&!stores.has(e.id))return false;
  if(!cx.row&&(e.op==='item'||e.op==='index')||!cx.pass&&e.op==='local')return false;
  return ek.every(k=>!(k in e)||expr(e[k],cx))&&(!e.fields||Array.isArray(e.fields)||Object.values(e.fields).every(x=>expr(x,cx)))&&(!e.items||e.items.every(x=>expr(x,cx)))};
 const list=(l,cx)=>expr(l.each,cx)&&(l.keyed===null||typeof l.keyed!=='object'||expr(l.keyed.expr,cx))&&kids(l.row,{row:true,pass:true})&&(!Array.isArray(l.fallback)||kids(l.fallback,{row:cx.row,pass:true}));
 const show=(b,cx)=>expr(b.when,cx)&&kids(b.yes,{row:cx.row||!!b.fn,pass:true})&&kids(b.no,{row:cx.row,pass:true});
 const kids=(cs,cx)=>(cs??[]).every(c=>'effect'in c||'memo'in c?expr(c.expr,cx):'list'in c?list(c.list,cx):'show'in c?show(c.show,cx):'read'in c?expr(c.read,cx):'cleanup'in c);
 const edits=s=>(s.edits??[]).every(ed=>['set','push','insert'].every(k=>!(k in ed)||expr(ed[k],TOP)))&&(!('returns'in s)||expr(s.returns,TOP));
 const step=st=>'write'in st?setters.has(st.write):'update'in st?setters.has(st.update)&&expr(st.expr,TOP):'store'in st?stores.has(st.store)&&edits(st)
  :'refresh'in st?nodes.has(st.refresh):'refresh_store'in st?stores.has(st.refresh_store):'read'in st?expr(st.read,TOP):false;
 for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;
  if(o.expr&&!expr(o.expr,TOP))return false;if(o.derive&&!expr(o.derive.expr,TOP))return false;
  if(o.op==='list'&&!list(o,TOP)||o.op==='show'&&!show(o,TOP)||(o.op==='memo'||o.op==='effect')&&!kids(o.children,{row:false,pass:true}))return false;
  if(['read','latest','pending'].includes(o.op)&&!('expr'in o)&&!nodes.has(o.id))return false;
  if(o.op==='refresh'&&!('store'in o?stores.has(o.store):nodes.has(o.id)))return false;
  if(['write','update'].includes(o.op)&&!setters.has(o.id))return false;
  if(o.op==='store_set'&&!(stores.has(o.id)&&edits(o)))return false;
  if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
  if(['signal','memo','list','show'].includes(o.op))nodes.add(o.id);if(o.op==='signal'||o.op==='memo'&&o.optimistic)setters.add(o.id);
  if(o.op==='store')stores.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// A driver error or crash is a different failure, not a disagreeing trace: not kept.
const differs=(ops,expected)=>{if(!bin)return true;let actual;try{actual=JSON.parse(execFileSync(bin,{input:JSON.stringify(ops)+'\n',encoding:'utf8',stdio:['pipe','pipe','ignore']}))}catch{return false}
 return Array.isArray(actual)&&JSON.stringify(actual)!==JSON.stringify(expected)};
const ok=async ops=>{if(!valid2c(ops)||!(((await marked(ops)).m[mark]??0)>0))return false;const r=await strict(ops);return !r.invalid&&differs(ops,r.expected)};
let out=generateSlice2c(+seed);if(!await ok(out))throw Error(`seed ${seed} does not reach ${mark}`+(bin?' or does not disagree on '+bin:''));
let size=Math.ceil(out.length/2);
while(size>=1){let changed=false;for(let i=0;i<out.length;i+=size){const c=out.slice(0,i).concat(out.slice(i+size));if(await ok(c)){out=c;changed=true;break}}if(!changed)size=Math.floor(size/2)}
console.log(JSON.stringify(out));process.exit(0);
