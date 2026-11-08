// Coverage delta from two cov-lines.mjs outputs (per-file line counts, summed): the TS code
// lines (comment-only lines skipped) executed in NEW and never in BASE, grouped by the
// innermost executed function of NEW (as docs/slice2a-fuzz/tools/delta.mjs), and per-file
// totals.   node docs/slice2c-fuzz/tools/delta-lines.mjs BASE.json NEW.json
import {readFileSync} from 'node:fs';
const [bf,nf]=process.argv.slice(2),B=JSON.parse(readFileSync(bf)),N=JSON.parse(readFileSync(nf));
const spans=a=>{const r=[];for(let i=0;i<a.length;){let j=i;while(j+1<a.length&&a[j+1]===a[j]+1)j++;r.push(i===j?''+a[i]:a[i]+'-'+a[j]);i=j+1}return r.join(',')};
const comment=l=>/^\s*(\/\/|\*|\/\*)/.test(l);
const fnsOf=(o,file)=>Object.entries(o.fns).filter(([k])=>k.split('|')[0].endsWith('/solid-src/'+file)).map(([k,c])=>{const m=k.split('|')[1].match(/^(\d+)-(\d+) (.*)$/);return {la:+m[1],lb:+m[2],name:m[3],count:c,key:m[1]+'-'+m[2]+' '+m[3]}});
let tl=0,tf=0,tn=0;const rows=[],per=[];
for(const [file,lc] of Object.entries(N.lines)){const bl=B.lines[file]??[];const text=readFileSync(new URL('../../../out/solid-src/'+file,import.meta.url),'utf8').split('\n');
 const added=[];for(let i=0;i<lc.length;i++)if(lc[i]>0&&!(bl[i]>0)&&!comment(text[i]))added.push(i+1);
 const nf=fnsOf(N,file),bfn=new Map(fnsOf(B,file).map(f=>[f.key,f.count]));
 const groups=new Map();for(const ln of added){let best=null;for(const f of nf)if(f.count>0&&f.la<=ln&&ln<=f.lb&&(!best||f.lb-f.la<best.lb-best.la))best=f;const k=best?best.key:'(module)';(groups.get(k)??groups.set(k,[]).get(k)).push(ln)}
 let fcount=0,ncount=0;for(const f of nf){const bc=bfn.get(f.key)??0;const ls=groups.get(f.key);if(f.count>0&&bc===0)ncount++;if(ls)fcount++;if(f.count>0&&(bc===0||ls))rows.push(`${bc===0?'NEW':'+'}\t${file}:${f.la}-${f.lb} ${f.name}\tcalls ${bc} -> ${f.count}\tlines ${spans(ls??[])}\t${(ls??[]).length}`)}
 if(added.length)per.push([file,fcount,ncount,added.length]);tl+=added.length;tf+=fcount;tn+=ncount}
console.log(rows.join('\n'));console.log('\n| file | functions with new lines | never called in base | new code lines |\n| --- | ---: | ---: | ---: |');
for(const [f,a,b,c] of per.sort((x,y)=>y[3]-x[3]))console.log(`| ${f} | ${a} | ${b} | ${c} |`);console.log(`| **total** | **${tf}** | **${tn}** | **${tl}** |`);
