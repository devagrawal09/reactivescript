// Slice 2b (tier B of docs/SLICE2B-DESIGN.md): stores and per-row optimistic writes on the
// slice-1 driver. Same Mulberry32 RNG, worker oracle (strict 'slice2b') and exact full-trace
// comparator as the other generators. Ops and expressions are those of docs/SLICE2B-DESIGN.md
// sec. 2-3 as implemented in fuzz/solid.mjs (lists, Show and memo children are tier C and
// never generated here).
//
// Families (deterministic weighted choice, family = W[seed mod |W|], no RNG):
// - store-plain (3): one plain store {list:[rows], n}; memos/effects over paths, counts and
//   plain() copies; top-level edits (leaf, keyed row field, push/insert/remove/move, delete,
//   row replacement, setter-returned replacement, reconcile by id or by position). A model
//   of the store keeps every index path in range.
// - store-actions (3): store-plain's store plus signal s and optimistic signal o; up to
//   three overlapping actions whose slices mix keyed store edits and writes (slice 2 may
//   write the yielded value); read/latest/pending over store expressions.
// - opt-memo-rows (4): an optimistic memo `shown` over the store's list (30%: a replace
//   that also reads an optimistic signal o2 other actions guess); per-row claims guess a
//   row through an updater, yield claim:K#c, then write the answer into the store row;
//   same-row double claims, mode writes mid-action, random resolve/reject order.
// - opt-store-rows (4): createOptimisticStore({list}) keyed by id (75%) or positional;
//   claims guess a row field, push a row or remove a row by key; slice 2 writes truth into
//   a separate plain store or into the optimistic store; latest/pending on row fields.
// - opt-store-derived (3): a derived optimistic store over flight list:<page>#<n> (seed [],
//   key id or null, optional seedLoadingValue); toggles guess a row field, yield
//   save:K#c and refresh the store; the server model answers with echo, correction,
//   reorder, added or dropped rows; page writes ask new questions; drain ops.
// - store-provenance (3): the derived store with two or three actions on the SAME row, each
//   refreshing; list answers resolve newest-first so older answers land under newer
//   guesses; mainline writes in between. With opt-store-derived this is how take / revert /
//   rebase and per-row provenance are reached.
// - tracker (4): frontend/tsx/fixtures/demo/tracker.tsx without Show/For (tier C): issues
//   store, optimistic `shown`, visible/unassigned filters (native or loop), render effects
//   for header, rows (plain copy of visible) and status, and claim actions shaped like the
//   demo's (updater guess, yield assign:K#c, store path write of the yielded owner, catch
//   writes status). Ints stand for strings: assignee ''=0, 'me'=9, owners 6-8.
//
// Rejections and render effects: an error reaching a render effect halts rc.21. Only
// derived stores can error here (a rejected list flight), and programs that may reject one
// read the store from user effects only.
const FAMILIES=[['store-plain',3],['store-actions',3],['opt-memo-rows',4],['opt-store-rows',4],['opt-store-derived',3],['store-provenance',3],['tracker',4]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const slice2bFamily=seed=>W[(seed>>>0)%W.length];

// Expression builders (docs/SLICE2B-DESIGN.md sec. 2).
const st=id=>({op:'store',id}),get=(of,key)=>({op:'get',of,key}),rd=id=>({op:'read',id}),len=of=>({op:'len',of});
const eq=(a,b)=>({op:'eq',a,b}),not=a=>({op:'not',a}),elem={op:'elem'},arg={op:'arg'},sent={op:'sent'},draft={op:'draft'};
const nat=(o,native)=>native?{...o,native:true}:o;
const filter=(of,where,native)=>nat({op:'filter',of,where},native),count=(of,where,native)=>nat({op:'count',of,where},native);
const find=(of,where,native)=>nat({op:'find',of,where},native),replace=(of,where,w,native)=>nat({op:'replace',of,where,with:w},native);
const obj=fields=>({op:'obj',fields}),arr=items=>({op:'arr',items}),lit=value=>({op:'lit',value}),plain=(of,fields)=>({op:'plain',of,fields});
const has=(of,key)=>({op:'has',of,key}),choose=(test,yes,no)=>({op:'choose',test,yes,no}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const ef=f=>get(elem,f);
const clone=v=>JSON.parse(JSON.stringify(v));

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

export function generateSlice2b(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 const probe=(label,expr,kinds=['read','latest','pending'])=>{for(const k of kinds)put(k,{label,expr})};
 const family=slice2bFamily(seed);
 const gens={'store-plain':storePlain,'store-actions':storeActions,'opt-memo-rows':optMemoRows,'opt-store-rows':optStoreRows,'opt-store-derived':()=>derived(false),'store-provenance':()=>derived(true),'tracker':tracker};
 gens[family]();
 return ops;

 // ---- plain store with a model ----
 function storePlain(){
  let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(10)});
  const model={list:Array.from({length:2+n(4)},row),n:n(5)};
  put('store',{id:'st',value:clone(model)});
  const L=get(st('st'),'list'),native=n(5)===0;
  put('memo',{id:'mn',expr:get(st('st'),'n')});
  put('memo',{id:'ml',expr:len(L)});
  put('memo',{id:'mc',expr:count(L,eq(ef('a'),0),native)});
  put('memo',{id:'mr',expr:get(get(L,n(4)),'a')});
  if(n(2))put('memo',{id:'mf',expr:find(L,eq(ef('id'),1+n(5)),native)});
  if(n(3)===0)put('memo',{id:'mh',expr:arr([has(get(L,0),'t'),has(st('st'),'n')])});
  put('effect',{id:'e1',render:true,expr:arr([rd('mn'),rd('ml'),rd('mc')])});
  put('effect',{id:'e2',render:true,expr:plain(L,['id','a'])});
  put('effect',{id:'e3',expr:n(2)?plain(get(L,n(3)),['id','a','t']):arr([rd('mr'),get(st('st'),'n')])});
  put('flush');
  const steps=12+n(7);
  for(let s=0;s<steps;s++){
   const batch=n(10)<3?2+n(2):1,merge=n(2);let edits=[];
   for(let b=0;b<batch;b++){const e=plainEdit(model,row);if(!e)continue;
    if(e.edits){if(merge&&!e.edits[0].returns)edits.push(...e.edits);else{if(edits.length){put('store_set',{id:'st',edits});edits=[]}put('store_set',{id:'st',...e.op})}}
   }
   if(edits.length)put('store_set',{id:'st',edits});
   if(n(10)<7)put('flush');
   const r=n(20);
   if(r<4)probe('rows',plain(L,['id','a','t']),['read']);
   else if(r<5)probe('n',get(st('st'),'n'));
   else if(r<6)probe('has',arr([has(get(L,n(3)),'t'),has(st('st'),'n')]),['read']);
  }
  put('flush');probe('rows',plain(L,['id','a','t']),['read']);probe('len',len(L),['read','latest','pending']);
 }
 // One random edit of the plain store, applied to the model. Returns {edits:[edit], op}
 // where op is the store_set body to use alone (returns/reconcile cannot merge).
 function plainEdit(model,row){
  const L=model.list,r=n(100),one=ed=>{applyEdit(model,ed);return {edits:[ed],op:{edits:[ed]}}};
  if(r<20)return one({path:['n'],set:n(9)});
  if(r<34&&L.length)return one({path:['list',n(L.length),pick(['a','t'])],set:n(9)});
  if(r<42)return one({path:['list',{key:'id',is:n(5)===0?99:(L.length?pick(L).id:99)},'a'],set:n(4)});
  if(r<52)return one({path:['list'],push:lit(row())});
  if(r<58&&L.length>1)return one({path:['list'],remove:n(L.length)});
  if(r<64)return one({path:['list'],insert:[n(L.length+1),lit(row())]});
  if(r<70&&L.length>1)return one({path:['list'],move:[n(L.length),n(L.length)]});
  if(r<75)return n(2)&&L.length?one({path:['list',n(L.length),'t'],del:true}):one({path:['n'],del:true});
  if(r<83&&L.length){const i=n(L.length),v=n(2)?{...row(),id:L[i].id}:row();return one({path:['list',i],set:lit(v)})}
  if(r<90){const x=n(4);model.list=model.list.filter(q=>q.a!==x);
   return {edits:[{returns:true}],op:{returns:obj({list:filter(get(draft,'list'),not(eq(ef('a'),x))),n:get(draft,'n')})}}}
  if(r<95){const v={list:clone(L),n:n(9)};
   for(const q of v.list)if(n(3)===0)q.a=n(4);
   if(v.list.length>1&&n(2)){const i=n(v.list.length),j=n(v.list.length);[v.list[i],v.list[j]]=[v.list[j],v.list[i]]}
   if(v.list.length>1&&n(3)===0)v.list.splice(n(v.list.length),1);
   if(n(3)===0)v.list.push(row());
   model.list=clone(v.list);model.n=v.n;
   return {edits:[{returns:true}],op:{reconcile:v,key:n(10)<7?'id':null}}}
  return one({path:['n'],set:n(9)});
 }

 // ---- plain store inside actions ----
 function storeActions(){
  let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(10)});
  const rows=Array.from({length:2+n(3)},row);
  put('signal',{id:'s',value:n(4)});put('signal',{id:'o',value:n(4),optimistic:true});
  put('store',{id:'st',value:{list:rows,n:n(5)}});
  const L=get(st('st'),'list'),native=n(5)===0;
  put('memo',{id:'ml',expr:len(L)});
  put('memo',{id:'mc',expr:count(L,eq(ef('a'),0),native)});
  put('effect',{id:'v1',render:true,expr:arr([rd('s'),rd('o'),rd('ml')])});
  put('effect',{id:'v2',render:true,expr:plain(L,['id','a'])});
  put('effect',{id:'w1',expr:arr([get(st('st'),'n'),rd('mc')])});
  put('flush');
  const ids=()=>n(6)===0?99:1+n(nextId-1);
  const storeEdit=(yielded)=>{const r=n(10);
   if(r<4)return {path:['list',{key:'id',is:ids()},'a'],set:yielded&&n(2)?sent:n(5)};
   if(r<6)return {path:['n'],set:yielded&&n(2)?sent:n(9)};
   if(r<8)return {path:['list'],push:lit(row())};
   return {path:['list'],removeKey:{key:'id',is:ids()}}};
  const sliceSteps=yielded=>{const out=[];const k=1+n(3);
   for(let i=0;i<k;i++){const r=n(10);
    if(r<5)out.push({store:'st',edits:[storeEdit(yielded)]});
    else if(r<7)out.push({write:'o',value:n(8)});
    else if(r<9)out.push({write:'s',value:n(8)});
    else out.push({read:pick([get(st('st'),'n'),len(L),plain(L,['id','a'])]),label:'in'})}
   return out};
  const open=[];let actions=0;
  const steps=12+n(7);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<30&&open.length<3){const flight='f'+actions,a={id:'a'+actions++,slices:[{steps:sliceSteps(false),flight},{steps:sliceSteps(true)}]};
    if(n(10)<3)a.catch={steps:n(2)?[{write:'s',value:n(8)}]:[{store:'st',edits:[{path:['n'],set:9}]}]};
    put('action',a);open.push(flight);if(n(2))put('flush')}
   else if(r<55&&open.length){const flight=open.splice(n(open.length),1)[0];
    if(n(4)===0)put('reject',{flight,message:'action-failed'});else put('resolve',{flight,value:n(8)});
    if(n(2))probe('rows',plain(L,['id','a']),['read'])}
   else if(r<72)put('store_set',{id:'st',edits:[storeEdit(false)]});
   else if(r<80)put('write',{id:pick(['s','s','o']),value:n(8)});
   else if(r<92){const e=pick([get(st('st'),'n'),len(L),get(get(L,0),'a'),plain(L,['id','a'])]);probe('p',e,n(2)?['read','latest','pending']:[pick(['read','latest','pending'])])}
   else put('flush');
  }
  for(const flight of open)put('resolve',{flight,value:1});
  put('flush');probe('rows',plain(L,['id','a','t']),['read']);probe('n',get(st('st'),'n'));probe('len',len(L));
 }

 // ---- optimistic memo over store rows ----
 function optMemoRows(){
  const R=3+n(3),rows=Array.from({length:R},(_,i)=>({id:i+1,a:n(3)?0:5,t:n(10)}));
  put('store',{id:'st',value:{list:rows}});
  // shown: the list proxy (tracker-faithful: row writes never re-run it), a plain copy (row
  // writes re-run the guessed memo: its truth lands under pending guesses), or a replace
  // that also reads optimistic o2, which pin actions guess (another action's lane re-derives
  // the guessed memo).
  const L=get(st('st'),'list'),native=n(2)===0,shape=n(10),variant=shape>=6,copy=shape>=3&&shape<6;
  if(variant)put('signal',{id:'o2',value:0,optimistic:true});
  put('memo',{id:'shown',optimistic:true,expr:variant?replace(L,eq(ef('id'),rd('o2')),obj({id:ef('id'),t:ef('t'),a:7}),native):copy?plain(L,['id','a','t']):L});
  put('signal',{id:'mode',value:0});put('signal',{id:'status',value:0});
  put('memo',{id:'visible',expr:filter(rd('shown'),choose(eq(rd('mode'),0),1,eq(ef('a'),0)),native)});
  put('memo',{id:'cnt',expr:count(rd('shown'),eq(ef('a'),0),native)});
  put('effect',{id:'head',render:true,expr:arr([rd('mode'),rd('cnt')])});
  put('effect',{id:'rows',render:true,expr:plain(rd('visible'),['id','a'])});
  put('effect',{id:'foot',expr:rd('status')});
  put('flush');
  const open=[],claims={};let actions=0;
  const steps=10+n(7);
  for(let s=0;s<steps;s++){const r=n(100);
   if(variant&&r<20&&open.length<4){const flight='pin#'+actions;put('action',{id:'p'+actions++,slices:[{steps:[{write:'o2',value:1+n(R)}],flight},{steps:n(2)?[{write:'o2',value:1+n(R)}]:[]}]});open.push({K:0,flight});if(n(4))put('flush')}
   else if(r<35&&open.length<4){const K=open.length&&n(3)===0&&open[0].K?open.find(x=>x.K).K:1+n(R),c=claims[K]=(claims[K]??0)+1,flight='claim:'+K+'#'+c;
    const first=[{update:'shown',expr:replace(arg,eq(ef('id'),K),obj({id:K,t:ef('t'),a:9}),native)}];
    if(variant&&n(2))first.push({write:'o2',value:1+n(R)});
    put('action',{id:'c'+actions++,slices:[{steps:first,flight},{steps:[{store:'st',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]},{write:'status',value:0}]}],catch:{steps:[{write:'status',value:K}]}});
    open.push({K,flight});if(n(3)<(variant?2:1))put('flush');
    // A pin right behind a claim: the pin's lane re-derives the guessed memo (lanes.ts take).
    if(variant&&open.length<4&&!open.some(x=>!x.K)&&n(2)){put('flush');const pf='pin#'+actions;put('action',{id:'p'+actions++,slices:[{steps:[{write:'o2',value:1+n(R)}],flight:pf},{steps:[]}]});open.push({K:0,flight:pf});put('flush')}}
   else if(r<45){put('write',{id:'mode',value:n(2)});if(n(2))put('flush')}
   else if(r<75&&open.length){const {flight}=open.splice(n(open.length),1)[0];
    if(n(3)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<85){const e=pick([plain(rd('shown'),['id','a']),len(rd('visible')),rd('cnt'),get(get(L,0),'a')]);probe('p',e,n(2)?['read','latest','pending']:['read'])}
   else if(r<90)put('store_set',{id:'st',edits:[{path:['list',{key:'id',is:1+n(R)},'a'],set:n(2)?0:5}]});
   else if(r<95)put('drain');
   else put('flush');
  }
  for(const {flight} of open)put('resolve',{flight,value:7});
  put('flush');probe('shown',plain(rd('shown'),['id','a','t']),['read','latest']);probe('store',plain(L,['id','a']),['read']);
 }

 // ---- optimistic store with per-row writes ----
 function optStoreRows(){
  const R=3+n(3),rows=Array.from({length:R},(_,i)=>({id:i+1,a:n(2)?0:5,t:n(10)}));let nextId=R+1;
  const keyed=n(4)!==0;
  put('store',{id:'os',optimistic:true,value:{list:rows},...(keyed?{}:{key:null})});
  put('store',{id:'tr',value:{n:0}});
  put('signal',{id:'status',value:0});
  const L=get(st('os'),'list'),native=n(4)===0;
  put('memo',{id:'ml',expr:len(L)});
  put('memo',{id:'mc',expr:count(L,eq(ef('a'),9),native)});
  if(n(2))put('memo',{id:'mh',expr:arr([has(L,R-1),has(L,R)])});
  put('effect',{id:'rows',render:true,expr:plain(L,['id','a'])});
  put('effect',{id:'head',render:true,expr:arr([rd('ml'),rd('status')])});
  put('effect',{id:'side',expr:arr([rd('mc'),get(st('tr'),'n')])});
  put('flush');
  const open=[],claims={};let actions=0;
  const steps=10+n(7);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<35&&open.length<4){const K=open.length&&n(3)===0?open[n(open.length)].K:1+n(R+1),c=claims[K]=(claims[K]??0)+1,flight='claim:'+K+'#'+c;
    const q=n(10),first=q<6?{store:'os',edits:[{path:['list',{key:'id',is:K},'a'],set:9}]}
     :q<8?{store:'os',edits:[{path:['list'],push:lit({id:nextId++,a:9,t:n(10)})}]}:{store:'os',edits:[{path:['list'],removeKey:{key:'id',is:K}}]};
    const w=n(3),second=w===0?[{store:'tr',edits:[{path:['n'],set:sent}]}]:w===1?[{store:'os',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]}]:[];
    put('action',{id:'c'+actions++,slices:[{steps:[first],flight},{steps:[...second,{write:'status',value:0}]}],catch:{steps:[{write:'status',value:K}]}});
    open.push({K,flight});if(n(3)===0)put('flush')}
   else if(r<65&&open.length){const {flight}=open.splice(n(open.length),1)[0];
    if(n(3)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<75){const i=n(R);probe('row',get(get(L,i),'a'),n(2)?['read','latest','pending']:['latest','pending'])}
   else if(r<78)probe('rows',plain(L,['id','a']),['read','latest']);
   else if(r<80)probe('has',arr([has(L,n(R+2)),has(get(L,0),'a')]),['read']);
   else if(r<87)put('store_set',n(2)?{id:'tr',edits:[{path:['n'],set:n(9)}]}:{id:'os',edits:[{path:['list',{key:'id',is:1+n(R)},'t'],set:n(9)}]});
   else if(r<93)put('drain');
   else put('flush');
  }
  for(const {flight} of open)put('resolve',{flight,value:7});
  put('flush');probe('rows',plain(L,['id','a','t']),['read','latest']);probe('tr',get(st('tr'),'n'),['read']);
 }

 // ---- derived optimistic store over a server model (opt-store-derived, store-provenance) ----
 function derived(provenance){
  const pages=2,server=[];let nextId=1;
  for(let p=0;p<pages;p++)server.push(Array.from({length:2+n(3)},()=>({id:nextId++,d:n(2),t:n(10)})));
  // nav: page is optimistic and nav actions guess it, so the derive re-asks in another
  // action's lane (store _slotTake -> take). Arrangement edits (push/removeKey on the
  // root) make keyed arrangement guesses (LaneView) that list answers re-base.
  const page0=n(pages),rej=n(4)===0,keyed=n(5)!==0,seedLoading=n(4)===0,nav=n(2)===0,arrange=n(2)===0;
  put('signal',{id:'page',value:page0,...(nav?{optimistic:true}:{})});put('signal',{id:'status',value:0});put('signal',{id:'s',value:0});
  put('store',{id:'os',optimistic:true,seed:[],...(keyed?{}:{key:null}),...(seedLoading?{seedLoading:true}:{}),derive:{expr:rd('page'),flight:'list',fresh:true}});
  const O=st('os'),native=n(4)===0;
  put('memo',{id:'ml',expr:len(O)});
  put('memo',{id:'md',expr:count(O,eq(ef('d'),1),native)});
  if(rej){put('effect',{id:'view',render:true,expr:arr([rd('page'),rd('status'),rd('s')])});put('effect',{id:'rows',expr:plain(O,['id','d'])});put('effect',{id:'sum',expr:arr([rd('ml'),rd('md')])})}
  else{put('effect',{id:'rows',render:true,expr:plain(O,['id','d'])});put('effect',{id:'view',render:true,expr:arr([rd('page'),rd('ml'),rd('status'),rd('s')])});if(n(2))put('effect',{id:'sum',expr:rd('md')})}
  const asked=[0,0];asked[page0]=1;
  // The server's answer to a list question: echo, correction, reorder, added or dropped rows.
  const answer=p=>{const rows=clone(server[p]),k=n(10);
   if(k<3){}else if(k<5&&rows.length){pick(rows).d^=1}
   else if(k<7&&rows.length>1){rows.reverse()}
   else if(k<8){rows.push({id:nextId++,d:n(2),t:n(10)})}
   else if(rows.length>1){rows.splice(n(rows.length),1)}
   if(n(3)===0)server[p]=clone(rows);return rows};
  const listFlight=(p,c)=>'list:'+p+'#'+c;
  const settleList=(p,c)=>{if(rej&&n(6)===0)put('reject',{flight:listFlight(p,c),message:'fetch-failed'});else put('resolve',{flight:listFlight(p,c),value:answer(p)})};
  if(n(4))put('flush');
  settleList(page0,1);
  probe('len',len(O));
  const open=[],saves={};let actions=0,page=page0;
  const guessEdit=(K,v)=>{const r=arrange?n(10):0;
   return r<6?{path:[{key:'id',is:K},'d'],set:v}:r<8?{path:[],push:lit({id:nextId++,d:v,t:n(10)})}:{path:[],removeKey:{key:'id',is:K}}};
  const toggle=K=>{const c=saves[K]=(saves[K]??0)+1,flight='save:'+K+'#'+c,v=n(2);
   const a={id:'t'+actions++,slices:[{steps:[{store:'os',edits:[guessEdit(K,v)]}],flight},{steps:[{refresh_store:'os'}]}]};
   if(n(10)<3)a.catch={steps:[{write:'status',value:K}]};
   put('action',a);open.push({K,flight,v,p:page});asked[page]++;};
  const rowIds=()=>server[page].map(r=>r.id);
  const navAction=()=>{const p=n(pages),flight='nav#'+actions;asked[p]++;
   put('action',{id:'n'+actions++,slices:[{steps:[{write:'page',value:p}],flight},{steps:n(2)?[{refresh_store:'os'}]:[]}]});open.push({K:0,flight,v:0,p})};
  if(provenance){
   // Two or three actions on the same row; each refreshes after its save. The saves
   // resolve, then the list answers land newest-first (older questions under newer guesses).
   const rounds=1+n(2);
   for(let round=0;round<rounds;round++){
    const ids=rowIds(),K=ids.length?pick(ids):1,acts=2+n(2);
    for(let i=0;i<acts;i++){toggle(K);if(nav&&n(2))navAction();if(n(2))put('flush');if(n(3)===0){put('store_set',{id:'os',edits:[{path:[{key:'id',is:K},'t'],set:n(9)}]})}if(n(3)===0)put('write',{id:'s',value:n(5)})}
    const order=open.splice(0);if(n(2))order.reverse();
    for(const o of order){if(n(5)===0)put('reject',{flight:o.flight,message:'save-failed'});else{put('resolve',{flight:o.flight,value:1});const row=server[o.p].find(r=>r.id===o.K);if(row)row.d=o.v}
     if(n(2))probe('row',get(get(O,0),'d'),['read','latest','pending'])}
    if(n(2))put('drain');
    const top=asked[page]+1;for(let c=top;c>=Math.max(1,top-acts);c--){settleList(page,c);if(n(2))probe('rows',plain(O,['id','d']),['read','latest'])}
    if(n(2)){put('write',{id:'s',value:n(5)});put('flush')}
   }
  }
  const steps=(provenance?4:10)+n(6);
  for(let s=0;s<steps;s++){const r=n(100);
   if(nav&&open.length<4&&n(5)===0){navAction();if(n(2))put('drain')}
   else if(r<28&&open.length<3){const ids=rowIds();toggle(ids.length&&n(6)?pick(ids):99);if(n(2))put('drain')}
   else if(r<45&&open.length){const o=open.splice(n(open.length),1)[0];
    if(n(5)===0)put('reject',{flight:o.flight,message:'save-failed'});else{put('resolve',{flight:o.flight,value:1});const row=server[o.p].find(x=>x.id===o.K);if(row)row.d=o.v}}
   else if(r<65){const p=n(pages);settleList(p,1+n(asked[p]+1))}
   else if(r<73&&!nav){page=n(pages);asked[page]++;put('write',{id:'page',value:page});if(n(2))put('flush')}
   else if(r<78){put('refresh',{store:'os'});asked[page]++;put('drain')}
   else if(r<88){const e=pick([len(O),get(get(O,0),'d'),plain(O,['id','d'])]);probe('p',e,n(2)?['read','latest','pending']:[pick(['read','latest','pending'])])}
   else if(r<94)put('drain');
   else put('flush');
  }
  for(const o of open)put('resolve',{flight:o.flight,value:1});
  for(let p=0;p<pages;p++)for(let c=1;c<=asked[p]+1;c++)if(n(3))settleList(p,c);
  put('drain');probe('rows',plain(O,['id','d','t']),['read','latest']);probe('len',len(O));
 }

 // ---- tracker-shaped (tier B: no Show/For) ----
 function tracker(){
  const R=3+n(3),NATIVE=n(2)===0;
  const rows=Array.from({length:R},(_,i)=>({id:i+1,t:i+1,a:n(3)?0:5}));
  trackerSetup(rows,NATIVE);
  const open=[],claims={};let actions=0;
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<40&&open.length<4){const K=1+n(R),c=claims[K]=(claims[K]??0)+1,flight='assign:'+K+'#'+c;put('action',trackerClaim('claim'+actions++,K,flight,NATIVE));open.push(flight);if(n(2))put('drain')}
   else if(r<50){put('write',{id:'mode',value:n(2)});put('flush')}
   else if(r<80&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(4)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:6+n(3)})}
   else if(r<90){const e=pick([plain(rd('shown'),['id','a']),plain(get(st('issues'),'list'),['id','a']),rd('unassigned'),len(rd('visible'))]);probe('p',e,n(2)?['read','latest','pending']:['read'])}
   else if(r<95)put('drain');
   else put('flush');
  }
  for(const flight of open)put('resolve',{flight,value:7});
  put('drain');probe('rows',plain(rd('shown'),['id','t','a']),['read','latest']);
 }
 function trackerSetup(rows,NATIVE){
  put('store',{id:'issues',value:{list:rows}});
  const L=get(st('issues'),'list'),open=eq(ef('a'),0);
  put('memo',{id:'shown',optimistic:true,expr:L});
  put('signal',{id:'mode',value:0});put('signal',{id:'status',value:0});
  put('memo',{id:'visible',expr:filter(rd('shown'),choose(eq(rd('mode'),0),1,open),NATIVE)});
  put('memo',{id:'unassigned',expr:count(rd('shown'),open,NATIVE)});
  put('effect',{id:'head',render:true,expr:arr([rd('mode'),rd('unassigned')])});
  put('effect',{id:'body',render:true,expr:choose(len(rd('visible')),plain(rd('visible'),['t','a']),-1)});
  put('effect',{id:'foot',render:true,expr:rd('status')});
  put('flush');
 }
}
export function trackerClaim(id,K,flight,NATIVE){
 return {id,slices:[
  {steps:[{update:'shown',expr:replace(arg,eq(ef('id'),K),obj({id:K,t:ef('t'),a:9}),NATIVE)}],flight},
  {steps:[{store:'issues',edits:[{path:['list',{key:'id',is:K},'a'],set:sent}]},{write:'status',value:0}]}],
  catch:{steps:[{write:'status',value:K}]}};
}

// The demo SCRIPT of frontend/tsx/demo.test.ts as one fixed program (tier B shape: the
// body effect stands for Show+For). Returns {ops, frames}: frames[i] is the op index after
// which frame i is taken (docs/slice2b-fuzz/tools/tracker-demo.mjs). A structural sanity
// check of the op encoding, not a parity score.
export function trackerDemo(){
 const ops=[],put=(op,rest={})=>ops.push({op,...rest}),frames=[];
 const L=get(st('issues'),'list'),open=eq(ef('a'),0),NATIVE=true;
 put('store',{id:'issues',value:{list:[{id:1,t:1,a:0},{id:2,t:2,a:6},{id:3,t:3,a:0}]}});
 put('memo',{id:'shown',optimistic:true,expr:L});
 put('signal',{id:'mode',value:0});put('signal',{id:'status',value:0});
 put('memo',{id:'visible',expr:filter(rd('shown'),choose(eq(rd('mode'),0),1,open),NATIVE)});
 put('memo',{id:'unassigned',expr:count(rd('shown'),open,NATIVE)});
 put('effect',{id:'head',render:true,expr:arr([rd('mode'),rd('unassigned')])});
 put('effect',{id:'body',render:true,expr:choose(len(rd('visible')),plain(rd('visible'),['t','a']),-1)});
 put('effect',{id:'foot',render:true,expr:rd('status')});
 put('flush');frames.push(ops.length-1);
 const step=f=>{f();put('drain');frames.push(ops.length-1)};
 step(()=>put('action',trackerClaim('claim1',1,'assign:1#1',NATIVE)));
 step(()=>put('resolve',{flight:'assign:1#1',value:7}));
 step(()=>put('action',trackerClaim('claim2',2,'assign:2#1',NATIVE)));
 step(()=>put('reject',{flight:'assign:2#1',message:'offline'}));
 step(()=>put('write',{id:'mode',value:1}));
 step(()=>put('action',trackerClaim('claim3',3,'assign:3#1',NATIVE)));
 step(()=>put('resolve',{flight:'assign:3#1',value:7}));
 return {ops,frames};
}
