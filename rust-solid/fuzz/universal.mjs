// The renderer oracle: runs a --render program (docs/RENDERER.md, "Program language") on Solid 2's
// own @solidjs/universal createRenderer (solid-next 2105ffb8, built, read-only), with Show/For
// and createComponent from solid-js and event plumbing from @solidjs/web. Load it with
// `--conditions=browser` (the worker does): 'solid-js' then resolves to the client build
// (packages/solid/dist/solid.js) and its signals to packages/signals/dist/prod/index.js, the
// same file fuzz/solid.mjs uses. All three packages share that one solid-js instance.
//
// The host is a recording tree (FakeNode): every host call, queries included, is logged with
// its arguments and result. crates/runtime/src/renderer.rs TreeRenderer is the same host in
// Rust. Event props go through @solidjs/web's own `assign` (assignProp's event arm, addEvent,
// delegateEvents); the root container is registered with `registerDelegatedRoot`. Events are
// dispatched DOM-style (propagation path fixed first, native listeners in order, cancelBubble
// stops after a node). Nothing is filtered or normalized: the log is the comparison.
const base=new URL('../../solid-next/packages/',import.meta.url);
const S=await import(new URL('solid/dist/solid.js',base).href);
const U=await import(new URL('universal/dist/universal.js',base).href);
const W=await import(new URL('web/dist/web.js',base).href);

export function runRender(ops){
 const log=[];
 // Function identities, numbered in first-logged order.
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
 const dispatch=(target,type)=>{const e=new FakeEvent(type,target),path=[];for(let n=target;n;n=n.parent)path.push(n);
  for(const n of path){const ls=n.listeners.filter(([name])=>name===type).map(([,l])=>l);for(const l of ls){e._ct=n;l.call(n,e)}if(e.cancelBubble)break}};

 // ---- the program ----
 const signals=new Map(),setters=new Map(),rows=new Map();
 const row=k=>{if(!rows.has(k))rows.set(k,{id:k,label:'r'+k});return rows.get(k)};
 const data=d=>d===null?undefined:Array.isArray(d)?d.map(data):typeof d==='object'?row(d.row):d;
 const call=v=>typeof v==='function'?v():v;
 const ev=(x,cx)=>{
  if(x===null)return undefined;
  if(typeof x!=='object')return x;
  switch(x.x){
   case 'read':return signals.get(x.id)();
   case 'cat':return ev(x.a,cx)+ev(x.b,cx);
   case 'not':return !ev(x.a,cx);
   case 'cond':return ev(x.test,cx)?ev(x.yes,cx):ev(x.no,cx);
   case 'arr':return x.items.map(i=>ev(i,cx));
   case 'fn':return ()=>ev(x.body,cx);
   case 'memo':return R.memo(()=>ev(x.body,cx));
   case 'cmemo':{const c=R.memo(()=>!!ev(x.test,cx));return ()=>c()?ev(x.yes,cx):ev(x.no,cx)}
   case 'el':return element(x,cx);
   case 'comp':return R.createComponent(()=>ev(x.body,cx),{});
   case 'show':{const props={get when(){return ev(x.when,cx)},
     get children(){return x.fn?(a=>ev(x.kids,{...cx,sarg:a})):ev(x.kids,cx)}};
    if('keyed'in x)props.keyed=x.keyed;
    if('fallback'in x)Object.defineProperty(props,'fallback',{get(){return ev(x.fallback,cx)},enumerable:true});
    return R.createComponent(S.Show,props)}
   case 'sarg':return call(cx.sarg);
   case 'for':{const props={get each(){return ev(x.each,cx)},
     children:x.arity===2?(item,index)=>ev(x.kids,{...cx,item,index}):item=>ev(x.kids,{...cx,item})};
    if('keyed'in x)props.keyed=x.keyed==='id'?(r=>r.id):x.keyed;
    if('fallback'in x)Object.defineProperty(props,'fallback',{get(){return ev(x.fallback,cx)},enumerable:true});
    return R.createComponent(S.For,props)}
   case 'let':return ev(x.body,{...cx,vars:{...cx.vars,[x.id]:ev(x.v,cx)}});
   case 'var':return cx.vars[x.id];
   case 'item':return call(cx.item);
   case 'index':return call(cx.index);
   case 'field':return ev(x.of,cx)[x.key];
   case 'handler':{const h=x;const f=function(a,b){const n=arguments.length,e=n===2?b:a;
     log.push(['handler',h.id,n,n===2?enc(a):null,e.type,e.currentTarget?e.currentTarget.id:null,e.target.id]);
     if(h.stop)e.cancelBubble=true;if(h.write)setters.get(h.write.id)(data(h.write.value))};
    return 'data'in h?[f,data(h.data)]:f}
   default:throw new Error('bad expression '+x.x);
  }};
 // Compiled-JSX shape: the element, its static children (template), its props, then one
 // insert per dynamic child with the next static sibling as marker (null: none after; a
 // lone dynamic child has no marker).
 const element=(x,cx)=>{const el=R.createElement(x.tag);const kids=x.kids??[],st=[];
  for(const k of kids){if(k.k==='text'){const t=R.createTextNode(k.v);R.insertNode(el,t);st.push(t)}else if(k.k==='el'){const n=ev(k.el,cx);R.insertNode(el,n);st.push(n)}else st.push(null)}
  for(const p of x.props??[]){if(p.dyn)R.effect(()=>ev(p.v,cx),(v,prev)=>{R.setProp(el,p.name,v,prev)});else R.setProp(el,p.name,ev(p.v,cx))}
  kids.forEach((k,i)=>{if(k.k!=='ins')return;let m=null;for(let j=i+1;j<kids.length;j++)if(st[j]){m=st[j];break}
   if(kids.length===1)m=undefined;R.insert(el,k.fn?()=>ev(k.x,cx):ev(k.x,cx),m)});
  return el};
 let dispose=null;
 for(const o of ops){
  switch(o.op){
   case 'signal':{const [g,s]=S.createSignal(data(o.value));signals.set(o.id,g);setters.set(o.id,s);break}
   case 'render':{if(dispose)throw new Error('render twice');dispose=R.render(()=>ev(o.view,{}),root);break}
   case 'write':setters.get(o.id)(data(o.value));break;
   case 'flush':S.flush();break;
   case 'dispatch':{const n=nodes[o.node];log.push(['dispatch',o.node,o.type,n?1:0]);if(n)dispatch(n,o.type);break}
   case 'dispose':{if(dispose){dispose();dispose=null}break}
   default:throw new Error('unknown op '+o.op);
  }
  log.push(['tree',tree(root)]);
 }
 return log;
}
