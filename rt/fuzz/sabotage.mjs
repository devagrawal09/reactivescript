// Wraps a Solid module namespace after import, before the executor uses it.
// Only the variant worker sets workerData.sabotage. Internal Solid calls are untouched;
// only what the executor calls through this namespace changes.
export const SABOTAGE_KINDS=['stale-read','skip-cleanup','no-equals','effect-order','flush-twice','drop-row','store-stale'];

function copyNs(ns){return Object.assign({},ns)}

function copySymbols(from,to){for(const s of Object.getOwnPropertySymbols(from))to[s]=from[s];return to}

// Every 40th tracked signal read (executor-level accessor call) returns the previous
// value that wrapper returned for that signal. The first read of a signal has no previous.
function staleRead(S){
  const state={n:0};
  const wrapGet=get=>{
    let prev,seen=false;
    const wrapped=()=>{
      const v=get();
      state.n++;
      if(state.n%40===0&&seen)return prev;
      seen=true;prev=v;return v};
    return copySymbols(get,wrapped)};
  const wrapPair=orig=>function(...args){
    const pair=orig.apply(this,args);
    return [wrapGet(pair[0]),pair[1]]};
  if(S.createSignal)S.createSignal=wrapPair(S.createSignal);
  if(S.createOptimistic)S.createOptimistic=wrapPair(S.createOptimistic);
}

// Every 5th onCleanup registration is dropped. Effect-returned cleanups are registered
// inside Solid and are not touched.
function skipCleanup(S){
  const orig=S.onCleanup;let n=0;
  S.onCleanup=function(fn){n++;if(n%5===0)return fn;return orig(fn)};
}

// createSignal ignores the equals option (default equality always).
function noEquals(S){
  const orig=S.createSignal;
  S.createSignal=function(value,options){
    if(options&&typeof options==='object'&&'equals' in options){options={...options};delete options.equals}
    return orig(value,options)};
}

// createEffect is created as createRenderEffect (apply-on-creation, no error bundle).
function effectOrder(S){
  const render=S.createRenderEffect;
  S.createEffect=function(compute,effectFn,options){
    const fn=effectFn&&typeof effectFn==='object'&&effectFn.effect?effectFn.effect:effectFn;
    return render(compute,fn,options)};
}

// flush() is a no-op every 7th call, so a queued apply that would have landed does not.
function flushTwice(S){
  const orig=S.flush;let n=0;
  S.flush=function(){n++;if(n%7===0)return;return orig()};
}

// mapArray's map result for index 0 is replaced with the constant 0.
// Arity is preserved (Solid decides index signals from map.length). keyed:false passes
// the index even to an arity-1 map, so the wrapper reads arguments[1].
function dropRow(S){
  const orig=S.mapArray;
  S.mapArray=function(list,mapFn,options){
    let first=true;
    const hit=(item,index)=>{
      const result=mapFn.length>1?mapFn(item,index):mapFn(item);
      let i;
      if(typeof index==='number')i=index;
      else if(typeof index==='function'){try{i=S.untrack?S.untrack(index):index()}catch{i=undefined}}
      const swap=i===0||(i===undefined&&first);
      first=false;
      return swap?0:result};
    const wrapped=mapFn.length>1?function(item,index){return hit(item,index)}:function(item){return hit(item,arguments[1])};
    return orig(list,wrapped,options)};
}

// createStore / createOptimisticStore setter drops every 9th call.
function storeStale(S){
  let n=0;
  const wrap=orig=>function(...args){
    const pair=orig.apply(this,args);
    const set=pair[1];
    const wrapped=function(...a){n++;if(n%9===0)return;return set.apply(this,a)};
    return [pair[0],wrapped]};
  if(S.createStore)S.createStore=wrap(S.createStore);
  if(S.createOptimisticStore)S.createOptimisticStore=wrap(S.createOptimisticStore);
}

export function applySabotage(ns,kind){
  if(!SABOTAGE_KINDS.includes(kind))throw new Error('unknown sabotage '+kind);
  const S=copyNs(ns);
  if(kind==='stale-read')staleRead(S);
  else if(kind==='skip-cleanup')skipCleanup(S);
  else if(kind==='no-equals')noEquals(S);
  else if(kind==='effect-order')effectOrder(S);
  else if(kind==='flush-twice')flushTwice(S);
  else if(kind==='drop-row')dropRow(S);
  else storeStale(S);
  return S;
}
