// Suspected Solid rc.21 bug (docs/SLICE2C-COVERAGE.md sec. 8): an optimistic store's array
// answers `has` (HasProperty) false for an index whose `get` returns a row and which is below
// its `length` (a row an action guessed with a push, while another action's guess lands).
// mapArray snapshots `_items = newItems.slice(0)`; Array.prototype.slice copies only indices
// HasProperty reports, so `_items` gets a hole, and the next pass hands `undefined` to the key
// function (in the fuzz program `x => x.id` throws a TypeError, which reaches the render effect
// reading the list and halts reactivity: --slice2c seed 493). On Solid's API alone, no fuzz
// oracle: docs/slice2c-fuzz/repro-493-optimistic-hole.json without row children, fallback or
// status writes. The list accessor records, at each pass, every index's get/has; the key
// function records what it is given instead of throwing. c0 and c1 are both required.
//   node docs/slice2c-fuzz/solid-bug-optimistic-hole.mjs
const S=await import(process.env.SOLID_SIGNALS_URL??new URL('../../../solid-next/packages/signals/dist/prod/index.js',import.meta.url).href);
const seen=[];
const [os,set]=S.createOptimisticStore({list:[{id:2,a:0,t:4},{id:3,a:5,t:8}]});
const flight=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const f={c0:flight(),c1:flight(),c2:flight(),c3:flight()};
const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();S.flush()};
const findKey=(t,id)=>{for(let i=0;i<t.length;i++)if(t[i]!=null&&t[i].id===id)return i;return -1};
const shiftRemove=(a,i)=>{const n=a.length;for(let k=i;k<n-1;k++)a[k]=a[k+1];a.length=n-1};
const shiftInsert=(a,i,x)=>{for(let k=a.length;k>i;k--)a[k]=a[k-1];a[i]=x};
S.createRoot(()=>{
 const L=S.mapArray(()=>{const l=os.list;S.untrack(()=>{for(let i=0;i<l.length;i++)if(!(i in l))seen.push('pass: list['+i+'] is row '+l[i]?.id+' but '+i+' in list is false (length '+l.length+')')});return l},item=>item,{keyed:x=>{if(x===undefined)seen.push('key fn got undefined (list now: length '+S.untrack(()=>os.list.length)+', ids '+JSON.stringify(S.untrack(()=>Array.from({length:os.list.length},(_,i)=>os.list[i]?.id??null)))+')');return x?.id}});
 S.createRenderEffect(()=>L().length,()=>{});
});
S.flush();
// c0: guess a removal of a missing row (no-op), await forever (needed: without it no hole)
S.action(function*(){set(d=>{const i=findKey(d.list,4);if(i>=0)shiftRemove(d.list,i)});yield f.c0.promise})();
// c1 (needed): guess the reversed list (setter returns a replacement), await, then a no-op edit
S.action(function*(){set(d=>{const l=d.list,r=[];for(let i=l.length-1;i>=0;i--)r.push(l[i]);return {list:r}});yield f.c1.promise})();
f.c1.resolve(6);await drain();
// c2: guess a pushed row; after the await, remove row 2
S.action(function*(){set(d=>{d.list[d.list.length]={id:6,a:9,t:8}});yield f.c2.promise;set(d=>{const i=findKey(d.list,2);if(i>=0)shiftRemove(d.list,i)})})();
// c3: guess row 2 moved to the front
S.action(function*(){set(d=>{const i=findKey(d.list,2);if(i>=0){const x=d.list[i];shiftRemove(d.list,i);shiftInsert(d.list,0,x)}});yield f.c3.promise})();
f.c3.resolve(7);await drain();
f.c2.resolve(6);await drain();
console.log(seen.length?'REPRODUCED: '+seen.join(', ')+' ('+seen.length+'x)':'not reproduced');
