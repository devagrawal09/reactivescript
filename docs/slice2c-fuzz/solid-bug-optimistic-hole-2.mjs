// Suspected Solid rc.21 bug, second form (docs/SLICE2C-COVERAGE.md sec. 8): overlapping pending
// actions that move/remove rows of an optimistic store's array (key "id", the default) compose
// into a view whose element is `undefined` below its length; every reader sees it (here a
// render effect copying the ids; in --slice2c seed 2723 a keyed list's key function throws on
// it). On Solid's API alone; docs/slice2c-fuzz/repro-2723-optimistic-hole.json is the op form.
//   node docs/slice2c-fuzz/solid-bug-optimistic-hole-2.mjs
const S=await import(process.env.SOLID_SIGNALS_URL??new URL('../../../solid-next/packages/signals/dist/prod/index.js',import.meta.url).href);
const [os,set]=S.createOptimisticStore({list:[{id:1,a:0},{id:2,a:0},{id:3,a:5}]});
const findKey=(t,id)=>{for(let i=0;i<t.length;i++)if(t[i]!=null&&t[i].id===id)return i;return -1};
const shiftRemove=(a,i)=>{const n=a.length;for(let k=i;k<n-1;k++)a[k]=a[k+1];a.length=n-1};
const shiftInsert=(a,i,x)=>{for(let k=a.length;k>i;k--)a[k]=a[k-1];a[i]=x};
const removeKey=id=>d=>{const i=findKey(d.list,id);if(i>=0)shiftRemove(d.list,i)};
const views=[];
S.createRoot(()=>S.createRenderEffect(()=>{const l=os.list;return Array.from({length:l.length},(_,i)=>l[i]===undefined?'undefined':l[i].id)},v=>{views.push(JSON.stringify(v))}));
S.flush();
const never=new Promise(()=>{});
// A: guess "row 2 to the front", then "remove row 3" (both required); stays pending.
S.action(function*(){set(d=>{const i=findKey(d.list,2);const x=d.list[i];shiftRemove(d.list,i);shiftInsert(d.list,0,x)});set(removeKey(3));yield never})();
S.flush();
// B: guess "remove row 2"; a second setter call that finds no row 2 (writes nothing) is
// required: with one call the view is [1].
S.action(function*(){set(removeKey(2));set(removeKey(2));yield never})();
S.flush();
console.log('views:',views.join(' -> '));
console.log(views.at(-1).includes('undefined')?'REPRODUCED: the last view has an undefined element (expected ids [1])':'not reproduced');
