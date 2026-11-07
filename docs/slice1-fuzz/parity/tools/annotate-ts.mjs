// Annotates each line of the Solid src copy with its V8 block-coverage count (docs/SLICE1-PARITY.md).
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const dir=process.argv[2],outd=process.argv[3];mkdirSync(outd,{recursive:true});
const files=new Map();
for(const f of readdirSync(dir)){const j=JSON.parse(readFileSync(dir+'/'+f));for(const s of j.result){if(!s.url.includes('/solid-src/'))continue;(files.get(s.url)??files.set(s.url,[]).get(s.url)).push(...s.functions)}}
for(const [url,fns] of files){const src=readFileSync(new URL(url),'utf8');const counts=new Float64Array(src.length).fill(-1);
 // merge: sum counts across processes; ranges applied in order (outer first)
 const acc=new Map();
 for(const fn of fns)for(const r of fn.ranges){const k=r.startOffset+':'+r.endOffset;acc.set(k,(acc.get(k)??0)+r.count)}
 const ranges=[...acc].map(([k,c])=>{const [a,b]=k.split(':').map(Number);return {a,b,c}}).sort((x,y)=>(y.b-y.a)-(x.b-x.a));
 for(const r of ranges)for(let i=r.a;i<r.b;i++)counts[i]=r.c;
 const lines=src.split('\n');let off=0;const out=[];
 for(let i=0;i<lines.length;i++){const l=lines[i];const m=l.search(/\S/);const c=m<0?-1:counts[off+m];out.push((c<0?'':c===0?'   -':String(c).padStart(4))+'\t'+(i+1)+'\t'+l);off+=l.length+1}
 writeFileSync(outd+'/'+url.split('/solid-src/')[1].replace('/','_')+'.txt',out.join('\n'))}
