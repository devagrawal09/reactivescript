const S = await import(process.env.SOLID_SIGNALS_URL ?? new URL('../../solid-next/packages/signals/dist/prod/index.js', import.meta.url).href);
export async function run(ops, progress=()=>{}) {
  const nodes=new Map(), setters=new Map(), owners=new Map(), flights=new Map(), log=[];
  const flight=id=>{if(!flights.has(id)){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});promise.catch(()=>{});flights.set(id,{promise,resolve,reject})}return flights.get(id)};
  const makeOwner=(id,parent)=>{let owner,dispose;S.createRoot(d=>{dispose=d;owner=S.getOwner()});owners.set(id,{owner,dispose});if(parent)S.runWithOwner(owners.get(parent).owner,()=>S.onCleanup(dispose));};
  makeOwner('root');
  const owned=(o,f)=>S.runWithOwner(owners.get(o??'root').owner,f);
  const equal=e=>e==='never'?false:e==='parity'?((a,b)=>a%2===b%2):undefined;
  const evalExpr=(e,prev)=>{if(typeof e==='number')return e;switch(e.op){case 'read':return nodes.get(e.id)();case 'add':return evalExpr(e.a,prev)+evalExpr(e.b,prev);case 'mod':return evalExpr(e.a,prev)%e.b;case 'choose':return evalExpr(e.test,prev)?evalExpr(e.yes,prev):evalExpr(e.no,prev);case 'untrack':return S.untrack(()=>evalExpr(e.expr,prev));case 'fail':throw new Error(e.message);case 'prev':return prev??e.fallback;default:throw Error('bad expression')}};
  const observed=f=>{try{return f()}catch(e){return {error:e instanceof S.NotReadyError?'pending':e.message}}};
  const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();S.flush()};
  try {
    for(const [index,o] of ops.entries()) {progress(index);switch(o.op){
      case 'signal':{const [get,set]=owned(null,()=> (o.optimistic?S.createOptimistic:S.createSignal)(o.value,{equals:equal(o.equals)}));nodes.set(o.id,get);setters.set(o.id,set);break}
      case 'memo':{const opts={lazy:o.lazy,equals:equal(o.equals)};if('loading'in o)opts.loadingValue=o.loading;const get=owned(o.owner,()=>S.createMemo(prev=>{log.push(['compute',o.id,prev??null]);const v=evalExpr(o.expr,prev);if(o.flight){const id=o.flight+':'+v;log.push(['flight',id]);return flight(id).promise}return v},opts));nodes.set(o.id,get);break}
      case 'effect':{const compute=prev=>{log.push(['compute',o.id,prev??null]);return evalExpr(o.expr,prev)};const effect=(v,p)=>{log.push(['effect',o.id,v,p??null]);return ()=>{log.push(['effect_cleanup',o.id,v])}};owned(o.owner,()=>{if(o.render)S.createRenderEffect(compute,effect,{defer:o.defer});else S.createEffect(compute,{effect,error:e=>{log.push(['error',o.id,e.message])}},{defer:o.defer})});break}
      case 'write':setters.get(o.id)(o.value);break;
      case 'read':log.push(['read',o.label??o.id,observed(nodes.get(o.id))]);break;
      case 'latest':log.push(['latest',o.id,observed(()=>S.latest(nodes.get(o.id)))]);break;
      case 'pending':log.push(['pending',o.id,observed(()=>S.isPending(nodes.get(o.id)))]);break;
      case 'flush':S.flush();break;
      case 'owner':makeOwner(o.id,o.parent??'root');break;
      case 'cleanup':owned(o.owner,()=>S.onCleanup(()=>{log.push(['cleanup',o.label])}));break;
      case 'dispose':owners.get(o.owner).dispose();break;
      case 'refresh':S.refresh(nodes.get(o.id)).catch(()=>{});break;
      case 'resolve':flight(o.flight).resolve(o.value);await drain();break;
      case 'reject':flight(o.flight).reject(new Error(o.message));await drain();break;
      case 'action':S.action(function*(){for(const slice of o.slices){for(const w of slice.writes??[])setters.get(w.id)(w.value);if(slice.flight)yield flight(slice.flight).promise}})().then(()=>{log.push(['action',o.id,null])},e=>{log.push(['action',o.id,e.message])});break;
      default:throw Error('unknown op '+o.op);
    }}
  } finally {progress('teardown');owners.get('root').dispose();S.flush()}
  const result=log.slice();progress('isolation');
  // A reduced program may leave actions open. Close them after recording teardown
  // so Solid's global queue cannot carry a transaction into the next program.
  for(let i=0;i<4;i++){for(const f of flights.values())f.resolve(0);await drain()}
  return result;
}
