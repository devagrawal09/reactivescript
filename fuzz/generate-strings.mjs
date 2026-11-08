// --strings: string values through the ported scheduler (the slice-1 driver), on the existing
// op language of fuzz/solid.mjs (docs/OP-LANGUAGE.md, docs/SLICE2C-COVERAGE.md): strings enter
// as signal/write/resolve values and `lit` literals, and are combined by `add` (JS `+`:
// concatenation, an integer's ToString), compared by `eq` (`===` by content) and tested by
// `choose`/`not` (`""` is falsy). Same Mulberry32 RNG, worker oracle (strict 'strings': the
// tier-C value domain plus strings) and exact comparator as the other modes.
//
// Families (family = W[seed mod |W|]):
// - str-scalar (3): string and integer signals (plain and optimistic), memos concatenating and
//   comparing them, render/user effects, writes of equal strings (no change: `===`) and new ones,
//   actions writing strings over flights resolved with strings, an async memo whose flight is
//   named by a string (`q:<string>`), read/latest/pending probes.
// - str-list (3): a signal holding an array of strings (duplicates included) mapped by mapArray
//   in identity, keyed:false or key-function mode; rows render `item + "!"`; edits and actions.
// - str-tracker (4): the slice-2 tracker (frontend-tracker slices/tracker) with its strings:
//   rows {id, title, assignee}, `assignee === ""` as open, mode "all"/"open", status text,
//   Show + For, row texts `title + ": " + (assignee || "nobody")`, claims that guess "me" and
//   write the awaited string, catch writing `"Could not assign #" + id`.
const FAMILIES=[['str-scalar',3],['str-list',3],['str-tracker',4]];
const W=FAMILIES.flatMap(([f,w])=>Array(w).fill(f));
export const stringsFamily=seed=>W[(seed>>>0)%W.length];

const st=id=>({op:'store',id}),get=(of,key)=>({op:'get',of,key}),rd=id=>({op:'read',id}),len=of=>({op:'len',of});
const eq=(a,b)=>({op:'eq',a,b}),not=a=>({op:'not',a}),elem={op:'elem'},arg={op:'arg'},sent={op:'sent'};
const filter=(of,where,native)=>native?{op:'filter',of,where,native:true}:{op:'filter',of,where};
const count=(of,where,native)=>native?{op:'count',of,where,native:true}:{op:'count',of,where};
const replace=(of,where,w,native)=>native?{op:'replace',of,where,with:w,native:true}:{op:'replace',of,where,with:w};
const obj=fields=>({op:'obj',fields}),lit=value=>({op:'lit',value}),plain=(of,fields)=>({op:'plain',of,fields});
const choose=(test,yes,no)=>({op:'choose',test,yes,no}),add=(a,b)=>({op:'add',a,b}),mod=(a,b)=>({op:'mod',a,b});
const item=()=>({op:'item'}),call=of=>({op:'call',of});
const ef=f=>get(elem,f);

export function generateStrings(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
 const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 const probe=(label,expr,kinds=['read'])=>{for(const k of kinds)put(k,{label,expr})};
 const STR=['','a','b','ab','0','me','x y'],str=()=>pick(STR);
 const family=stringsFamily(seed);
 ({'str-scalar':scalar,'str-list':list,'str-tracker':tracker})[family]();
 return ops;

 function scalar(){
  put('signal',{id:'s',value:str()});put('signal',{id:'t',value:str()});put('signal',{id:'k',value:n(5)});
  put('signal',{id:'o',value:str(),optimistic:true});
  const sx=()=>pick([rd('s'),rd('t'),rd('o'),lit(str())]);
  const textE=()=>{const r=n(6);return r<2?add(sx(),sx()):r<3?add(sx(),rd('k')):r<4?add(rd('k'),sx()):r<5?choose(sx(),sx(),lit('empty')):choose(eq(sx(),sx()),lit('same'),add(lit('diff:'),sx()))};
  put('memo',{id:'m1',expr:textE()});put('memo',{id:'m2',expr:add(rd('m1'),choose(not(rd('s')),lit('!'),rd('t')))});
  const asyncMemo=n(2)===0;
  if(asyncMemo)put('memo',{id:'q',expr:add(lit('k'),rd('k')),flight:'q'});
  put('effect',{id:'e1',render:true,expr:rd('m2')});put('effect',{id:'e2',render:n(2)===0,expr:eq(rd('m1'),rd('s'))});
  if(asyncMemo)put('effect',{id:'e3',expr:add(rd('q'),lit('.'))});
  put('flush');
  const open=[],qs=new Set(),asked=new Set();let actions=0;
  if(asyncMemo)asked.add('q:k'+ops.find(o=>o.op==='signal'&&o.id==='k').value);
  const steps=10+n(10);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<35){const id=pick(['s','t','s','k']);put('write',{id,value:id==='k'?n(5):str()});if(id==='k'&&asyncMemo)asked.add('q:k'+ops[ops.length-1].value);if(n(3))put('flush')}
   else if(r<45){const v=ops.filter(o=>o.op==='write'&&o.id==='s').pop()?.value??ops.find(o=>o.id==='s').value;put('write',{id:'s',value:v});put('flush')} // an equal string
   else if(r<60&&open.length<3){const flight='f'+actions;
    put('action',{id:'a'+actions++,slices:[{writes:[{id:'o',value:str()},...(n(2)?[{id:'t',value:str()}]:[])],flight},{steps:[{write:'s',value:str()},{update:'t',expr:add({op:'arg'},sent)}]}]});open.push(flight);if(n(2))put('flush')}
   else if(r<75&&open.length){const flight=open.splice(n(open.length),1)[0];if(n(5)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:str()})}
   else if(r<82&&asyncMemo&&asked.size){const f=pick([...asked]);if(!qs.has(f)){qs.add(f);put('resolve',{flight:f,value:str()})}}
   else if(r<92)probe('p',pick([rd('m1'),rd('m2'),rd('o'),add(rd('s'),rd('o'))]),n(2)?['read','latest','pending']:['read']);
   else put('drain');
  }
  for(const flight of open)put('resolve',{flight,value:'end'});
  if(asyncMemo)for(const f of asked)if(!qs.has(f))put('resolve',{flight:f,value:'z'});
  put('drain');probe('m',rd('m2'),['read','latest']);
 }

 function list(){
  let xs=Array.from({length:n(7)},()=>str());
  put('signal',{id:'xs',value:xs.slice()});put('signal',{id:'sfx',value:pick(['!','?',''])});
  const r=n(10),keyed=r<5?true:r<8?false:{expr:add(elem,lit('#'))},idx=n(2)===0;
  const row=[{effect:'e',render:true,expr:add(item(),rd('sfx'))}];
  if(idx)row.push({effect:'i',render:true,expr:add({op:'index'},lit(':'))});
  if(n(2))row.push({memo:'m',expr:eq(item(),lit(''))},{effect:'v',expr:{op:'local',id:'m'}});
  const fb=n(3)===0?[{effect:'fb',render:true,expr:rd('sfx')}]:undefined;
  put('list',{id:'L',each:rd('xs'),keyed,index:idx,...(fb?{fallback:fb}:{}),row});
  put('effect',{id:'top',render:true,expr:len(rd('L'))});
  put('flush');
  const edit=l=>{l=l.slice();const r=n(8);if(r<2)l.splice(n(l.length+1),0,str());else if(r<4&&l.length)l.splice(n(l.length),1);
   else if(r<5)l.reverse();else if(r<6&&l.length>1){const [x]=l.splice(n(l.length),1);l.splice(n(l.length+1),0,x)}else if(r<7)l=[];else l=l.map(x=>n(3)?x:str());return l};
  const open=[];let actions=0;
  const steps=10+n(9);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<55){xs=edit(xs);put('write',{id:'xs',value:xs.slice()});if(n(10)<8)put('flush')}
   else if(r<65){put('write',{id:'sfx',value:pick(['!','?','',str()])});if(n(2))put('flush')}
   else if(r<75&&open.length<3){const flight='f'+actions,a=edit(xs);put('action',{id:'a'+actions++,slices:[{steps:[{write:'xs',value:a}],flight},{steps:[]}]});open.push(flight);if(n(2))put('flush')}
   else if(r<85&&open.length){const flight=open.splice(n(open.length),1)[0];put('resolve',{flight,value:str()})}
   else if(r<95)probe('L',rd('L'),pick([['read'],['read','latest','pending']]));
   else put('drain');
  }
  for(const flight of open)put('resolve',{flight,value:'x'});
  put('flush');probe('L',rd('L'));
 }

 function tracker(){
  const TITLES=['Crash on save','Slow search','Typo in footer','Login loop','Dark mode'],WHO=['ana','bo','dev'];
  const R=3+n(3),NATIVE=n(2)===0;
  const rows=Array.from({length:R},(_,i)=>({id:i+1,title:TITLES[i%TITLES.length],assignee:n(3)?'':pick(WHO)}));
  put('store',{id:'issues',value:{list:rows}});
  const L=get(st('issues'),'list'),open=eq(ef('assignee'),lit(''));
  put('memo',{id:'shown',optimistic:true,expr:L});
  put('signal',{id:'mode',value:'all'});put('signal',{id:'status',value:''});
  put('memo',{id:'visible',expr:filter(rd('shown'),choose(eq(rd('mode'),lit('all')),1,open),NATIVE)});
  put('memo',{id:'unassigned',expr:count(rd('shown'),open,NATIVE)});
  put('effect',{id:'hm',render:true,expr:add(lit('Filter: '),rd('mode'))});
  put('effect',{id:'hu',render:true,expr:add(rd('unassigned'),lit(' open'))});
  put('show',{id:'B',when:len(rd('visible')),
   yes:[{list:{id:'L',lazy:true,each:rd('visible'),keyed:true,index:false,
    row:[{effect:'t',render:true,expr:add(get(item(),'title'),lit(': '))},{effect:'a',render:true,expr:choose(get(item(),'assignee'),get(item(),'assignee'),lit('nobody'))}]}}],no:[]});
  put('effect',{id:'body',render:true,expr:call(rd('B'))});
  put('effect',{id:'foot',render:true,expr:rd('status')});
  put('flush');
  const pending=[],claims={};let actions=0;
  const steps=10+n(8);
  for(let s=0;s<steps;s++){const r=n(100);
   if(r<40&&pending.length<4){const K=1+n(R),c=claims[K]=(claims[K]??0)+1,flight='assign:'+K+'#'+c;
    put('action',{id:'claim'+actions++,slices:[
     {steps:[{update:'shown',expr:replace(arg,eq(ef('id'),K),obj({id:K,title:ef('title'),assignee:lit('me')}),NATIVE)}],flight},
     {steps:[{store:'issues',edits:[{path:['list',{key:'id',is:K},'assignee'],set:sent}]},{write:'status',value:''}]}],
     catch:{steps:[{update:'status',expr:add(lit('Could not assign #'),K)}]}});
    pending.push(flight);if(n(2))put('drain')}
   else if(r<50){put('write',{id:'mode',value:pick(['all','open'])});put('flush')}
   else if(r<80&&pending.length){const flight=pending.splice(n(pending.length),1)[0];if(n(4)===0)put('reject',{flight,message:'offline'});else put('resolve',{flight,value:pick(WHO)})}
   else if(r<90){const e=pick([plain(rd('shown'),['id','assignee']),call(rd('B')),rd('unassigned'),len(rd('visible'))]);probe('p',e,n(2)?['read','latest','pending']:['read'])}
   else if(r<95)put('drain');
   else put('flush');
  }
  for(const flight of pending)put('resolve',{flight,value:'ana'});
  put('drain');probe('rows',plain(rd('shown'),['id','title','assignee']),['read','latest']);probe('body',call(rd('B')));
 }
}
