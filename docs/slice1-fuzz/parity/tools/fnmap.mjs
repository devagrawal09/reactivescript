// Per-function call counts from V8 coverage of the Solid src copy (docs/SLICE1-PARITY.md).
import {readdirSync,readFileSync} from 'node:fs';
const dir=process.argv[2];const fns=new Map();
for(const f of readdirSync(dir)){const j=JSON.parse(readFileSync(dir+'/'+f));for(const s of j.result){if(!s.url.includes('/solid-src/'))continue;const file=s.url.split('/solid-src/')[1];const src=readFileSync(new URL(s.url),'utf8');for(const fn of s.functions){const r=fn.ranges[0];if(r.startOffset===0)continue;const a=src.slice(0,r.startOffset).split('\n').length,b=src.slice(0,r.endOffset).split('\n').length;const name=fn.functionName||'(anonymous)';const k=file+'\t'+a+'-'+b+'\t'+name;fns.set(k,(fns.get(k)??0)+r.count)}}}
for(const [k,v] of [...fns].sort()) if(v>0) console.log(v+'\t'+k);
