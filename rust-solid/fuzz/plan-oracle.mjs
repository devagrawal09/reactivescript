// The plan v2 oracle: runs a v2 plan (frontend/plan/docs/PLAN-V2.md) against a version 1 or 2 scenario on
// Solid 2's own primitives (createSignal, createStore, createOptimistic(fn), createMemo, action, Show, For from
// solid-js) and its own @solidjs/universal renderer, with the recording host of fuzz/universal.mjs (FakeNode) and
// @solidjs/web's event delegation; and prints the host's log. `cargo run --bin plan-trace` prints the same log from the
// Rust port (`scenario::trace_v2`); `node fuzz/plan-diff.mjs` compares the two exactly.
//
// The builder mirrors frontend/plan/solid-plan.ts (the JS reference consumer the frontend gate runs): the same
// Solid calls in the same order, which is the order Solid's universal compiler emits for the TSX twin (templates, static
// props, markers, condition memos; PLAN-V2.md "Markup"). Its host log is native Solid's: frontend's plan fuzz
// compares native, compiled RX, solid-plan.ts and this port's `plan-trace` (docs/plan-fuzz/README.md).
// Plan v2.1 (async data: frontend plan/docs/PLAN-V2.md, "v2.1: async data"): async memos (createMemo over a host
// call), isPending/latest probes, refresh/affects steps, Loading/Errored views and structured, pure hosts, against a
// version 2.1 scenario (structured results handed over as fresh copies), as solid-plan.ts builds them.
// Load with `--conditions=browser` (production client builds, the files the other oracles use).
// Usage: node --conditions=browser fuzz/plan-oracle.mjs PLAN.json SCENARIO.json
import {readFileSync} from 'node:fs';
const base=new URL('../../solid-next/packages/',import.meta.url);
const S=await import(new URL('solid/dist/solid.js',base).href);
const U=await import(new URL('universal/dist/universal.js',base).href);
const W=await import(new URL('web/dist/web.js',base).href);

export async function tracePlan(plan,scenario){
 const log=[];
 // ---- the recording host (fuzz/universal.mjs) ----
 const fnIds=new WeakMap();let fnN=0;
 const fnId=f=>{let k=fnIds.get(f);if(k===undefined)fnIds.set(f,k=fnN++);return k};
 const nodes=[];
 class FakeNode{
  constructor(tag,text){this.id=nodes.length;nodes.push(this);this.tag=tag;this.text=text;this.children=[];this.parent=null;this.props=new Map();this.listeners=[]}
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
 const R=U.createRenderer({
  createElement(tag){const n=new FakeNode(tag);log.push(['createElement',tag,n.id]);return n},
  createTextNode(value){if(typeof value!=='string'&&typeof value!=='number')throw new TypeError('createTextNode of a non-text');const n=new FakeNode(undefined,value);log.push(['createTextNode',value,n.id]);return n},
  replaceText(node,value){log.push(['replaceText',need(node).id,enc(value)]);if(node.tag!==undefined)throw new TypeError('replaceText of an element');node.text=value},
  isTextNode(node){const r=need(node).tag===undefined;log.push(['isTextNode',node.id,r]);return r},
  setProperty(node,name,value,prev){log.push(['setProperty',need(node).id,name,enc(value),enc(prev)]);
   if(isEventProp(name))W.assign(node,{[name]:value},true,holder(node,name),true);else node.props.set(name,value)},
  insertNode(parent,node,anchor){log.push(['insertNode',need(parent).id,need(node).id,anchor==null?null:need(anchor).id]);
   if(anchor!=null&&anchor.parent!==parent)throw new Error('NotFoundError');
   let ref=anchor??null;if(ref===node)ref=parent.children[parent.children.indexOf(node)+1]??null;
   if(node.parent){const p=node.parent.children;p.splice(p.indexOf(node),1)}
   const at=ref?parent.children.indexOf(ref):parent.children.length;parent.children.splice(at,0,node);node.parent=parent},
  removeNode(parent,node){log.push(['removeNode',need(parent).id,need(node).id]);if(node.parent!==parent)throw new Error('NotFoundError');
   parent.children.splice(parent.children.indexOf(node),1);node.parent=null},
  getParentNode(node){const r=need(node).parent;log.push(['getParentNode',node.id,r?r.id:null]);return r},
  getFirstChild(node){const r=need(node).children[0]??null;log.push(['getFirstChild',node.id,r?r.id:null]);return r},
  getNextSibling(node){need(node);const p=node.parent,r=p?p.children[p.children.indexOf(node)+1]??null:null;log.push(['getNextSibling',node.id,r?r.id:null]);return r}
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

 // ---- the scenario (slices/run-js.ts timing: three turns of setImmediate, then flush) ----
 const settle=async()=>{for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));S.flush()}};
 const frames=[];let dispose=null;
 const check=()=>{if(fatal!==null)throw new Error(fatal);if(halted)throw new Error('reactivity halted');if(uncaught.length)throw new Error(uncaught[0])};
 let halted=false;const error=console.error;console.error=(...a)=>{if(String(a[0]).startsWith('[REACTIVITY_HALTED]'))halted=true;return error(...a)};
 try{
  for(const[index,step]of scenario.steps.entries()){
   if(step.type==='mount')dispose=R.render(component,root);
   else if(step.type==='click'){
    const cs=clickables(root);
    const t=step.target;const target='element'in step?cs[step.element]?.node:cs.filter(c=>frameOf(c.node)===t.text&&(t.parent===undefined||(c.parent&&frameOf(c.parent)===t.parent)))[t.index]?.node;
    if(!target)throw new Error('step '+index+': no clickable '+JSON.stringify(step.target??step.element));
    dispatch(target,'click');
   }else{
    const r=requests.find(q=>q.host===step.host&&q.number===step.call);
    if(!r)throw new Error('step '+index+': '+step.host+' call #'+step.call+' was not issued');
    if(!r.pending)throw new Error('step '+index+': '+step.host+' call #'+step.call+' is already settled');
    if(step.args&&JSON.stringify(r.args)!==JSON.stringify(step.args))throw new Error('step '+index+': arguments');
    // Format 2.1: a structured result conforms exactly and is handed over as a fresh copy.
    if(step.type==='resolve'&&!conforms(step.value,parseType(r.returns)))throw new Error('step '+index+': '+step.host+' resolved with a value outside '+r.returns);
    r.pending=false;if(step.type==='resolve')r.resolve(typeof step.value==='object'?structuredClone(step.value):step.value);else r.reject(new Error(step.error));
   }
   await settle();
   try{check()}catch(e){throw new Error('step '+index+': '+e.message)}
   const frame=frameOf(root);
   log.push(['step',index,step.type],['tree',tree(root)],['frame',frame]);
   if(frame!==step.frame)throw new Error('step '+index+': expected '+JSON.stringify(step.frame)+', actual '+JSON.stringify(frame));
   frames.push(frame);
  }
  if(requests.some(r=>r.pending))throw new Error('scenario left host calls pending');
  dispose();
  return{result:{frames},log};
 }catch(e){return{result:{error:e.message},log}}
 finally{console.error=error}
}

if(import.meta.url===`file://${process.argv[1]}`){
 const[planPath,scenarioPath]=process.argv.slice(2);
 if(!scenarioPath){console.error('usage: node --conditions=browser fuzz/plan-oracle.mjs PLAN.json SCENARIO.json');process.exit(2)}
 const out=await tracePlan(JSON.parse(readFileSync(planPath,'utf8')),JSON.parse(readFileSync(scenarioPath,'utf8')));
 console.log(JSON.stringify(out));
 if(out.result.error)process.exitCode=1;
}
