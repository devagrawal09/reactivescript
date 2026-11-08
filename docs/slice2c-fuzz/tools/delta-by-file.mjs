// Per-file totals of a docs/slice2a-fuzz/tools/delta.mjs report: functions with new lines,
// functions never called in the base, new code lines.   node delta-by-file.mjs DELTA.txt
import {readFileSync} from 'node:fs';
const per={};let tot={fns:0,neu:0,lines:0};
for(const l of readFileSync(process.argv[2],'utf8').split('\n')){const m=l.match(/^(NEW|\+)\t(\S+?):(\d+)-(\d+) (.*?)\tcalls (\d+) -> (\d+)\tlines (.*)$/);if(!m)continue;
 const n=m[8].trim()?m[8].split(',').reduce((s,r)=>{const [a,b=a]=r.split('-').map(Number);return s+b-a+1},0):0;
 const e=per[m[2]]??={fns:0,neu:0,lines:0};if(n){e.fns++;tot.fns++}if(m[1]==='NEW'){e.neu++;tot.neu++}e.lines+=n;tot.lines+=n}
console.log('| file | functions with new lines | never called in base | new code lines |\n| --- | ---: | ---: | ---: |');
for(const [f,e] of Object.entries(per).sort((a,b)=>b[1].lines-a[1].lines))console.log(`| ${f} | ${e.fns} | ${e.neu} | ${e.lines} |`);
console.log(`| **total** | **${tot.fns}** | **${tot.neu}** | **${tot.lines}** |`);
