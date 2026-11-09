// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
// Fuzz seed 629 (--slice2a), its 13-op reduction (rust-solid/docs/slice2a-fuzz/port/reduced-rust-panic-629.json),
// written on the public API.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);
const flights=new Map();
const flight=id=>{if(!flights.has(id)){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});promise.catch(()=>{});flights.set(id,{promise,resolve,reject})}return flights.get(id)};
const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();S.flush()};
const show=v=>v instanceof Error?`<${v.constructor.name}: ${v.message}>`:typeof v==='string'?JSON.stringify(v):String(v);
let s,setS,o,setO,p,setP,a,m;
S.createRoot(()=>{
 [s,setS]=S.createSignal(2);
 [o,setO]=S.createOptimistic(3);
 [p,setP]=S.createOptimistic(1);
 a=S.createMemo(()=>flight('q:'+(s()%3)).promise,{loadingValue:0});
 m=S.createMemo(()=>a()+o());
 S.createEffect(()=>{const mv=m();const r=mv+s()+p();console.log('watch compute: m() =',show(mv),'-> ',show(r));return r},{effect:v=>console.log('watch effect',show(v)),error:e=>console.log('watch error handler',show(e))});
});
S.action(function*(){setP(3);setS(0);yield flight('q:1').promise;setS(4)})().then(()=>console.log('a0 done'),e=>console.log('a0 rejected',e.message));
flight('q:1').resolve(4);await drain();
S.action(function*(){setO(7);setS(0);yield flight('f1').promise})().then(()=>console.log('a1 done'),e=>console.log('a1 rejected',e.message));
flight('q:2').reject(new Error('memo-failed'));await drain();
flight('q:0').resolve(1);await drain();
S.action(function*(){setS(5);yield flight('q:2').promise;setS(2)})().then(()=>console.log('a3 done'),e=>console.log('a3 rejected',e.message));
flight('f1').resolve(4);await drain();
