// Mulberry32; all scheduling comes from program ops, never wall-clock time.
export function generate(seed) {
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max),pick=xs=>xs[n(xs.length)];
 const ops=[];const put=(op,rest={})=>ops.push({op,...rest});const read=id=>({op:'read',id}),add=(a,b)=>({op:'add',a,b});
 const mode=seed%6;const observe=id=>{put('read',{id});put('latest',{id});put('pending',{id})};
 put('signal',{id:'s',value:n(4)});put('signal',{id:'t',value:n(4),equals:pick(['default','parity','never'])});put('owner',{id:'scope'});put('cleanup',{owner:'scope',label:'first'});put('cleanup',{owner:'scope',label:'second'});
 if(mode===0||mode===5) {
   const refs=['s','t'];
   for(let i=0;i<5;i++){const id='m'+i;let expr=pick([add(read(pick(refs)),read(pick(refs))),{op:'mod',a:read(pick(refs)),b:2},{op:'choose',test:read('s'),yes:read(pick(refs)),no:read('t')},add(read(pick(refs)),{op:'untrack',expr:read('t')})]);put('memo',{id,expr,lazy:mode===5&&n(2)===0,equals:pick(['default','parity','never']),owner:'scope'});refs.push(id)}
   for(let i=0;i<3;i++)put('effect',{id:'e'+i,expr:read(pick(refs)),render:n(2)===0,defer:n(5)===0,owner:'scope'});
   put('flush');
   for(let i=0;i<25;i++){const k=n(7);if(k<3)put('write',{id:pick(['s','t']),value:n(7)});else if(k===3)put('flush');else if(k===4)observe(pick(refs));else if(k===5)put('refresh',{id:pick(refs.slice(2))});else put('read',{id:pick(refs)})}
   put('flush');put('dispose',{owner:'scope'});put('write',{id:'s',value:99});put('flush');
 } else if(mode===1) {
   put('memo',{id:'a',expr:read('s'),flight:'flight',owner:'scope',...(seed%12===1?{loading:0}:{})});put('memo',{id:'m',expr:add(read('a'),read('t')),owner:'scope'});put('effect',{id:'e',expr:read('m'),owner:'scope'});observe('a');put('flush');
   const initial=ops[0].value;put('resolve',{flight:'flight:'+initial,value:10+n(8)});observe('a');
   if(seed%18===1){put('refresh',{id:'a'});observe('a');put('flush');observe('a');put('resolve',{flight:'flight:'+initial,value:0});observe('a')}
   for(let i=1;i<=3;i++){put('write',{id:'s',value:10+i});put('write',{id:'t',value:n(5)});observe('s');put('flush');observe('s');observe('a');if(i>1&&n(2))put('resolve',{flight:'flight:'+(9+i),value:100+i});if(i===2&&seed%24===1)put('reject',{flight:'flight:'+(10+i),message:'flight-failed'});else put('resolve',{flight:'flight:'+(10+i),value:20+i});observe('m')}
 } else if(mode===2||mode===3) {
   put('signal',{id:'o',value:0,optimistic:true});put('effect',{id:'e',expr:add(read('s'),read('o')),owner:'scope'});put('effect',{id:'et',expr:read('t'),owner:'scope'});put('flush');
   put('write',{id:'t',value:5});
   put('action',{id:'a',slices:[{writes:[{id:'s',value:10},{id:'o',value:50}],flight:'gate-a'},{writes:[{id:'s',value:20}]}]});
   if(mode===3)put('flush');
   put('action',{id:'b',slices:[{writes:[{id:pick(['s','t']),value:30}],flight:'gate-b'},{writes:[{id:'t',value:40}]}]});
   observe('s');observe('o');put('flush');observe('s');observe('t');observe('o');
   const order=n(2)?['a','b']:['b','a'];for(const id of order){if(n(4)===0)put('reject',{flight:'gate-'+id,message:'failed-'+id});else put('resolve',{flight:'gate-'+id,value:1});observe('s');observe('t');observe('o')}
 } else {
   put('memo',{id:'m',expr:{op:'choose',test:read('s'),yes:read('t'),no:{op:'fail',message:'boom'}},owner:'scope'});put('effect',{id:'e',expr:read('m'),owner:'scope'});put('flush');put('read',{id:'m'});
   for(let i=0;i<5;i++){put('write',{id:'s',value:i%2});put('flush');put('read',{id:'m'})}
   put('dispose',{owner:'scope'});put('write',{id:'s',value:7});put('flush');
 }
 return ops;
}
