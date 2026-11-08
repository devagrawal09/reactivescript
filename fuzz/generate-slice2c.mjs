// Slice 2c (tier C of docs/SLICE2B-DESIGN.md): keyed lists (mapArray / For), Show, children
// built inside computations, row-owned effects/memos/cleanups and row events, on the
// slice-1 driver. Same Mulberry32 RNG, worker oracle (strict 'slice2c') and exact full-trace
// comparator as the other generators. Ops and expressions: docs/SLICE2C-COVERAGE.md sec. 1
// (fuzz/solid.mjs tier C), on top of tier B (docs/SLICE2B-DESIGN.md sec. 2-3).
//
// Families (deterministic weighted choice, family = W[seed mod |W|], no RNG):
// - list-ints (3): a signal holding an int array (values 0-5, duplicates); one mapArray in a
//   random keying mode (identity, keyed:false, key fn mod 3), mapper arity 1 or 2, optional
//   fallback (plain or with children); row render/user effects, row memos read through
//   `local`, cleanups; writes made by insert/remove/move/swap/reverse/dup/clear/same-content/
//   rotate edits, several per turn; some writes inside actions (held). 10%: a row body read
//   of an async memo (NotReadyError mid-pass: the #2903 abort and retry); 8%: a row body read
//   that fails for one value (an Error mid-pass), read only by user effects.
// - list-store (3): a list over a store's rows (identity, "id" key, keyed:false; 10% shallow
//   store); row effects over item fields, plain copies and the index; edits: fields, push,
//   insert, remove, move, row replacement (same id or new), setter-returned filter, reconcile
//   by id or by position; some keyed edits inside actions.
// - list-lanes (3): a list over an optimistic memo `shown` (over store rows, or over an int
//   array signal); claim actions guess through updaters that edit a row, filter a row out,
//   move it to the front, reverse the list or insert a row; the action's second slice writes
//   truth (the yielded value, a removal, a push) or nothing; 1-4 overlapping actions; the
//   list lives under a named owner that is disposed mid-action in 8% of programs.
// - list-opt-store (3): a list over an optimistic store's rows (key id, or positional 25%)
//   whose rows are moved (moveKey front/back), removed (removeKey), pushed or edited while
//   other actions are pending; slice 2 writes truth into the same store; mainline edits.
// - list-show (3): Show (element children, 20% function children, 20% keyed) over a signal,
//   an optimistic signal or a list length, with a For in its yes branch and effects in both;
//   memos (and 30% an effect) whose passes build children and register cleanups; writes and
//   actions flip the condition and the list under holds (writes in action slices) and lanes
//   (optimistic guesses): parkChildren, holdFrame, zombies.
// - list-nested (2): store rows {id,a,tags:[ints]}; each row maps its tags with a nested
//   list whose rows read the outer row through `up`; nested edits.
// - list-bulk (2): an int list of 66-100 distinct values (identity keying, arity 1, no row
//   children): rotations, swaps, small displacements, removals (trySmallMove), full replaces
//   (the probe miss), a displaced duplicate inside a run (the duplicate decline), growth.
// - tracker (4): frontend/tsx/fixtures/demo/tracker.tsx with Show + For: issues store,
//   optimistic `shown`, visible/unassigned (native or loop), render effects for the filter,
//   the open count, the Show insert (call of the Show accessor) and the status; the Show's
//   yes branch is a For (identity keyed, arity 1) whose rows have the IssueRow text render
//   effects; claims as in the demo.
//
// Render effects never see an error (an error reaching a render effect halts rc.21): only
// user effects read nodes that can fail.
const FAMILIES=[['list-ints',3],['list-store',3],['list-lanes',3],['list-opt-store',3],['list-show',3],['list-nested',2],['list-bulk',2],['tracker',4]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const slice2cFamily=seed=>W[(seed>>>0)%W.length];

const st=id=>({op:'store',id}),get=(of,key)=>({op:'get',of,key}),rd=id=>({op:'read',id}),len=of=>({op:'len',of});
const eq=(a,b)=>({op:'eq',a,b}),not=a=>({op:'not',a}),elem={op:'elem'},arg={op:'arg'},sent={op:'sent'},draft={op:'draft'};
const nat=(o,native)=>native?{...o,native:true}:o;
const filter=(of,where,native)=>nat({op:'filter',of,where},native),count=(of,where,native)=>nat({op:'count',of,where},native);
const replace=(of,where,w,native)=>nat({op:'replace',of,where,with:w},native);
const obj=fields=>({op:'obj',fields}),arr=items=>({op:'arr',items}),lit=value=>({op:'lit',value}),plain=(of,fields)=>({op:'plain',of,fields});
const choose=(test,yes,no)=>({op:'choose',test,yes,no}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const item=up=>up?{op:'item',up}:{op:'item'},index=up=>up?{op:'index',up}:{op:'index'},call=of=>({op:'call',of}),local=id=>({op:'local',id});
const concat=items=>({op:'concat',items}),reverse=of=>({op:'reverse',of}),fail=message=>({op:'fail',message});
const ef=f=>get(elem,f);
const clone=v=>JSON.parse(JSON.stringify(v));

export function generateSlice2c(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 const probe=(label,expr,kinds=['read'])=>{for(const k of kinds)put(k,{label,expr})};
 const family=slice2cFamily(seed);
 const gens={'list-ints':listInts,'list-store':listStore,'list-lanes':listLanes,'list-opt-store':listOptStore,'list-show':listShow,'list-nested':listNested,'list-bulk':listBulk,'tracker':tracker};
 gens[family]();
 return ops;

 // ---- shared pieces ----
 // A keying mode and arity: identity (default), keyed:false, or a key function.
 function keying(keyFn){const r=n(10);return r<5?true:r<8?false:keyFn}
 // Row children over an int item. `idx`: the mapper receives a usable index.
 function intRow(idx,extra=[]){const kids=[];const k=1+n(3);
  for(let i=0;i<k;i++){const r=n(10);
   if(r<4)kids.push({effect:'e'+i,render:true,expr:item()});
   else if(r<6&&idx)kids.push({effect:'e'+i,render:n(2)===0,expr:add(item(),index())});
   else if(r<8){kids.push({memo:'m'+i,expr:add(item(),1)});kids.push({effect:'v'+i,render:true,expr:local('m'+i)})}
   else kids.push({effect:'e'+i,expr:arr([item(),...extra])})}
  if(n(3)===0)kids.push({cleanup:'c'});return kids}
 // Row children over a store row proxy (or raw row) item.
 function objRow(idx,fields=['id','a']){const kids=[];const k=1+n(3);
  for(let i=0;i<k;i++){const r=n(10);
   if(r<4)kids.push({effect:'e'+i,render:true,expr:get(item(),pick(['a','t']))});
   else if(r<6)kids.push({effect:'e'+i,render:n(2)===0,expr:plain(item(),fields)});
   else if(r<8&&idx)kids.push({effect:'e'+i,render:true,expr:arr([index(),get(item(),'id')])});
   else{kids.push({memo:'m'+i,expr:arr([get(item(),'a'),get(item(),'id')])});kids.push({effect:'v'+i,render:true,expr:local('m'+i)})}}
  if(n(3)===0)kids.push({cleanup:'c'});return kids}
 function fallbackSpec(){const r=n(6);return r<3?false:r<5?true:[{effect:'fb',render:true,expr:0},{cleanup:'fc'}]}

 // ---- list-ints ----
 // Edit an int array model; returns the new array.
 function intEdit(xs,vals=6){const a=xs.slice(),r=n(100);
  if(r<14)a.splice(n(a.length+1),0,n(vals));
  else if(r<26&&a.length)a.splice(n(a.length),1);
  else if(r<38&&a.length>1){const [x]=a.splice(n(a.length),1);a.splice(n(a.length+1),0,x)}
  else if(r<48&&a.length>1){const i=n(a.length),j=n(a.length);[a[i],a[j]]=[a[j],a[i]]}
  else if(r<54)a.reverse();
  else if(r<62&&a.length)a.splice(n(a.length+1),0,a[n(a.length)]);
  else if(r<66)a.length=0;
  else if(r<72){}
  else if(r<78&&a.length>1)a.push(a.shift());
  else if(r<86&&a.length)a[n(a.length)]=n(vals);
  else if(r<92)return Array.from({length:n(7)},()=>n(vals));
  else a.push(n(vals));
  return a}
 function listInts(){
  let xs=Array.from({length:n(7)},()=>n(6));
  const variant=n(100),asyncRow=variant<10,failRow=variant>=10&&variant<18;
  put('signal',{id:'xs',value:clone(xs)});put('signal',{id:'k',value:n(3)});
  const keyed=keying({expr:mod(elem,3)}),idx=n(2)===0,fb=fallbackSpec();
  const row=intRow(idx,[rd('k')]);
  if(asyncRow){put('memo',{id:'am',expr:mod(rd('k'),3),flight:'q'});row.unshift({read:add(item(),rd('am')),label:'r'})}
  if(failRow){const bad=n(6);row.unshift({read:choose(eq(item(),bad),fail('bad-row'),item()),label:'r'})}
  const risky=asyncRow||failRow;
  put('list',{id:'L',each:rd('xs'),keyed,index:idx,fallback:fb,row});
  put('effect',{id:'top',render:!risky,expr:rd('L')});
  if(n(2))put('effect',{id:'lenL',expr:len(rd('L'))});
  put('flush');
  const open=[];let actions=0,qs=[0,1,2];
  const steps=10+n(9);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<55){const turns=n(10)<3?2:1;for(let t=0;t<turns;t++){xs=intEdit(xs);put('write',{id:'xs',value:clone(xs)})}if(n(10)<8)put('flush')}
   else if(r<65){put('write',{id:'k',value:n(3)});if(n(2))put('flush')}
   else if(r<75&&open.length<3){const flight='f'+actions,a1=intEdit(xs),a2=intEdit(a1);
    put('action',{id:'a'+actions++,slices:[{steps:[{write:'xs',value:clone(a1)}],flight},{steps:n(2)?[{write:'xs',value:clone(a2)}]:[]}]});open.push(flight);if(n(2))put('flush')}
   else if(r<85&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(5)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:n(4)})}
   else if(r<90&&asyncRow&&qs.length){const q=qs.splice(n(qs.length),1)[0];put('resolve',{flight:'q:'+q,value:n(3)})}
   else if(r<95)probe('L',rd('L'),risky?['read']:pick([['read'],['read','latest','pending']]));
   else put('drain');
  }
  for(const flight of open)put('resolve',{flight,value:1});
  if(asyncRow)for(const q of qs)put('resolve',{flight:'q:'+q,value:1});
  put('flush');probe('L',rd('L'));
 }

 // ---- list-store ----
 function storeEdit(model,row,exact){const L=model.list,r=exact?n(100):pick([25,35,82,90,97]),one=ed=>{applyEdit(model,ed);return {edits:[ed]}};
  if(r<20&&L.length)return one({path:['list',n(L.length),pick(['a','t'])],set:n(9)});
  if(r<30)return one({path:['list',{key:'id',is:L.length&&n(5)?pick(L).id:99},'a'],set:n(4)});
  if(r<40)return one({path:['list'],push:lit(row())});
  if(r<50&&L.length>1)return one({path:['list'],remove:n(L.length)});
  if(r<60)return one({path:['list'],insert:[n(L.length+1),lit(row())]});
  if(r<70&&L.length>1)return one({path:['list'],move:[n(L.length),n(L.length)]});
  if(r<80&&L.length){const i=n(L.length),v=n(2)?{...row(),id:L[i].id}:row();return one({path:['list',i],set:lit(v)})}
  if(r<88){const x=n(4);model.list=model.list.filter(q=>q.a!==x);
   return {returns:obj({list:filter(get(draft,'list'),not(eq(ef('a'),x)))})}}
  if(r<96){const v=clone(L);for(const q of v)if(n(3)===0)q.a=n(4);
   if(v.length>1&&n(2)){const i=n(v.length),j=n(v.length);[v[i],v[j]]=[v[j],v[i]]}
   if(v.length>1&&n(3)===0)v.splice(n(v.length),1);if(n(3)===0)v.push(row());
   model.list=clone(v);return {reconcile:{list:v},key:n(10)<7?'id':null}}
  return one({path:['list',{key:'id',is:L.length?pick(L).id:99},'t'],set:n(9)});
 }
 function listStore(){
  let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(10)});
  if(n(10)===0)return shallowRoot(row);
  const model={list:Array.from({length:n(6)},row)},shallow=n(10)===0;
  put('store',{id:'st',value:clone(model),...(shallow?{shallow:true}:{})});
  const L=get(st('st'),'list'),keyed=pick([true,true,'id','id',false]),idx=n(2)===0;
  put('list',{id:'L',each:L,keyed,index:idx,fallback:fallbackSpec(),row:objRow(idx)});
  put('effect',{id:'top',render:true,expr:rd('L')});
  if(n(2))put('memo',{id:'cnt',expr:count(L,eq(ef('a'),0),n(4)===0)});
  if(n(2))put('effect',{id:'side',expr:plain(L,['id','a'])});
  put('flush');
  const open=[];let actions=0;
  const steps=10+n(9);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<60){put('store_set',{id:'st',...storeEdit(model,row,!actions)});if(n(10)<7)put('flush')}
   else if(r<72&&open.length<3){const flight='f'+actions,K=model.list.length?pick(model.list).id:99,q=n(4);
    const ed=q===0?{path:['list',{key:'id',is:K},'a'],set:9}:q===1?{path:['list'],removeKey:{key:'id',is:K}}:q===2?{path:['list'],push:lit(row())}:{path:['list'],moveKey:{key:'id',is:K,to:pick([0,-1])}};
    put('action',{id:'a'+actions++,slices:[{steps:[{store:'st',edits:[ed]}],flight},{steps:n(2)?[{store:'st',edits:[{path:['list',{key:'id',is:K},'t'],set:sent}]}]:[]}]});open.push(flight);if(n(2))put('flush')}
   else if(r<82&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(5)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:n(8)})}
   else if(r<92)probe('L',pick([rd('L'),plain(L,['id','a'])]));
   else put(pick(['flush','drain']));
  }
  for(const flight of open)put('resolve',{flight,value:1});
  put('flush');probe('L',rd('L'));probe('rows',plain(L,['id','a','t']));
 }

 // A shallow store whose root is the row array: the list diffs its backing (map.ts shallowView).
 function shallowRoot(row){
  const m=Array.from({length:1+n(5)},row);
  put('store',{id:'st',value:clone(m),shallow:true});
  const keyed=pick([true,'id',false]),idx=n(2)===0;
  put('list',{id:'L',each:st('st'),keyed,index:idx,row:objRow(idx)});
  put('effect',{id:'top',render:true,expr:rd('L')});put('flush');
  const steps=8+n(8);
  for(let s=0;s<steps;s++){const r=n(10);
   if(r<3){const x=row();m.push(x);put('store_set',{id:'st',edits:[{path:[],push:lit(clone(x))}]})}
   else if(r<5&&m.length>1){const i=n(m.length);m.splice(i,1);put('store_set',{id:'st',edits:[{path:[],remove:i}]})}
   else if(r<7&&m.length){const i=n(m.length),x={...row(),id:m[i].id};m[i]=x;put('store_set',{id:'st',edits:[{path:[i],set:lit(clone(x))}]})}
   else if(r<8&&m.length>1){const i=n(m.length),j=n(m.length),[x]=m.splice(i,1);m.splice(j,0,x);put('store_set',{id:'st',edits:[{path:[],move:[i,j]}]})}
   else if(r<9&&m.length){const i=n(m.length),v=n(9);m[i].a=v;put('store_set',{id:'st',edits:[{path:[i,'a'],set:v}]})}
   else probe('L',rd('L'));
   if(n(10)<8)put('flush')}
  put('flush');probe('L',rd('L'));
 }

 // ---- list-lanes: a list over an optimistic memo ----
 function listLanes(){
  const ints=n(10)<4,R=3+n(3);let nextId=R+1;
  const owned=n(2)===0,disposeAt=owned&&n(100)<8?n(8):-1;
  if(owned)put('owner',{id:'lo'});
  put('signal',{id:'status',value:0});
  let shown,keyed,idx=n(2)===0,guess,truth;
  if(ints){
   put('signal',{id:'xs',value:Array.from({length:R},()=>n(6))});
   put('memo',{id:'shown',optimistic:true,expr:rd('xs')});
   keyed=keying({expr:mod(elem,3)});
   guess=()=>{const r=n(5),v=n(6);return r===0?concat([arr([v]),arg]):r===1?filter(arg,not(eq(elem,v))):r===2?reverse(arg):r===3?concat([arg,arr([v])]):replace(arg,eq(elem,v),add(elem,1))};
   truth=()=>n(2)?[{write:'xs',value:Array.from({length:1+n(5)},()=>n(6))}]:[];
  }else{
   put('store',{id:'st',value:{list:Array.from({length:R},(_,i)=>({id:i+1,a:n(3)?0:5,t:n(10)}))}});
   const L=get(st('st'),'list');
   put('memo',{id:'shown',optimistic:true,expr:L});
   keyed=pick([true,true,'id',false]);
   guess=K=>{const r=n(6);return r===0?replace(arg,eq(ef('id'),K),obj({id:K,t:ef('t'),a:9}),n(3)===0)
    :r===1?filter(arg,not(eq(ef('id'),K)),n(3)===0):r===2?concat([filter(arg,eq(ef('id'),K)),filter(arg,not(eq(ef('id'),K)))])
    :r===3?reverse(arg):r===4?concat([arg,arr([lit({id:nextId++,a:9,t:n(10)})])]):concat([arr([lit({id:nextId++,a:9,t:n(10)})]),arg])};
   truth=K=>{const r=n(4);return r===0?[{store:'st',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]}]:r===1?[{store:'st',edits:[{path:['list'],removeKey:{key:'id',is:K}}]}]
    :r===2?[{store:'st',edits:[{path:['list'],push:lit({id:nextId++,a:0,t:n(10)})}]}]:[]};
  }
  put('list',{id:'L',each:rd('shown'),keyed,index:idx,fallback:fallbackSpec(),row:ints?intRow(idx):objRow(idx),...(owned?{owner:'lo'}:{})});
  put('effect',{id:'top',render:true,expr:rd('L'),...(owned?{owner:'lo'}:{})});
  put('effect',{id:'head',render:true,expr:arr([len(rd('shown')),rd('status')])});
  put('flush');
  const open=[],claims={};let actions=0,disposed=false;
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100);
   if(s===disposeAt&&open.length){put('dispose',{owner:'lo'});disposed=true;continue}
   if(r<35&&open.length<4){const K=1+n(R),c=claims[K]=(claims[K]??0)+1,flight='claim:'+K+'#'+c;
    const first=[{update:'shown',expr:guess(K)}];if(n(4)===0)first.push({update:'shown',expr:guess(1+n(R))});
    put('action',{id:'c'+actions++,slices:[{steps:first,flight},{steps:[...truth(K),{write:'status',value:0}]}],catch:{steps:[{write:'status',value:K}]}});
    open.push(flight);if(n(3)<2)put('flush')}
   else if(r<65&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(4)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<75){if(ints)put('write',{id:'xs',value:Array.from({length:n(6)},()=>n(6))});else put('store_set',{id:'st',edits:[{path:['list',{key:'id',is:1+n(R)},'t'],set:n(9)}]});if(n(2))put('flush')}
   else if(r<87&&!disposed)probe('L',rd('L'),pick([['read'],['read','latest','pending']]));
   else if(r<93)probe('shown',ints?rd('shown'):plain(rd('shown'),['id','a']),['read','latest']);
   else put(pick(['flush','drain']));
  }
  for(const flight of open)put('resolve',{flight,value:7});
  put('flush');if(!disposed)probe('L',rd('L'));probe('shown',ints?rd('shown'):plain(rd('shown'),['id','a','t']),['read','latest']);
 }

 // ---- list-opt-store: an optimistic store's rows moved/removed under pending actions ----
 function listOptStore(){
  const R=3+n(4);let nextId=R+1;const keyedStore=n(4)!==0;
  put('store',{id:'os',optimistic:true,value:{list:Array.from({length:R},(_,i)=>({id:i+1,a:n(2)?0:5,t:n(10)}))},...(keyedStore?{}:{key:null})});
  put('signal',{id:'status',value:0});
  const L=get(st('os'),'list'),keyed=pick([true,true,'id','id',false]),idx=n(2)===0;
  put('list',{id:'L',each:L,keyed,index:idx,fallback:fallbackSpec(),row:objRow(idx,['id','a','t'])});
  put('effect',{id:'top',render:true,expr:rd('L')});
  put('effect',{id:'head',render:true,expr:arr([len(L),rd('status')])});
  if(n(2))put('effect',{id:'side',expr:plain(L,['id','a'])});
  put('flush');
  const ids=()=>1+n(nextId-1);
  const guess=K=>{const r=n(100);
   if(r<30)return {store:'os',edits:[{path:['list'],moveKey:{key:'id',is:K,to:pick([0,-1])}}]};
   if(r<55)return {store:'os',edits:[{path:['list'],removeKey:{key:'id',is:K}}]};
   if(r<68)return {store:'os',edits:[{path:['list'],push:lit({id:nextId++,a:9,t:n(10)})}]};
   if(r<88)return {store:'os',edits:[{path:['list',{key:'id',is:K},'a'],set:9}]};
   if(r<94)return {store:'os',edits:[{path:['list'],moveKey:{key:'id',is:K,to:0}},{path:['list',{key:'id',is:K},'a'],set:9}]};
   return {store:'os',returns:obj({list:reverse(get(draft,'list'))})}};
  const truth=K=>{const r=n(5);return r===0?[{store:'os',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]}]:r===1?[{store:'os',edits:[{path:['list'],removeKey:{key:'id',is:K}}]}]
   :r===2?[{store:'os',edits:[{path:['list'],moveKey:{key:'id',is:K,to:pick([0,-1])}}]}]:[]};
  const open=[],claims={};let actions=0;
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<38&&open.length<4){const K=open.length&&n(3)===0?open[n(open.length)].K:ids(),c=claims[K]=(claims[K]??0)+1,flight='claim:'+K+'#'+c;
    const first=[guess(K)];if(n(5)===0)first.push(guess(ids()));
    put('action',{id:'c'+actions++,slices:[{steps:first,flight},{steps:[...truth(K),{write:'status',value:0}]}],catch:{steps:[{write:'status',value:K}]}});
    open.push({K,flight});if(n(3)===0)put('flush')}
   else if(r<66&&open.length){const {flight}=open.splice(n(open.length),1)[0];if(n(4)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<76){const K=ids();put('store_set',{id:'os',edits:[n(3)?{path:['list',{key:'id',is:K},'t'],set:n(9)}:{path:['list'],moveKey:{key:'id',is:K,to:pick([0,-1])}}]});if(n(2))put('flush')}
   else if(r<88)probe('L',pick([rd('L'),plain(L,['id','a'])]),pick([['read'],['read','latest','pending']]));
   else put(pick(['flush','drain']));
  }
  for(const {flight} of open)put('resolve',{flight,value:7});
  put('flush');probe('L',rd('L'));probe('rows',plain(L,['id','a','t']),['read','latest']);
 }

 // ---- list-show: Show and children in computations under holds and lanes ----
 function listShow(){
  let xs=Array.from({length:n(5)},()=>n(6));
  put('signal',{id:'xs',value:clone(xs)});put('signal',{id:'f',value:n(2)});put('signal',{id:'of',value:n(2),optimistic:true});put('signal',{id:'s',value:n(4)});
  // 30%: an async memo over flights q:<s mod 3> (resolved, never rejected) read in the branch,
  // in a child pass and (a third of those) in the condition: frames over pending work.
  const async=n(10)<3;if(async)put('memo',{id:'am',expr:mod(rd('s'),3),flight:'q'});
  // 50%: Show, the children-building memos and their readers live under owner `so`, which
  // is disposed mid-action in a fifth of those (a parked frame dies with its owner).
  const so=n(2)===0,own=so?{owner:'so'}:{};if(so)put('owner',{id:'so'});
  const when=async&&n(3)===0?add(rd('f'),rd('am')):pick([len(rd('xs')),rd('f'),rd('of'),choose(eq(rd('f'),0),len(rd('xs')),0),add(rd('f'),rd('of'))]);
  const fn=n(5)===0,keyedShow=n(5)===0;
  const keyed=keying({expr:mod(elem,3)}),idx=n(2)===0;
  const yes=[{list:{id:'L',lazy:true,each:rd('xs'),keyed,index:idx,fallback:n(3)===0,row:intRow(idx,[rd('s')])}}];
  // A function child's accessor is read from a user effect only: a read after unmount throws.
  if(n(2))yes.unshift({effect:'y',render:!fn,expr:fn?item():arr([rd('f'),rd('s')])});
  if(n(3)===0)yes.unshift({memo:'ym',expr:add(rd('s'),1)},{effect:'yv',render:true,expr:local('ym')});
  if(n(3)===0)yes.push({cleanup:'yc'});
  if(async)yes.push({effect:'ya',render:n(2)===0,expr:arr([rd('am'),rd('f')])});
  const no=n(4)?[{effect:'fb',render:true,expr:rd('s')}]:[];if(n(3)===0)no.push({cleanup:'nc'});
  put('show',{id:'B',when,yes,no,...(fn?{fn:true}:{}),...(keyedShow?{keyed:true}:{}),...own});
  put('effect',{id:'body',render:true,expr:call(rd('B')),...own});
  // memos (and an effect) whose passes build children
  const mkids=()=>{const k=[async&&n(2)?{effect:'c0',render:n(2)===0,expr:arr([rd('am'),rd('s')])}:{effect:'c0',render:n(2)===0,expr:pick([rd('xs'),rd('s'),add(rd('s'),rd('f'))])}];
   if(n(2))k.push({memo:'cm',expr:add(rd('s'),rd('of'))},{effect:'cv',render:true,expr:local('cm')});
   if(n(3)===0)k.push({list:{id:'CL',each:rd('xs'),keyed:true,index:false,row:[{effect:'r',render:true,expr:item()}]}});
   if(n(2))k.push({cleanup:'c1'});return k};
  put('memo',{id:'m',expr:pick([rd('f'),add(rd('f'),rd('of')),len(rd('xs'))]),children:mkids(),cleanup:'c',...own});
  put('effect',{id:'me',render:true,expr:rd('m'),...own});
  if(n(10)<3)put('effect',{id:'ec',expr:add(rd('s'),rd('f')),children:mkids(),cleanup:'c',...own});
  if(n(2))put('memo',{id:'m2',optimistic:n(2)===0,expr:rd('of'),children:[{effect:'d0',render:true,expr:rd('s')}],cleanup:'c'});
  put('flush');
  const open=[];let actions=0,disposed=false,qs=async?[0,1,2]:[];
  const disposeAt=so&&n(5)===0?3+n(8):-1;
  const steps=10+n(9);
  for(let s=0;s<steps;s++){const r=n(100);
   if(s===disposeAt&&open.length){put('dispose',{owner:'so'});disposed=true;if(n(2))put('flush');continue}
   if(qs.length&&n(8)===0){put('resolve',{flight:'q:'+qs.splice(n(qs.length),1)[0],value:n(3)});continue}
   if(r<25){const w=n(4);if(w===0){xs=intEdit(xs);put('write',{id:'xs',value:clone(xs)})}else if(w===1)put('write',{id:'f',value:n(2)});else if(w===2)put('write',{id:'s',value:n(5)});else{xs=n(2)?[]:intEdit(xs);put('write',{id:'xs',value:clone(xs)});put('write',{id:'f',value:n(2)})}
    if(n(10)<7)put('flush')}
   else if(r<55&&open.length<3){const flight='f'+actions,sl=()=>{const out=[];const k=1+n(2);for(let i=0;i<k;i++){const q=n(5);
      out.push(q===0?{write:'f',value:n(2)}:q===1?{write:'of',value:n(2)}:q===2?{write:'s',value:n(5)}:q===3?{write:'xs',value:clone(xs=intEdit(xs))}:{write:'of',value:1-n(2)})}return out};
    put('action',{id:'a'+actions++,slices:[{steps:sl(),flight},{steps:n(2)?sl():[]}]});open.push(flight);if(n(3)<2)put('flush')}
   else if(r<75&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(5)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:n(4)})}
   else if(r<87)probe('p',disposed?rd('xs'):pick([call(rd('B')),rd('m'),rd('xs')]),async?['read']:pick([['read'],['read','latest','pending']]));
   else put(pick(['flush','drain']));
  }
  for(const flight of open)put('resolve',{flight,value:1});
  for(const q of qs)put('resolve',{flight:'q:'+q,value:1});
  put('flush');if(!disposed){probe('B',call(rd('B')));probe('m',rd('m'))}
 }

 // ---- list-nested ----
 function listNested(){
  let nextId=1;const row=()=>({id:nextId++,a:n(4),tags:Array.from({length:n(4)},()=>n(5))});
  const model={list:Array.from({length:1+n(4)},row)};
  put('store',{id:'st',value:clone(model)});
  const L=get(st('st'),'list'),okeyed=pick([true,'id',false]),ikeyed=keying({expr:mod(elem,2)}),iidx=n(2)===0;
  const inner={id:'T',each:get(item(),'tags'),keyed:ikeyed,index:iidx,fallback:n(3)===0,
   row:[{effect:'e',render:true,expr:arr([item(),get(item(1),'a')])},...(iidx?[{effect:'i',render:true,expr:arr([index(),get(item(1),'id')])}]:[]),...(n(3)===0?[{cleanup:'c'}]:[])]};
  put('list',{id:'L',each:L,keyed:okeyed,index:n(2)===0,row:[{effect:'h',render:true,expr:get(item(),'a')},{list:inner},{effect:'tv',render:true,expr:local('T')}]});
  put('effect',{id:'top',render:true,expr:rd('L')});
  put('flush');
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100),Ls=model.list;
   if(r<20&&Ls.length){const i=n(Ls.length),v=n(5);Ls[i].tags.push(v);put('store_set',{id:'st',edits:[{path:['list',i,'tags'],push:v}]})}
   else if(r<32&&Ls.length&&Ls.some(x=>x.tags.length)){const i=Ls.findIndex(x=>x.tags.length);const j=n(Ls[i].tags.length);Ls[i].tags.splice(j,1);put('store_set',{id:'st',edits:[{path:['list',i,'tags'],remove:j}]})}
   else if(r<42&&Ls.length&&Ls.some(x=>x.tags.length>1)){const i=Ls.findIndex(x=>x.tags.length>1),tg=Ls[i].tags,a=n(tg.length),b=n(tg.length);const [x]=tg.splice(a,1);tg.splice(b,0,x);put('store_set',{id:'st',edits:[{path:['list',i,'tags'],move:[a,b]}]})}
   else if(r<52&&Ls.length&&Ls.some(x=>x.tags.length)){const i=Ls.findIndex(x=>x.tags.length),j=n(Ls[i].tags.length),v=n(5);Ls[i].tags[j]=v;put('store_set',{id:'st',edits:[{path:['list',i,'tags',j],set:v}]})}
   else if(r<60&&Ls.length){const i=n(Ls.length),v=n(5);Ls[i].a=v;put('store_set',{id:'st',edits:[{path:['list',i,'a'],set:v}]})}
   else if(r<68){const x=row();Ls.splice(0,0,x);put('store_set',{id:'st',edits:[{path:['list'],insert:[0,lit(clone(x))]}]})}
   else if(r<74&&Ls.length>1){const i=n(Ls.length);Ls.splice(i,1);put('store_set',{id:'st',edits:[{path:['list'],remove:i}]})}
   else if(r<80&&Ls.length){const i=n(Ls.length),v={...row(),id:Ls[i].id};Ls[i]=v;put('store_set',{id:'st',edits:[{path:['list',i],set:lit(clone(v))}]})}
   else if(r<86&&Ls.length){const i=n(Ls.length),v=Array.from({length:n(4)},()=>n(5));Ls[i].tags=v;put('store_set',{id:'st',edits:[{path:['list',i,'tags'],set:lit(clone(v))}]})}
   else if(r<94)probe('L',pick([rd('L'),plain(L,['id','a','tags'])]));
   else put('drain');
   if(n(10)<7)put('flush');
  }
  put('flush');probe('L',rd('L'));probe('rows',plain(L,['id','a','tags']));
 }

 // ---- list-bulk: windows over 64 items ----
 function listBulk(){
  const N=66+n(35);let fresh=1000;let xs=Array.from({length:N},(_,i)=>i+1);
  put('signal',{id:'xs',value:clone(xs)});
  put('list',{id:'L',each:rd('xs'),keyed:true,index:false,row:[]});
  put('effect',{id:'top',render:n(2)===0,expr:len(rd('L'))});
  if(n(2))put('effect',{id:'all',expr:rd('L')});
  put('flush');
  const steps=8+n(8);
  for(let s=0;s<steps;s++){const r=n(100),a=xs.slice();
   if(r<18){const k=1+n(Math.min(32,a.length-1));if(n(2))a.push(...a.splice(0,k));else a.unshift(...a.splice(a.length-k,k))}
   else if(r<32){const i=n(a.length),j=Math.min(a.length-1,Math.max(0,i+(n(2)?1:-1)*(1+n(n(4)?32:a.length))));[a[i],a[j]]=[a[j],a[i]]}
   else if(r<46){const i=n(a.length),[x]=a.splice(i,1);a.splice(Math.min(a.length,Math.max(0,i+(n(2)?1:-1)*(1+n(32)))),0,x)}
   else if(r<60){const k=1+n(5);for(let t=0;t<k&&a.length>66;t++)a.splice(n(a.length),1)}
   else if(r<68){for(let i=0;i<a.length;i++)a[i]=fresh++}
   else if(r<76){const i=n(a.length-2),j=Math.min(a.length-1,i+1+n(8));a[j]=a[i];const x=a.shift();a.push(x)}
   else if(r<84){const k=1+n(3);for(let t=0;t<k;t++)a.splice(n(a.length+1),0,fresh++)}
   else if(r<90){const i=n(a.length-1);[a[i],a[i+1]]=[a[i+1],a[i]];a.splice(n(a.length),1)}
   else{a.reverse()}
   xs=a;put('write',{id:'xs',value:clone(xs)});if(n(10)<8)put('flush');
   if(n(10)<2)probe('L',len(rd('L')));
  }
  put('flush');probe('L',rd('L'));
 }

 // ---- tracker: tracker.tsx with Show + For ----
 function tracker(){
  const R=3+n(3),NATIVE=n(2)===0;
  const rows=Array.from({length:R},(_,i)=>({id:i+1,t:i+1,a:n(3)?0:6}));
  trackerSetupC(put,rows,NATIVE,n(4)===0);
  const open=[],claims={};let actions=0;
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<40&&open.length<4){const K=1+n(R),c=claims[K]=(claims[K]??0)+1,flight='assign:'+K+'#'+c;put('action',trackerClaim('claim'+actions++,K,flight,NATIVE));open.push(flight);if(n(2))put('drain')}
   else if(r<50){put('write',{id:'mode',value:n(2)});put('flush')}
   else if(r<80&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(4)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<90){const e=pick([plain(rd('shown'),['id','a']),call(rd('B')),rd('unassigned'),len(rd('visible'))]);probe('p',e,n(2)?['read','latest','pending']:['read'])}
   else if(r<95)put('drain');
   else put('flush');
  }
  for(const flight of open)put('resolve',{flight,value:7});
  put('drain');probe('rows',plain(rd('shown'),['id','t','a']),['read','latest']);probe('body',call(rd('B')));
 }
}

// The model of a plain store's edits: the same shift semantics as fuzz/solid.mjs `edit`.
function applyEdit(m,ed){const p=ed.path,isArrOp=!('set'in ed||ed.del);let t=m;
 const seg=s=>{if(typeof s!=='object')return s;const i=t.findIndex(r=>r!=null&&r[s.key]===s.is);if(i<0)throw 'miss';return i};
 try{for(let i=0;i<p.length-(isArrOp?0:1);i++)t=t[seg(p[i])];
  if(!isArrOp){const k=seg(p[p.length-1]);if(ed.del)delete t[k];else t[k]=clone(ed.set.value??ed.set);return}
  if('push'in ed)t.push(clone(ed.push.value));
  else if('insert'in ed)t.splice(ed.insert[0],0,clone(ed.insert[1].value));
  else if('remove'in ed)t.splice(ed.remove,1);
  else if('removeKey'in ed){const i=t.findIndex(r=>r!=null&&r[ed.removeKey.key]===ed.removeKey.is);if(i>=0)t.splice(i,1)}
  else if('move'in ed){const [i,j]=ed.move,[x]=t.splice(i,1);t.splice(j,0,x)}
 }catch(e){if(e!=='miss')throw e}}

// tracker.tsx: the header's two text inserts (mode, open count), the Show insert (a render
// effect calling the Show accessor, which hands out the For's list accessor) and the status
// insert. Show: when = visible().length > 0 (a 1/0 here; 25% the raw length), element
// children = <For each={visible()}> (identity keyed, arity 1) whose rows are IssueRow's two
// text inserts (title, assignee); the fallback is static text (no reactive node).
function trackerSetupC(put,rows,NATIVE,rawLen){
 put('store',{id:'issues',value:{list:rows}});
 const L=get(st('issues'),'list'),open=eq(ef('a'),0);
 put('memo',{id:'shown',optimistic:true,expr:L});
 put('signal',{id:'mode',value:0});put('signal',{id:'status',value:0});
 put('memo',{id:'visible',expr:filter(rd('shown'),choose(eq(rd('mode'),0),1,open),NATIVE)});
 put('memo',{id:'unassigned',expr:count(rd('shown'),open,NATIVE)});
 put('effect',{id:'hm',render:true,expr:rd('mode')});
 put('effect',{id:'hu',render:true,expr:rd('unassigned')});
 put('show',{id:'B',when:rawLen?len(rd('visible')):choose(len(rd('visible')),1,0),
  yes:[{list:{id:'L',lazy:true,each:rd('visible'),keyed:true,index:false,
   row:[{effect:'t',render:true,expr:get(item(),'t')},{effect:'a',render:true,expr:get(item(),'a')}]}}],no:[]});
 put('effect',{id:'body',render:true,expr:call(rd('B'))});
 put('effect',{id:'foot',render:true,expr:rd('status')});
 put('flush');
}
export function trackerClaim(id,K,flight,NATIVE){
 return {id,slices:[
  {steps:[{update:'shown',expr:replace(arg,eq(ef('id'),K),obj({id:K,t:ef('t'),a:9}),NATIVE)}],flight},
  {steps:[{store:'issues',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]},{write:'status',value:0}]}],
  catch:{steps:[{write:'status',value:K}]}};
}

// The demo SCRIPT of frontend/tsx/demo.test.ts as one fixed program, with Show + For.
// Returns {ops, frames}: frames[i] is the op index after which frame i is taken
// (docs/slice2c-fuzz/tools/tracker-demo.mjs). A structural sanity check, not a parity score.
export function trackerDemoC(){
 const ops=[],put=(op,rest={})=>ops.push({op,...rest}),frames=[];
 trackerSetupC(put,[{id:1,t:1,a:0},{id:2,t:2,a:6},{id:3,t:3,a:0}],true,false);frames.push(ops.length-1);
 const step=f=>{f();put('drain');frames.push(ops.length-1)};
 step(()=>put('action',trackerClaim('claim1',1,'assign:1#1',true)));
 step(()=>put('resolve',{flight:'assign:1#1',value:7}));
 step(()=>put('action',trackerClaim('claim2',2,'assign:2#1',true)));
 step(()=>put('reject',{flight:'assign:2#1',message:'offline'}));
 step(()=>put('write',{id:'mode',value:1}));
 step(()=>put('action',trackerClaim('claim3',3,'assign:3#1',true)));
 step(()=>put('resolve',{flight:'assign:3#1',value:7}));
 return {ops,frames};
}
