// Per-operation function coverage of the Solid src copy (docs/SLICE2A-COVERAGE.md).
// Runs fuzz/solid.mjs in ONE process (like eq.mjs) under the inspector's precise
// coverage, and takes (and resets) the counts at every op boundary through run()'s
// progress callback, so each op's calls include the microtasks it drains.
//   node --import <register.mjs> perop.mjs slice1|slice2a FIRST LAST OUT.json
// with SOLID_SIGNALS_URL=file://.../out/solid-src/index.ts. Ops are classed by kind
// and target (see classOf); OUT maps class -> {ops, fns: {"file:a-b name": calls}}.
import {Session} from 'node:inspector';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const [mode,a,b,o]=process.argv.slice(2);
const session=new Session();session.connect();
const post=(m,p)=>{let r,err;session.post(m,p,(e,x)=>{err=e;r=x});if(err)throw err;return r};
post('Profiler.enable');post('Profiler.startPreciseCoverage',{callCount:true,detailed:false});
const {run}=await import(new URL('fuzz/solid.mjs',root));
const gen=mode==='slice1'?(await import(new URL('fuzz/generate-slice1.mjs',root))).generateSlice1:(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a;
const srcs=new Map(),lineOf=(url,off)=>{let s=srcs.get(url);if(!s){const t=readFileSync(new URL(url),'utf8');const st=[0];for(let i=0;i<t.length;i++)if(t[i]==='\n')st.push(i+1);srcs.set(url,s=st)}let lo=0,hi=s.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(s[m]<=off)lo=m;else hi=m-1}return lo+1};
const out={};
function take(cls){const r=post('Profiler.takePreciseCoverage').result;if(cls===null)return;const e=out[cls]??={ops:0,fns:{}};e.ops++;
 for(const s of r){if(!s.url.includes('/solid-src/'))continue;const file=s.url.split('/solid-src/')[1];for(const f of s.functions){const r0=f.ranges[0];if(r0.startOffset===0||r0.count===0)continue;const k=file+':'+lineOf(s.url,r0.startOffset)+'-'+lineOf(s.url,r0.endOffset)+' '+(f.functionName||'(anonymous)');e.fns[k]=(e.fns[k]??0)+r0.count}}}
function classes(ops){
 // Node kinds and flight roles, from the program text alone.
 const kind=new Map(),actionFlights=new Set(),memoPrefixes=new Set();
 for(const x of ops){if(x.op==='signal')kind.set(x.id,x.optimistic?'optimistic':'signal');if(x.op==='memo'){kind.set(x.id,x.flight?(x.expr.a?.op==='read'&&kind.get(x.expr.a.id)==='async'?'async-chain':'async'):'memo');if(x.flight)memoPrefixes.add(x.flight)}if(x.op==='action')for(const s of x.slices)if(s.flight)actionFlights.add(s.flight)}
 return ops.map(x=>{switch(x.op){
  case 'signal':return 'signal:'+kind.get(x.id);
  case 'memo':return 'memo:'+kind.get(x.id)+('loading'in x?'+loading':'');
  case 'effect':return 'effect:'+(x.render?'render':'user');
  case 'read':case 'latest':case 'pending':case 'write':case 'refresh':return x.op+':'+kind.get(x.id);
  case 'resolve':case 'reject':{const memo=memoPrefixes.has(x.flight.split(':')[0]),act=actionFlights.has(x.flight);return x.op+':'+(memo&&act?'memo+action-flight':memo?'memo-flight':'action-flight')}
  default:return x.op}})}
for(let s=+a;s<=+b;s++){const ops=gen(s),cls=classes(ops);let prev=null;
 take(null);
 await run(ops,i=>{take(prev);prev=i==='teardown'?'teardown':cls[i]});
 take(prev)}
writeFileSync(o,JSON.stringify(out));
