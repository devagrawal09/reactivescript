// Execution counts of TS line ranges in NODE_V8_COVERAGE runs of the Solid src copy, with
// the block-range rule of docs/slice2a-fuzz/tools/delta.mjs (innermost range wins; a
// line's count is the count at its first non-blank character). For the cut-site table of
// docs/SLICE2B-COVERAGE.md:   node lines.mjs DIR [DIR2] file.ts:A-B ...
// Prints per range: max line count in DIR (and DIR2), and the lines with count > 0.
import {readdirSync,readFileSync,existsSync,statSync} from 'node:fs';
const args=process.argv.slice(2),dirs=args.filter(a=>existsSync(a)&&statSync(a).isDirectory()),ranges=args.filter(a=>!dirs.includes(a));
function load(dir){const files=new Map();
 for(const f of readdirSync(dir)){const j=JSON.parse(readFileSync(dir+'/'+f));for(const s of j.result){if(!s.url.includes('/solid-src/'))continue;(files.get(s.url)??files.set(s.url,[]).get(s.url)).push(...s.functions)}}
 const out=new Map();
 for(const [url,fns] of files){const src=readFileSync(new URL(url),'utf8');const counts=new Float64Array(src.length).fill(-1);const acc=new Map();
  for(const fn of fns)for(const r of fn.ranges){const k=r.startOffset+':'+r.endOffset;acc.set(k,(acc.get(k)??0)+r.count)}
  const rs=[...acc].map(([k,c])=>{const [a,b]=k.split(':').map(Number);return {a,b,c}}).sort((x,y)=>(y.b-y.a)-(x.b-x.a));
  for(const r of rs)for(let i=r.a;i<r.b;i++)counts[i]=r.c;
  const lines=src.split('\n'),lc=[];let off=0;for(const l of lines){const m=l.search(/\S/);lc.push(m<0?-1:counts[off+m]);off+=l.length+1}
  out.set(url.split('/solid-src/')[1],lc)}
 return out}
const data=dirs.map(load);
for(const r of ranges){const [file,span]=r.split(':');const [a,b=a]=span.split('-').map(Number);
 const cols=data.map(d=>{const lc=d.get(file)??[];let max=0;const hit=[];for(let i=a;i<=b;i++){const c=lc[i-1]??-1;if(c>max)max=c;if(c>0)hit.push(i)}return max+(hit.length?' ['+hit[0]+'..'+hit[hit.length-1]+' '+hit.length+' lines]':'')});
 console.log(r.padEnd(32),cols.join('  |  '))}
