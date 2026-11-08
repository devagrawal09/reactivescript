// Per-operation function coverage of the Solid src copy (docs/SLICE2B-COVERAGE.md); as
// docs/slice2a-fuzz/tools/perop.mjs (same method: inspector precise coverage, taken and
// reset at every op boundary through run()'s progress callback), plus slice2b op classes,
// and with every program in a FRESH worker (as the fuzz oracle runs it): in one process,
// Solid state a program leaves behind (open lanes, unsettled flights) runs again inside
// later programs' ops and is counted there.
//   node perop.mjs slice2a|slice2b FIRST LAST OUT.json [JOBS]      (repository root)
// Report with docs/slice2a-fuzz/tools/perop-report.mjs BASE.json NEW.json.
import {Session} from 'node:inspector';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
const root=pathToFileURL(process.cwd()+'/');
if(isMainThread){const [mode,a,b,o,jobs='4']=process.argv.slice(2);const out={};let next=+a;
 const env={...process.env,SOLID_SIGNALS_URL:new URL('out/solid-src/index.ts',root).href};
 const once=s=>new Promise((res,rej)=>{const w=new Worker(fileURLToPath(import.meta.url),{env,workerData:{mode,seed:s}});w.once('message',m=>{w.terminate();res(m)});w.once('error',rej)});
 const lane=async()=>{while(next<=+b){const r=await once(next++);for(const [cls,v] of Object.entries(r)){const e=out[cls]??={ops:0,fns:{}};e.ops+=v.ops;for(const [k,n] of Object.entries(v.fns))e.fns[k]=(e.fns[k]??0)+n}}};
 await Promise.all(Array.from({length:+jobs},lane));writeFileSync(o,JSON.stringify(out));process.exit(0)}
await import(new URL('docs/slice1-fuzz/parity/tools/register.mjs',root).href);
const {mode,seed}=workerData,a=seed,b=seed;
const session=new Session();session.connect();
const post=(m,p)=>{let r,err;session.post(m,p,(e,x)=>{err=e;r=x});if(err)throw err;return r};
post('Profiler.enable');post('Profiler.startPreciseCoverage',{callCount:true,detailed:false});
const {run}=await import(new URL('fuzz/solid.mjs',root));
const gen=mode==='slice2a'?(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a:(await import(new URL('fuzz/generate-slice2b.mjs',root))).generateSlice2b;
const srcs=new Map(),lineOf=(url,off)=>{let s=srcs.get(url);if(!s){const t=readFileSync(new URL(url),'utf8');const st=[0];for(let i=0;i<t.length;i++)if(t[i]==='\n')st.push(i+1);srcs.set(url,s=st)}let lo=0,hi=s.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(s[m]<=off)lo=m;else hi=m-1}return lo+1};
const out={};
function take(cls){const r=post('Profiler.takePreciseCoverage').result;if(cls===null)return;const e=out[cls]??={ops:0,fns:{}};e.ops++;
 for(const s of r){if(!s.url.includes('/solid-src/'))continue;const file=s.url.split('/solid-src/')[1];for(const f of s.functions){const r0=f.ranges[0];if(r0.startOffset===0||r0.count===0)continue;const k=file+':'+lineOf(s.url,r0.startOffset)+'-'+lineOf(s.url,r0.endOffset)+' '+(f.functionName||'(anonymous)');e.fns[k]=(e.fns[k]??0)+r0.count}}}
function classes(ops){
 const kind=new Map(),skind=new Map(),actionFlights=new Set(),memoPrefixes=new Set(),derivePrefixes=new Set();
 const editKind=ed=>'set'in ed?(ed.path.some(p=>typeof p==='object')?'keyed':ed.path.length===1?'leaf':ed.path.length===2?'row':'field'):ed.del?'del':Object.keys(ed).find(k=>k!=='path');
 const setForm=s=>'reconcile'in s?'reconcile'+(s.key===null?'-pos':''):'returns'in s?'returns':s.edits.length>1?'multi':editKind(s.edits[0]);
 for(const x of ops){if(x.op==='signal')kind.set(x.id,x.optimistic?'optimistic':'signal');
  if(x.op==='memo'){kind.set(x.id,x.optimistic?'optimistic-memo':x.flight?(x.expr.a?.op==='read'&&kind.get(x.expr.a.id)==='async'?'async-chain':'async'):'memo');if(x.flight)memoPrefixes.add(x.flight)}
  if(x.op==='store'){skind.set(x.id,x.derive?'derived-optimistic':x.optimistic?'optimistic':'plain');if(x.derive)derivePrefixes.add(x.derive.flight)}
  if(x.op==='action')for(const s of x.slices)if(s.flight)actionFlights.add(s.flight)}
 const stepKinds=s=>[...new Set((s.writes??[]).map(w=>'write-'+kind.get(w.id)).concat((s.steps??[]).map(st=>'write'in st?'write-'+kind.get(st.write):'update'in st?'update':'store'in st?'store-'+skind.get(st.store):'refresh_store'in st?'refresh-store':'refresh'in st?'refresh':'read')))].sort().join('+')||'none';
 return ops.map(x=>{switch(x.op){
  case 'signal':return 'signal:'+kind.get(x.id);
  case 'memo':return 'memo:'+kind.get(x.id)+('loading'in x?'+loading':'');
  case 'store':return 'store:'+skind.get(x.id)+(x.key===null?'+positional':'')+(x.seedLoading?'+seedLoading':'');
  case 'store_set':return 'store_set:'+skind.get(x.id)+':'+setForm(x);
  case 'effect':return 'effect:'+(x.render?'render':'user');
  case 'update':return 'update:'+kind.get(x.id);
  case 'action':return 'action:'+('steps'in x.slices[0]||x.catch?stepKinds(x.slices[0]):'writes');
  case 'read':case 'latest':case 'pending':return x.op+':'+('expr'in x?'expr':kind.get(x.id));
  case 'write':return 'write:'+kind.get(x.id);
  case 'refresh':return 'refresh:'+('store'in x?'store':kind.get(x.id));
  case 'resolve':case 'reject':{const p=x.flight.split(':')[0],memo=memoPrefixes.has(p),der=derivePrefixes.has(p),act=actionFlights.has(x.flight);return x.op+':'+(der?'derive-flight':memo&&act?'memo+action-flight':memo?'memo-flight':'action-flight')}
  default:return x.op}})}
for(let s=+a;s<=+b;s++){const ops=gen(s),cls=classes(ops);let prev=null;
 take(null);
 await run(ops,i=>{take(prev);prev=i==='teardown'?'teardown':cls[i]});
 take(prev)}
parentPort.postMessage(out);
