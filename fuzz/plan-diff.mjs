// Compares the Rust plan v2 consumer with Solid 2 on one plan and scenario: `fuzz/plan-oracle.mjs` (Solid's own
// primitives and renderer) and `target/debug/plan-trace` (the port) must print identical results and identical host
// logs, entry for entry. Nothing is filtered or normalized.
// Usage: node --conditions=browser fuzz/plan-diff.mjs PLAN.json SCENARIO.json
import {readFileSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {tracePlan} from './plan-oracle.mjs';
const root=new URL('..',import.meta.url).pathname;
const [planPath,scenarioPath]=process.argv.slice(2);
if(!scenarioPath){console.error('usage: node --conditions=browser fuzz/plan-diff.mjs PLAN.json SCENARIO.json');process.exit(2)}
execFileSync('cargo',['build','--quiet','--bin','plan-trace'],{cwd:root,stdio:'inherit'});
const expected=await tracePlan(JSON.parse(readFileSync(planPath,'utf8')),JSON.parse(readFileSync(scenarioPath,'utf8')));
const r=spawnSync(root+'target/debug/plan-trace',[planPath,scenarioPath],{encoding:'utf8'});
if(r.status!==0&&r.status!==1||!r.stdout){console.error('plan-trace failed',r.status,r.stderr);process.exit(1)}
const actual=JSON.parse(r.stdout);
const same=JSON.stringify(expected)===JSON.stringify(actual);
const n=Math.max(expected.log.length,actual.log.length);
let first=-1;for(let i=0;i<n;i++)if(JSON.stringify(expected.log[i])!==JSON.stringify(actual.log[i])){first=i;break}
console.log(JSON.stringify({agree:same,oracle:expected.result,rust:actual.result,entries:{oracle:expected.log.length,rust:actual.log.length},firstDifference:first}));
if(first>=0)for(let i=Math.max(0,first-3);i<Math.min(n,first+4);i++)console.log(i,'oracle',JSON.stringify(expected.log[i]),'\n ','rust  ',JSON.stringify(actual.log[i]));
if(!same)process.exitCode=1;
