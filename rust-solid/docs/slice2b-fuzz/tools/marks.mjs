// Which --slice2b seeds reach which Solid sites (docs/SLICE2B-COVERAGE.md "cut sites").
// Builds out/solid-mark: the TS copy (out/solid-src) with a counter call after each anchor
// line below, then runs fuzz/solid.mjs (in ONE process, like eq.mjs) over the seeds and
// prints, per mark: total hits, seeds hitting it, hits per family, first seeds.
//   node docs/slice2b-fuzz/tools/marks.mjs FIRST LAST [OUT.json]
// (run from the repository root with Node 24; positions shift only inside the copy).
import {cpSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const dir='out/solid-mark/';rmSync(dir,{recursive:true,force:true});cpSync('out/solid-src',dir,{recursive:true});
const M=(file,anchor,mark)=>({file,anchor,mark}),R=(file,anchor,replacement,mark)=>({file,anchor,replacement,mark});
const marks=[
 M('core/lanes.ts','export function take(n: Signal<any>, l: Transaction, d?: boolean): void {','take'),
 R('core/lanes.ts','      take(el, l);\n','      (__M("take@laneStage"), take(el, l));\n','take@laneStage'),
 M('core/lanes.ts','        let [n, v, g, q, t] = kept.splice(i, 5);\n','kept-back'),
 M('core/lanes.ts','            commitPendingNode(n);\n            x._lane = v;\n','kept-restored'),
 R('core/lanes.ts','    if (guessed && reverting) reverted.add(l);\n','    if (guessed && reverting) (__M("reverted"), reverted.add(l));\n','reverted'),
 M('core/lanes.ts','function laneOutcome(el: Computed<any>, value: unknown, errored: boolean): boolean {\n','laneOutcome'),
 M('core/lanes.ts','  if (stale(el, answered(el))) {\n','laneOutcome-stale'),
 M('core/lanes.ts','    const older = stale(el, question);\n','laneWrite-guess'),
 M('core/lanes.ts','    if (GlobalQueue._laneRebase?.(el, v, older) || older) {\n','laneWrite-held'),
 M('core/lanes.ts','function linkLanes(a: Transaction, b: Transaction): void {\n','linkLanes'),
 M('store/optimistic.ts','  for (const m of nodesOf(t!)) if (m?._config & CONFIG_GUESS && txOf(m) === g) take(m, d, m !== n);\n','slotTake-take'),
 M('store/optimistic.ts','GlobalQueue._laneRebase = (el: Signal<any>, truth: unknown, older: boolean) => {\n','laneRebase'),
 M('store/optimistic.ts','  const keyFn = t._fam?.key;\n  if (!keyFn) return;\n','laneRebase-arrangement'),
 M('store/optimistic.ts','  if (view.g === null) txOf(el).over = t._fam!.node!._x!._transaction!;\n','laneRebase-4525'),
 M('store/optimistic.ts','function fold(el: Signal<any>, truth: unknown): boolean {\n','fold'),
 R('store/optimistic.ts','    l.folded = foldedRead;\n','    (__M("fold-folded"), (l.folded = foldedRead));\n','fold-folded'),
 M('store/optimistic.ts','function foldedRead(c: Computed<any> | null, el: Signal<any> | Computed<any>): unknown {\n','foldedRead'),
 M('store/optimistic.ts','function laneSet(node: Signal<any>, value: unknown, lane: ReturnType<typeof txOf>): void {\n','laneSet'),
 M('store/optimistic.ts','function pairRows(t: StoreTarget, pb: Record<PropertyKey, any>): void {\n','pairRows'),
 M('store/optimistic.ts','export function optimisticHas(t: StoreTarget, key: PropertyKey): boolean | undefined {\n','optimisticHas'),
 // Sites the Rust port (crates/runtime/src/slice1) cuts with a "not ported" panic:
 M('core/async.ts','  clearPendingSources(el);\n  if (el._x) el._x._blocked = false;\n','stageError-staged'),
 M('core/scheduler.ts','    n._time = clock + 1;\n    notifyStatus(c as Computed<unknown>, STATUS_ERROR, e);\n','commit-staged-error'),
 R('core/lanes.ts','      x._lane = n._pendingValue;\n      n._pendingValue = NOT_PENDING;\n','      if (n._pendingValue instanceof Error) __M("laneSeam-staged-error");\n      x._lane = n._pendingValue;\n      n._pendingValue = NOT_PENDING;\n','laneSeam-staged-error'),
 R('core/truth.ts','  if (!(el._config & CONFIG_GUESS) && el._pendingValue !== NOT_PENDING) return el._pendingValue;\n','  if (!(el._config & CONFIG_GUESS) && el._pendingValue !== NOT_PENDING) return (el._pendingValue instanceof Error && __M("laneValue-staged-error"), el._pendingValue);\n','laneValue-staged-error'),
 M('core/core.ts','    if (comp._config & CONFIG_AUTO_DISPOSE) {\n','reawaken-dormant'),
 M('core/core.ts','    dormantNodes.add(el as Computed<unknown>);\n','dormant-sweep'),
 R('core/verdict.ts','((c._config |= CONFIG_VERDICT), 0)','(__M("verdict-reader"), (c._config |= CONFIG_VERDICT), 0)','verdict-reader'),
 M('core/async.ts','    if (stillPending && el._loading) {\n','notready-loading'),
 R('core/lanes.ts','    if (n._config & CONFIG_GUESS && n._x!._transaction === l && inFlight(n)) return true;\n','    if (n._config & CONFIG_GUESS && n._x!._transaction === l && inFlight(n)) return (__M("guessFlights-true"), true);\n','guessFlights-true'),
];
const done=new Set();
for(const m of marks){const p=dir+m.file;let s=readFileSync(p,'utf8');const i=s.indexOf(m.anchor);
 if(i<0||s.indexOf(m.anchor,i+1)>=0)throw Error('anchor not unique: '+m.mark);
 if(m.replacement){writeFileSync(p,s.slice(0,i)+m.replacement.replaceAll('__M(','(globalThis as any).__M?.(')+s.slice(i+m.anchor.length));done.add(m.mark);continue}
 s=s.slice(0,i+m.anchor.length)+`;(globalThis as any).__M?.(${JSON.stringify(m.mark)});`+(m.anchor.endsWith('\n')?'\n':'')+s.slice(i+m.anchor.length);writeFileSync(p,s);done.add(m.mark)}
writeFileSync(dir+'hooks.mjs',readFileSync('docs/slice1-fuzz/parity/tools/hooks.mjs','utf8').replace('/solid-src/','/solid-mark/'));
writeFileSync(dir+'register.mjs',readFileSync('docs/slice1-fuzz/parity/tools/register.mjs','utf8'));
// out/solid-mark/one.mjs: one program (a JSON op array) with its trace and marks:
//   SOLID_SIGNALS_URL=file://$PWD/out/solid-mark/index.ts node --import ./out/solid-mark/register.mjs out/solid-mark/one.mjs FILE
writeFileSync(dir+'one.mjs',`const hits=new Map();globalThis.__M=m=>hits.set(m,(hits.get(m)??0)+1);
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});const {readFileSync}=await import('node:fs');
let ops=JSON.parse(readFileSync(process.argv[2],'utf8'));if(!Array.isArray(ops))ops=ops.ops;const t=await run(ops);
for(const e of t)console.log(JSON.stringify(e));console.log(JSON.stringify(Object.fromEntries(hits)));`);
const [a,b,o]=process.argv.slice(2);
if(!a){console.log('wrote',dir);process.exit(0)}
// Each program runs in a FRESH worker (as the fuzz oracle does): Solid's module state
// (open transactions, lanes, flights a program left unsettled) must not leak into the next
// program's counts. The worker registers the .ts loader itself, then imports the copy.
writeFileSync(dir+'mark-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import('./register.mjs');const hits=new Map();globalThis.__M=m=>hits.set(m,(hits.get(m)??0)+1);
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
parentPort.on('message',async ops=>{let error=null;try{await run(ops)}catch(e){error=String(e)}parentPort.postMessage({m:Object.fromEntries(hits),error})});`);
const {Worker}=await import('node:worker_threads');
const {generateSlice2b,slice2bFamily}=await import(pathToFileURL(process.cwd()+'/fuzz/generate-slice2b.mjs').href);
process.env.SOLID_SIGNALS_URL=pathToFileURL(process.cwd()+'/'+dir+'index.ts').href;
const once=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+process.cwd()+'/'+dir+'mark-worker.mjs'),{env:process.env});
 const t=setTimeout(()=>{w.terminate();res({m:{},error:'timeout'})},5000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
const per={};let next=+a;
async function lane(){while(next<=+b){const s=next++;const r=await once(generateSlice2b(s));per[s]={f:slice2bFamily(s),m:r.m,...(r.error?{error:r.error}:{})}}}
await Promise.all(Array.from({length:4},lane));
const rep={};for(const m of done){const r={hits:0,seeds:0,byFamily:{},first:[]};
 for(const [s,{f,m:mm}] of Object.entries(per))if(mm[m]){r.hits+=mm[m];r.seeds++;r.byFamily[f]=(r.byFamily[f]??0)+1;if(r.first.length<5)r.first.push(+s)}rep[m]=r}
if(o)writeFileSync(o,JSON.stringify(per));
for(const [m,r] of Object.entries(rep))console.log(m.padEnd(24),String(r.hits).padStart(6),String(r.seeds).padStart(5),JSON.stringify(r.byFamily),'first',r.first.join(','));
