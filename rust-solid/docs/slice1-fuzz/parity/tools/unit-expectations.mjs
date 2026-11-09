// Solid-side expectations for crates/runtime/tests/slice1.rs (run from the repository root).
const S = await import(new URL('../solid-next/packages/signals/dist/prod/index.js','file://'+process.cwd()+'/').href);
const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();S.flush()};
const fl=()=>{let r,j;const p=new Promise((a,b)=>{r=a;j=b});p.catch(()=>{});return {p,r,j}};
const out={};
{ // T1
 const [s,set]=S.createSignal(0);const fa=fl(),fb=fl();
 S.action(function*(){set(1);yield fa.p})();S.flush();
 S.action(function*(){set(1);yield fb.p})();S.flush();
 fa.r(0);await drain();const a=s();fb.r(0);await drain();out.t1=[a,s()];
}
{ // T2
 const [s,set]=S.createSignal(1);const [o,seto]=S.createOptimistic(0);const f=fl();
 set(1);S.action(function*(){seto(6);yield f.p})();S.flush();set(3);S.flush();const r=[s(),o()];f.r(0);await drain();out.t2=[...r,s(),o()];
}
{ // T3
 let likes,setLikes,shown,setShown;S.createRoot(()=>{[likes,setLikes]=S.createSignal(0);[shown,setShown]=S.createOptimistic(()=>likes());});
 const f=fl();S.action(function*(){setShown(1);setLikes(7);yield f.p})();S.flush();const r=[likes(),shown()];f.r(0);await drain();out.t3=[...r,likes(),shown()];
}
{ // T4
 const [n,setn]=S.createOptimistic(0);const f=fl();
 S.action(function*(){setn(p=>p+1);setn(p=>p+1);yield f.p})();S.flush();const r=n();f.r(0);await drain();out.t4=[r,n()];
}
{ // T5
 const [n,setn]=S.createSignal(0);const fa=fl(),fb=fl();
 S.action(function*(){setn(1);yield fa.p})();S.action(function*(){setn(2);yield fb.p})();S.flush();
 fa.r(0);await drain();const a=n();fb.r(0);await drain();out.t5=[a,n()];
}
console.log(JSON.stringify(out));
