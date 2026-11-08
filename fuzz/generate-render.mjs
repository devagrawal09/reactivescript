// --render: programs for the renderer differential test (docs/RENDERER.md). Same Mulberry32 RNG
// as the other generators. A program declares signals, renders one view with Solid 2's
// universal renderer (fuzz/universal.mjs; Rust: src/bin/render-driver.rs), then writes,
// flushes, dispatches events and finally may dispose. The view language mirrors compiled
// universal JSX: elements with static children, props (static or effect-bound) and inserts
// (marker: the next static sibling, null, or none for a lone child), components, Show, For,
// renderer memos and the compiler's conditional pattern (`cmemo`).
//
// Families (family = W[seed mod |W|], no RNG):
// - text (3): string/number/boolean/undefined values and concatenations in single and multi
//   inserts, static (non-function) inserts, thunks, type changes (text -> array -> empty ...).
// - arrays (3): nested arrays (fragments) of strings, numbers, elements, thunks, renderer memos
//   and conditional fragments; lengths change to and from 0 (the sentinel of #4274).
// - show (3): Show over string/number/boolean conditions, keyed or not, element or function
//   children, with or without a fallback, nested Shows; branch swaps and same-truthiness writes.
// - for (3): For over row objects (identity, keyed:false, keyed by id), arity 1/2 (index text),
//   optional fallback; inserts, removals, moves, swaps, reversals, clears.
// - bulk (2): For over 66-100 rows: reversals, rotations, block moves of more than 64 rows,
//   shuffles, removals, replacement.
// - events (3): onClick/onInput (delegated by @solidjs/web) and onChange (native) handlers,
//   functions or [handler, data] tuples, static or effect-bound (re-set on writes), disabled
//   nodes, cancelBubble, handler writes; dispatch at random node ids.
// - mixed (2): all of the above in one view, then dispose and further writes.
// In arrays and mixed, 6% of child positions share one node between two places (`let`): a
// node inserted twice moves, so universal's `isLive` and cleanChildren's not-a-child arms run.
const FAMILIES=[['text',3],['arrays',3],['show',3],['for',3],['bulk',2],['events',3],['mixed',2]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const renderFamily=seed=>W[(seed>>>0)%W.length];

export function generateRender(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
 const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)],chance=p=>rnd()<p;
 const family=renderFamily(seed);
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 // Typed signals: S strings, N numbers, P any primitive, A any child datum, L row lists.
 const sig={S:[],N:[],P:[],A:[],L:[]};let sigN=0;
 const STR=['','a','b','hello','0',' ','x y'],str=()=>pick(STR),num=()=>pick([0,1,2,7,-3,42]);
 const prim=()=>pick([str(),num(),true,false,null]);
 const datum=(d=0)=>{const r=n(10);if(r<3)return str();if(r<5)return num();if(r<6)return pick([true,false,null]);if(d<2&&r<9)return Array.from({length:n(4)},()=>datum(d+1));return []};
 let rowN=0;const rows=k=>Array.from({length:k},()=>({row:++rowN}));
 const mk=(t,v)=>{const id=t+(sigN++);sig[t].push(id);put('signal',{id,value:v});return id};
 const value={S:str,N:num,P:prim,A:()=>datum()};
 const read=id=>({x:'read',id});
 const anyRead=ts=>{const ids=ts.flatMap(t=>sig[t]);return ids.length?read(pick(ids)):null};
 // ---- expressions ----
 const textX=()=>{const r=n(6);if(r<2&&sig.S.length)return read(pick(sig.S));if(r<3&&sig.N.length)return read(pick(sig.N));
  if(r<5){const a=sig.S.length?read(pick(sig.S)):str(),b=sig.N.length&&n(2)?read(pick(sig.N)):str();return n(2)?{x:'cat',a,b}:{x:'cat',a:b,b:a}}return pick([str(),num()])};
 const condX=()=>anyRead(['S','N','P'])??pick([true,false,'',1]);
 let handlerN=0,letN=0;
 const handler=()=>{const h={x:'handler',id:'h'+(handlerN++)};if(chance(0.5))h.data=pick([str(),num(),[num(),str()]]);if(chance(0.2))h.stop=true;
  const w=sig.S.concat(sig.N,sig.P);if(w.length&&chance(0.5)){const id=pick(w);h.write={id,value:value[id[0]]()}}return h};
 const evName=()=>pick(['onClick','onClick','onInput','onChange']);
 // An element: static text/element children and inserts; props.
 const el=(d)=>{
  // A lone insert switching between an empty array and a node (cleanChildren's empty-current arm).
  if(d>0&&(family==='text'||family==='arrays')&&chance(0.1))return {x:'el',tag:'p',props:[],kids:[{k:'ins',x:{x:'cond',test:condX(),yes:{x:'arr',items:[]},no:{x:'el',tag:'i',props:[],kids:[{k:'text',v:'n'}]}},fn:true}]};
  const kids=[];const k=1+n(d>1?2:4);
  for(let i=0;i<k;i++){const r=n(10);
   if(r<3)kids.push({k:'text',v:pick(['A','B','C','-',str()||'t'])});
   else if(r<4&&d<3)kids.push({k:'el',el:el(d+1)});
   else kids.push({k:'ins',x:child(d+1),fn:chance(0.75)})}
  const props=[];
  if(family==='events'||family==='mixed'||chance(0.15)){const m=1+n(2);for(let i=0;i<m;i++)props.push({name:evName(),v:chance(0.15)?null:handler(),dyn:chance(0.4)})}
  if(chance(family==='events'?0.3:0.1))props.push({name:'disabled',v:sig.P.length&&chance(0.6)?read(pick(sig.P)):pick([true,false]),dyn:chance(0.6)});
  if(chance(0.2))props.push({name:'title',v:textX(),dyn:chance(0.7)});
  const e={x:'el',tag:pick(['div','span','p','li','b']),props,kids};
  // One handler value (function or tuple) bound once and set again by an effect: assignProp's
  // `value === prev` and same-tuple arms.
  if((family==='events'||family==='mixed')&&chance(0.25)){const id='v'+(letN++),use={x:'var',id};
   props.push({name:evName(),v:{x:'cond',test:condX(),yes:use,no:pick([null,use,handler()])},dyn:true});return {x:'let',id,v:handler(),body:e}}
  return e};
 const show=(d)=>{const s={x:'show',when:condX(),kids:null};
  if(chance(0.3))s.keyed=chance(0.5);
  if(chance(0.25)){s.fn=true;s.kids=pick([{x:'sarg'},{x:'arr',items:['v:',{x:'sarg'}]},{x:'el',tag:'i',kids:[{k:'ins',x:{x:'sarg'},fn:true}]}])}
  else s.kids=child(d+1);
  if(chance(0.6))s.fallback=chance(0.5)?child(d+1):pick(['no','',null]);
  return s};
 const forX=(d,len)=>{const ids=sig.L;const f={x:'for',each:read(pick(ids)),arity:chance(0.4)?2:1};
  const r=n(10);if(r<2)f.keyed=false;else if(r<4)f.keyed='id';else if(r<5)f.keyed=true;
  const rowKids=[{k:'ins',x:{x:'field',of:{x:'item'},key:pick(['label','id'])},fn:true}];
  if(f.arity===2&&chance(0.7))rowKids.push({k:'text',v:'@'},{k:'ins',x:{x:'index'},fn:true});
  if(family==='events'||chance(0.2))rowKids.push({k:'el',el:{x:'el',tag:'button',props:[{name:'onClick',v:handler(),dyn:false}],kids:[{k:'text',v:'x'}]}});
  const rowEl={x:'el',tag:'li',props:[],kids:rowKids};
  f.kids=len==='bulk'?{x:'el',tag:'li',props:[],kids:[{k:'ins',x:{x:'field',of:{x:'item'},key:'label'},fn:true}]}:chance(0.8)?rowEl:{x:'arr',items:[{x:'field',of:{x:'item'},key:'label'},',']};
  if(chance(0.4))f.fallback=pick(['empty',{x:'el',tag:'i',kids:[{k:'text',v:'none'}]},null]);
  return f};
 // A node shared by two places (a `let`-bound element or renderer memo of one): inserting it
 // again moves it, so the other region's `current` names a node that is no longer its own.
 const shared=(d)=>{const id='v'+(letN++),v=chance(0.5)?{x:'memo',body:el(d+1)}:el(d+1),use={x:'var',id};
  const one=x=>({x:'el',tag:'p',props:[],kids:[{k:'ins',x,fn:true}]}),r=n(4);
  const body=r===0?{x:'arr',items:[use,child(d+1),{x:'cond',test:condX(),yes:use,no:child(d+1)}]}
   :r===1?{x:'el',tag:'div',props:[],kids:[{k:'ins',x:use,fn:true},{k:'text',v:'|'},{k:'ins',x:{x:'cond',test:condX(),yes:use,no:'-'},fn:true}]}
   // a lone insert whose array value holds the node, next to one that may take it
   :r===2?{x:'el',tag:'div',props:[],kids:[{k:'el',el:one({x:'cond',test:condX(),yes:{x:'arr',items:[use,'x']},no:el(d+2)})},{k:'el',el:one({x:'cond',test:condX(),yes:use,no:'-'})}]}
   // a lone insert switching between the node and an array holding it
   :one({x:'cond',test:condX(),yes:use,no:{x:'arr',items:[child(d+1),use]}});
  return {x:'let',id,v,body}};
 // A child expression (what an insert or a fragment holds).
 const child=(d)=>{
  const deep=d>3;if(!deep&&(family==='arrays'||family==='mixed')&&chance(0.06))return shared(d);const r=n(deep?4:16);
  if(r<2)return textX();
  if(r<3)return pick([null,true,false,'',num()]);
  if(r<4)return anyRead(['A','P','S','N'])??str();
  if(r<6)return {x:'fn',body:child(d+1)};
  if(r<8)return {x:'arr',items:Array.from({length:n(4)},()=>child(d+1))};
  if(r<9)return el(d);
  if(r<10)return {x:'cmemo',test:condX(),yes:child(d+1),no:child(d+1)};
  if(r<11)return {x:'memo',body:child(d+1)};
  if(r<12)return chance(0.15)?{x:'cond',test:condX(),yes:{x:'arr',items:[]},no:el(d)}:{x:'cond',test:condX(),yes:child(d+1),no:child(d+1)};
  if(r<13)return {x:'comp',body:child(d+1)};
  if(r<15)return show(d);
  return sig.L.length?forX(d):textX()};
 // ---- the program ----
 const nS=1+n(3),nN=1+n(2),nP=1+n(2),nA=family==='arrays'||family==='text'||family==='mixed'?1+n(3):n(2);
 for(let i=0;i<nS;i++)mk('S',str());for(let i=0;i<nN;i++)mk('N',num());for(let i=0;i<nP;i++)mk('P',prim());for(let i=0;i<nA;i++)mk('A',datum());
 const pool=[];
 const nL=family==='for'||family==='bulk'||family==='mixed'?1+n(2):family==='events'||chance(0.3)?1:0;
 for(let i=0;i<nL;i++){const len=family==='bulk'?66+n(35):n(7);const rs=rows(len);pool.push(...rs);mk('L',rs)}
 let view;
 if(family==='bulk')view={x:'el',tag:'ul',props:[],kids:[{k:'text',v:'['},{k:'ins',x:forX(0,'bulk'),fn:false},{k:'text',v:']'}]};
 else if(family==='for')view={x:'el',tag:'ul',props:[],kids:Array.from({length:1+n(2)},()=>({k:'ins',x:forX(0),fn:chance(0.3)})).concat(chance(0.5)?[{k:'text',v:'end'}]:[])};
 else if(family==='show')view={x:'el',tag:'div',props:[],kids:Array.from({length:1+n(3),},()=>chance(0.8)?{k:'ins',x:show(1),fn:false}:{k:'text',v:'|'})};
 else view=chance(0.2)?child(1):el(0);
 put('render',{view});
 // List edits over the current model of a list signal.
 const lists=new Map(sig.L.map((id,i)=>[id,ops.find(o=>o.op==='signal'&&o.id===id).value.slice()]));
 const fresh=()=>({row:++rowN});
 const editList=(id,bulk)=>{let l=lists.get(id).slice();const r=n(bulk?9:10);const len=l.length;
  if(bulk){
   if(r<1)l.reverse();
   else if(r<2){const k=1+n(Math.max(1,len-1));l=l.slice(k).concat(l.slice(0,k))}
   else if(r<4&&len>66){const s=n(len-65),c=65+n(Math.max(1,len-s-65));const blk=l.splice(s,Math.min(c,len-s));const at=n(l.length+1);l.splice(at,0,...blk)}
   else if(r<5){for(let i=l.length-1;i>0;i--){const j=n(i+1);[l[i],l[j]]=[l[j],l[i]]}}
   else if(r<6&&len){const i=n(len),j=n(len);[l[i],l[j]]=[l[j],l[i]]}
   else if(r<7&&len){l.splice(n(len),1+n(5))}
   else if(r<8){l.splice(n(len+1),0,...Array.from({length:1+n(5)},fresh))}
   else l=Array.from({length:66+n(35)},(_,i)=>chance(0.5)&&i<len?l[i]:fresh());
  } else {
   if(r<2)l.splice(n(len+1),0,chance(0.3)&&pool.length?pick(pool):fresh());
   else if(r<4&&len)l.splice(n(len),1);
   else if(r<5&&len>1){const [x]=l.splice(n(len),1);l.splice(n(l.length+1),0,x)}
   else if(r<6&&len>1){const i=n(len),j=n(len);[l[i],l[j]]=[l[j],l[i]]}
   else if(r<7)l.reverse();
   else if(r<8)l=[];
   else if(r<9)l=Array.from({length:n(8)},()=>chance(0.5)&&pool.length?pick(pool):fresh());
   else if(len){l.push(l[n(len)])} // a duplicate row
  }
  for(const x of l)if(!pool.includes(x))pool.push(x);
  lists.set(id,l);put('write',{id,value:l.map(x=>({row:x.row}))})};
 const steps=family==='bulk'?6+n(6):8+n(10);
 for(let s=0;s<steps;s++){const r=n(10);
  if(r<5){const k=1+n(2);for(let i=0;i<k;i++){const t=pick(Object.keys(sig).filter(t=>sig[t].length));const id=pick(sig[t]);
    if(t==='L')editList(id,family==='bulk');else put('write',{id,value:value[t]()})}put('flush')}
  else if(r<7&&(family==='events'||family==='mixed'||family==='for')){put('dispatch',{node:1+n(40),type:pick(['click','click','input','change'])});if(chance(0.7))put('flush')}
  else if(r<8){put('dispatch',{node:1+n(30),type:'click'});put('flush')}
  else if(r<9){const t=pick(Object.keys(sig).filter(t=>sig[t].length&&t!=='L'));if(t){const id=pick(sig[t]);put('write',{id,value:value[t]()})}}
  else put('flush');
 }
 if(family==='mixed'||chance(0.2)){put('dispose');const t=pick(Object.keys(sig).filter(t=>sig[t].length&&t!=='L'));if(t){const id=pick(sig[t]);put('write',{id,value:value[t]()})}put('flush')}
 return ops;
}
