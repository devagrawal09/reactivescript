import {parentPort,workerData} from 'node:worker_threads';
import {run} from './solid.mjs';
// strict (run.mjs --slice2a), fail-closed, the program is invalid instead of a trace:
// - oracle-halted: rc.21 reports an uncaught effect error by console.error('[REACTIVITY_HALTED]',
//   cause) and halts (scheduler.ts haltReactivity);
// - oracle-nonscalar: an observed value is not what docs/OP-LANGUAGE.md allows (an integer,
//   or null for a missing previous value; a boolean for pending; {error} for a failed read).
//   The worker's structured clone would turn an Error-valued memo into {}.
const strict=workerData?.strict;let halted=false;if(strict){const error=console.error;console.error=(...a)=>{if(String(a[0]).startsWith('[REACTIVITY_HALTED]'))halted=true;return error(...a)}}
const int=v=>Number.isInteger(v),opt=v=>v===null||int(v),str=v=>typeof v==='string',failed=v=>v!==null&&typeof v==='object'&&Object.keys(v).join()==='error'&&str(v.error);
const shapes={compute:[str,opt],flight:[str],effect:[str,int,opt],effect_cleanup:[str,int],error:[str,str],cleanup:[str],action:[str,v=>v===null||str(v)],read:[str,v=>int(v)||failed(v)],latest:[str,v=>int(v)||failed(v)],pending:[str,v=>typeof v==='boolean'||failed(v)]};
const scalar=log=>log.every(e=>{const s=shapes[e[0]];return s&&e.length===s.length+1&&s.every((f,i)=>f(e[i+1]))});
// strict 'slice2b' (run.mjs --slice2b): the same rule over the tier-B value domain of
// docs/SLICE2B-DESIGN.md sec. 1 instead of integers. A value is null (also undefined: the
// comparator's JSON makes both null), an integer, a plain array of values, a store proxy
// token {p}, or a raw object {r, v:{field: value}}. Booleans only as `pending` results.
// Anything else (an Error or a string as a value, NaN, the oracle's {nonscalar} marker)
// makes the program oracle-nonscalar.
const plainObj=v=>v!==null&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype,keys=(v,k)=>Object.keys(v).join()===k;
const dom=v=>v===null||v===undefined||int(v)||Array.isArray(v)&&v.every(dom)||plainObj(v)&&(keys(v,'p')&&int(v.p)||keys(v,'r,v')&&int(v.r)&&plainObj(v.v)&&Object.values(v.v).every(dom));
const shapes2b={compute:[str,dom],flight:[str],effect:[str,dom,dom],effect_cleanup:[str,dom],error:[str,str],cleanup:[str],action:[str,v=>v===null||str(v)],read:[str,v=>dom(v)||failed(v)],latest:[str,v=>dom(v)||failed(v)],pending:[str,v=>typeof v==='boolean'||failed(v)],update:[str,dom],derive:[str,dom],caught:[str,str],miss:[str,dom]};
const scalar2b=log=>log.every(e=>{const s=shapes2b[e[0]];return s&&e.length===s.length+1&&s.every((f,i)=>f(e[i+1]))});
// strict 'slice2c' (run.mjs --slice2c): the 'slice2b' rule, plus tier C (docs/SLICE2C-COVERAGE.md):
// a labelled list/For accessor {f: label} is a value, and the events row, fallback and branch.
const dom2c=v=>v===null||v===undefined||int(v)||Array.isArray(v)&&v.every(dom2c)||plainObj(v)&&(keys(v,'p')&&int(v.p)||keys(v,'f')&&str(v.f)||keys(v,'r,v')&&int(v.r)&&plainObj(v.v)&&Object.values(v.v).every(dom2c));
const shapes2c={compute:[str,dom2c],flight:[str],effect:[str,dom2c,dom2c],effect_cleanup:[str,dom2c],error:[str,str],cleanup:[str],action:[str,v=>v===null||str(v)],read:[str,v=>dom2c(v)||failed(v)],latest:[str,v=>dom2c(v)||failed(v)],pending:[str,v=>typeof v==='boolean'||failed(v)],update:[str,dom2c],derive:[str,dom2c],caught:[str,str],miss:[str,dom2c],
 row:[str,int,dom2c,v=>v===null||int(v)],fallback:[str,int],branch:[str,int,v=>v===0||v===1]};
const scalar2c=log=>log.every(e=>{const s=shapes2c[e[0]];return s&&e.length===s.length+1&&s.every((f,i)=>f(e[i+1]))});
// strict 'strings' (run.mjs --strings): the 'slice2c' rule with strings as values.
const domS=v=>v===null||v===undefined||int(v)||str(v)||Array.isArray(v)&&v.every(domS)||plainObj(v)&&(keys(v,'p')&&int(v.p)||keys(v,'f')&&str(v.f)||keys(v,'r,v')&&int(v.r)&&plainObj(v.v)&&Object.values(v.v).every(domS));
const shapesS={compute:[str,domS],flight:[str],effect:[str,domS,domS],effect_cleanup:[str,domS],error:[str,str],cleanup:[str],action:[str,v=>v===null||str(v)],read:[str,v=>domS(v)||failed(v)],latest:[str,v=>domS(v)||failed(v)],pending:[str,v=>typeof v==='boolean'||failed(v)],update:[str,domS],derive:[str,domS],caught:[str,str],miss:[str,domS],
 row:[str,int,domS,v=>v===null||int(v)],fallback:[str,int],branch:[str,int,v=>v===0||v===1]};
const scalarS=log=>log.every(e=>{const s=shapesS[e[0]];return s&&e.length===s.length+1&&s.every((f,i)=>f(e[i+1]))});
parentPort.on('message',async ops=>{try{const expected=await run(ops,progress=>parentPort.postMessage({progress}));const bad=strict&&expected.findIndex(e=>!(strict==='strings'?scalarS:strict==='slice2c'?scalar2c:strict==='slice2b'?scalar2b:scalar)([e]));parentPort.postMessage(halted?{invalid:'oracle-halted'}:bad>=0&&strict?{invalid:'oracle-nonscalar',detail:bad+': '+(strict==='slice2b'||strict==='slice2c'||strict==='strings'?expected[bad].map(x=>x instanceof Error?String(x):JSON.stringify(x)??String(x)):expected[bad].map(x=>x!==null&&typeof x==='object'&&!failed(x)?String(x):x)).join(' ')}:{expected})}catch(e){parentPort.postMessage({invalid:'oracle-error',detail:e.stack})}});
