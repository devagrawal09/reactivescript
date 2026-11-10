const S = await import(process.env.SOLID_SIGNALS_URL ?? new URL('../../solid-next/packages/signals/dist/prod/index.js', import.meta.url).href);
export async function run(ops, progress=()=>{}) {
  const nodes=new Map(), setters=new Map(), owners=new Map(), flights=new Map(), log=[];
  const flight=id=>{if(!flights.has(id)){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});promise.catch(()=>{});flights.set(id,{promise,resolve,reject})}return flights.get(id)};
  const makeOwner=(id,parent)=>{let owner,dispose;S.createRoot(d=>{dispose=d;owner=S.getOwner()});owners.set(id,{owner,dispose});if(parent)S.runWithOwner(owners.get(parent).owner,()=>S.onCleanup(dispose));};
  makeOwner('root');
  const owned=(o,f)=>S.runWithOwner(owners.get(o??'root').owner,f);
  const equal=e=>e==='never'?false:e==='parity'?((a,b)=>a%2===b%2):undefined;
  // ---- Tier B (docs/SLICE2B-DESIGN.md sec. 1-3): stores, structured values, the expression
  // context CX. Reached only through new op names, new fields, or new expression ops.
  // Logging never descends into a store proxy: identity is a lazily numbered token,
  // assigned in first-logged order. A value outside the domain is never thrown on (that
  // would change Solid's control flow); it is logged as {nonscalar} and the strict
  // --slice2b worker marks the program invalid (fail-closed).
  const stores=new Map(),ids=new WeakMap();let tokN=0,CX=null;
  // Tier C: list/For accessors carry a label and log as {f: label} (docs/SLICE2C-COVERAGE.md).
  // Only tier-C ops create labels, so no legacy or tier-B value ever reaches the {f} arm.
  const fnLabels=new WeakMap();
  const tok=o=>{let t=ids.get(o);if(t===undefined)ids.set(o,t=++tokN);return t};
  const enc=v=>{
    if(v===undefined||v===null)return null;
    if(typeof v==='number'||typeof v==='boolean')return v; // non-integers are rejected by the strict worker
    if(typeof v==='function'&&fnLabels.has(v))return {f:fnLabels.get(v)}; // tier C: a labelled list accessor
    if(typeof v==='string')return v; // a string encodes as itself (--strings; no other generator makes one)
    if(typeof v!=='object')return {nonscalar:typeof v};
    if(v[S.$TARGET]!==undefined)return {p:tok(v)}; // store proxy: identity only (brand trap, no reactive read)
    if(Array.isArray(v))return v.map(enc); // plain array: elements
    if(Object.getPrototypeOf(v)!==Object.prototype)return {nonscalar:'object'};
    const o={};for(const k of Object.keys(v))o[k]=enc(v[k]);return {r:tok(v),v:o}; // raw object
  };
  const out=v=>typeof v==='number'||v===undefined?(v??null):enc(v);
  // Legacy log sites: identity on every value the legacy op language can produce (ints,
  // undefined, Error objects, strings, booleans); only arrays, plain objects and store
  // proxies (tier B values) are encoded.
  const lg=v=>v!==null&&typeof v==='object'&&(v[S.$TARGET]!==undefined||Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype)||typeof v==='function'&&fnLabels.has(v)?enc(v):v;
  const within=(cx,f)=>{const s=CX;CX=cx;try{return f()}finally{CX=s}};
  const loop=(xs,f)=>{const n=xs.length;for(let i=0;i<n;i++)f(xs[i],i)};
  const sub=(e,x,i,prev)=>within({...CX,elem:x,pos:i},()=>evalExpr(e,prev));
  const plain=(v,f)=>v===null||typeof v!=='object'?v:Array.isArray(v)?(r=>(loop(v,x=>r.push(plain(x,f))),r))([]):Object.fromEntries(f.map(k=>[k,plain(v[k],f)]));
  const evalExprB=(e,prev)=>{switch(e.op){
    case 'store':return stores.get(e.id).proxy;
    case 'get':{const x=evalExpr(e.of,prev),k=typeof e.key==='object'?evalExpr(e.key,prev):e.key;return x==null?undefined:x[k]}
    case 'has':{const x=evalExpr(e.of,prev);return x!=null&&e.key in x?1:0}
    case 'len':{const x=evalExpr(e.of,prev);return x==null?undefined:x.length}
    case 'eq':return evalExpr(e.a,prev)===evalExpr(e.b,prev)?1:0;
    case 'not':return evalExpr(e.a,prev)?0:1;
    case 'elem':return CX.elem;
    case 'pos':return CX.pos;
    case 'filter':{const x=evalExpr(e.of,prev);if(x==null)return undefined;
      if(e.native)return x.filter((y,i)=>!!sub(e.where,y,i,prev));
      const r=[];loop(x,(y,i)=>{if(sub(e.where,y,i,prev))r.push(y)});return r}
    case 'count':{const x=evalExpr(e.of,prev);if(x==null)return undefined;
      if(e.native)return x.filter((y,i)=>!!sub(e.where,y,i,prev)).length;
      let c=0;loop(x,(y,i)=>{if(sub(e.where,y,i,prev))c++});return c}
    case 'find':{const x=evalExpr(e.of,prev);if(x==null)return undefined;
      if(e.native)return x.findIndex((y,i)=>!!sub(e.where,y,i,prev));
      const n=x.length;for(let i=0;i<n;i++)if(sub(e.where,x[i],i,prev))return i;return -1}
    case 'replace':{const x=evalExpr(e.of,prev);if(x==null)return undefined;
      const f=(y,i)=>sub(e.where,y,i,prev)?sub(e.with,y,i,prev):y;
      if(e.native)return x.map(f);const r=[];loop(x,(y,i)=>r.push(f(y,i)));return r}
    case 'obj':{const o={};for(const k of Object.keys(e.fields))o[k]=evalExpr(e.fields[k],prev);return o}
    case 'arr':return e.items.map(x=>evalExpr(x,prev));
    case 'lit':return structuredClone(e.value);
    case 'plain':return plain(evalExpr(e.of,prev),e.fields);
    case 'arg':return CX.arg;
    case 'sent':return CX.sent;
    case 'draft':return CX.draft;
    // Tier C expressions: row item/index (an accessor is called: a row-signal read), calling
    // a Show/For accessor, a node local to the enclosing row or child pass, concat/reverse.
    case 'item':{const it=rowOf(e.up).item;return typeof it==='function'?it():it}
    case 'index':{const ix=rowOf(e.up).index;return typeof ix==='function'?ix():ix}
    case 'call':{const f=evalExpr(e.of,prev);return typeof f==='function'?f():f}
    case 'local':return CX.scope.get(e.id)();
    case 'concat':{const r=[];for(const it of e.items){const x=evalExpr(it,prev);if(x!=null)loop(x,y=>{r.push(y)})}return r}
    case 'reverse':{const x=evalExpr(e.of,prev);if(x==null)return undefined;const r=[];for(let i=x.length-1;i>=0;i--)r.push(x[i]);return r}
    // Tier D (--boundaries): the verdict windows inside a computation (a tracked isPending /
    // latest: the pass becomes a verdict reader).
    case 'pending':return S.isPending(()=>evalExpr(e.of,prev));
    case 'latest':return S.latest(()=>evalExpr(e.of,prev));
    default:throw Error('bad expression')}};
  const rowOf=up=>{let c=CX.row;for(let d=up??0;d>0;d--)c=c.up;return c};
  const evalExpr=(e,prev)=>{if(typeof e==='number')return e;switch(e.op){case 'read':return nodes.get(e.id)();case 'add':return evalExpr(e.a,prev)+evalExpr(e.b,prev);case 'mod':return evalExpr(e.a,prev)%e.b;case 'choose':return evalExpr(e.test,prev)?evalExpr(e.yes,prev):evalExpr(e.no,prev);case 'untrack':return S.untrack(()=>evalExpr(e.expr,prev));case 'fail':throw new Error(e.message);case 'prev':return prev??e.fallback;default:return evalExprB(e,prev)}};
  const observed=f=>{try{return f()}catch(e){return {error:e instanceof S.NotReadyError?'pending':e.message}}};
  const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();S.flush()};
  const MISS={};
  const findKey=(t,s)=>{const n=t.length;for(let i=0;i<n;i++){const r=t[i];if(r!=null&&r[s.key]===s.is)return i}return -1};
  const val=(e,d)=>within({...CX,draft:d},()=>evalExpr(e));
  const shiftRemove=(a,i)=>{const n=a.length;for(let k=i;k<n-1;k++)a[k]=a[k+1];a.length=n-1};
  const shiftInsert=(a,i,x)=>{for(let k=a.length;k>i;k--)a[k]=a[k-1];a[i]=x};
  const edit=(sid,d,ed)=>{const p=ed.path,isArrOp=!('set'in ed||ed.del);let t=d;
    const seg=s=>{if(typeof s!=='object')return s;const i=findKey(t,s);if(i<0){log.push(['miss',sid,out(s.is)]);throw MISS}return i};
    try{
      for(let i=0;i<p.length-(isArrOp?0:1);i++)t=t[seg(p[i])];
      if(!isArrOp){const k=seg(p[p.length-1]);if(ed.del)delete t[k];else t[k]=val(ed.set,d);return}
      if('push'in ed)t[t.length]=val(ed.push,d);
      else if('insert'in ed)shiftInsert(t,ed.insert[0],val(ed.insert[1],d));
      else if('remove'in ed)shiftRemove(t,ed.remove);
      else if('removeKey'in ed){const i=findKey(t,ed.removeKey);if(i<0)log.push(['miss',sid,out(ed.removeKey.is)]);else shiftRemove(t,i)}
      else if('move'in ed){const [i,j]=ed.move,x=t[i];shiftRemove(t,i);shiftInsert(t,j,x)}
      else if('moveKey'in ed){const m=ed.moveKey,i=findKey(t,m);if(i<0)log.push(['miss',sid,out(m.is)]);else{const x=t[i];shiftRemove(t,i);shiftInsert(t,m.to===0?0:t.length,x)}} // tier C
      else if('splice'in ed){const [i,n,...xs]=ed.splice;t.splice(i,n,...xs.map(e=>val(e,d)))}
      else throw Error('bad edit');
    }catch(e){if(e!==MISS)throw e}};
  const runSet=(sid,s)=>{const st=stores.get(sid),cx=CX;
    if('reconcile'in s)return st.set(S.reconcile(structuredClone(s.reconcile),s.key===undefined?'id':s.key));
    st.set(d=>within(cx,()=>{if('returns'in s)return val(s.returns,d);for(const ed of s.edits)edit(sid,d,ed)}))};
  const upd=(id,e)=>{const cx=CX;setters.get(id)(prev=>{log.push(['update',id,out(prev)]);return within({...cx,arg:prev},()=>evalExpr(e))})};
  const step=st=>'write'in st?setters.get(st.write)(st.value):'update'in st?upd(st.update,st.expr)
    :'affects'in st?S.affects(nodes.get(st.affects))
    :'store'in st?runSet(st.store,st):'refresh'in st?void S.refresh(nodes.get(st.refresh)).catch(()=>{})
    :'refresh_store'in st?void S.refresh(stores.get(st.refresh_store).proxy).catch(()=>{})
    :'read'in st?void log.push(['read',st.label,observed(()=>out(evalExpr(st.read)))]):(()=>{throw Error('bad step')})();
  const extendedAction=o=>S.action(function*(){let sent;
    const run=s=>within({sent},()=>{for(const w of s.writes??[])setters.get(w.id)(w.value);for(const st of s.steps??[])step(st)});
    try{for(const s of o.slices){run(s);if(s.flight)sent=yield flight(s.flight).promise}}
    catch(e){if(!o.catch)throw e;log.push(['caught',o.id,e.message]);run(o.catch)}
  })().then(()=>{log.push(['action',o.id,null])},e=>{log.push(['action',o.id,e.message])});
  const memoFn=o=>prev=>{log.push(['compute',o.id,lg(prev)??null]);const v=evalExpr(o.expr,prev);if(o.flight){const id=o.flight+':'+v;log.push(['flight',id]);return flight(id).promise}return v};
  // ---- Tier C (docs/SLICE2B-DESIGN.md tier C, docs/SLICE2C-COVERAGE.md): mapArray in its three
  // keying modes with exact mapper arity, For (a lazily created mapArray under the owner
  // captured at the "component call"), Show (the three memos of solid-js flow.ts), children
  // built inside computations (memo/effect `children`, `cleanup`), row-owned effects, memos,
  // nested lists/Shows and cleanups, and the row/fallback/branch events. A context is
  // {row, scope}: row = {item, index, up} of the enclosing mapper call (or null), scope = the
  // nodes local to that row or child pass, read by the `local` expression.
  const errText=e=>e instanceof Error?e.message:String(e);
  const childC=(r,pre,cx)=>{
    if('effect'in r){const id=pre+'.'+r.effect;
      const compute=prev=>within(cx,()=>{log.push(['compute',id,lg(prev)??null]);return evalExpr(r.expr,prev)});
      const effect=(v,p)=>{log.push(['effect',id,lg(v),lg(p)??null]);return ()=>{log.push(['effect_cleanup',id,lg(v)])}};
      if(r.render)S.createRenderEffect(compute,effect,{defer:r.defer});
      else S.createEffect(compute,{effect,error:e=>{log.push(['error',id,errText(e)])}},{defer:r.defer});return}
    if('memo'in r){const id=pre+'.'+r.memo;cx.scope.set(r.memo,S.createMemo(prev=>within(cx,()=>{log.push(['compute',id,lg(prev)??null]);return evalExpr(r.expr,prev)})));return}
    if('list'in r){cx.scope.set(r.list.id,makeList({...r.list,id:pre+'.'+r.list.id},cx));return}
    if('show'in r){cx.scope.set(r.show.id,makeShow({...r.show,id:pre+'.'+r.show.id},cx));return}
    if('loading'in r||'errored'in r){const b=r.loading??r.errored;cx.scope.set(b.id,makeBoundary({...b,id:pre+'.'+b.id},cx,'loading'in r));return}
    if('cleanup'in r){S.onCleanup(()=>{log.push(['cleanup',pre+'.'+r.cleanup])});return}
    // A read in the mapper/pass body itself (a component reading a prop at creation): not
    // wrapped in observed(), so a throw (an Error, a NotReadyError) aborts the pass (#2903).
    if('read'in r){log.push(['read',pre+'.'+r.label,within(cx,()=>out(evalExpr(r.read)))]);return}
    throw Error('bad child')};
  // mapArray (lazy: false) or For (lazy: true). `index` gives the mapper arity 2 (map.length > 1
  // decides the index signals); `keyed`: true | false | field name | {expr} (a key function).
  const makeList=(o,cx)=>{const id=o.id;let n=0;
    const keyed=o.keyed===false?false:typeof o.keyed==='string'?(k=>x=>x[k])(o.keyed)
      :o.keyed!==null&&typeof o.keyed==='object'?x=>within({...cx,elem:x},()=>evalExpr(o.keyed.expr)):true;
    const body=(item,index)=>{const s=++n,rid=id+'#'+s;
      log.push(['row',id,s,typeof item==='function'?null:out(item),typeof index==='number'?index:null]);
      S.onCleanup(()=>{log.push(['cleanup',rid])});
      const rc={row:{item,index,up:cx.row},scope:new Map()};for(const r of o.row??[])childC(r,rid,rc);return s};
    const map=o.index?(item,index)=>body(item,index):item=>body(item);
    // For passes {keyed: props.keyed} (undefined when omitted; map.ts treats it as true).
    const opts=o.lazy?{keyed:o.keyed===true?undefined:keyed}:{keyed};
    if(o.fallback)opts.fallback=()=>{const s=++n,fid=id+'#'+s;log.push(['fallback',id,s]);S.onCleanup(()=>{log.push(['cleanup',fid])});
      if(Array.isArray(o.fallback)){const fc={row:cx.row,scope:new Map()};for(const r of o.fallback)childC(r,fid,fc)}return -s};
    const make=()=>S.mapArray(()=>within(cx,()=>evalExpr(o.each)),map,opts);
    if(!o.lazy)return make();
    const owner=S.getOwner();let mapped;
    const list=()=>(mapped??=S.runWithOwner(owner,make))();fnLabels.set(list,id);return list};
  // Show: conditionValue (no options in prod), condition ({equals: !a===!b, sync}; keyed: the
  // conditionValue itself) and the outer memo ({sync}). Element children are built in the
  // outer pass as a JSX children getter would (createComponent untracks only the component
  // call; building them reads nothing); function children (fn: true) run under untrack with
  // the narrowed accessor (keyed: the raw value). The outer value is the pass number, or the
  // accessor of the last list child (what an insert() hole would read).
  const makeShow=(o,cx)=>{const id=o.id;let pass=0,shown;
    const cv=S.createMemo(()=>within(cx,()=>evalExpr(o.when)));
    const cond=o.keyed?cv:S.createMemo(cv,{equals:(a,b)=>!a===!b,sync:true});
    const build=(kids,p,item)=>{const pre=id+'@'+p,sc={row:item===undefined?cx.row:{item,index:undefined,up:cx.row},scope:new Map()};let ret=p;
      for(const r of kids){childC(r,pre,sc);if('list'in r)ret=sc.scope.get(r.list.id)}return ret};
    return S.createMemo(()=>{const c=cond(),run=(shown={}),p=++pass;log.push(['branch',id,p,c?1:0]);
      if(!c)return build(o.no??[],p,undefined);
      if(!o.fn)return build(o.yes??[],p,undefined);
      return S.untrack(()=>build(o.yes??[],p,o.keyed?c:()=>{(S.verdict&&shown===run)||cond()||(()=>{throw 'Stale read from <Show>.'})();return cv()}))},{sync:true})};
  // ---- Tier D (--boundaries, docs/BOUNDARIES-COVERAGE.md): Loading and Errored boundaries over
  // children built in the boundary's children computed (as a JSX children getter), a fallback
  // built in its own computed (Loading's a getter; Errored's a function of the error accessor
  // and reset, which reads the error when `err` is set), and the events bcontent / bfallback
  // (the pass that built them) and berror (the error the fallback read). The boundary's value
  // is the content's `expr` (or its pass number) or the fallback's negated pass number; its
  // accessor is a node (read it from a render effect to put it on screen).
  const resets=new Map();
  const makeBoundary=(o,cx,loading)=>{const id=o.id;let kp=0,fp=0;
    const kids=()=>{const p=++kp,pre=id+'^'+p;log.push(['bcontent',id,p]);const sc={row:cx.row,scope:new Map()};for(const r of o.children??[])childC(r,pre,sc);return 'expr'in o?within(sc,()=>evalExpr(o.expr)):p};
    const fb=err=>{const p=++fp,pre=id+'~'+p;log.push(['bfallback',id,p]);if(err&&o.err)log.push(['berror',id,errText(err())]);const sc={row:cx.row,scope:new Map()};for(const r of o.fallback??[])childC(r,pre,sc);return -p};
    return loading?S.createLoadingBoundary(kids,()=>fb()):S.createErrorBoundary(kids,(err,reset)=>{resets.set(id,reset);return fb(err)})};
  // A memo or effect whose pass builds children (untracked, as a component call) and
  // registers a cleanup: every re-run parks or disposes the previous pass's frame.
  const childPass=(o,pre)=>{S.untrack(()=>{const sc={row:null,scope:new Map()};for(const r of o.children??[])childC(r,pre,sc)});if(o.cleanup)S.onCleanup(()=>{log.push(['cleanup',pre])})};
  const memoC=o=>{let k=0;const opts={lazy:o.lazy,equals:equal(o.equals)};if('loading'in o)opts.loadingValue=o.loading;
    const fn=prev=>{log.push(['compute',o.id,lg(prev)??null]);childPass(o,o.id+'@'+(++k));const v=evalExpr(o.expr,prev);if(o.flight){const id=o.flight+':'+v;log.push(['flight',id]);return flight(id).promise}return v};
    if(o.optimistic){const [get,set]=owned(o.owner,()=>S.createOptimistic(fn,opts));nodes.set(o.id,get);setters.set(o.id,set)}else nodes.set(o.id,owned(o.owner,()=>S.createMemo(fn,opts)))};
  const effectC=o=>{let k=0;const compute=prev=>{log.push(['compute',o.id,lg(prev)??null]);childPass(o,o.id+'@'+(++k));return evalExpr(o.expr,prev)};
    const effect=(v,p)=>{log.push(['effect',o.id,lg(v),lg(p)??null]);return ()=>{log.push(['effect_cleanup',o.id,lg(v)])}};
    owned(o.owner,()=>{if(o.render)S.createRenderEffect(compute,effect,{defer:o.defer});else S.createEffect(compute,{effect,error:e=>{log.push(['error',o.id,errText(e)])}},{defer:o.defer})})};
  try {
    for(const [index,o] of ops.entries()) {progress(index);switch(o.op){
      case 'signal':{const [get,set]=owned(null,()=> (o.optimistic?S.createOptimistic:S.createSignal)(o.value,{equals:equal(o.equals)}));nodes.set(o.id,get);setters.set(o.id,set);break}
      case 'memo':{if(o.children||'cleanup'in o){memoC(o);break}const opts={lazy:o.lazy,equals:equal(o.equals)};if('loading'in o)opts.loadingValue=o.loading;if(o.optimistic){const [get,set]=owned(o.owner,()=>S.createOptimistic(memoFn(o),opts));nodes.set(o.id,get);setters.set(o.id,set);break}const get=owned(o.owner,()=>S.createMemo(prev=>{log.push(['compute',o.id,lg(prev)??null]);const v=evalExpr(o.expr,prev);if(o.flight){const id=o.flight+':'+v;log.push(['flight',id]);return flight(id).promise}return v},opts));nodes.set(o.id,get);break}
      case 'effect':{if(o.children||'cleanup'in o){effectC(o);break}const compute=prev=>{log.push(['compute',o.id,lg(prev)??null]);return evalExpr(o.expr,prev)};const effect=(v,p)=>{log.push(['effect',o.id,lg(v),lg(p)??null]);return ()=>{log.push(['effect_cleanup',o.id,lg(v)])}};owned(o.owner,()=>{if(o.render)S.createRenderEffect(compute,effect,{defer:o.defer});else S.createEffect(compute,{effect,error:e=>{log.push(['error',o.id,e.message])}},{defer:o.defer})});break}
      case 'write':setters.get(o.id)(o.value);break;
      case 'read':if('expr'in o){const f=()=>evalExpr(o.expr);log.push([o.op,o.label,observed(()=>out(o.op==='read'?f():o.op==='latest'?S.latest(f):S.isPending(f)))]);break}log.push(['read',o.label??o.id,observed(()=>lg(nodes.get(o.id)()))]);break;
      case 'latest':if('expr'in o){const f=()=>evalExpr(o.expr);log.push([o.op,o.label,observed(()=>out(o.op==='read'?f():o.op==='latest'?S.latest(f):S.isPending(f)))]);break}log.push(['latest',o.id,observed(()=>lg(S.latest(nodes.get(o.id))))]);break;
      case 'pending':if('expr'in o){const f=()=>evalExpr(o.expr);log.push([o.op,o.label,observed(()=>out(o.op==='read'?f():o.op==='latest'?S.latest(f):S.isPending(f)))]);break}log.push(['pending',o.id,observed(()=>S.isPending(nodes.get(o.id)))]);break;
      case 'flush':S.flush();break;
      case 'owner':makeOwner(o.id,o.parent??'root');break;
      case 'cleanup':owned(o.owner,()=>S.onCleanup(()=>{log.push(['cleanup',o.label])}));break;
      case 'dispose':owners.get(o.owner).dispose();break;
      case 'refresh':if('store'in o){S.refresh(stores.get(o.store).proxy).catch(()=>{});break}S.refresh(nodes.get(o.id)).catch(()=>{});break;
      case 'resolve':flight(o.flight).resolve(o.value);await drain();break;
      case 'reject':flight(o.flight).reject(new Error(o.message));await drain();break;
      case 'action':if('catch'in o||o.slices.some(s=>'steps'in s)){extendedAction(o);break}S.action(function*(){for(const slice of o.slices){for(const w of slice.writes??[])setters.get(w.id)(w.value);if(slice.flight)yield flight(slice.flight).promise}})().then(()=>{log.push(['action',o.id,null])},e=>{log.push(['action',o.id,e.message])});break;
      // Tier B ops (docs/SLICE2B-DESIGN.md sec. 3.2).
      case 'store':{let pair;const v=structuredClone(o.value??o.seed);
        const make=o.optimistic?S.createOptimisticStore:S.createStore;
        if(o.derive){const d=o.derive,cnt=new Map();
          const fn=draft=>within(null,()=>{const k=evalExpr(d.expr);let name=d.flight+':'+k;
            if(d.fresh){const c=(cnt.get(k)??0)+1;cnt.set(k,c);name+='#'+c}
            log.push(['derive',o.id,out(k)]);log.push(['flight',name]);return flight(name).promise});
          const opts={key:o.key===undefined?'id':o.key};if(o.seedLoading)opts.seedLoadingValue=true;
          pair=owned(o.owner,()=>make(fn,v,opts));
        } else pair=owned(o.owner,()=>make(v,{...(o.shallow?{shallow:true}:{}),...(o.optimistic&&'key'in o?{key:o.key}:{})}));
        stores.set(o.id,{proxy:pair[0],set:pair[1]});break}
      case 'store_set':runSet(o.id,o);break;
      case 'update':upd(o.id,o.expr);break;
      case 'drain':await drain();break;
      // Tier C ops.
      case 'list':nodes.set(o.id,owned(o.owner,()=>makeList(o,{row:null,scope:new Map()})));break;
      case 'show':nodes.set(o.id,owned(o.owner,()=>makeShow(o,{row:null,scope:new Map()})));break;
      // Tier D ops.
      case 'loading':case 'errored':nodes.set(o.id,owned(o.owner,()=>makeBoundary(o,{row:null,scope:new Map()},o.op==='loading')));break;
      case 'affects':S.affects(nodes.get(o.id));break;
      case 'reset':{const r=resets.get(o.id);if(r)r();break}
      default:throw Error('unknown op '+o.op);
    }}
  } finally {progress('teardown');owners.get('root').dispose();S.flush()}
  // Each program gets a fresh worker. Freeze the trace before any unrequested
  // promise continuation, then terminate the worker instead of draining orphans.
  return log.slice();
}
