// Slice 2a: the slice-1 shape (plain signal s, optimistic signal o, render effects,
// two-slice actions over flights, resolve/reject, flush) plus async memos over flights.
// Same Mulberry32 RNG, op language, worker oracle and comparator as generate.mjs and
// generate-slice1.mjs. Every op already exists in fuzz/solid.mjs (docs/OP-LANGUAGE.md).
//
// - Async memo `a` returns the promise `q:<key>` with key = s mod 3 (or (s+o) mod 3, so
//   optimistic guesses feed the request). Different values map to one key, so requests
//   reuse the same promise; settling twice is a no-op. Optional loadingValue.
// - `async-chain` adds `b` = flight `r:<a mod 3>` over `a`.
// - Actions write s/o, which feed `a`: their transactions entangle with pending async
//   work. Some actions yield on a memo's own flight (`q:<k>`), shared with the memo.
// - refresh, latest and pending probe the async status; memo flights are resolved or
//   rejected in random order, before or after the request that uses them.
// - `async-lanes` adds a second optimistic signal p. Two open actions guessing o and p
//   give two sibling lanes, and a computation reading both links them (lanes.ts
//   enterLane → linkLanes); with one optimistic signal Solid never links lanes.
//
// Rejected memo flights: in rc.21 an error that reaches a render effect with no
// boundary halts reactivity (scheduler.ts haltReactivity → reportError, an uncaught
// exception in the oracle worker). Programs that may reject a memo flight therefore read
// the async memos only from user effects (`createEffect` with the oracle's logged error
// handler); their render effects read the signals only.
const FAMILIES=['async-actions','async-refresh','async-chain','async-reject','async-lanes'];
export const slice2aFamily=seed=>FAMILIES[(seed>>>0)%FAMILIES.length];
export function generateSlice2a(seed) {
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});const read=id=>({op:'read',id}),add=(a,b)=>({op:'add',a,b}),mod3=e=>({op:'mod',a:e,b:3});
 const family=(seed>>>0)%FAMILIES.length;
 // Memo rejections: always in async-reject, in a third of the others.
 const memoRejects=family===3||n(3)===0;
 put('signal',{id:'s',value:n(3)});put('signal',{id:'o',value:n(4),optimistic:true});
 const lanes=family===4,guesses=lanes?['o','p']:['o'];if(lanes)put('signal',{id:'p',value:n(4),optimistic:true});
 const lanesFeed=n(3)===0;
 put('memo',{id:'a',expr:mod3(lanesFeed?add(read('s'),read(pick(guesses))):read('s')),flight:'q',...(n(2)?{loading:n(3)}:{})});
 const asyncs=['a'],prefixes=['q'];
 if(family===2){put('memo',{id:'b',expr:mod3(read('a')),flight:'r',...(n(3)===0?{loading:n(3)}:{})});asyncs.push('b');prefixes.push('r')}
 const top=asyncs[asyncs.length-1];
 const derived=n(2)===0;if(derived)put('memo',{id:'m',expr:add(read(top),read('o'))});
 const asyncView=(e=>lanes?add(e,read('p')):e)(derived?add(read('m'),read('s')):add(read(top),read('o')));
 if(memoRejects){
  put('effect',{id:'view',expr:add(read('s'),lanes?add(read('o'),read('p')):read('o')),render:true});
  put('effect',{id:'watch',expr:asyncView});
  if(n(2))put('effect',{id:'watch2',expr:read('a')});
 } else {
  put('effect',{id:'view',expr:asyncView,render:true});
  if(n(2))put('effect',{id:'side',expr:add(read('s'),lanes?add(read('o'),read('p')):read('o')),render:true});
  if(n(3)===0)put('effect',{id:'watch',expr:read('a')});
 }
 const nodes=['s',...guesses,...asyncs,...(derived?['m']:[])];
 const observe=id=>{put('read',{id});put('latest',{id});put('pending',{id})};
 observe('a');put('flush');observe(top);
 const open=[];let actions=0;
 // Weights per family: write, action, flush, observe, refresh, settle memo flight, settle action flight.
 const weights=[[2,4,2,3,1,3,3],[2,2,2,3,4,3,2],[2,3,2,3,1,4,2],[2,3,2,3,1,4,3],[2,5,2,3,1,3,3]][family];
 const total=weights.reduce((x,y)=>x+y,0);
 const choose=()=>{let r=n(total);for(let i=0;i<weights.length;i++){if(r<weights[i])return i;r-=weights[i]}};
 const rejectRate=family===3?2:5,memoFlight=()=>pick(prefixes)+':'+n(3);
 const steps=10+n(5);
 for(let i=0;i<steps;i++){const k=choose();
  if(k===0){put('write',{id:pick(['s','s',...guesses]),value:n(6)});if(n(2))put('flush')}
  else if(k===1&&open.length<2){
   // One action in six awaits a memo flight by name: the same promise the memo holds.
   const flight=n(6)===0?'q:'+n(3):'f'+actions;const first=[];if(n(3))first.push({id:pick(guesses),value:n(8)});if(n(4))first.push({id:'s',value:n(6)});if(!first.length)first.push({id:'s',value:n(6)});
   put('action',{id:'a'+actions++,slices:[{writes:first,flight},{writes:n(3)?[{id:'s',value:n(6)}]:[]}]});open.push(flight);if(n(2))put('flush')}
  else if(k===2)put('flush');
  else if(k===3){const id=pick(nodes);if(n(2))observe(id);else put(pick(['read','latest','pending']),{id})}
  else if(k===4){put('refresh',{id:pick(asyncs)});if(n(2))put('flush');observe(pick(asyncs))}
  else if(k===5){const flight=memoFlight();if(memoRejects&&n(rejectRate)===0)put('reject',{flight,message:'memo-failed'});else put('resolve',{flight,value:n(6)});observe(pick(asyncs))}
  else if(open.length){const flight=open.splice(n(open.length),1)[0];if(n(rejectRate)===0&&(memoRejects||flight[0]==='f'))put('reject',{flight,message:'action-failed'});else put('resolve',{flight,value:n(8)});observe(pick(nodes))}
  else put('flush');
 }
 // Settle what is still open so the tail observes landed state; settling twice is a no-op.
 for(const flight of open)put('resolve',{flight,value:1});
 for(const p of prefixes)for(let key=0;key<3;key++)if(n(4))put('resolve',{flight:p+':'+key,value:n(6)});
 put('flush');for(const id of nodes)observe(id);
 return ops;
}
