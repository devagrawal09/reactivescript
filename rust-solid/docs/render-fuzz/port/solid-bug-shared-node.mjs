// Suspected @solidjs/universal issue (rc.21, solid-next 2105ffb8): reconcileArrays's map-fallback
// removal, `else removeNode(parentNode, a[aStart++])` (universal.ts:313, dist/universal.js:186),
// removes `a[aStart]` without the liveness test the prefix/suffix arms make (isLive,
// universal.ts:251; cleanChildren tests `getParentNode(el) === parent`, universal.ts:330). This
// repro and all 28 invalid render-fuzz programs throw there. The bulk-removal arm
// (universal.ts:273-276) lacks the same check. When another
// region has taken a node of `current`, the host is asked to remove a node from a parent it is
// no longer in; a DOM-like host throws NotFoundError and the render effect halts reactivity.
// Run: node --conditions=browser docs/render-fuzz/port/solid-bug-shared-node.mjs
const base=new URL('../../../../solid-next/packages/',import.meta.url);
const S=await import(new URL('solid/dist/solid.js',base).href);
const U=await import(new URL('universal/dist/universal.js',base).href);
let n=0;const mk=(tag,text)=>({id:n++,tag,text,children:[],parent:null});
const R=U.createRenderer({
 createElement:t=>mk(t),createTextNode:v=>mk(undefined,v),replaceText(node,v){node.text=v},isTextNode:x=>x.tag===undefined,setProperty(){},
 insertNode(p,c,a){if(a!=null&&a.parent!==p)throw new Error('NotFoundError (insertBefore)');if(c.parent)c.parent.children.splice(c.parent.children.indexOf(c),1);
  const ref=a===c?p.children[p.children.indexOf(c)+1]??null:a??null;p.children.splice(ref?p.children.indexOf(ref):p.children.length,0,c);c.parent=p},
 removeNode(p,c){console.log('removeNode(parent #'+p.id+', node #'+c.id+'): node.parent is #'+(c.parent?.id??null));if(c.parent!==p)throw new Error('NotFoundError (removeChild)');p.children.splice(p.children.indexOf(c),1);c.parent=null},
 getParentNode:x=>x.parent,getFirstChild:x=>x.children[0]??null,getNextSibling:x=>x.parent?x.parent.children[x.parent.children.indexOf(x)+1]??null:null});
const show=x=>x.tag===undefined?String(x.text):'<'+x.tag+'#'+x.id+'>'+x.children.map(show).join('')+'</'+x.tag+'>';
const [a,setA]=S.createSignal(true),[b,setB]=S.createSignal(false);
const root=mk('root'),shared=mk('em');R.insertNode(shared,mk(undefined,'shared'));
const p1=mk('p'),p2=mk('p');R.insertNode(root,p1);R.insertNode(root,p2);
S.createRoot(()=>{R.insert(p1,()=>a()?[shared,'x']:['y']);R.insert(p2,()=>b()?shared:'-')});S.flush();
console.log('1',show(root));
setB(true);S.flush();console.log('2',show(root),'(p2 took the shared node)');
const error=console.error;console.error=(...x)=>console.log('console.error:',String(x[0]).split('\n')[0]);
try{setA(false);S.flush();console.log('3',show(root))}catch(e){console.log('3 threw:',e.message)}
console.error=error;
