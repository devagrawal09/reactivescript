// --boundaries (tier D, docs/BOUNDARIES-COVERAGE.md): Loading and Errored boundaries over async
// memos, on the slice-1 driver, against Solid's own createLoadingBoundary / createErrorBoundary
// (fuzz/solid.mjs tier D). Same Mulberry32 RNG, worker oracle (strict 'boundaries') and exact
// full-trace comparator as the other generators.
//
// The pieces: async memos `a` (flight `q:<s mod 3>`) and, in some families, `b` (flight
// `r:<a mod 3>`, chained) or `c` (flight `p:<t mod 2>`, independent); boundaries built as ops
// (`loading`, `errored`) or as children of other boundaries, Show branches and memo passes,
// whose children are effects, memos, Shows, nested boundaries and a content `expr`; render
// effects that read a boundary's accessor (what an insert would do); tracked verdict windows
// (`pending`/`latest` expressions inside memos and effects); `affects` (an op, and a step at
// the head of an action); `refresh`; actions that write the memos' inputs, await flights and
// re-ask; resolves and rejects in any order, superseded requests settled late; an Errored's
// `reset`; owners disposed with boundaries under them.
//
// Families (deterministic weighted choice, family = W[seed mod |W|]):
// - first-load (3): one Loading over content reading `a`; no rejection (an error with no
//   Errored above reaches a render effect: rc.21 halts).
// - errored (3): Errored > Loading (or Errored alone) over `a`; memo and action flights may
//   reject; the fallback reads the error; `reset` and `refresh` retry.
// - nested (2): Loading > Errored > Loading, two Loadings under one Errored, a Loading in a
//   Show branch that toggles, a boundary in a memo's pass.
// - probes (3): memos and effects inside the boundary whose passes call isPending/latest of
//   `a`, a derived memo or a sum; `affects` marks; refresh while pending.
// - actions (3): actions that declare `affects`, await a flight, refresh `a` after the await,
//   write `s` (a new question) and fail or succeed; overlapping actions settled out of order.
// - owners (2): boundaries under a named owner disposed mid-flight; boundaries in a memo pass
//   re-created by a write.
const FAMILIES=[['first-load',3],['errored',3],['nested',2],['probes',3],['actions',3],['owners',2]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const boundariesFamily=seed=>W[(seed>>>0)%W.length];

const rd=id=>({op:'read',id}),local=id=>({op:'local',id}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const choose=(test,yes,no)=>({op:'choose',test,yes,no}),pending=of=>({op:'pending',of}),latest=of=>({op:'latest',of});

export function generateBoundaries(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 const family=boundariesFamily(seed);
 // Memo flights may reject only when every reader of an async memo is under an Errored
 // (`exposed` is set by a structure that has one with none above: the program then never rejects
 // one, as an error reaching a render effect with no Errored halts rc.21).
 const rejects=family!=='first-load'&&family!=='probes'?true:family==='probes'&&n(3)===0;let exposed=false;
 // Sources and async memos.
 put('signal',{id:'s',value:n(3)});
 put('memo',{id:'a',expr:mod(rd('s'),3),flight:'q'});
 const asyncs=['a'],prefixes=['q'];
 if(family==='nested'||family==='probes'&&n(2)||family==='errored'&&n(3)===0){put('memo',{id:'b',expr:mod(rd('a'),3),flight:'r'});asyncs.push('b');prefixes.push('r')}
 if(family==='actions'&&n(2)||family==='nested'&&n(2)){put('signal',{id:'t',value:n(2)});put('memo',{id:'c',expr:mod(rd('t'),2),flight:'p'});asyncs.push('c');prefixes.push('p')}
 const derived=n(2)===0;if(derived)put('memo',{id:'m',expr:add(rd(pick(asyncs)),rd('s'))});
 const values=[...asyncs,...(derived?['m']:[])];
 const sig=asyncs.includes('c')?['s','t']:['s'];
 // A content expression over the async memos (and the signals).
 const contentExpr=()=>{const r=n(6);const v=pick(values);
  return r<2?rd(v):r<3?add(rd(v),rd('s')):r<4?choose(pending(rd(v)),100,rd(v)):r<5?latest(rd(v)):add(rd(pick(values)),rd(pick(values)))};
 // (No arithmetic over a window's read: `latest` of a held node with no value is `undefined`, and `undefined + n` is
 // NaN, outside the op language.)
 // Children of a boundary's content (built in its children computed).
 let k=0;const fresh=p=>p+(k++);
 const probeKids=()=>{const kids=[];const v=pick(values);
  if(n(2)){const id=fresh('pm');kids.push({memo:id,expr:pending(rd(v))});kids.push({effect:fresh('pv'),render:true,expr:local(id)})}
  if(n(3)===0)kids.push({effect:fresh('pe'),render:true,expr:choose(pending(rd(v)),-1,rd(v))});
  if(n(3)===0){const id=fresh('lm');kids.push({memo:id,expr:latest(rd(v))});kids.push({effect:fresh('lv'),render:true,expr:local(id)})}
  // A probe of two reads (no arithmetic inside the window: a staged first value read outside the flush is
  // `undefined` there, and `undefined + n` is NaN, outside the op language).
  if(n(4)===0)kids.push({effect:fresh('pu'),expr:pending(choose(rd(v),rd('s'),0))});
  return kids};
 const contentKids=(depth)=>{const kids=[];const c=1+n(3);
  for(let i=0;i<c;i++){const r=n(10);
   if(r<4)kids.push({effect:fresh('e'),render:true,expr:rd(pick(values))});
   else if(r<6){const id=fresh('m');kids.push({memo:id,expr:add(rd(pick(values)),1)});kids.push({effect:fresh('v'),render:true,expr:local(id)})}
   else if(r<7)kids.push({effect:fresh('u'),expr:rd(pick(values))});
   else if(r<8)kids.push({cleanup:fresh('c')});
   else if(r<9&&depth<2)kids.push(...nestedBoundary(depth+1));
   else kids.push({effect:fresh('w'),render:true,expr:rd(pick(sig))})}
  if(family==='probes'||n(4)===0)kids.push(...probeKids());
  return kids};
 const fallbackKids=()=>{const kids=[];if(n(2))kids.push({effect:fresh('f'),render:true,expr:rd(pick(sig))});if(n(3)===0)kids.push({cleanup:fresh('fc')});return kids};
 // A boundary spec (as an op or as a child kind): content children, an optional content expr.
 const spec=(id,depth,errored)=>({id,children:contentKids(depth),...(n(3)?{expr:contentExpr()}:{}),fallback:fallbackKids(),...(errored&&n(2)?{err:true}:{})});
 const view=b=>({effect:fresh('show'),render:true,expr:local(b)});
 // A nested boundary and the render effect that reads its value in the same pass (its insert).
 function nestedBoundary(depth){const errored=rejects&&n(3)===0;const id=fresh(errored?'NE':'NL');const s=spec(id,depth,errored);
  return [errored?{errored:s}:{loading:s},view(id)]}
 // The top-level structure.
 const tops=[];
 const loadingInto=(owner,depth=0)=>{const id='L'+tops.length;const s=spec(id,depth,false);put('loading',{...s,...(owner?{owner}:{})});tops.push(id);return id};
 const erroredOp=(inner,owner)=>{const id='E'+tops.length;const s=spec(id,1,true);
  if(inner)s.children.push({loading:{...spec('L',2,false)}},{effect:fresh('lv'),render:true,expr:local('L')});
  if(inner==='two')s.children.push({loading:{...spec('L2',2,false)}},{effect:fresh('lv'),render:true,expr:local('L2')});
  put('errored',{...s,...(owner?{owner}:{})});tops.push(id);return id};
 let owner=null;
 if(family==='owners'){owner='o1';put('owner',{id:'o1'})}
 if(family==='first-load'||family==='probes'&&!rejects){loadingInto(owner);exposed=true}
 else if(family==='errored')erroredOp(n(3)?'one':null,owner);
 else if(family==='nested'){const r=n(3);if(r===0)erroredOp('two',owner);else if(r===1){
   // Loading > Errored > Loading: the Errored as the Loading's child.
   const id='L'+tops.length;const s={id,children:[{effect:fresh('w'),render:true,expr:rd('s')}],...(n(2)?{expr:rd('s')}:{}),fallback:fallbackKids()};s.children.push({errored:{...spec('E',1,true),children:[...contentKids(1),{loading:spec('L',2,false)},{effect:fresh('lv'),render:true,expr:local('L')}]}},{effect:fresh('ev'),render:true,expr:local('E')});put('loading',{...s,...(owner?{owner}:{})});tops.push(id)}
  else{
   // A Loading in a Show branch (under an Errored) that toggles with `g`.
   put('signal',{id:'g',value:1});const id='E'+tops.length;const s=spec(id,1,true);
   s.children.push({show:{id:'S',when:rd('g'),yes:[{loading:spec('L',2,false)},{effect:fresh('lv'),render:true,expr:local('L')}],no:[{effect:fresh('nv'),render:true,expr:rd('s')}]}},{effect:fresh('sv'),render:true,expr:local('S')});
   put('errored',{...s,...(owner?{owner}:{})});tops.push(id);sig.push('g')}}
 else if(family==='probes')erroredOp('one',owner);
 else if(family==='actions')erroredOp(n(4)?'one':null,owner);
 else if(family==='owners'){if(n(2))erroredOp('one',owner);else{loadingInto(owner);exposed=true}
  if(n(2)){
   // A boundary in a memo's pass: re-created when the memo re-runs (`s`).
   put('memo',{id:'mp',expr:rd('s'),children:[{loading:spec('ML',1,false)},{effect:fresh('mv'),render:true,expr:local('ML')}],cleanup:true});exposed=true}}
 // Render effects reading each top boundary (the insert), and a top read of one.
 for(const b of tops)put('effect',{id:'view'+b,render:true,expr:rd(b)});
 if(n(2))put('effect',{id:'side',render:true,expr:rd(pick(sig))});
 const observe=()=>{const b=pick(tops);put('read',{id:b,label:'r'+b})};
 // The scenario.
 const open=[];let actions=0;
 const memoFlight=()=>{const p=pick(prefixes);return p+':'+(p==='p'?n(2):n(3))};
 const weights={'first-load':[3,1,2,3,3,0,1,0],'errored':[3,2,2,3,3,2,1,2],'nested':[3,2,2,3,3,1,1,1],'probes':[3,2,2,3,3,1,3,1],'actions':[2,5,2,3,3,2,2,1],'owners':[3,2,2,3,3,1,1,1]}[family];
 const total=weights.reduce((x,y)=>x+y,0);
 const pickKind=()=>{let r=n(total);for(let i=0;i<weights.length;i++){if(r<weights[i])return i;r-=weights[i]}};
 const steps=10+n(8);let disposed=false;
 for(let i=0;i<steps;i++){const kind=pickKind();
  if(kind===0){put('write',{id:pick(sig),value:n(5)});if(n(2))put('flush')}
  else if(kind===1&&open.length<2){
   const a=pick(asyncs),flight='f'+actions,stepsA=[];
   if(family==='actions'||n(2))stepsA.push({affects:a});
   const second=[];if(n(2))second.push({refresh:a});if(n(2))second.push({write:pick(sig),value:n(5)});
   const o={id:'act'+actions++,slices:[{steps:stepsA,writes:n(3)===0?[{id:pick(sig),value:n(5)}]:[],flight},{steps:second,writes:[]}]};
   if(n(2))o.catch={writes:[],steps:[{write:'s',value:n(5)}]};
   put('action',o);open.push(flight);if(n(2))put('flush')}
  else if(kind===2)put('flush');
  else if(kind===3){if(n(2))observe();else put('pending',{id:pick(asyncs)})}
  else if(kind===4){const flight=memoFlight();if(rejects&&!exposed&&n(4)===0)put('reject',{flight,message:'load-failed'});else put('resolve',{flight,value:n(5)})}
  else if(kind===5&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(3)===0)put('reject',{flight,message:'save-failed'});else put('resolve',{flight,value:n(5)})}
  else if(kind===6){if(n(2))put('affects',{id:pick(asyncs)});else{put('refresh',{id:pick(asyncs)});if(n(2))put('flush')}}
  else if(kind===7){const e=tops.find(t=>t[0]==='E');if(e&&n(2))put('reset',{id:e});else if(owner&&!disposed&&n(3)===0){put('dispose',{owner});disposed=true}else put('flush')}
  else put('flush');
 }
 // Settle what is still open; settling twice is a no-op.
 for(const flight of open)put('resolve',{flight,value:1});
 for(const p of prefixes)for(let key=0;key<3;key++)if(n(3))put('resolve',{flight:p+':'+key,value:n(5)});
 put('flush');observe();
 return ops;
}
