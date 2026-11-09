// Strip-only TypeScript cannot run parameter properties: rewrite them in the out/ copy only.
import {readFileSync,writeFileSync} from 'node:fs';
for(const f of process.argv.slice(2)){let s=readFileSync(f,'utf8');
s=s.replace(/constructor\(([\s\S]*?)\)\s*\{\}/g,(m,params)=>{const names=[];const p=params.replace(/public\s+(\w+)/g,(_,n)=>{names.push(n);return n});if(!names.length)return m;return 'constructor('+p+') {'+names.map(n=>`this.${n}=${n};`).join('')+'}'});
writeFileSync(f,s)}
