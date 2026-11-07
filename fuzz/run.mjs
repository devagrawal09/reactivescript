import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {run as solid} from './solid.mjs';
import {generate} from './generate.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
execFileSync('cargo',['build','--quiet','--bin','driver'],{cwd:root,stdio:'inherit'});
const child=spawn(root+'/target/debug/driver',[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout});const waits=[];lines.on('line',line=>waits.shift()?.(JSON.parse(line)));
const rust=ops=>new Promise(resolve=>{waits.push(resolve);child.stdin.write(JSON.stringify(ops)+String.fromCharCode(10))});
const compare=async ops=>{let expected;try{expected=await solid(ops)}catch(e){return {invalid:e.stack}}const actual=await rust(ops);return {expected,actual,agree:JSON.stringify(expected)===JSON.stringify(actual)}};
function valid(ops){const nodes=new Set(),owners=new Set(['root']);const expr=e=>typeof e==='number'||e&&((e.op!=='read'||nodes.has(e.id))&&['a','b','test','yes','no','expr'].every(k=>!(k in e)||typeof e[k]==='number'||expr(e[k])));for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;if(o.expr&&!expr(o.expr))return false;if(['read','latest','pending','write','refresh'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='action'&&o.slices.some(s=>(s.writes??[]).some(w=>!nodes.has(w.id))))return false;if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
async function reduce(ops){let out=ops;let size=Math.ceil(out.length/2),checks=0;while(size>=1&&checks<180){let changed=false;for(let i=0;i<out.length&&checks<180;i+=size){const candidate=out.slice(0,i).concat(out.slice(i+size));if(!valid(candidate))continue;checks++;const r=await compare(candidate);if(!r.invalid&&!r.agree){out=candidate;changed=true;break}}if(!changed)size=Math.floor(size/2)}return out}
const out=arg('--out',root+'/out');mkdirSync(out,{recursive:true});
let total=0,agreement=0,invalid=0;const coverage={},classes={},modes={};
try {
 if(args.includes('--replay')){const ops=JSON.parse(readFileSync(arg('--replay'),'utf8'));const r=await compare(ops);console.log(JSON.stringify(r,null,2));if(!r.agree)process.exitCode=1;}
 else {const count=Number(arg('--seeds','2000')),start=Number(arg('--start','1'));
 for(let seed=start;seed<start+count;seed++){const ops=generate(seed);for(const o of ops)coverage[o.op]=(coverage[o.op]??0)+1;const r=await compare(ops);total++;const mode=seed%6;modes[mode]??={total:0,agreement:0};modes[mode].total++;
 if(r.invalid){invalid++;writeFileSync(out+'/invalid-'+seed+'.json',JSON.stringify({ops,error:r.invalid},null,2));continue}
 if(r.agree){agreement++;modes[mode].agreement++;continue}
 const i=Array.isArray(r.actual)?r.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(r.actual[i])):0;
 const kind=mode+'-'+(r.expected[i]?.[0]??'end')+'-'+(r.actual[i]?.[0]??'end');
 writeFileSync(out+'/fail-'+seed+'.json',JSON.stringify({seed,ops,...r},null,2));
 if(!classes[kind]){classes[kind]={count:0,seed};if(!args.includes('--no-reduce')){const reduced=await reduce(ops);writeFileSync(out+'/reduced-'+kind+'.json',JSON.stringify(reduced,null,2));writeFileSync(out+'/reduced-'+kind+'.logs.json',JSON.stringify(await compare(reduced),null,2))}}
 classes[kind].count++;
 }
 const summary={total,agreement,rate:total?agreement/total:0,invalid,coverage,modes,classes};writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));if(agreement!==total)process.exitCode=1;
 }
} finally {child.stdin.end()}
