// Coverage delta between two NODE_V8_COVERAGE runs of the Solid src copy
// (docs/SLICE2A-COVERAGE.md):  node delta.mjs BASE_DIR NEW_DIR [--lines]
// Per function (innermost V8 function range): calls in BASE, calls in NEW, and the
// TS code lines (comment-only lines skipped) that execute in NEW but never in BASE. Line counts use the same
// outermost-to-innermost block-range rule as slice1-fuzz/parity/tools/annotate-ts.mjs.
import {readdirSync,readFileSync} from 'node:fs';
const [baseDir,newDir]=process.argv.slice(2),showLines=process.argv.includes('--lines');
function load(dir){const files=new Map();
 for(const f of readdirSync(dir)){const j=JSON.parse(readFileSync(dir+'/'+f));for(const s of j.result){if(!s.url.includes('/solid-src/'))continue;(files.get(s.url)??files.set(s.url,[]).get(s.url)).push(...s.functions)}}
 const out=new Map();
 for(const [url,fns] of files){const src=readFileSync(new URL(url),'utf8');const counts=new Float64Array(src.length).fill(-1);const acc=new Map(),fnAcc=new Map();
  for(const fn of fns){for(const r of fn.ranges){const k=r.startOffset+':'+r.endOffset;acc.set(k,(acc.get(k)??0)+r.count)}const r=fn.ranges[0];const k=r.startOffset+':'+r.endOffset;const e=fnAcc.get(k)??{a:r.startOffset,b:r.endOffset,name:fn.functionName||'(anonymous)',count:0};e.count+=r.count;fnAcc.set(k,e)}
  const ranges=[...acc].map(([k,c])=>{const [a,b]=k.split(':').map(Number);return {a,b,c}}).sort((x,y)=>(y.b-y.a)-(x.b-x.a));
  for(const r of ranges)for(let i=r.a;i<r.b;i++)counts[i]=r.c;
  const lines=src.split('\n'),lc=[],starts=[];let off=0;for(const l of lines){const m=l.search(/\S/);lc.push(m<0?-1:counts[off+m]);starts.push(off);off+=l.length+1}
  const lineOf=o=>{let lo=0,hi=starts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]<=o)lo=mid;else hi=mid-1}return lo+1};
  const fnList=[...fnAcc.values()].filter(f=>f.a>0).map(f=>({...f,la:lineOf(f.a),lb:lineOf(f.b)}));
  out.set(url.split('/solid-src/')[1],{lines,lc,fnList})}
 return out}
const base=load(baseDir),neu=load(newDir);
const report=[];let newFns=0,newLines=0;
for(const [file,n] of neu){const b=base.get(file);const bfn=new Map((b?.fnList??[]).map(f=>[f.la+'-'+f.lb+' '+f.name,f.count]));
 const comment=l=>/^\s*(\/\/|\*|\/\*)/.test(l);
 const added=[];for(let i=0;i<n.lines.length;i++)if(n.lc[i]>0&&!(b&&b.lc[i]>0)&&!comment(n.lines[i]))added.push(i+1);
 // Assign each new line to its innermost executed function (a closure that never ran
 // still owns the line that creates it in V8 ranges: give that line to its parent).
 const groups=new Map();for(const ln of added){let best=null;for(const f of n.fnList)if(f.count>0&&f.la<=ln&&ln<=f.lb&&(!best||f.b-f.a<best.b-best.a))best=f;const k=best?best.la+'-'+best.lb+' '+best.name:'(module)';(groups.get(k)??groups.set(k,[]).get(k)).push(ln)}
 for(const f of n.fnList){const k=f.la+'-'+f.lb+' '+f.name;const bc=bfn.get(k)??0;if(f.count>0&&bc===0)newFns++;const ls=groups.get(k);if(f.count>0&&(bc===0||ls))report.push({file,k,f,bc,ls:ls??[]})}
 newLines+=added.length;
 if(groups.has('(module)'))report.push({file,k:'(module)',f:{count:0},bc:0,ls:groups.get('(module)')});
 for(const r of report)if(r.file===file&&showLines&&!r.printed){r.printed=true;r.text=r.ls.map(l=>String(l).padStart(5)+' '+String(n.lc[l-1]).padStart(6)+' | '+n.lines[l-1]).join('\n')}}
const span=ls=>{const out=[];for(const l of ls){const last=out[out.length-1];if(last&&last[1]===l-1)last[1]=l;else out.push([l,l])}return out.map(([a,b])=>a===b?a:a+'-'+b).join(',')};
console.log('# new functions (calls 0 in base):',newFns,' new lines:',newLines);
for(const r of report.sort((x,y)=>x.file.localeCompare(y.file)||parseInt(x.k)-parseInt(y.k))){console.log([r.bc===0?'NEW':'+', r.file+':'+r.k, 'calls '+r.bc+' -> '+r.f.count, 'lines '+span(r.ls)].join('\t'));if(showLines&&r.text)console.log(r.text)}
