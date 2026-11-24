// --slice0: sync-only programs below slice1. Same Mulberry32 RNG and op language as generate.mjs
// (docs/OP-LANGUAGE.md). No actions, flights, optimistic, latest/pending, refresh, stores, lists.
// 30-90 ops. Families (family = W[seed mod |W|], no RNG):
// - diamond: two memos share a signal, a third reads both; choose and untrack; all equals modes.
// - chain: a signal feeding a chain of eager memos.
// - prev: eager memos that fold `prev`; equality cut-off on the fold.
// - fail-recover: a memo that throws, a user effect that catches it, a later write that recovers.
// - children: effects, memos and cleanups created inside memos and effects.
// - owners: nested owners, cleanups, dispose of an owner whose effects are still queued.
// - switch: choose that changes which signal a memo depends on.
// - batch: several writes per turn, a read between writes and the flush, a double write, a
//   write that restores the committed value before the flush.
const FAMILIES=[['diamond',3],['chain',2],['prev',2],['fail-recover',3],['children',3],['owners',3],['switch',2],['batch',3]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const slice0Family=seed=>W[(seed>>>0)%W.length];

const rd=id=>({op:'read',id}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const choose=(test,yes,no)=>({op:'choose',test,yes,no}),untrack=expr=>({op:'untrack',expr}),prev=fallback=>({op:'prev',fallback}),fail=message=>({op:'fail',message});

export function generateSlice0(seed){
  let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
  const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
  const ops=[],put=(op,rest={})=>ops.push({op,...rest});
  const committed={},staged={};
  const sig=(id,value,equals)=>{(equals?put('signal',{id,value,equals}):put('signal',{id,value}));committed[id]=staged[id]=value};
  const write=(id,value)=>{put('write',{id,value});staged[id]=value};
  const flush=()=>{put('flush');for(const id in staged)committed[id]=staged[id]};
  const equals=()=>pick(['default','parity','never']);
  const target=30+n(51); // 30-80; a filler step may add a few more, still under 90
  const family=slice0Family(seed);
  ({diamond,chain,prevFold,failRecover,children,owners,switchDep,batch})[family==='prev'?'prevFold':family==='fail-recover'?'failRecover':family==='switch'?'switchDep':family]();
  while(ops.length<target)filler();
  return ops;

  function diamond(){
    sig('a',n(4),equals());sig('b',n(4),equals());sig('c',n(4),equals());
    put('memo',{id:'ab',expr:add(rd('a'),rd('b'))});
    put('memo',{id:'bc',expr:add(rd('b'),rd('c'))});
    put('memo',{id:'top',expr:add(rd('ab'),rd('bc'))});
    put('memo',{id:'sw',expr:choose(rd('a'),rd('ab'),untrack(rd('bc')))});
    put('owner',{id:'scope'});put('cleanup',{owner:'scope',label:'d1'});put('cleanup',{owner:'scope',label:'d2'});
    put('effect',{id:'er',expr:rd('top'),render:true,owner:'scope'});
    put('effect',{id:'eu',expr:rd('sw'),owner:'scope',defer:n(2)===0});
    put('effect',{id:'ed',expr:rd('a'),render:n(2)===0,defer:true,owner:'scope'});
    flush();
  }
  function chain(){
    sig('s',n(5),equals());
    let prevId='s';
    for(let i=0;i<5;i++){const id='m'+i;put('memo',{id,expr:add(rd(prevId),i===2?untrack(rd('s')):1),equals:i===1?equals():undefined});prevId=id}
    put('effect',{id:'er',expr:rd(prevId),render:true});
    put('effect',{id:'eu',expr:rd('m0'),defer:n(2)===0});
    put('effect',{id:'es',expr:rd('s'),render:n(2)===0});
    flush();
  }
  function prevFold(){
    sig('s',n(4),equals());sig('t',1+n(3),equals());
    put('memo',{id:'fold',expr:add(rd('s'),prev(0)),equals:equals()});
    put('memo',{id:'fold2',expr:choose(rd('t'),prev(1),rd('s')),equals:pick(['default','never'])});
    put('effect',{id:'er',expr:rd('fold'),render:true});
    put('effect',{id:'eu',expr:rd('fold2')});
    flush();
  }
  function failRecover(){
    // Start truthy so creation does not throw. Only a user effect reads the throwing memo.
    sig('s',1,'default');sig('t',n(4),equals());
    put('memo',{id:'m',expr:choose(rd('s'),rd('t'),fail('boom'))});
    put('effect',{id:'watch',expr:rd('m')});
    put('effect',{id:'safe',expr:rd('t'),render:true});
    flush();
    put('read',{id:'m'});
    write('s',0);flush();put('read',{id:'m'});
    write('t',n(5));flush();put('read',{id:'m'});
    write('s',1);flush();put('read',{id:'m'});
  }
  function children(){
    sig('s',n(4),equals());sig('t',n(4),'never');
    put('memo',{id:'parent',expr:add(rd('s'),1),children:[
      {effect:'e',render:true,expr:rd('s')},
      {memo:'m',expr:add(rd('t'),1)},
      {effect:'v',expr:{op:'local',id:'m'},defer:n(2)===0},
      {cleanup:'c'}
    ],cleanup:true});
    put('effect',{id:'host',expr:rd('t'),render:n(2)===0,children:[
      {effect:'e',render:true,expr:add(rd('s'),rd('t'))},
      {memo:'m',expr:rd('s')},
      {effect:'v',expr:{op:'local',id:'m'}},
      {cleanup:'c'}
    ],cleanup:true});
    put('effect',{id:'top',expr:rd('parent'),render:true});
    flush();
  }
  function owners(){
    sig('s',n(4),equals());sig('t',n(4),equals());
    put('owner',{id:'outer'});put('owner',{id:'inner',parent:'outer'});
    put('cleanup',{owner:'outer',label:'outer'});put('cleanup',{owner:'inner',label:'inner-a'});put('cleanup',{owner:'inner',label:'inner-b'});
    put('effect',{id:'queued',expr:rd('s'),owner:'inner'});
    put('effect',{id:'deferred',expr:add(rd('s'),rd('t')),owner:'inner',defer:true});
    put('effect',{id:'outerE',expr:rd('t'),owner:'outer',render:true});
    flush();
    // Effects under inner are queued by the write; dispose before the flush drops them.
    write('s',committed.s+1+n(3));
    put('read',{id:'s'});
    put('dispose',{owner:'inner'});
    flush();
    write('t',committed.t+1+n(3));
    put('dispose',{owner:'outer'});
    flush();
    write('s',n(4));flush();
  }
  function switchDep(){
    sig('g',1,equals());sig('x',n(5),equals());sig('y',n(5),equals());
    put('memo',{id:'c',expr:choose(rd('g'),rd('x'),rd('y'))});
    put('memo',{id:'d',expr:choose(rd('g'),untrack(rd('x')),rd('y'))});
    put('memo',{id:'e',expr:add(rd('c'),choose(rd('x'),rd('y'),rd('g')))});
    put('effect',{id:'er',expr:rd('c'),render:true});
    put('effect',{id:'eu',expr:rd('e'),defer:n(2)===0});
    put('effect',{id:'ed',expr:rd('d')});
    flush();
    write('g',0);flush();
    write('x',n(6));write('y',n(6));flush();
    write('g',1);flush();
  }
  function batch(){
    sig('a',n(4),equals());sig('b',n(4),pick(['default','never']));sig('c',n(4),'parity');
    put('memo',{id:'ab',expr:add(rd('a'),rd('b'))});
    put('memo',{id:'bc',expr:add(rd('b'),rd('c'))});
    put('memo',{id:'top',expr:add(rd('ab'),rd('bc'))});
    put('effect',{id:'er',expr:rd('top'),render:true});
    put('effect',{id:'eu',expr:rd('a')});
    flush();
  }
  function ids(){return Object.keys(committed)}
  function memos(){return ops.filter(o=>o.op==='memo').map(o=>o.id)}
  function filler(){
    const kind=n(10),sigs=ids();
    if(family==='fail-recover'&&n(4)===0){write('s',n(2));if(n(2))write('t',n(5));flush();put('read',{id:'m'});return}
    if(kind<4){
      const k=2+n(3);
      for(let i=0;i<k;i++){const id=pick(sigs);write(id,n(7))}
      if(n(2)){const id=pick(sigs);put('read',{id})}
      flush();
      const readable=sigs.concat(memos());
      if(readable.length)put('read',{id:pick(readable)});
    } else if(kind<6){
      const id=pick(sigs);const v=n(6);write(id,v);write(id,v+1+n(3));put('read',{id});flush();put('read',{id});
    } else if(kind<8){
      const id=pick(sigs);const old=committed[id];write(id,old+1+n(4));write(id,old);put('read',{id});flush();put('read',{id});
    } else if(kind<9){
      const id=pick(sigs);write(id,n(5));put('read',{id});write(id,n(5));flush();put('read',{id});
    } else flush();
  }
}
