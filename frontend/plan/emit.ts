// Emit the checked plan for one fixture (.rx, .tsx or .yield.tsx). Usage: emit.ts [--schema 1|2|2.1] INPUT [OUTPUT]
// The schema is the format version of the slice scenario beside INPUT (<stem>.scenario.json), because a plan's consumer
// is driven by that scenario and the v1 consumer accepts only version-1 scenarios: like.rx emits v1 (docs/PLAN.md),
// tracker.rx emits v2 (docs/PLAN-V2.md), tracker-async.rx v2.1 (PLAN-V2.md, "v2.1: async data": the v2 builder with the
// async tier on, in the TSX frontend too). --schema overrides it (like.plan-v2.json). Without either, emit.ts refuses.
// Both builders run the pinned checker and refuse any diagnostic; neither falls back to the other.
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {loadTsxModules} from '../tsx/modules.ts';
import {loadYieldModules} from '../yield/lower.ts';
import {resolvePlan} from './resolve.ts';
import {resolvePlanV2} from './resolve-v2.ts';
const usage='usage: emit.ts [--schema 1|2|2.1] INPUT [OUTPUT]';
const args=process.argv.slice(2);
let schema:string|undefined;
const flag=args.indexOf('--schema');
if(flag>=0){schema=args[flag+1];args.splice(flag,2);}
if(schema!==undefined&&schema!=='1'&&schema!=='2'&&schema!=='2.1')throw new Error('--schema must be 1, 2 or 2.1. '+usage);
if(args.length<1||args.length>2||args.some(a=>a.startsWith('--')))throw new Error(usage);
const input=resolve(args[0]);
const stem=basename(input).match(/^(.+?)\.(yield\.tsx|tsx|rx)$/);
if(!stem)throw new Error('INPUT must be a .rx, .tsx or .yield.tsx fixture: '+input);
const read=(path:string)=>{try{return readFileSync(path,'utf8')}catch{return undefined}};
if(schema===undefined){
  const path=join(dirname(input),stem[1]+'.scenario.json'),text=read(path);
  if(text===undefined)throw new Error('no scenario '+path+' to choose the plan schema; pass --schema 1|2|2.1');
  const version=JSON.parse(text).version;
  if(version!==1&&version!==2&&version!==2.1)throw new Error('scenario '+path+' has format version '+JSON.stringify(version)+'; plans exist for 1, 2 and 2.1');
  schema=String(version);
}
const async=schema==='2.1';
const set=input.endsWith('.yield.tsx')?loadYieldModules(input,read):loadTsxModules(input,read,{async});
const result=JSON.stringify(schema==='1'?resolvePlan(set):resolvePlanV2(set,{async}),null,2)+'\n';
if(args[1])writeFileSync(args[1],result);else process.stdout.write(result);
