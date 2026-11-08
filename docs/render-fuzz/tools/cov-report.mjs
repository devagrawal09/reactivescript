// Prints the source segments of a dist file that no process executed (V8 block coverage).
// node docs/render-fuzz/tools/cov-report.mjs <NODE_V8_COVERAGE dir> <url suffix> [first-last line]
// Per coverage file, an offset's count is that of the innermost range containing it (V8 reports
// a nested range only where its count differs from the enclosing one); an offset is covered if
// any file gives it a nonzero count.
import {readdirSync,readFileSync} from 'node:fs';
const [dir,suffix,lines]=process.argv.slice(2);
let src,covered,seen;
for(const f of readdirSync(dir)){const j=JSON.parse(readFileSync(dir+'/'+f,'utf8'));
 for(const s of j.result){if(!s.url.endsWith(suffix))continue;
  if(!src){src=readFileSync(new URL(s.url),'utf8');covered=new Uint8Array(src.length);seen=new Uint8Array(src.length)}
  const count=new Int32Array(src.length).fill(-1);
  for(const fn of s.functions)for(const r of fn.ranges){count.fill(r.count,r.startOffset,Math.min(r.endOffset,src.length))}
  for(let i=0;i<src.length;i++){if(count[i]>=0)seen[i]=1;if(count[i]>0)covered[i]=1}}}
if(!src){console.log('no coverage for',suffix);process.exit(1)}
const lineOf=o=>src.slice(0,o).split('\n').length;
const [lo,hi]=lines?lines.split('-').map(Number):[1,Infinity];
let out=0;for(let i=0;i<src.length;){if(seen[i]&&!covered[i]){let j=i;while(j<src.length&&seen[j]&&!covered[j])j++;
  const text=src.slice(i,j);if(text.trim()&&lineOf(i)>=lo&&lineOf(i)<=hi){out++;console.log(lineOf(i)+'-'+lineOf(j),JSON.stringify(text.length>110?text.slice(0,110)+'…':text))}i=j}else i++}
console.log('uncovered segments',out);
