// --slice0c: slice0's sync-only restriction plus tier-B plain stores and tier-C structures.
// No actions, flights, optimistic, latest/pending, refresh. Modeled on the sync families of
// generate-slice2b.mjs (store-plain) and generate-slice2c.mjs (lists, Show, nested children).
// Families (family = W[seed mod |W|], no RNG):
// - store-plain: one plain store, memos over get/has/len/filter/count/find, store_set edits
//   (path, push/insert/remove/move/moveKey/removeKey, delete, returns, reconcile), several
//   edits per turn, a read between an edit and the flush.
// - list-ints: mapArray over an int signal, every keying mode, arity 1 or 2, fallback, row
//   effects/memos/cleanups, array edits.
// - list-store: a list over a plain store's rows (identity, "id", keyed:false), moveKey and
//   the other edits, optional shallow.
// - list-for: lazy For (mapArray created on first read) over ints or store rows.
// - show: Show (element or function children, keyed or not) with a For in the yes branch,
//   effects in both, a memo whose pass builds children.
// - nested: store rows {id,a,tags}; each row maps its tags; the inner row reads the outer
//   item through `up`.
// - bulk: an int list of 66-100 values, identity keying, rotations and block moves.
const FAMILIES=[['store-plain',3],['list-ints',3],['list-store',3],['list-for',2],['show',3],['nested',2],['bulk',1]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const slice0cFamily=seed=>W[(seed>>>0)%W.length];

const st=id=>({op:'store',id}),get=(of,key)=>({op:'get',of,key}),rd=id=>({op:'read',id}),len=of=>({op:'len',of});
const eq=(a,b)=>({op:'eq',a,b}),not=a=>({op:'not',a}),elem={op:'elem'};
const nat=(o,native)=>native?{...o,native:true}:o;
const filter=(of,where,native)=>nat({op:'filter',of,where},native),count=(of,where,native)=>nat({op:'count',of,where},native);
const find=(of,where,native)=>nat({op:'find',of,where},native);
const obj=fields=>({op:'obj',fields}),arr=items=>({op:'arr',items}),lit=value=>({op:'lit',value}),plain=(of,fields)=>({op:'plain',of,fields});
const has=(of,key)=>({op:'has',of,key}),choose=(test,yes,no)=>({op:'choose',test,yes,no}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const item=up=>up?{op:'item',up}:{op:'item'},index=()=>({op:'index'}),call=of=>({op:'call',of}),local=id=>({op:'local',id});
const ef=f=>get(elem,f);
const clone=v=>JSON.parse(JSON.stringify(v));
const draft={op:'draft'};

export function generateSlice0c(seed){
  let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
  const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
  const ops=[],put=(op,rest={})=>ops.push({op,...rest});
  const probe=(label,expr)=>{put('read',{label,expr})};
  const family=slice0cFamily(seed);
  ({'store-plain':storePlain,'list-ints':listInts,'list-store':listStore,'list-for':listFor,'show':showFam,'nested':nested,'bulk':bulk})[family]();
  return ops;

  function applyEdit(m,ed){const p=ed.path,isArrOp=!('set' in ed||ed.del);let t=m;
    const seg=s=>{if(typeof s!=='object')return s;const i=t.findIndex(r=>r!=null&&r[s.key]===s.is);if(i<0)throw 'miss';return i};
    try{for(let i=0;i<p.length-(isArrOp?0:1);i++)t=t[seg(p[i])];
      if(!isArrOp){const k=seg(p[p.length-1]);if(ed.del)delete t[k];else t[k]=clone(ed.set&&ed.set.op==='lit'?ed.set.value:ed.set);return}
      if('push' in ed)t.push(clone(ed.push.value));
      else if('insert' in ed)t.splice(ed.insert[0],0,clone(ed.insert[1].value));
      else if('remove' in ed)t.splice(ed.remove,1);
      else if('removeKey' in ed){const i=t.findIndex(r=>r!=null&&r[ed.removeKey.key]===ed.removeKey.is);if(i>=0)t.splice(i,1)}
      else if('move' in ed){const [i,j]=ed.move,[x]=t.splice(i,1);t.splice(j,0,x)}
      else if('moveKey' in ed){const i=t.findIndex(r=>r!=null&&r[ed.moveKey.key]===ed.moveKey.is);if(i>=0){const [x]=t.splice(i,1);t.splice(ed.moveKey.to===0?0:t.length,0,x)}}
      else if('splice' in ed){const [i,c,...xs]=ed.splice;t.splice(i,c,...xs.map(e=>clone(e.value??e)))}
    }catch(e){if(e!=='miss')throw e}}
  function one(model,ed){applyEdit(model,ed);return {edits:[ed]}}
  function plainEdit(model,row){
    const L=model.list,r=n(100);
    if(r<16)return one(model,{path:['n'],set:n(9)});
    if(r<28&&L.length)return one(model,{path:['list',n(L.length),pick(['a','t'])],set:n(9)});
    if(r<36)return one(model,{path:['list',{key:'id',is:n(5)===0?99:(L.length?pick(L).id:99)},'a'],set:n(4)});
    if(r<46)return one(model,{path:['list'],push:lit(row())});
    if(r<52&&L.length>1)return one(model,{path:['list'],remove:n(L.length)});
    if(r<58)return one(model,{path:['list'],insert:[n(L.length+1),lit(row())]});
    if(r<64&&L.length>1)return one(model,{path:['list'],move:[n(L.length),n(L.length)]});
    if(r<70&&L.length)return one(model,{path:['list'],moveKey:{key:'id',is:pick(L).id,to:pick([0,-1])}});
    if(r<76&&L.length)return one(model,{path:['list'],removeKey:{key:'id',is:n(4)===0?99:pick(L).id}});
    if(r<80)return n(2)&&L.length?one(model,{path:['list',n(L.length),'t'],del:true}):one(model,{path:['n'],del:true});
    if(r<86&&L.length){const i=n(L.length),v=n(2)?{...row(),id:L[i].id}:row();return one(model,{path:['list',i],set:lit(v)})}
    if(r<92){const x=n(4);model.list=model.list.filter(q=>q.a!==x);
      return {returns:obj({list:filter(get(draft,'list'),not(eq(ef('a'),x))),n:get(draft,'n')})}}
    const v={list:clone(L),n:n(9)};
    for(const q of v.list)if(n(3)===0)q.a=n(4);
    if(v.list.length>1&&n(2)){const i=n(v.list.length),j=n(v.list.length);[v.list[i],v.list[j]]=[v.list[j],v.list[i]]}
    if(v.list.length>1&&n(3)===0)v.list.splice(n(v.list.length),1);
    if(n(3)===0)v.list.push(row());
    model.list=clone(v.list);model.n=v.n;
    return {reconcile:v,key:n(10)<7?'id':null};
  }
  function storePlain(){
    let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(10)});
    const model={list:Array.from({length:2+n(4)},row),n:n(5)};
    put('store',{id:'st',value:clone(model)});
    const L=get(st('st'),'list'),native=n(5)===0;
    put('memo',{id:'mn',expr:get(st('st'),'n')});
    put('memo',{id:'ml',expr:len(L)});
    put('memo',{id:'mc',expr:count(L,eq(ef('a'),0),native)});
    put('memo',{id:'mr',expr:get(get(L,0),'a')});
    if(n(2))put('memo',{id:'mf',expr:find(L,eq(ef('id'),1+n(5)),native)});
    if(n(2))put('memo',{id:'mh',expr:arr([has(get(L,0),'t'),has(st('st'),'n')])});
    if(n(2))put('memo',{id:'mp',expr:plain(L,['id','a'])});
    put('effect',{id:'e1',render:true,expr:arr([rd('mn'),rd('ml'),rd('mc')])});
    put('effect',{id:'e2',render:true,expr:plain(L,['id','a'])});
    put('effect',{id:'e3',expr:arr([rd('mr'),get(st('st'),'n')])});
    put('flush');
    const steps=12+n(8);
    for(let s=0;s<steps;s++){
      const batch=n(10)<4?2+n(2):1;
      for(let b=0;b<batch;b++){const e=plainEdit(model,row);put('store_set',{id:'st',...e})}
      if(n(3))probe('mid',plain(L,['id','a']));
      if(n(10)<8)put('flush');
      if(n(4)===0)probe('rows',plain(L,['id','a','t']));
      else if(n(5)===0)probe('has',arr([has(get(L,0),'t'),has(st('st'),'gone')]));
    }
    put('flush');probe('rows',plain(L,['id','a','t']));probe('len',len(L));
  }
  function keying(keyFn){const r=n(10);return r<5?true:r<8?false:keyFn}
  function intRow(idx){const kids=[];const k=1+n(3);
    for(let i=0;i<k;i++){const r=n(10);
      if(r<4)kids.push({effect:'e'+i,render:true,expr:item()});
      else if(r<6&&idx)kids.push({effect:'e'+i,render:n(2)===0,expr:add(item(),index())});
      else if(r<8){kids.push({memo:'m'+i,expr:add(item(),1)});kids.push({effect:'v'+i,render:true,expr:local('m'+i)})}
      else kids.push({effect:'e'+i,expr:item()})}
    if(n(3)===0)kids.push({cleanup:'c'});return kids}
  function fallbackSpec(){const r=n(6);return r<3?false:r<5?true:[{effect:'fb',render:true,expr:0},{cleanup:'fc'}]}
  function intEdit(xs){const a=xs.slice(),r=n(100);
    if(r<14)a.splice(n(a.length+1),0,n(6));
    else if(r<26&&a.length)a.splice(n(a.length),1);
    else if(r<38&&a.length>1){const [x]=a.splice(n(a.length),1);a.splice(n(a.length+1),0,x)}
    else if(r<48&&a.length>1){const i=n(a.length),j=n(a.length);[a[i],a[j]]=[a[j],a[i]]}
    else if(r<58)a.reverse();
    else if(r<66&&a.length)a.splice(n(a.length+1),0,a[n(a.length)]);
    else if(r<70)a.length=0;
    else if(r<78&&a.length>1)a.push(a.shift());
    else if(r<88&&a.length)a[n(a.length)]=n(6);
    else if(r<94)return Array.from({length:n(7)},()=>n(6));
    else a.push(n(6));
    return a}
  function listInts(){
    let xs=Array.from({length:n(7)},()=>n(6));
    put('signal',{id:'xs',value:clone(xs)});put('signal',{id:'k',value:n(3)});
    const keyed=keying({expr:mod(elem,3)}),idx=n(2)===0,fb=fallbackSpec();
    put('list',{id:'L',each:rd('xs'),keyed,index:idx,fallback:fb,row:intRow(idx)});
    put('effect',{id:'top',render:true,expr:rd('L')});
    if(n(2))put('effect',{id:'lenL',expr:len(rd('L'))});
    put('flush');
    const steps=10+n(8);
    for(let s=0;s<steps;s++){
      const turns=n(10)<3?2+n(2):1;
      for(let t=0;t<turns;t++){xs=intEdit(xs);put('write',{id:'xs',value:clone(xs)});if(n(3)===0)probe('mid',rd('L'))}
      if(n(10)<8)put('flush');
      if(n(4)===0){put('write',{id:'k',value:n(3)});put('flush')}
      else if(n(5)===0)probe('L',rd('L'));
    }
    put('flush');probe('L',rd('L'));
  }
  function objRow(idx){const kids=[];const k=1+n(3);
    for(let i=0;i<k;i++){const r=n(10);
      if(r<4)kids.push({effect:'e'+i,render:true,expr:get(item(),pick(['a','t']))});
      else if(r<6)kids.push({effect:'e'+i,render:n(2)===0,expr:plain(item(),['id','a'])});
      else if(r<8&&idx)kids.push({effect:'e'+i,render:true,expr:arr([index(),get(item(),'id')])});
      else{kids.push({memo:'m'+i,expr:get(item(),'a')});kids.push({effect:'v'+i,render:true,expr:local('m'+i)})}}
    if(n(3)===0)kids.push({cleanup:'c'});return kids}
  function rowEdit(model,row){
    const L=model.list,r=n(100);
    if(r<18&&L.length)return one(model,{path:['list',n(L.length),pick(['a','t'])],set:n(9)});
    if(r<28)return one(model,{path:['list',{key:'id',is:L.length&&n(5)?pick(L).id:99},'a'],set:n(4)});
    if(r<38)return one(model,{path:['list'],push:lit(row())});
    if(r<46&&L.length>1)return one(model,{path:['list'],remove:n(L.length)});
    if(r<54)return one(model,{path:['list'],insert:[n(L.length+1),lit(row())]});
    if(r<62&&L.length>1)return one(model,{path:['list'],move:[n(L.length),n(L.length)]});
    if(r<72&&L.length)return one(model,{path:['list'],moveKey:{key:'id',is:pick(L).id,to:pick([0,-1])}});
    if(r<78&&L.length)return one(model,{path:['list'],removeKey:{key:'id',is:n(4)?pick(L).id:99}});
    if(r<86&&L.length){const i=n(L.length),v=n(2)?{...row(),id:L[i].id}:row();return one(model,{path:['list',i],set:lit(v)})}
    if(r<93){const x=n(4);model.list=model.list.filter(q=>q.a!==x);return {returns:obj({list:filter(get(draft,'list'),not(eq(ef('a'),x)))})}}
    const v=clone(L);for(const q of v)if(n(3)===0)q.a=n(4);
    if(v.length>1&&n(2)){const i=n(v.length),j=n(v.length);[v[i],v[j]]=[v[j],v[i]]}
    if(n(3)===0)v.push(row());
    model.list=clone(v);return {reconcile:{list:v},key:n(10)<7?'id':null};
  }
  function listStore(){
    let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(10)});
    const model={list:Array.from({length:1+n(5)},row)},shallow=n(8)===0;
    put('store',{id:'st',value:clone(model),...(shallow?{shallow:true}:{})});
    const L=get(st('st'),'list'),keyed=pick([true,true,'id','id',false]),idx=n(2)===0;
    put('owner',{id:'lo'});
    put('list',{id:'L',each:L,keyed,index:idx,fallback:fallbackSpec(),row:objRow(idx),owner:'lo'});
    put('effect',{id:'top',render:true,expr:rd('L'),owner:'lo'});
    if(n(2))put('memo',{id:'cnt',expr:count(L,eq(ef('a'),0),n(4)===0)});
    if(n(2))put('effect',{id:'side',expr:plain(L,['id','a'])});
    put('flush');
    const steps=10+n(8);let disposed=false;
    for(let s=0;s<steps;s++){
      const batch=n(8)===0?2:1;
      for(let b=0;b<batch;b++)put('store_set',{id:'st',...rowEdit(model,row)});
      if(n(4)===0)probe('mid',rd('L'));
      if(n(10)<7)put('flush');
      // dispose the owner while a list update is queued: the edit is staged, dispose, then flush.
      if(!disposed&&n(14)===0){put('store_set',{id:'st',...rowEdit(model,row)});put('dispose',{owner:'lo'});disposed=true;put('flush');break}
    }
    if(!disposed)put('flush');
    probe('rows',plain(L,['id','a','t']));
  }
  function listFor(){
    const overStore=n(2)===0;
    if(!overStore){
      let xs=Array.from({length:n(6)},()=>n(6));
      put('signal',{id:'xs',value:clone(xs)});
      const keyed=keying({expr:mod(elem,3)}),idx=n(2)===0;
      put('list',{id:'L',each:rd('xs'),keyed,index:idx,lazy:true,fallback:fallbackSpec(),row:intRow(idx)});
      put('effect',{id:'body',render:true,expr:call(rd('L'))});
      put('flush');
      const steps=8+n(6);
      for(let s=0;s<steps;s++){xs=intEdit(xs);put('write',{id:'xs',value:clone(xs)});if(n(3)===0)probe('acc',call(rd('L')));if(n(10)<8)put('flush')}
      put('flush');probe('L',rd('L'));probe('body',call(rd('L')));
    } else {
      let nextId=1;const row=()=>({id:nextId++,a:n(4),t:n(8)});
      const model={list:Array.from({length:1+n(4)},row)};
      put('store',{id:'st',value:clone(model)});
      const L=get(st('st'),'list'),keyed=pick([true,'id',false]),idx=n(2)===0;
      put('list',{id:'L',each:L,keyed,index:idx,lazy:true,fallback:n(2)?false:true,row:objRow(idx)});
      put('effect',{id:'body',render:true,expr:call(rd('L'))});
      put('flush');
      const steps=8+n(6);
      for(let s=0;s<steps;s++){put('store_set',{id:'st',...rowEdit(model,row)});if(n(10)<8)put('flush')}
      put('flush');probe('body',call(rd('L')));
    }
  }
  function showFam(){
    let xs=Array.from({length:n(5)},()=>n(5));
    put('signal',{id:'xs',value:clone(xs)});put('signal',{id:'g',value:1});
    const keyed=keying({expr:mod(elem,3)}),idx=n(2)===0,fn=n(5)===0,showKeyed=n(5)===0;
    const yes=[{list:{id:'L',each:rd('xs'),keyed,index:idx,lazy:n(2)===0,row:intRow(idx)}},{effect:'lv',render:true,expr:local('L')}];
    const no=[{effect:'nv',render:true,expr:rd('g')},{cleanup:'nc'}];
    put('show',{id:'B',when:rd('g'),yes,no,...(fn?{fn:true}:{}),...(showKeyed?{keyed:true}:{})});
    put('effect',{id:'view',render:true,expr:call(rd('B'))});
    put('memo',{id:'host',expr:rd('g'),children:[
      {effect:'e',render:true,expr:len(rd('xs'))},
      {memo:'m',expr:add(rd('g'),1)},
      {effect:'v',expr:local('m')},
      {cleanup:'c'}
    ],cleanup:true});
    put('effect',{id:'hm',render:true,expr:rd('host')});
    put('flush');
    const steps=8+n(7);
    for(let s=0;s<steps;s++){const r=n(10);
      if(r<5){const turns=n(5)===0?2:1;for(let t=0;t<turns;t++){xs=intEdit(xs);put('write',{id:'xs',value:clone(xs)})}if(n(2))probe('mid',call(rd('B')));put('flush')}
      else if(r<8){put('write',{id:'g',value:n(2)});put('flush')}
      else {put('write',{id:'g',value:0});put('write',{id:'g',value:1});put('flush')}
    }
    put('flush');probe('B',call(rd('B')));
  }
  function nested(){
    let nextId=1;const row=()=>({id:nextId++,a:n(4),tags:Array.from({length:n(4)},()=>n(5))});
    const model={list:Array.from({length:1+n(4)},row)};
    put('store',{id:'st',value:clone(model)});
    const L=get(st('st'),'list');
    put('list',{id:'L',each:L,keyed:'id',index:n(2)===0,row:[
      {effect:'a',render:true,expr:get(item(),'a')},
      {list:{id:'T',each:get(item(),'tags'),keyed:n(2)===0?true:false,index:n(2)===0,row:[
        {effect:'t',render:true,expr:add(item(),get(item(1),'id'))},
        {cleanup:'c'}
      ]}},
      {effect:'tv',render:true,expr:local('T')}
    ]});
    put('effect',{id:'top',render:true,expr:rd('L')});
    put('flush');
    const steps=8+n(6);
    for(let s=0;s<steps;s++){
      const Lst=model.list,r=n(8);
      let ed;
      if(r<2&&Lst.length){const i=n(Lst.length);const tags=Lst[i].tags.slice();tags.splice(n(tags.length+1),0,n(5));Lst[i]={...Lst[i],tags};ed={path:['list',i,'tags'],set:lit(tags.slice())}}
      else if(r<4&&Lst.length&&Lst.some(q=>q.tags.length)){const i=Lst.findIndex(q=>q.tags.length);const tags=Lst[i].tags.slice();tags.splice(n(tags.length),1);Lst[i]={...Lst[i],tags};ed={path:['list',i,'tags'],set:lit(tags.slice())}}
      else if(r<6){const x=row();Lst.push(x);ed={path:['list'],push:lit(clone(x))}}
      else if(r<7&&Lst.length>1){const i=n(Lst.length);Lst.splice(i,1);ed={path:['list'],remove:i}}
      else {const x=row();Lst.push(x);ed={path:['list'],push:lit(clone(x))}}
      put('store_set',{id:'st',edits:[ed]});
      if(n(10)<8)put('flush');
    }
    put('flush');probe('L',rd('L'));
  }
  function bulk(){
    let xs=Array.from({length:66+n(35)},(_,i)=>i+1);
    put('signal',{id:'xs',value:xs.slice()});
    put('list',{id:'L',each:rd('xs'),keyed:true,index:false,row:[]});
    put('effect',{id:'top',render:true,expr:len(rd('L'))});
    put('flush');
    const steps=6+n(4);
    for(let s=0;s<steps;s++){const len=xs.length,r=n(6);
      if(r<1)xs=xs.slice().reverse();
      else if(r<2){const k=1+n(Math.max(1,len-1));xs=xs.slice(k).concat(xs.slice(0,k))}
      else if(r<4&&len>66){const a=xs.slice();const st=n(len-65),c=Math.min(65+n(8),len-st);const blk=a.splice(st,c);a.splice(n(a.length+1),0,...blk);xs=a}
      else if(r<5&&len){const a=xs.slice();a.splice(n(len),1+n(4));xs=a}
      else {const a=xs.slice();const i=n(len),j=n(len);[a[i],a[j]]=[a[j],a[i]];xs=a}
      put('write',{id:'xs',value:xs.slice()});put('flush');
    }
    put('flush');probe('L',len(rd('L')));
  }
}
