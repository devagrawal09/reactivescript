import {spawn,execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generate} from './generate.mjs';
import {generateSlice1} from './generate-slice1.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const timeout=Number(arg('--timeout-ms','1500'));
const slice1=args.includes('--slice1'),binary=slice1?'slice1-driver':'driver';
execFileSync('cargo',['build','--quiet','--bin',binary],{cwd:root,stdio:'inherit'});
let worker,child,lines;
function startRust(){child=spawn(root+'/target/debug/'+binary,[],{stdio:['pipe','pipe','inherit']});lines=createInterface({input:child.stdout});}
function oracle(ops){worker=new Worker(new URL('./worker.mjs',import.meta.url));const w=worker;let progress;return new Promise(resolve=>{
 const finish=result=>{clearTimeout(timer);w.removeListener('message',onMessage);w.removeListener('error',onError);w.terminate();worker=undefined;resolve(result)};
 const onMessage=result=>{if('progress'in result)progress=result.progress;else {if(result.invalid){w.terminate();worker=undefined}finish(result)}},onError=e=>{worker=undefined;finish({invalid:'oracle-error',detail:e.stack})};
 const timer=setTimeout(()=>{w.terminate();worker=undefined;finish({invalid:'oracle-timeout',progress})},timeout);
 w.on('message',onMessage);w.once('error',onError);w.postMessage(ops);
})}
function rust(ops){if(!child)startRust();const c=child,l=lines;return new Promise(resolve=>{
 const finish=result=>{clearTimeout(timer);l.removeListener('line',onLine);c.removeListener('exit',onExit);resolve(result)};
 const onLine=line=>{try{finish(JSON.parse(line))}catch{finish({driver_error:'invalid-json'})}};
 const onExit=()=>{child=undefined;finish({driver_error:'exit'})};
 const timer=setTimeout(()=>{c.kill('SIGKILL');child=undefined;finish({driver_error:'timeout'})},timeout);
 l.once('line',onLine);c.once('exit',onExit);c.stdin.write(JSON.stringify(ops)+String.fromCharCode(10));
})}
async function compare(ops){const reference=await oracle(ops);const actual=await rust(ops);return {...reference,actual,agree:!reference.invalid&&JSON.stringify(reference.expected)===JSON.stringify(actual)}}
function valid(ops){const nodes=new Set(),owners=new Set(['root']);const expr=e=>typeof e==='number'||e&&((e.op!=='read'||nodes.has(e.id))&&['a','b','test','yes','no','expr'].every(k=>!(k in e)||typeof e[k]==='number'||expr(e[k])));for(const o of ops){if(o.owner&&!owners.has(o.owner)||o.parent&&!owners.has(o.parent))return false;if(o.expr&&!expr(o.expr))return false;if(['read','latest','pending','write','refresh'].includes(o.op)&&!nodes.has(o.id))return false;if(o.op==='action'&&o.slices.some(s=>(s.writes??[]).some(w=>!nodes.has(w.id))))return false;if(['signal','memo'].includes(o.op))nodes.add(o.id);if(o.op==='owner')owners.add(o.id)}return true}
function traceClass(r){if(r.invalid)return r.invalid;if(r.actual?.driver_error)return 'rust-'+r.actual.driver_error;const i=r.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(r.actual[i]));return (r.expected[i]?.[0]??'end')+'-'+(r.actual[i]?.[0]??'end')}
async function reduce(ops,initial){let out=ops;let size=Math.ceil(out.length/2),checks=0;while(size>=1&&checks<180){let changed=false;for(let i=0;i<out.length&&checks<180;i+=size){const candidate=out.slice(0,i).concat(out.slice(i+size));if(!valid(candidate))continue;checks++;const r=await compare(candidate);const sameFailure=initial.invalid?r.invalid===initial.invalid:initial.actual?.driver_error?r.actual?.driver_error===initial.actual.driver_error:!r.invalid&&!r.actual?.driver_error;if(sameFailure&&!r.agree&&(!slice1||traceClass(r)===traceClass(initial))){out=candidate;changed=true;break}}if(!changed)size=Math.floor(size/2)}return out}
const out=arg('--out',root+'/out');mkdirSync(out,{recursive:true});
let total=0,agreement=0,invalid=0;const coverage={},classes={},modes={};
try {
 if(args.includes('--replay')){const ops=JSON.parse(readFileSync(arg('--replay'),'utf8'));const r=await compare(ops);console.log(JSON.stringify(r,null,2));if(!r.agree)process.exitCode=1;}
 else {const count=Number(arg('--seeds','2000')),start=Number(arg('--start','1'));
 for(let seed=start;seed<start+count;seed++){
  if(args.includes('--trace'))console.error('seed',seed);
  const ops=(slice1?generateSlice1:generate)(seed);for(const o of ops)coverage[o.op]=(coverage[o.op]??0)+1;
  const r=await compare(ops);total++;const mode=slice1?'scalar-actions':seed%6;modes[mode]??={total:0,agreement:0};modes[mode].total++;
  if(r.agree){agreement++;modes[mode].agreement++;continue}
  if(r.invalid)invalid++;
  const i=Array.isArray(r.actual)&&r.expected?r.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(r.actual[i])):0;
  const kind=r.invalid??(r.actual?.driver_error?'rust-'+r.actual.driver_error:mode+'-'+(r.expected[i]?.[0]??'end')+'-'+(r.actual[i]?.[0]??'end'));
  writeFileSync(out+'/fail-'+seed+'.json',JSON.stringify({seed,ops,...r},null,2));
  if(!classes[kind]){classes[kind]={count:0,seed};if(!args.includes('--no-reduce')){const reduced=await reduce(ops,r);writeFileSync(out+'/reduced-'+kind+'.json',JSON.stringify(reduced,null,2));writeFileSync(out+'/reduced-'+kind+'.logs.json',JSON.stringify(await compare(reduced),null,2))}}
  classes[kind].count++;
 }
 const summary={total,agreement,rate:total?agreement/total:0,invalid,timeoutMs:timeout,coverage,modes,classes};writeFileSync(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));if(agreement!==total)process.exitCode=1;
 }
} finally {child?.stdin.end();if(worker)await worker.terminate()}
