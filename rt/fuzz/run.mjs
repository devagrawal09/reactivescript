// Differential fuzzer: two Solid JS runtimes, trace for trace.
// Reference is Solid 2 at store-proto-base. Variant is --variant <index.js> (signals modes)
// or --variant-root <checkout> (--render). Default variant is the reference, which must agree.
// A program invalid on the reference is invalid (counted, not a difference). A program valid
// on the reference where the variant errors, times out, halts or differs is a difference.
import {Worker} from 'node:worker_threads';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {generate} from './generate.mjs';
import {generateSlice1} from './generate-slice1.mjs';
import {generateSlice2a,slice2aFamily} from './generate-slice2a.mjs';
import {generateSlice2b,slice2bFamily} from './generate-slice2b.mjs';
import {generateSlice2c,slice2cFamily} from './generate-slice2c.mjs';
import {generateStrings,stringsFamily} from './generate-strings.mjs';
import {generateRender,renderFamily} from './generate-render.mjs';
import {generateBoundaries,boundariesFamily} from './generate-boundaries.mjs';
import {generateSlice0,slice0Family} from './generate-slice0.mjs';
import {generateSlice0c,slice0cFamily} from './generate-slice0c.mjs';
import {SABOTAGE_KINDS} from './sabotage.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const REF_ROOT='/home/lucifer/work/solidjs/store-proto-base';
const REF_SIGNALS=pathToFileURL(REF_ROOT+'/packages/signals/dist/prod/index.js').href;
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const toHref=p=>p.startsWith('file:')||p.startsWith('http:')||p.startsWith('https:')?p:pathToFileURL(resolve(p)).href;
const timeout=Number(arg('--timeout-ms','1500'));
const slice0=args.includes('--slice0'),slice0c=args.includes('--slice0c'),slice1=args.includes('--slice1'),slice2a=args.includes('--slice2a'),slice2b=args.includes('--slice2b'),slice2c=args.includes('--slice2c'),strings=args.includes('--strings'),render=args.includes('--render'),boundaries=args.includes('--boundaries');
const sabotage=arg('--sabotage',null);
if(sabotage&&!SABOTAGE_KINDS.includes(sabotage)){console.error('unknown sabotage '+sabotage+'; kinds: '+SABOTAGE_KINDS.join(', '));process.exit(2)}
const variantSignals=arg('--variant',null)?toHref(arg('--variant')):REF_SIGNALS;
const variantRoot=arg('--variant-root',REF_ROOT);
const modeName=render?'render':boundaries?'boundaries':strings?'strings':slice2c?'slice2c':slice2b?'slice2b':slice2a?'slice2a':slice1?'slice1':slice0c?'slice0c':slice0?'slice0':'default';
const tag=sabotage?modeName+'-sab-'+sabotage:modeName;
const out=arg('--out',here+'failures/'+tag);
const logDir=here+'logs';
mkdirSync(out,{recursive:true});mkdirSync(logDir,{recursive:true});
function renderUrls(root){const base=pathToFileURL(root.replace(/\/$/,'')+'/');return {solidUrl:new URL('packages/solid/dist/solid.js',base).href,universalUrl:new URL('packages/universal/dist/universal.js',base).href,webUrl:new URL('packages/web/dist/web.js',base).href}}
function strictOf(){if(boundaries)return 'boundaries';if(strings)return 'strings';if(slice2c||slice0c)return 'slice2c';if(slice2b)return 'slice2b';if(slice2a||slice0)return true;return undefined}
function workerDataFor(role){const data={solidUrl:role==='variant'?variantSignals:REF_SIGNALS};const s=strictOf();if(s)data.strict=s;if(role==='variant'&&sabotage)data.sabotage=sabotage;return data}
function renderData(role){const data=renderUrls(role==='variant'?variantRoot:REF_ROOT);if(role==='variant'&&sabotage)data.sabotage=sabotage;return data}
function runOne(ops,role){
  const w=render?new Worker(new URL('./render-worker.mjs',import.meta.url),{execArgv:['--conditions=browser'],workerData:renderData(role)}):new Worker(new URL('./worker.mjs',import.meta.url),{workerData:workerDataFor(role)});
  let progress;return new Promise(resolve=>{
    const finish=result=>{clearTimeout(timer);w.removeListener('message',onMessage);w.removeListener('error',onError);w.terminate();resolve(result)};
    const onMessage=result=>{if('progress' in result)progress=result.progress;else finish(result)};
    const onError=e=>finish({invalid:'oracle-error',detail:e.stack});
    const timer=setTimeout(()=>finish({invalid:'oracle-timeout',progress}),timeout);
    w.on('message',onMessage);w.once('error',onError);w.postMessage(ops);
  });
}
async function compare(ops){
  const reference=await runOne(ops,'reference');
  if(reference.invalid)return {...reference,agree:false};
  const variant=await runOne(ops,'variant');
  if(variant.invalid)return {expected:reference.expected,actual:{driver_error:variant.invalid,detail:variant.detail,progress:variant.progress},agree:false};
  if(variant.halted&&!reference.halted)return {expected:reference.expected,actual:{driver_error:'oracle-halted'},agree:false};
  return {expected:reference.expected,actual:variant.expected,agree:JSON.stringify(reference.expected)===JSON.stringify(variant.expected)};
}
function valid(ops){const nodes=new Set(),owners=new Set(['root']);const expr=e=>typeof e==='number'||e&&((e.op!=='read'||nodes.has(e.id))&&['a','b','test','yes','no','expr'].every(k=>!(k in e)||typeof e[k]==='number'||expr(e[k])));for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;if(o.expr&&!expr(o.expr))return false;if(['read','latest','pending','write','refresh'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='action'&&o.slices.some(s=>(s.writes??[]).some(w=>!nodes.has(w.id))))return false;if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// --slice0 reducer validity: valid()'s rules, plus children expressions and dispose targets.
function valid0(ops){const nodes=new Set(),owners=new Set(['root']);
  const expr=e=>typeof e==='number'||e&&((e.op!=='read'||nodes.has(e.id))&&['a','b','test','yes','no','expr'].every(k=>!(k in e)||typeof e[k]==='number'||expr(e[k])));
  const kids=cs=>(cs??[]).every(c=>'effect' in c||'memo' in c?expr(c.expr):'read' in c?expr(c.read):'cleanup' in c);
  for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;if(o.expr&&!expr(o.expr))return false;
    if((o.op==='memo'||o.op==='effect')&&o.children&&!kids(o.children))return false;
    if(['read','write'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='dispose'&&!owners.has(o.owner))return false;
    if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
// --slice2b reducer validity (docs/SLICE2B-DESIGN.md sec. 3.4): every node, setter, store and
// owner reference in ops, steps and (walked) expressions must name an earlier definition.
function valid2b(ops){const nodes=new Set(),setters=new Set(),stores=new Set(),owners=new Set(['root']);
  const ek=['a','b','test','yes','no','expr','of','where','with','key'];
  const expr=e=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(expr);
    if(e.op==='read'&&!nodes.has(e.id)||e.op==='store'&&!stores.has(e.id))return false;
    return ek.every(k=>!(k in e)||expr(e[k]))&&(!e.fields||Array.isArray(e.fields)||Object.values(e.fields).every(expr))&&(!e.items||e.items.every(expr))};
  const edits=s=>(s.edits??[]).every(ed=>['set','push','insert'].every(k=>!(k in ed)||expr(ed[k])))&&(!('returns' in s)||expr(s.returns));
  const step=st=>'write' in st?setters.has(st.write):'update' in st?setters.has(st.update)&&expr(st.expr):'store' in st?stores.has(st.store)&&edits(st)
    :'refresh' in st?nodes.has(st.refresh):'refresh_store' in st?stores.has(st.refresh_store):'read' in st?expr(st.read):false;
  for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;
    if(o.expr&&!expr(o.expr))return false;if(o.derive&&!expr(o.derive.expr))return false;
    if(['read','latest','pending'].includes(o.op)&&!('expr' in o)&&!nodes.has(o.id))return false;
    if(o.op==='refresh'&&!('store' in o?stores.has(o.store):nodes.has(o.id)))return false;
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
  const expr=(e,cx)=>{if(e===null||typeof e!=='object')return true;if(Array.isArray(e))return e.every(x=>expr(x,cx));
    if(e.op==='read'&&!nodes.has(e.id)||e.op==='store'&&!stores.has(e.id))return false;
    if(!cx.row&&(e.op==='item'||e.op==='index')||!cx.pass&&e.op==='local')return false;
    return ek.every(k=>!(k in e)||expr(e[k],cx))&&(!e.fields||Array.isArray(e.fields)||Object.values(e.fields).every(x=>expr(x,cx)))&&(!e.items||e.items.every(x=>expr(x,cx)))};
  const list=(l,cx)=>expr(l.each,cx)&&(l.keyed===null||typeof l.keyed!=='object'||expr(l.keyed.expr,cx))&&kids(l.row,{row:true,pass:true})&&(!Array.isArray(l.fallback)||kids(l.fallback,{row:cx.row,pass:true}));
  const show=(b,cx)=>expr(b.when,cx)&&kids(b.yes,{row:cx.row||!!b.fn,pass:true})&&kids(b.no,{row:cx.row,pass:true});
  const kids=(cs,cx)=>(cs??[]).every(c=>'effect' in c||'memo' in c?expr(c.expr,cx):'list' in c?list(c.list,cx):'show' in c?show(c.show,cx):'read' in c?expr(c.read,cx):'cleanup' in c);
  const edits=s=>(s.edits??[]).every(ed=>['set','push','insert'].every(k=>!(k in ed)||expr(ed[k],TOP)))&&(!('returns' in s)||expr(s.returns,TOP));
  const step=st=>'write' in st?setters.has(st.write):'update' in st?setters.has(st.update)&&expr(st.expr,TOP):'store' in st?stores.has(st.store)&&edits(st)
    :'refresh' in st?nodes.has(st.refresh):'refresh_store' in st?stores.has(st.refresh_store):'read' in st?expr(st.read,TOP):false;
  for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;
    if(o.expr&&!expr(o.expr,TOP))return false;if(o.derive&&!expr(o.derive.expr,TOP))return false;
    if(o.op==='list'&&!list(o,TOP)||o.op==='show'&&!show(o,TOP)||(o.op==='memo'||o.op==='effect')&&!kids(o.children,{row:false,pass:true}))return false;
    if(['read','latest','pending'].includes(o.op)&&!('expr' in o)&&!nodes.has(o.id))return false;
    if(o.op==='refresh'&&!('store' in o?stores.has(o.store):nodes.has(o.id)))return false;
    if(['write','update'].includes(o.op)&&!setters.has(o.id))return false;
    if(o.op==='store_set'&&!(stores.has(o.id)&&edits(o)))return false;
    if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
    if(['signal','memo','list','show'].includes(o.op))nodes.add(o.id);if(o.op==='signal'||o.op==='memo'&&o.optimistic)setters.add(o.id);
    if(o.op==='store')stores.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
function validD(ops){const nodes=new Set(),setters=new Set(),owners=new Set(['root']);
  const expr=(e,pass)=>{if(e===null||typeof e!=='object')return true;if(e.op==='read'&&!nodes.has(e.id)||e.op==='local'&&!pass)return false;
    return ['a','b','test','yes','no','of'].every(k=>!(k in e)||expr(e[k],pass))};
  const kids=cs=>(cs??[]).every(c=>'effect' in c||'memo' in c?expr(c.expr,true):'loading' in c||'errored' in c?bnd(c.loading??c.errored):'show' in c?expr(c.show.when,true)&&kids(c.show.yes)&&kids(c.show.no):'cleanup' in c);
  const bnd=b=>kids(b.children)&&kids(b.fallback)&&(!('expr' in b)||expr(b.expr,true));
  const step=st=>'write' in st?setters.has(st.write):'refresh' in st||'affects' in st?nodes.has(st.refresh??st.affects):false;
  for(const o of ops){if(o.owner&&!owners.has(o.owner))return false;if(o.expr&&!expr(o.expr,false))return false;
    if((o.op==='loading'||o.op==='errored')&&!bnd(o))return false;if(o.op==='memo'&&o.children&&!kids(o.children))return false;
    if(['read','pending','refresh','affects'].includes(o.op)&&!nodes.has(o.id))return false;
    if(o.op==='write'&&!setters.has(o.id))return false;if(o.op==='dispose'&&!owners.has(o.owner))return false;
    if(o.op==='action'&&!o.slices.concat(o.catch?[o.catch]:[]).every(s=>(s.writes??[]).every(w=>setters.has(w.id))&&(s.steps??[]).every(step)))return false;
    if(['signal','memo','loading','errored'].includes(o.op))nodes.add(o.id);if(o.op==='signal')setters.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
function validRender(ops){const sigs=new Set();let live=false;
  const refs=x=>{if(x===null||typeof x!=='object')return true;if(Array.isArray(x))return x.every(refs);if((x.x==='read'&&!sigs.has(x.id))||(x.write&&!sigs.has(x.write.id)))return false;return Object.values(x).every(refs)};
  for(const o of ops){if(o.op==='signal'){sigs.add(o.id);continue}if(o.op==='write'&&!sigs.has(o.id))return false;
    if(o.op==='render'){if(live||!refs(o.view))return false;live=true}if(o.op==='dispose')live=false}return true}
function traceClass(r){if(r.invalid)return r.invalid;if(r.actual?.driver_error)return 'variant-'+r.actual.driver_error;const exp=r.expected,act=r.actual,n=Math.max(exp.length,act.length);for(let i=0;i<n;i++)if(JSON.stringify(exp[i])!==JSON.stringify(act[i]))return (exp[i]?.[0]??'end')+'-'+(act[i]?.[0]??'end');return 'end-end'}
const checkValid=render?validRender:boundaries?validD:slice2c||strings||slice0c?valid2c:slice2b?valid2b:slice0?valid0:valid;
const strictTrace=slice1||slice2a||slice2b||slice2c||strings||render||boundaries||slice0||slice0c;
async function reduce(ops,initial){let outOps=ops;let size=Math.ceil(outOps.length/2),checks=0;while(size>=1&&checks<180){let changed=false;for(let i=0;i<outOps.length&&checks<180;i+=size){const candidate=outOps.slice(0,i).concat(outOps.slice(i+size));if(!checkValid(candidate))continue;checks++;const r=await compare(candidate);const sameFailure=initial.invalid?r.invalid===initial.invalid:initial.actual?.driver_error?r.actual?.driver_error===initial.actual.driver_error:!r.invalid&&!r.actual?.driver_error;if(sameFailure&&!r.agree&&(!strictTrace||traceClass(r)===traceClass(initial))){outOps=candidate;changed=true;break}}if(!changed)size=Math.floor(size/2)}return outOps}
const generateOf=render?generateRender:boundaries?generateBoundaries:strings?generateStrings:slice2c?generateSlice2c:slice2b?generateSlice2b:slice2a?generateSlice2a:slice1?generateSlice1:slice0c?generateSlice0c:slice0?generateSlice0:generate;
const familyOf=seed=>render?renderFamily(seed):boundaries?boundariesFamily(seed):strings?stringsFamily(seed):slice2c?slice2cFamily(seed):slice2b?slice2bFamily(seed):slice2a?slice2aFamily(seed):slice1?'scalar-actions':slice0c?slice0cFamily(seed):slice0?slice0Family(seed):seed%6;
let total=0,agreement=0,invalid=0,differences=0;const coverage={},classes={},modes={},invalidByClass={},invSample={};
const t0=Date.now();
try {
  if(args.includes('--replay')){const ops=JSON.parse(readFileSync(arg('--replay'),'utf8'));const r=await compare(ops);console.log(JSON.stringify(r,null,2));if(!r.agree&&!r.invalid)process.exitCode=1;}
  else {const count=Number(arg('--seeds','2000')),start=Number(arg('--start','1'));
    for(let seed=start;seed<start+count;seed++){
      if(args.includes('--trace'))console.error('seed',seed);
      const ops=generateOf(seed);for(const o of ops)coverage[o.op]=(coverage[o.op]??0)+1;
      const r=await compare(ops);total++;const mode=familyOf(seed);modes[mode]??={total:0,agreement:0,invalid:0,differences:0};modes[mode].total++;
      if(r.invalid){invalid++;modes[mode].invalid++;invalidByClass[r.invalid]=(invalidByClass[r.invalid]??0)+1;if(!invSample[r.invalid]){invSample[r.invalid]=seed;console.error('invalid',modeName,r.invalid,'seed',seed,(r.detail||'').split('\n')[0]) }continue}
      if(r.agree){agreement++;modes[mode].agreement++;continue}
      differences++;modes[mode].differences++;
      const kind=traceClass(r);
      if(!classes[kind]){classes[kind]={count:0,seed};writeFileSync(out+'/fail-'+seed+'.json',JSON.stringify({seed,kind,ops,expected:r.expected,actual:r.actual},null,2));if(!args.includes('--no-reduce')){const reduced=await reduce(ops,r);writeFileSync(out+'/reduced-'+kind+'.json',JSON.stringify(reduced,null,2));writeFileSync(out+'/reduced-'+kind+'.logs.json',JSON.stringify(await compare(reduced),null,2))}}
      classes[kind].count++;
      if(differences===1)console.error('difference',modeName,kind,'seed',seed);
    }
    const elapsedMs=Date.now()-t0;
    const summary={mode:modeName,sabotage:sabotage||null,variant:render?variantRoot:variantSignals,reference:render?REF_ROOT:REF_SIGNALS,seeds:count,start,total,valid:total-invalid,agreement,differences,invalid,invalidByClass,programsPerSec:elapsedMs?Number((total/(elapsedMs/1000)).toFixed(2)):0,elapsedMs,timeoutMs:timeout,coverage,modes,classes};
    writeFileSync(logDir+'/'+tag+'.json',JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary,null,2));
    if(differences)process.exitCode=1;
  }
} finally {}
