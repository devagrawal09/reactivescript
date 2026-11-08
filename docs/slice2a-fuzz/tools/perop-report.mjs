// Per-op-class call table from two perop.mjs outputs (docs/SLICE2A-COVERAGE.md):
//   node perop-report.mjs BASE.json NEW.json [--all]
// For each op class of NEW: ops, then each Solid function it calls (calls per op),
// marked NEW when the function is never called anywhere in BASE, and + when no BASE
// op of the same kind (the class before ':') calls it. --all lists the old functions too.
import {readFileSync} from 'node:fs';
const [bf,nf]=process.argv.slice(2),all=process.argv.includes('--all');
const base=JSON.parse(readFileSync(bf)),neu=JSON.parse(readFileSync(nf));
const baseAny=new Set(Object.values(base).flatMap(v=>Object.keys(v.fns)));
const pos=k=>{const m=k.match(/^(.*):(\d+)-/);return [m[1],+m[2]]};
for(const cls of Object.keys(neu).sort()){const v=neu[cls],kind=cls.replace(/:.*/,''),b={fns:Object.assign({},...Object.entries(base).filter(([c])=>c.replace(/:.*/,'')===kind).map(([,x])=>x.fns))};
 const rows=Object.entries(v.fns).sort((x,y)=>{const [fa,la]=pos(x[0]),[fb,lb]=pos(y[0]);return fa.localeCompare(fb)||la-lb});
 const mark=k=>!baseAny.has(k)?'NEW':b.fns[k]?'   ':'+  ';
 const shown=rows.filter(([k])=>all||mark(k)!=='   ');
 console.log('\n## '+cls+'  ops '+v.ops+'  functions '+rows.length+'  new-for-class '+shown.length);
 for(const [k,n] of shown)console.log(mark(k)+'\t'+(n/v.ops).toFixed(2)+'\t'+k)}
