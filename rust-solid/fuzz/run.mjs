import {spawn,execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generate} from './generate.mjs';
import {generateSlice1} from './generate-slice1.mjs';
import {generateSlice2a,slice2aFamily} from './generate-slice2a.mjs';
import {generateSlice2b,slice2bFamily} from './generate-slice2b.mjs';
import {generateSlice2c,slice2cFamily} from './generate-slice2c.mjs';
import {generateStrings,stringsFamily} from './generate-strings.mjs';
import {generateRender,renderFamily} from './generate-render.mjs';
import {generateBoundaries,boundariesFamily} from './generate-boundaries.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const timeout=Number(arg('--timeout-ms','1500'));
const slice1=args.includes('--slice1'),slice2a=args.includes('--slice2a'),slice2b=args.includes('--slice2b'),slice2c=args.includes('--slice2c'),strings=args.includes('--strings'),render=args.includes('--render'),boundaries=args.includes('--boundaries'),binary=render?'render-driver':slice1||slice2a||slice2b||slice2c||strings||boundaries?'slice1-driver':'driver';
// --boundaries: Loading and Errored boundaries over async memos, tracked isPending/latest and
// affects (tier D, docs/BOUNDARIES-COVERAGE.md) on the slice-1 driver; strict workers
// (worker.mjs strict 'boundaries').
// --render: the renderer differential test (docs/RENDERER.md): Solid 2's @solidjs/universal with a
// recording host (fuzz/universal.mjs, in a worker loaded with --conditions=browser) against the Rust
// port (src/bin/render-driver.rs). --strings: string values on the slice-1 driver (strict 'strings').
// --slice2c: lists, Show and children in computations (docs/SLICE2B-DESIGN.md tier C,
// docs/SLICE2C-COVERAGE.md) on the slice-1 driver. Strict workers (worker.mjs strict 'slice2c').
// --slice2b: stores and per-row optimistic writes (docs/SLICE2B-DESIGN.md tier B) on the slice-1
// driver. Strict workers over the tier-B value domain (worker.mjs strict 'slice2b').
// --slice2a: async-memo programs on the slice-1 driver. Its oracle workers are strict
// (worker.mjs): a reactivity halt or a non-integer observed value makes the program invalid.
execFileSync('cargo',['build','--quiet','--bin',binary],{cwd:root,stdio:'inherit'});
let worker,child,lines;
function startRust(){child=spawn(root+'/target/debug/'+binary,[],{stdio:['pipe','pipe','inherit']});lines=createInterface({input:child.stdout});}
function oracle(ops){worker=render?new Worker(new URL('./render-worker.mjs',import.meta.url),{execArgv:['--conditions=browser']}):new Worker(new URL('./worker.mjs',import.meta.url),...(boundaries?[{workerData:{strict:'boundaries'}}]:strings?[{workerData:{strict:'strings'}}]:slice2a?[{workerData:{strict:true}}]:slice2b?[{workerData:{strict:'slice2b'}}]:slice2c?[{workerData:{strict:'slice2c'}}]:[]));const w=worker;let progress;return new Promise(resolve=>{
 const finish=result=>{clearTimeout(timer);w.removeListener('message',onMessage);w.removeListener('error',onError);w.terminate();worker=undefined;resolve(result)};
 const onMessage=result=>{if('progress'in result)progress=result.progress;else {if(result.invalid){w.terminate();worker=undefined}finish(result)}},onError=e=>{worker=undefined;finish({invalid:'oracle-error',detail:e.stack})};
 const timer=setTimeout(()=>{w.terminate();worker=undefined;finish({invalid:'oracle-timeout',progress})},timeout);
 w.on('message',onMessage);w.once('error',onError);w.postMessage(ops);
})}
function rust(ops){if(!child)startRust();const c=child,l=lines;return new Promise(resolve=>{
 const finish=result=>{clearTimeout(timer);l.removeListener('line',onLine);c.removeListener('exit',onExit);resolve(result)};
 const onLine=line=>{try{finish(JSON.parse(line))}catch{finish({driver_error:'invalid-json'})}};
 const onExit=()=>{child=undefined;finish({driver_error:'exit'})};
 const timer=setTimeout(()=>{c.kill('SIGKILL');child=undefined;finish({driver_error:'timeout'})},timeout);
 l.once('line',onLine);c.once('exit',onExit);c.stdin.write(JSON.stringify(ops)+String.fromCharCode(10));
})}
async function compare(ops){const reference=await oracle(ops);const actual=await rust(ops);return {...reference,actual,agree:!reference.invalid&&JSON.stringify(reference.expected)===JSON.stringify(actual)}}
function valid(ops){const nodes=new Set(),owners=new Set(['root']);const expr=e=>typeof e==='number'||e&&((e.op!=='read'||nodes.has(e.id))&&['a','b','test','yes','no','expr'].every(k=>!(k in e)||typeof e[k]==='number'||expr(e[k])));for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;if(o.expr&&!expr(o.expr))return false;if(['read','latest','pending','write','refresh'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='action'&&o.slices.some(s=>(s.writes??[]).some(w=>!nodes.has(w.id))))return false;if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// --slice2b reducer validity (docs/SLICE2B-DESIGN.md sec. 3.4): every node, setter, store and
// owner reference in ops, steps and (walked) expressions must name an earlier definition.
function valid2b(ops){const nodes=new Set(),setters=new Set(),stores=new Set(),owners=new Set(['root']);
 const ek=['a','b','test','yes','no','expr','of','where','with','key'];
 const expr=e=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(expr);
  if(e.op==='read'&&!nodes.has(e.id)||e.op==='store'&&!stores.has(e.id))return false;
  return ek.every(k=>!(k in e)||expr(e[k]))&&(!e.fields||Array.isArray(e.fields)||Object.values(e.fields).every(expr))&&(!e.items||e.items.every(expr))};
 const edits=s=>(s.edits??[]).every(ed=>['set','push','insert'].every(k=>!(k in ed)||expr(ed[k])))&&(!('returns'in s)||expr(s.returns));
 const step=st=>'write'in st?setters.has(st.write):'update'in st?setters.has(st.update)&&expr(st.expr):'store'in st?stores.has(st.store)&&edits(st)
  :'refresh'in st?nodes.has(st.refresh):'refresh_store'in st?stores.has(st.refresh_store):'read'in st?expr(st.read):false;
 for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;
  if(o.expr&&!expr(o.expr))return false;if(o.derive&&!expr(o.derive.expr))return false;
  if(['read','latest','pending'].includes(o.op)&&!('expr'in o)&&!nodes.has(o.id))return false;
  if(o.op==='refresh'&&!('store'in o?stores.has(o.store):nodes.has(o.id)))return false;
  if(['write','update'].includes(o.op)&&!setters.has(o.id))return false;
  if(o.op==='store_set'&&!(stores.has(o.id)&&edits(o)))return false;
  if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
  if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='signal'||o.op==='memo'&&o.optimistic)setters.add(o.id);
  if(o.op==='store')stores.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// --slice2c reducer validity: valid2b's rules over every op, with list and Show ids as readable
// nodes, every expression position walked (list `each`/`keyed`, Show `when`, children specs
// recursively, concat items), and `item`/`index`/`local` only inside a row or child pass.
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
// --boundaries reducer validity: every node, setter and owner an op, a step, an expression or a
// child (walked into boundaries, Shows and memo passes) names is defined earlier; `local` only
// inside a pass.
function validD(ops){const nodes=new Set(),setters=new Set(),owners=new Set(['root']);
 const expr=(e,pass)=>{if(e===null||typeof e!=='object')return true;if(e.op==='read'&&!nodes.has(e.id)||e.op==='local'&&!pass)return false;
  return ['a','b','test','yes','no','of'].every(k=>!(k in e)||expr(e[k],pass))};
 const kids=cs=>(cs??[]).every(c=>'effect'in c||'memo'in c?expr(c.expr,true):'loading'in c||'errored'in c?bnd(c.loading??c.errored):'show'in c?expr(c.show.when,true)&&kids(c.show.yes)&&kids(c.show.no):'cleanup'in c);
 const bnd=b=>kids(b.children)&&kids(b.fallback)&&(!('expr'in b)||expr(b.expr,true));
 const step=st=>'write'in st?setters.has(st.write):'refresh'in st||'affects'in st?nodes.has(st.refresh??st.affects):false;
 for(const o of ops){if(o.owner&&!owners.has(o.owner))return false;if(o.expr&&!expr(o.expr,false))return false;
  if((o.op==='loading'||o.op==='errored')&&!bnd(o))return false;if(o.op==='memo'&&o.children&&!kids(o.children))return false;
  if(['read','pending','refresh','affects'].includes(o.op)&&!nodes.has(o.id))return false;
  if(o.op==='write'&&!setters.has(o.id))return false;if(o.op==='dispose'&&!owners.has(o.owner))return false;
  if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
  if(['signal','memo','loading','errored'].includes(o.op))nodes.add(o.id);if(o.op==='signal')setters.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// --render reducer validity: every signal a program reads, writes or names in a handler is declared
// before the op using it; at most one view is rendered at a time.
function validRender(ops){const sigs=new Set();let live=false;
 const refs=x=>{if(x===null||typeof x!=='object')return true;if(Array.isArray(x))return x.every(refs);if((x.x==='read'&&!sigs.has(x.id))||(x.write&&!sigs.has(x.write.id)))return false;return Object.values(x).every(refs)};
 for(const o of ops){if(o.op==='signal'){sigs.add(o.id);continue}if(o.op==='write'&&!sigs.has(o.id))return false;
  if(o.op==='render'){if(live||!refs(o.view))return false;live=true}if(o.op==='dispose')live=false}return true}
function traceClass(r){if(r.invalid)return r.invalid;if(r.actual?.driver_error)return 'rust-'+r.actual.driver_error;const i=r.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(r.actual[i]));return (r.expected[i]?.[0]??'end')+'-'+(r.actual[i]?.[0]??'end')}
async function reduce(ops,initial){let out=ops;let size=Math.ceil(out.length/2),checks=0;while(size>=1&&checks<180){let changed=false;for(let i=0;i<out.length&&checks<180;i+=size){const candidate=out.slice(0,i).concat(out.slice(i+size));if(!(render?validRender:boundaries?validD:slice2c||strings?valid2c:slice2b?valid2b:valid)(candidate))continue;checks++;const r=await compare(candidate);const sameFailure=initial.invalid?r.invalid===initial.invalid:initial.actual?.driver_error?r.actual?.driver_error===initial.actual.driver_error:!r.invalid&&!r.actual?.driver_error;if(sameFailure&&!r.agree&&(!(slice1||slice2a||slice2b||slice2c||strings||render||boundaries)||traceClass(r)===traceClass(initial))){out=candidate;changed=true;break}}if(!changed)size=Math.floor(size/2)}return out}
const out=arg('--out',root+'/out');mkdirSync(out,{recursive:true});
let total=0,agreement=0,invalid=0;const coverage={},classes={},modes={};
try {
 if(args.includes('--replay')){const ops=JSON.parse(readFileSync(arg('--replay'),'utf8'));const r=await compare(ops);console.log(JSON.stringify(r,null,2));if(!r.agree)process.exitCode=1;}
 else {const count=Number(arg('--seeds','2000')),start=Number(arg('--start','1'));
 for(let seed=start;seed<start+count;seed++){
  if(args.includes('--trace'))console.error('seed',seed);
  const ops=(render?generateRender:boundaries?generateBoundaries:strings?generateStrings:slice2c?generateSlice2c:slice2b?generateSlice2b:slice2a?generateSlice2a:slice1?generateSlice1:generate)(seed);for(const o of ops)coverage[o.op]=(coverage[o.op]??0)+1;
  const r=await compare(ops);total++;const mode=render?renderFamily(seed):boundaries?boundariesFamily(seed):strings?stringsFamily(seed):slice2c?slice2cFamily(seed):slice2b?slice2bFamily(seed):slice2a?slice2aFamily(seed):slice1?'scalar-actions':seed%6;modes[mode]??={total:0,agreement:0};modes[mode].total++;
  if(r.agree){agreement++;modes[mode].agreement++;continue}
  if(r.invalid)invalid++;
  const i=Array.isArray(r.actual)&&r.expected?r.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(r.actual[i])):0;
  const kind=r.invalid??(r.actual?.driver_error?'rust-'+r.actual.driver_error:mode+'-'+(r.expected[i]?.[0]??'end')+'-'+(r.actual[i]?.[0]??'end'));
  writeFileSync(out+'/fail-'+seed+'.json',JSON.stringify({seed,ops,...r},null,2));
  if(!classes[kind]){classes[kind]={count:0,seed};if(!args.includes('--no-reduce')){const reduced=await reduce(ops,r);writeFileSync(out+'/reduced-'+kind+'.json',JSON.stringify(reduced,null,2));writeFileSync(out+'/reduced-'+kind+'.logs.json',JSON.stringify(await compare(reduced),null,2))}}
  classes[kind].count++;
 }
 const summary={total,agreement,rate:total?agreement/total:0,invalid,timeoutMs:timeout,coverage,modes,classes};writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));if(agreement!==total)process.exitCode=1;
 }
} finally {child?.stdin.end();if(worker)await worker.terminate()}
