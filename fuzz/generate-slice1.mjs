// Same protocol and oracle as generate.mjs; only the scalar action path is generated.
export function generateSlice1(seed) {
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=max=>Math.floor(rnd()*max);
 const ops=[],put=(op,rest={})=>ops.push({op,...rest});
 put('signal',{id:'s',value:n(4)});put('signal',{id:'o',value:n(4),optimistic:true});
 put('effect',{id:'view',expr:{op:'add',a:{op:'read',id:'s'},b:{op:'read',id:'o'}},render:true});put('flush');
 const observe=()=>{put('read',{id:'s'});put('read',{id:'o'})};
 for(let round=0;round<3;round++){
   const flight='f'+round;
   if(n(3)===0)put('write',{id:'s',value:n(8)});
   put('action',{id:'a'+round,slices:[{writes:[{id:'o',value:n(8)},...(n(2)?[{id:'s',value:n(8)}]:[])],flight},{writes:[{id:'s',value:n(8)}]}]});
   observe();put('flush');observe();
   if(n(3)===0){put('write',{id:'s',value:n(8)});put('flush')}
   if(n(2))put('resolve',{flight,value:n(8)});else put('reject',{flight,message:'rejected'});
   observe();
 }
 put('flush');return ops;
}
