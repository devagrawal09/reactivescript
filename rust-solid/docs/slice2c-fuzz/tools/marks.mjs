// docs/slice2c-fuzz copy of docs/slice2b-fuzz/tools/marks.mjs: the generator is chosen by MODE
// (slice2b | slice2c), and the tier-C sites (map.ts paths, parked frames, holdFrame, zombies)
// are marked too (docs/SLICE2C-COVERAGE.md "cut sites").
//   node docs/slice2c-fuzz/tools/marks.mjs MODE FIRST LAST [OUT.json]
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
 // ---- Tier C sites ----
 // Parked frames (L2), holdFrame, zombies (Rust: owner.rs:66, core.rs:106, scheduler.rs:4/189/319/627 "not ported / constant").
 R('core/core.ts','    } else if (el._firstChild !== null || el._disposal !== null) parkChildren(el);\n','    } else if (el._firstChild !== null || el._disposal !== null) (__M("parkChildren"), parkChildren(el));\n','parkChildren'),
 R('core/core.ts','      deferReleases((released = []));\n      disposeChildren(el);\n','      deferReleases((released = []));\n      if (el._config & CONFIG_STAGED && (el._firstChild !== null || el._disposal !== null)) __M("die-on-spot");\n      disposeChildren(el);\n','die-on-spot'),
 R('core/core.ts','  else if (el._flags & REACTIVE_ZOMBIE && !(el._flags & REACTIVE_LANE_DIRTY)) deferZombie(el);\n','  else if (el._flags & REACTIVE_ZOMBIE && !(el._flags & REACTIVE_LANE_DIRTY)) (__M("deferZombie"), deferZombie(el));\n','deferZombie'),
 R('core/core.ts','  else if (laneStageHook && el._flags & REACTIVE_ZOMBIE && laneFrameMember(el)) {\n','  else if (laneStageHook && el._flags & REACTIVE_ZOMBIE && laneFrameMember(el)) {\n    __M("laneFrameMember-cancel");\n','laneFrameMember-cancel'),
 M('core/scheduler.ts','function holdFrame(owner: Owner, t: Transaction): void {\n','holdFrame'),
 R('core/scheduler.ts','      if (!(c._config & CONFIG_HELD)) holdNode(c as unknown as Signal<any>, t);\n','      if (!(c._config & CONFIG_HELD)) (__M("holdFrame-node"), holdNode(c as unknown as Signal<any>, t));\n','holdFrame-node'),
 M('core/scheduler.ts','      const zombies = deferredZombies.splice(0);\n','zombies-at-park'),
 R('core/scheduler.ts','        if (!(zombies[i]._flags & REACTIVE_DISPOSED)) recompute(zombies[i]);\n','        if (!(zombies[i]._flags & REACTIVE_DISPOSED)) (__M("zombie-rerun-at-commit"), recompute(zombies[i]));\n','zombie-rerun-at-commit'),
 R('core/scheduler.ts','    GlobalQueue._dispose(c as Computed<unknown>, false, true);\n}\n','    (__M("commit-retires-frame"), GlobalQueue._dispose(c as Computed<unknown>, false, true));\n}\n','commit-retires-frame'),
 M('core/scheduler.ts','function removalStagedBy(r: Computed<any>, t: Transaction): boolean {\n','removalStagedBy'),
 R('core/lanes.ts','        if (x._pendingFirstChild !== null || x._pendingDisposal !== null)\n          GlobalQueue._dispose(n as Computed<any>, false, true);\n','        if (x._pendingFirstChild !== null || x._pendingDisposal !== null)\n          (__M("dissolve-retires-frame"), GlobalQueue._dispose(n as Computed<any>, false, true));\n','dissolve-retires-frame'),
 R('core/lanes.ts','    if (x._pendingFirstChild !== null || x._pendingDisposal !== null)\n      GlobalQueue._dispose(n, false, true);\n','    if (x._pendingFirstChild !== null || x._pendingDisposal !== null)\n      (__M("laneSeam-retires-frame"), GlobalQueue._dispose(n, false, true));\n','laneSeam-retires-frame'),
 R('core/owner.ts','  if (zombie) node._x!._pendingFirstChild = null;\n','  if (zombie) (__M("dispose-parked-frame"), (node._x!._pendingFirstChild = null));\n','dispose-parked-frame'),
 R('core/owner.ts','    )\n      disposeChildren(node, false, true);\n','    )\n      (__M("parked-frame-dies-with-owner"), disposeChildren(node, false, true));\n','parked-frame-dies-with-owner'),
 M('core/core.ts','export function bornInto(c: Computed<any>, t: Transaction): unknown {\n','bornInto'),
 // Rust core.rs header: CONFIG_SYNC (Show's condition/outer memos) and promoted writes are not ported.
 R('core/core.ts','    if (!__DEV__ && el._config & CONFIG_SYNC) {\n','    if (!__DEV__ && el._config & CONFIG_SYNC) {\n      __M("sync-fast-arm");\n','sync-fast-arm'),
 R('core/core.ts','  el._config |= CONFIG_PROMOTED;\n  promotedWrites.push(el);\n','  el._config |= CONFIG_PROMOTED;\n  __M("promoted-write");\n  promotedWrites.push(el);\n','promoted-write'),
 M('core/core.ts','export function creatorReads(p: Computed<any> | null, born: number): number {\n','creatorReads'),
 // mapArray (map.ts) paths.
 M('map.ts','        this._owner.dispose(false);\n        this._nodes = [];\n        this._items = [];\n','map-empty-dispose'),
 M('map.ts','        this._indexes && (this._indexes = []);\n      }\n      if (this._fallback && !this._mappings.length) {\n','map-fallback'),
 M('map.ts','    else if (this._len === 0) {\n','map-create-all'),
 M('map.ts','        for (i = 0; i <= j!; i++) nodes[i]?.dispose();\n','map-create-all-abort'),
 R('map.ts','        if (this._rows) writeRow(this._rows[start], newItems[start]);\n','        if (this._rows) (__M("map-prefix-writeRow"), writeRow(this._rows[start], newItems[start]));\n','map-prefix-writeRow'),
 M('map.ts','      if (start === newLen && this._len === newLen) {\n','map-no-structural-change'),
 M('map.ts','        const m = start + ((newEnd - start) >> 1);\n','map-small-probe'),
 R('map.ts','        if (k <= hi && trySmallMove(this, newItems as Item[], newLen, start)) return;\n','        if (k <= hi && (__M("map-small-try"), trySmallMove(this, newItems as Item[], newLen, start))) return (__M("map-small-commit"), undefined);\n','map-small-try'),
 R('map.ts','        if (displaced.has(oldItems[ro + a])) return false;\n','        if (displaced.has(oldItems[ro + a])) return (__M("map-small-duplicate-decline"), false);\n','map-small-duplicate-decline'),
 M('map.ts','      tempNodes.fill(undefined as any);\n','map-stageRemoval-not-pure'),
 M('map.ts','      if (pure !== null) {\n','map-stageRemoval-pure'),
 M('map.ts','        newIndices = new Map<Item, number>();\n','map-keyed-path'),
 M('map.ts','            (created ??= []).push((tempNodes[j - start] = createOwner()));\n','map-row-created'),
 M('map.ts','          if (created) for (i = 0; i < created.length; i++) created[i].dispose();\n','map-abort-2903'),
 R('map.ts','  if (dif > 0) {\n    // Grow first','  if (dif > 0) {\n    __M("commitWindow-grow");\n    // Grow first','commitWindow-grow'),
 R('map.ts','  } else if (dif < 0) {\n    for (i = end + 1','  } else if (dif < 0) {\n    __M("commitWindow-shrink");\n    for (i = end + 1','commitWindow-shrink'),
 R('map.ts','  (row._value === v && row._pendingValue === NOT_PENDING) || setSignal(row, v);\n','  (row._value === v && row._pendingValue === NOT_PENDING) || (__M("writeRow-setSignal"), setSignal(row, v));\n','writeRow-setSignal'),
 R('map.ts','    if (liveIndexes) setSignal((liveIndexes[j] = indexes![j - start]), j);\n','    if (liveIndexes) (__M("index-setSignal"), setSignal((liveIndexes[j] = indexes![j - start]), j));\n','index-setSignal'),
 R('map.ts','  newItems = shallowView?.((newItems as any)[$TARGET]) ?? newItems;\n','  newItems = (shallowView?.((newItems as any)[$TARGET]) && __M("map-shallowView"), shallowView?.((newItems as any)[$TARGET]) ?? newItems);\n','map-shallowView'),
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
const [mode,a,b,o]=process.argv.slice(2);
if(!a){console.log('wrote',dir);process.exit(0)}
// Each program runs in a FRESH worker (as the fuzz oracle does): Solid's module state
// (open transactions, lanes, flights a program left unsettled) must not leak into the next
// program's counts. The worker registers the .ts loader itself, then imports the copy.
writeFileSync(dir+'mark-worker.mjs',`import {parentPort} from 'node:worker_threads';
await import('./register.mjs');const hits=new Map();globalThis.__M=m=>hits.set(m,(hits.get(m)??0)+1);
const {run}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/fuzz/solid.mjs').href)});
parentPort.on('message',async ops=>{let error=null;try{await run(ops)}catch(e){error=String(e)}parentPort.postMessage({m:Object.fromEntries(hits),error})});`);
const {Worker}=await import('node:worker_threads');
const G=mode==='slice2c'?['generate-slice2c.mjs','generateSlice2c','slice2cFamily']:['generate-slice2b.mjs','generateSlice2b','slice2bFamily'];
const gm=await import(pathToFileURL(process.cwd()+'/fuzz/'+G[0]).href),generateSlice2b=gm[G[1]],slice2bFamily=gm[G[2]];
process.env.SOLID_SIGNALS_URL=pathToFileURL(process.cwd()+'/'+dir+'index.ts').href;
const once=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+process.cwd()+'/'+dir+'mark-worker.mjs'),{env:process.env});
 const t=setTimeout(()=>{w.terminate();res({m:{},error:'timeout'})},5000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
const per={};let next=+a;
async function lane(){while(next<=+b){const s=next++;const r=await once(generateSlice2b(s));per[s]={f:slice2bFamily(s),m:r.m,...(r.error?{error:r.error}:{})}}}
await Promise.all(Array.from({length:4},lane));
// Marks a replacement carries besides its own name (map-small-commit) are reported too.
for(const {m:mm} of Object.values(per))for(const k of Object.keys(mm))done.add(k);
const rep={};for(const m of done){const r={hits:0,seeds:0,byFamily:{},first:[]};
 for(const [s,{f,m:mm}] of Object.entries(per))if(mm[m]){r.hits+=mm[m];r.seeds++;r.byFamily[f]=(r.byFamily[f]??0)+1;if(r.first.length<5)r.first.push(+s)}rep[m]=r}
if(o)writeFileSync(o,JSON.stringify(per));
for(const [m,r] of Object.entries(rep))console.log(m.padEnd(24),String(r.hits).padStart(6),String(r.seeds).padStart(5),JSON.stringify(r.byFamily),'first',r.first.join(','));
