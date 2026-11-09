// Per-line execution counts of the Solid src copy from a NODE_V8_COVERAGE directory, with each
// file's lines computed FROM THAT FILE ALONE (innermost range wins, a line's count is the count
// at its first non-blank character: the rule of docs/slice2a-fuzz/tools/delta.mjs), then summed
// over files. delta.mjs and lines.mjs instead sum block ranges over files first; V8 omits a
// nested block whose count equals its parent's, so a block one worker ran (omitted there) and
// another never ran (reported with 0) sums to 0 and its lines look unexecuted. Summing per-file
// line counts avoids that. Also sums per-function call counts (keyed by function range+name).
//   node docs/slice2c-fuzz/tools/cov-lines.mjs IN_DIR OUT.json
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const [inDir,outFile]=process.argv.slice(2);
const srcs=new Map(),lines=new Map(),fns=new Map();
const src=url=>{let s=srcs.get(url);if(!s){const t=readFileSync(new URL(url),'utf8');const ls=t.split('\n'),starts=[],first=[];let off=0;for(const l of ls){starts.push(off);const m=l.search(/\S/);first.push(m<0?-1:off+m);off+=l.length+1}
 srcs.set(url,s={len:t.length,ls,starts,first})}return s};
const lineOf=(s,o)=>{let lo=0,hi=s.starts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(s.starts[m]<=o)lo=m;else hi=m-1}return lo+1};
for(const f of readdirSync(inDir)){const j=JSON.parse(readFileSync(inDir+'/'+f));
 for(const sc of j.result){if(!sc.url.includes('/solid-src/'))continue;const s=src(sc.url);
  const rs=[];for(const fn of sc.functions){for(const r of fn.ranges)rs.push(r);const r0=fn.ranges[0];if(r0.startOffset>0){const k=sc.url+'|'+lineOf(s,r0.startOffset)+'-'+lineOf(s,r0.endOffset)+' '+(fn.functionName||'(anonymous)');fns.set(k,(fns.get(k)??0)+r0.count)}}
  rs.sort((x,y)=>(y.endOffset-y.startOffset)-(x.endOffset-x.startOffset));
  const counts=new Float64Array(s.len).fill(-1);for(const r of rs)counts.fill(r.count,r.startOffset,r.endOffset);
  let acc=lines.get(sc.url);if(!acc)lines.set(sc.url,acc=new Float64Array(s.ls.length).fill(-1));
  for(let i=0;i<s.ls.length;i++){const p=s.first[i];if(p<0)continue;const c=counts[p];if(c<0)continue;acc[i]=(acc[i]<0?0:acc[i])+c}}}
const out={lines:{},fns:Object.fromEntries(fns)};for(const [u,a] of lines)out.lines[u.split('/solid-src/')[1]]=Array.from(a);
writeFileSync(outFile,JSON.stringify(out));console.log(Object.keys(out.lines).length,'scripts ->',outFile);
