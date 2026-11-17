// The benchmark suite's Solid JS driver: runs a workload file (workloads.mjs) on Solid 2 rc.21's own primitives and
// @solidjs/universal, building the plan exactly as rust-solid/fuzz/plan-oracle.mjs does (its builder is copied here,
// unchanged but for the log switch), with the same host minus the log when timing.
//   node --conditions=browser solid-js.mjs WORKLOAD.json [wall|trace]
// wall: 2 warmup samples, then 7; prints median and min µs per op and the final frame's hash.
// trace: one sample with the host log on and 3 settle turns per step (as the plan oracle settles); prints the log.
import {readFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url);
const base=process.env.SOLID_NEXT?new URL(`file://${process.env.SOLID_NEXT}/packages/`):new URL('solid-next/packages/',root);
const S=await import(new URL('solid/dist/solid.js',base).href);
const U=await import(new URL('universal/dist/universal.js',base).href);
const W=await import(new URL('web/dist/web.js',base).href);

// Plan v2.3 (composition) is built by the frontend's reference consumer, plan/solid-plan.ts, the plan fuzz's JS plan leg,
// over this host's renderer. It resolves solid-js to the same solid-next build as the imports above.
const FRONTEND=process.env.FRONTEND??new URL('frontend',root).pathname;
let planComponent=null;
const loadComposition=async()=>{planComponent??=(await import(`${FRONTEND}/plan/solid-plan.ts`)).planComponent};

function app(plan,logging){
 const log=[];
 if(!logging)log.push=()=>0;
 // ---- the recording host (fuzz/universal.mjs) ----
 const fnIds=new WeakMap();let fnN=0;
 const fnId=f=>{let k=fnIds.get(f);if(k===undefined)fnIds.set(f,k=fnN++);return k};
 // Children are a doubly linked sibling list (O(1) insert and remove), as rust-solid's test host keeps them.
 let nodes=0;
 const unlink=n=>{const p=n.parent;if(n.prev)n.prev.next=n.next;else p.first=n.next;if(n.next)n.next.prev=n.prev;else p.last=n.prev;n.prev=n.next=n.parent=null};
 class FakeNode{
  constructor(tag,text){this.id=nodes++;this.tag=tag;this.text=text;this.first=null;this.last=null;this.prev=null;this.next=null;this.parent=null;this.props=new Map();this.listeners=[]}
  get children(){const a=[];for(let c=this.first;c;c=c.next)a.push(c);return a}
  get parentNode(){return this.parent}
  get disabled(){return this.props.get('disabled')}
  addEventListener(name,fn){log.push(['addEventListener',this.id,name,{fn:fnId(fn)}]);if(!this.listeners.some(([n,l])=>n===name&&l===fn))this.listeners.push([name,fn])}
  removeEventListener(name,fn){log.push(['removeEventListener',this.id,name,{fn:fnId(fn)}]);const i=this.listeners.findIndex(([n,l])=>n===name&&l===fn);if(i>=0)this.listeners.splice(i,1)}
  contains(o){for(let n=o;n;n=n.parent)if(n===this)return true;return false}
 }
 class FakeEvent{constructor(type,target){this.type=type;this.cancelBubble=false;this._t=target;this._ct=null}get target(){return this._t}get currentTarget(){return this._ct}}
 const isNode=n=>n instanceof FakeNode,need=n=>{if(!isNode(n))throw new TypeError('not a host node: '+String(n));return n};
 const enc=v=>{
  if(v===undefined||v===null)return null;
  if(typeof v==='boolean'||typeof v==='number'||typeof v==='string')return v;
  if(typeof v==='function')return {fn:fnId(v)};
  if(Array.isArray(v))return v.map(enc);
  if(isNode(v))return {node:v.id};
  throw new TypeError('logging a value outside the domain');
 };
 const root=new FakeNode('#root');
 const isEventProp=p=>p.indexOf(':')<0&&p.startsWith('on')&&p.charCodeAt(2)>64&&p.charCodeAt(2)<91;
 const holders=new Map();const holder=(node,name)=>{const k=node.id+' '+name;if(!holders.has(k))holders.set(k,{});return holders.get(k)};
 // createElement's static props (event handlers, as solid-plan.ts and Solid's universal compiler pass them) go through
 // setProperty, as in the composition branch's plan-fuzz host (frontend/plan/fuzz/host.ts).
 const setProperty=(node,name,value,prev)=>{log.push(['setProperty',need(node).id,name,enc(value),enc(prev)]);
  if(isEventProp(name))W.assign(node,{[name]:value},true,holder(node,name),true);else node.props.set(name,value)};
 const R=U.createRenderer({
  createElement(tag,staticProps){const n=new FakeNode(tag);log.push(['createElement',tag,n.id]);
   if(staticProps)for(const name of Object.keys(staticProps))setProperty(n,name,staticProps[name],undefined);return n},
  createTextNode(value){if(typeof value!=='string'&&typeof value!=='number')throw new TypeError('createTextNode of a non-text');const n=new FakeNode(undefined,value);log.push(['createTextNode',value,n.id]);return n},
  replaceText(node,value){log.push(['replaceText',need(node).id,enc(value)]);if(node.tag!==undefined)throw new TypeError('replaceText of an element');node.text=value},
  isTextNode(node){const r=need(node).tag===undefined;log.push(['isTextNode',node.id,r]);return r},
  setProperty,
  insertNode(parent,node,anchor){log.push(['insertNode',need(parent).id,need(node).id,anchor==null?null:need(anchor).id]);
   if(anchor!=null&&anchor.parent!==parent)throw new Error('NotFoundError');
   let ref=anchor??null;if(ref===node)ref=node.next;
   if(node.parent)unlink(node);
   node.parent=parent;if(ref){node.prev=ref.prev;node.next=ref;if(ref.prev)ref.prev.next=node;else parent.first=node;ref.prev=node}
   else{node.prev=parent.last;if(parent.last)parent.last.next=node;else parent.first=node;parent.last=node}},
  removeNode(parent,node){log.push(['removeNode',need(parent).id,need(node).id]);if(node.parent!==parent)throw new Error('NotFoundError');
   unlink(node)},
  getParentNode(node){const r=need(node).parent;log.push(['getParentNode',node.id,r?r.id:null]);return r},
  getFirstChild(node){const r=need(node).first;log.push(['getFirstChild',node.id,r?r.id:null]);return r},
  getNextSibling(node){const r=need(node).parent?node.next:null;log.push(['getNextSibling',node.id,r?r.id:null]);return r}
 });
 W.registerDelegatedRoot(root);
 const tree=n=>n.tag===undefined?[n.id,enc(n.text)]:[n.id,n.tag,n.children.map(tree)];
 const frameOf=n=>n.tag===undefined?String(n.text):n.children.map(frameOf).join('');
 const dispatch=(target,type)=>{const e=new FakeEvent(type,target),path=[];for(let n=target;n;n=n.parent)path.push(n);
  for(const n of path){const ls=n.listeners.filter(([name])=>name===type).map(([,l])=>l);for(const l of ls){e._ct=n;l.call(n,e)}if(e.cancelBubble)break}};
 // Live clickables, depth-first: a delegated click handler on the node, or a native click listener (the root's
 // delegation listener does not count).
 const clickables=(n,parent,out=[])=>{if(n.tag===undefined)return out;
  if(n['_$$click']||(n!==root&&n.listeners.some(([t])=>t==='click')))out.push({node:n,parent});
  for(const c of n.children)clickables(c,n,out);return out};

 // ---- hosts: every call is a new pending request ----
 const requests=[];
 const typeOk=(v,t)=>typeof v===t&&(t!=='number'||Number.isInteger(v));
 // v2.1: a host result type (frontend eval/interface.ts parseType) and exact conformance (plan/types.ts conforms).
 const parseType=text=>{let i=0;const t=text.trim();const ws=()=>{while(/\s/.test(t[i]??''))i++};
  const one=()=>{ws();let r;if(t[i]==='{'){i++;const fields=[];ws();while(t[i]!=='}'){const k=/^[A-Za-z_$][\w$]*/.exec(t.slice(i))[0];i+=k.length;ws();i++;fields.push([k,one()]);ws();if(t[i]===','||t[i]===';'){i++;ws()}}i++;r={k:'record',fields}}
   else if(t[i]==='('){i++;r=one();ws();i++}else{const w=/^(number|string|boolean)\b/.exec(t.slice(i))[0];i+=w.length;r={k:w}}
   ws();while(t.slice(i,i+2)==='[]'){i+=2;r={k:'array',item:r};ws()}return r};return one()};
 const conforms=(v,t)=>t.k==='number'?typeof v==='number'&&Number.isInteger(v):t.k==='string'||t.k==='boolean'?typeof v===t.k
  :t.k==='array'?Array.isArray(v)&&v.every(x=>conforms(x,t.item))
  :!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===t.fields.length&&t.fields.every(([k,ft])=>Object.prototype.hasOwnProperty.call(v,k)&&conforms(v[k],ft));
 const api=Object.fromEntries(plan.hosts.map(h=>[h.name,(...args)=>{
  if(args.length!==h.params.length||args.some((a,i)=>!typeOk(a,h.params[i])))throw new Error(h.name+' called with '+JSON.stringify(args));
  const number=requests.filter(r=>r.host===h.name).length+1;log.push(['request',h.name,number,args.map(enc)]);
  return new Promise((resolve,reject)=>requests.push({host:h.name,number,args,resolve,reject,pending:true,returns:h.returns}))}]));

 // ---- the plan (solid-plan.ts) ----
 let fatal=null;const fail=m=>{fatal??=m;return new Error(m)};
 const truthy=v=>{if(typeof v==='boolean')return v;if(typeof v==='string')return v!=='';if(typeof v==='number')return v!==0;if(typeof v==='object'&&v!==null)return true;throw fail('truthiness of '+String(v))};
 const integer=v=>{if(typeof v!=='number'||!Number.isInteger(v))throw fail('expected an integer');return v};
 const text=v=>typeof v==='string'?v:String(integer(v));
 const reads=new Map(),setters=new Map(),kinds=new Map(),actions=new Map();
 const lambda=(param,body,env)=>x=>evaluate(body,new Map(env).set(param,x));
 const evaluate=(e,env)=>{
  switch(e.op){
   case 'literal':return e.value;
   case 'array':return e.items.map(x=>evaluate(x,env));
   case 'object':return Object.fromEntries(e.fields.map(f=>[f.key,evaluate(f.value,env)]));
   case 'read':{const r=reads.get(e.source);if(!r)throw fail('unknown source '+e.source);return r()}
   case 'local':{if(!env.has(e.name))throw fail('unbound local '+e.name);return env.get(e.name)}
   // `o.key` alone, as the TSX twin reads it (a store's get trap, never has); no plan value is undefined.
   case 'get':{const o=evaluate(e.object,env);if(typeof o!=='object'||o===null||Array.isArray(o))throw fail('get '+e.key+' of a non-record');const v=o[e.key];if(v===undefined)throw fail('get '+e.key+': no such field');return v}
   case 'length':{const a=evaluate(e.array,env);if(!Array.isArray(a))throw fail('length of a non-array');return a.length}
   case 'filter':case 'map':case 'findIndex':{const a=evaluate(e.array,env);if(!Array.isArray(a))throw fail(e.op+' of a non-array');const f=lambda(e.param,e.body,env);
    return e.op==='map'?a.map(x=>f(x)):e.op==='filter'?a.filter(x=>truthy(f(x))):a.findIndex(x=>truthy(f(x)))}
   case 'add':{const l=evaluate(e.left,env),r=evaluate(e.right,env);if(typeof l==='string'||typeof r==='string')return text(l)+text(r);return integer(l)+integer(r)}
   case 'eq':case 'ne':{const l=evaluate(e.left,env),r=evaluate(e.right,env);return e.op==='eq'?l===r:l!==r}
   case 'lt':case 'le':case 'gt':case 'ge':{const l=integer(evaluate(e.left,env)),r=integer(evaluate(e.right,env));return e.op==='lt'?l<r:e.op==='le'?l<=r:e.op==='gt'?l>r:l>=r}
   case 'and':{const l=evaluate(e.left,env);return truthy(l)?evaluate(e.right,env):l}
   case 'or':{const l=evaluate(e.left,env);return truthy(l)?l:evaluate(e.right,env)}
   case 'not':return !truthy(evaluate(e.value,env));
   case 'cond':return truthy(evaluate(e.test,env))?evaluate(e.then,env):evaluate(e.else,env);
   // v2.1: the probes, evaluated inside Solid's own windows.
   case 'pending':return S.isPending(()=>evaluate(e.value,env));
   case 'latest':return S.latest(()=>evaluate(e.value,env));
   default:throw fail('unknown expression op '+e.op);
  }};
 // A host rejection thrown in at an await is caught by the nearest `try`; an evaluator error is not.
 const rejection=Symbol('rejection');
 function* exec(steps,env){
  for(const s of steps){
   if(s.op==='write'){
    if(!s.path){const value=evaluate(s.value,env);if(kinds.get(s.source)!=='signal')throw fail('a plain write targets a signal');setters.get(s.source)(()=>value);continue}
    if(kinds.get(s.source)!=='store')throw fail('a path write targets a store');
    // Inside the setter, as the TSX twin `setStore(draft => { draft.a[i].b = v })` evaluates it: each segment in turn
    // (an index when reached), then the value, then the set. A node a pending transaction holds reads there as that
    // transaction has it.
    setters.get(s.source)(draft=>{let o=draft;for(const[i,p]of s.path.entries()){if(typeof o!=='object'||o===null)throw fail('store path does not exist');
     const k='key'in p?p.key:integer(evaluate(p.index,env));
     if(typeof k==='number'&&(!Array.isArray(o)||k<0||k>=o.length))throw fail('store path index '+k);
     if(i===s.path.length-1)o[k]=evaluate(s.value,env);else o=o[k]}});
   }else if(s.op==='optimistic'){
    if(kinds.get(s.source)!=='optimistic')throw fail('a guess targets an optimistic source');
    setters.get(s.source)('updater'in s?lambda(s.updater.param,s.updater.body,env):(()=>{const v=evaluate(s.value,env);return()=>v})());
   }else if(s.op==='await'){
    let v;try{v=yield api[s.host](...s.args.map(a=>evaluate(a,env)))}catch(e){throw {[rejection]:e}}
    const r=plan.hosts.find(h=>h.name===s.host).returns;if(!conforms(v,parseType(r)))throw fail('a host result is not a '+r);env.set(s.bind,v);
   }else if(s.op==='try'){
    try{yield* exec(s.body,new Map(env))}catch(e){if(!(e&&e[rejection]))throw e;yield* exec(s.catch,new Map(env))}
   }else if(s.op==='call'){
    const a=actions.get(s.action);if(!a)throw fail('unknown action '+s.action);
    a(...s.args.map(x=>evaluate(x,env))).then(()=>log.push(['action',s.action,null]),e=>{const m=e&&e[rejection]?e[rejection].message:e instanceof Error?e.message:String(e);log.push(['action',s.action,m]);uncaught.push('uncaught failure in action '+s.action+': '+m)});
   }else if(s.op==='refresh'||s.op==='affects'){
    // v2.1: Solid's refresh(memo) / affects(memo) on an async memo's accessor.
    if(kinds.get(s.source)!=='async')throw fail(s.op+' targets an async memo');
    if(s.op==='refresh')void S.refresh(reads.get(s.source)).catch(()=>{});else S.affects(reads.get(s.source));
   }else throw fail('unknown step op '+s.op);
  }}
 const uncaught=[];
 const component=()=>{
  for(const s of plan.sources){kinds.set(s.name,s.kind);
   if(s.kind==='signal'){const[get,set]=S.createSignal(evaluate(s.seed,new Map()));reads.set(s.name,get);setters.set(s.name,set)}
   else if(s.kind==='store'){const[store,set]=S.createStore(evaluate(s.seed,new Map()));reads.set(s.name,()=>store);setters.set(s.name,set)}
   else if(s.kind==='optimistic'){const[get,set]=S.createOptimistic(()=>evaluate(s.seed,new Map()));reads.set(s.name,get);setters.set(s.name,set)}
   else throw fail('unknown source kind '+s.kind)}
  for(const m of plan.memos){
   // v2.1: an async memo, createMemo(() => host(...args)): each computation is one new request.
   if(m.await){kinds.set(m.name,'async');reads.set(m.name,S.createMemo(()=>api[m.await.host](...m.await.args.map(a=>evaluate(a,new Map())))));continue}
   kinds.set(m.name,'memo');reads.set(m.name,S.createMemo(()=>evaluate(m.value,new Map())))}
  for(const a of plan.actions)actions.set(a.name,S.action(function*(...args){if(args.length!==a.params.length)throw fail(a.name+' arity');yield* exec(a.steps,new Map(a.params.map((p,i)=>[p,args[i]])))}));
  const handler=(steps,env)=>()=>{const run=exec(steps,new Map(env));if(!run.next().done)throw fail('a plain handler never awaits')};
  // An element tree is one template, lowered as Solid's universal compiler lowers JSX (solid-next packages/compiler
  // src/universal/transform.rs lower_native_element, lower_universal_children): declare creates the elements (events as
  // static props, which the host applies with setProperty: here createElement then setProp, the same log) and, when an
  // element has more than one child, its static texts, in pre-order; exprs appends each element's static children (a
  // lone static text is created at its append), then runs its children's exprs and its dynamic children's inserts in
  // child order, each before the next static sibling (null if none; no marker for a lone child).
  const isStatic=v=>v.kind==='text'&&v.value.op==='literal';
  const lower=(view,env)=>({view,env,node:null,texts:new Map(),kids:new Map(view.children.map((c,i)=>[i,c]).filter(([,c])=>c.kind==='element').map(([i,c])=>[i,lower(c,env)]))});
  const declare=l=>{l.node=R.createElement(l.view.tag);for(const e of l.view.events)R.setProp(l.node,e.name,handler(e.steps,l.env));
   const multi=l.view.children.length>1;
   l.view.children.forEach((c,i)=>{if(isStatic(c)){if(multi)l.texts.set(i,R.createTextNode(text(c.value.value)))}else if(c.kind==='element')declare(l.kids.get(i))})};
  const exprs=l=>{const cs=l.view.children,multi=cs.length>1;
   cs.forEach((c,i)=>{if(isStatic(c))R.insertNode(l.node,multi?l.texts.get(i):R.createTextNode(text(c.value.value)));else if(c.kind==='element')R.insertNode(l.node,l.kids.get(i).node)});
   cs.forEach((c,i)=>{if(c.kind==='element')return exprs(l.kids.get(i));if(isStatic(c))return;const value=dynamic(c,l.env);if(!multi)return R.insert(l.node,value);
    let marker=null;for(let j=i+1;j<cs.length;j++){if(isStatic(cs[j])){marker=l.texts.get(j);break}if(cs[j].kind==='element'){marker=l.kids.get(j).node;break}}
    R.insert(l.node,value,marker)})};
  const element=(v,env)=>{const l=lower(v,env);declare(l);exprs(l);return l.node};
  // Show's when and For's each: the compiler's transformCondition(…, inline) (compiler src/shared/condition.rs). The test
  // of a conditional with a dynamic branch, or the left of && with both sides dynamic, is read through a memo created in
  // the getter (R.memo(() => test)(); !!test unless a comparison or !); || walks its left spine to such an &&. Dynamic:
  // the TSX twin has a call or member access (a read of a signal, memo or optimistic source, get, length, array methods).
  const dyn=e=>{switch(e.op){case 'literal':case 'local':return false;case 'read':return kinds.get(e.source)!=='store';
   case 'get':case 'length':case 'filter':case 'map':case 'findIndex':return true;case 'array':return e.items.some(dyn);
   case 'object':return e.fields.some(f=>dyn(f.value));case 'not':return dyn(e.value);case 'pending':case 'latest':return true;case 'cond':return dyn(e.test)||dyn(e.then)||dyn(e.else);
   default:return dyn(e.left)||dyn(e.right)}};
  const comparison=e=>['eq','ne','lt','le','gt','ge','not'].includes(e.op);
  const memoized=f=>R.memo(f)();
  const condition=(e,env)=>{
   if(e.op==='cond'){if(!(dyn(e.then)||dyn(e.else))||!dyn(e.test))return evaluate(e,env);
    const c=memoized(()=>comparison(e.test)?evaluate(e.test,env):truthy(evaluate(e.test,env)));const b=truthy(c)?e.then:e.else;
    return b.op==='cond'||b.op==='and'||b.op==='or'?condition(b,env):evaluate(b,env)}
   if(e.op==='and'){if(!dyn(e.right)||!dyn(e.left))return evaluate(e,env);
    if(comparison(e.left)){const c=memoized(()=>evaluate(e.left,env));return truthy(c)?evaluate(e.right,env):c}
    return memoized(()=>truthy(evaluate(e.left,env)))?evaluate(e.right,env):evaluate(e.left,env)}
   if(e.op==='or'&&(e.left.op==='and'||e.left.op==='or')){const l=condition(e.left,env);return truthy(l)?l:evaluate(e.right,env)}
   return evaluate(e,env)};
  const dynamic=(v,env)=>{
   if(v.kind==='text')return()=>text(evaluate(v.value,env));
   if(v.kind==='show')return R.createComponent(S.Show,v.fallback.length?{get when(){return condition(v.when,env)},get fallback(){return fragment(v.fallback,env)},get children(){return fragment(v.children,env)}}
    :{get when(){return condition(v.when,env)},get children(){return fragment(v.children,env)}});
   if(v.kind==='for'){if(v.key!=='identity')throw fail('For keys rows by identity');
    return R.createComponent(S.For,{get each(){const xs=condition(v.each,env);if(!Array.isArray(xs))throw fail('For of a non-array');return xs},children:item=>fragment(v.children,new Map(env).set(v.item,item))})}
   // v2.1: Loading's fallback is a getter, Errored's a function of the error (which the plan does not read).
   if(v.kind==='loading')return R.createComponent(S.Loading,{get fallback(){return fragment(v.fallback,env)},get children(){return fragment(v.children,env)}});
   if(v.kind==='errored')return R.createComponent(S.Errored,{fallback:_error=>fragment(v.fallback,env),get children(){return fragment(v.children,env)}});
   throw fail('unknown view kind '+v.kind)};
  const fragment=(views,env)=>{const parts=views.map(v=>{if(v.kind==='element')return element(v,env);if(v.kind==='text')throw fail('text directly in a component position (the markup, a Show branch, a For row)');return dynamic(v,env)});return parts.length===1?parts[0]:parts};
  return fragment(plan.markup,new Map());
 };


 let dispose=null;
 const nth=(n,i)=>{const go=x=>{if(x.tag===undefined)return null;if(x['_$$click']||(x!==root&&x.listeners.some(([t])=>t==='click'))){if(i===0)return x;i--}for(let c=x.first;c;c=c.next){const r=go(c);if(r)return r}return null};return go(n)};
 return {log,setters,root,
  mount(){dispose=R.render(plan.version===2.3?planComponent(plan,api,{renderer:R}):component,root)},
  dispose(){dispose();dispose=null;const n=log.length;W.unregisterDelegatedRoot?.(root);log.length=n},
  check(){if(fatal!==null)throw new Error(fatal);if(uncaught.length)throw new Error(uncaught[0])},
  // Finding the i-th clickable is the harness's: its time is kept apart and subtracted (as the Rust driver does).
  click(i){const t0=performance.now();const t=nth(root,i);untimed.ms+=performance.now()-t0;if(!t)throw new Error('no clickable '+i);dispatch(t,'click')},
  reject(host,error){const r=requests.find(q=>q.host===host&&q.pending);if(!r)throw new Error('no pending '+host);r.pending=false;r.reject(new Error(error))},
  resolve(host,value){const r=requests.find(q=>q.host===host&&q.pending);if(!r)throw new Error('no pending '+host);r.pending=false;r.resolve(typeof value==='object'?structuredClone(value):value)},
  frame(){return frameOf(root)},tree(){return tree(root)}};
}

// ---- jfb's header buttons and the workload runner ----
const ADJ=["pretty","large","big","small","tall","short","long","handsome","plain","quaint","clean","elegant","easy","angry","crazy","helpful","mushy","odd","unsightly","adorable","important","inexpensive","cheap","expensive","fancy"];
const COLOUR=["red","yellow","blue","green","pink","brown","purple","brown","white","black","orange"];
const NOUN=["table","chair","house","bbq","desk","car","pony","cookie","sandwich","burger","pizza","mouse","keyboard"];
const label=id=>{const h=Number((BigInt(id)*2654435761n)&0xffffffffn);return `${ADJ[h%25]} ${COLOUR[Math.floor(h/25)%11]} ${NOUN[Math.floor(h/275)%13]}`};
const rows=(st,n)=>{const out=[];for(let i=0;i<n;i++){const id=st.next++;out.push({id,label:label(id)})}return out};
const jfb=(a,st,op,n)=>{const set=a.setters.get('rows');
 if(op==='run'||op==='runlots'){const list=rows(st,n??(op==='run'?1000:10000));set(s=>{s.list=list})}
 else if(op==='add'){const more=rows(st,n??1000);set(s=>{const l=s.list,len=l.length;for(let i=0;i<more.length;i++)l[len+i]=more[i]})}
 else if(op==='update')set(s=>{const l=s.list;for(let i=0;i<l.length;i+=10)l[i].label=l[i].label+' !!!'})
 else if(op==='clear')set(s=>{s.list=[]})
 else if(op==='swap')set(s=>{const l=s.list;const k=l.length-2;if(l.length>3){const x=l[1];l[1]=l[k];l[k]=x}})
 else throw new Error('unknown jfb op '+op)};

const fnv=s=>{let h=0xcbf29ce484222325n;for(const b of Buffer.from(s,'utf8')){h^=BigInt(b);h=(h*0x100000001b3n)&0xffffffffffffffffn}return h.toString(16).padStart(16,'0')};

const untimed={ms:0};
export async function sample(w,{logging=false,turns=1,reps=w.reps}={}){
 const asyncPlan=w.plan.hosts.length>0;
 const settle=async()=>{for(let i=0;i<turns;i++){if(asyncPlan||logging)await new Promise(r=>setImmediate(r));S.flush()}};
 let a=null,st={next:1},index=0,last=null;
 const step=async s=>{
  if(s.t==='mount'){a=app(w.plan,logging);a.mount()}
  else if(s.t==='dispose'){a.dispose();last=a.log;a=null;return}
  else if(s.t==='click')a.click(s.i);
  else if(s.t==='resolve')a.resolve(s.host,s.value);
  else if(s.t==='append')a.setters.get(s.source)(d=>{const l=d[s.key];l[l.length]=structuredClone(s.value)});
  else if(s.t==='reject')a.reject(s.host,s.error);
  else if(s.t==='jfb')jfb(a,st,s.op,s.n);
  else throw new Error('unknown step '+s.t);
  await settle();a.check();
  if(logging)a.log.push(['step',index++,s.t],['tree',a.tree()],['frame',a.frame()]);
 };
 const start=async()=>{st={next:1};if(w.mount!=='manual'){a=app(w.plan,logging);a.mount();await settle();a.check()}for(const s of w.init)await step(s)};
 let total=0,frame='',log=null;
 if(w.fresh){
  for(let k=0;k<reps;k++){await start();untimed.ms=0;const t=performance.now();for(const s of w.op)await step(s);total+=performance.now()-t-untimed.ms;
   if(a){frame=a.frame();log=a.log;a.dispose()}else log=last}
 }else{
  await start();untimed.ms=0;const t=performance.now();for(let k=0;k<reps;k++)for(const s of w.op)await step(s);total=performance.now()-t-untimed.ms;frame=a.frame();log=a.log;a.dispose()}
 return {us:total*1000/reps,frame,log};
}

if(import.meta.url===(await import("node:url")).pathToFileURL((await import("node:fs")).realpathSync(process.argv[1])).href){
 const w=JSON.parse(readFileSync(process.argv[2],'utf8'));if(w.plan.version===2.3)await loadComposition();const mode=process.argv[3]??'wall';
 const reps=process.env.REPS?Number(process.env.REPS):w.reps;
 if(mode==='trace'){const r=await sample(w,{logging:true,turns:3,reps});console.log(JSON.stringify({frame:fnv(r.frame),log:r.log}))}
 else{await sample(w,{reps});await sample(w,{reps});const us=[];let frame='';for(let i=0;i<7;i++){const r=await sample(w,{reps});us.push(r.us);frame=r.frame}
  us.sort((x,y)=>x-y);console.log(JSON.stringify({name:w.name,runtime:'solid-js',med:+us[3].toFixed(3),min:+us[0].toFixed(3),frame:fnv(frame),len:frame.length}))}
}
