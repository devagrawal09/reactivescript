import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseGate,command } from './collect.mjs';

test('gate result, tests, fuzz and diagnostics',()=>{const parsed=parseGate('\u001b[32mResult: PASS\u001b[0m\nTests: 42 passed\nFuzz: 500 seeds\nDiagnostics: 0\nerror TS1234: sample');assert.deepEqual(parsed.result,['Result: PASS']);assert.deepEqual(parsed.tests,['Tests: 42 passed']);assert.deepEqual(parsed.fuzz,['Fuzz: 500 seeds']);assert.equal(parsed.diagnostics.length,2);});
test('commands time out',async()=>{await assert.rejects(command(process.execPath,['-e','setTimeout(()=>{},5000)'],{timeout:100}),/timed out/);});
test('page renders safely and shows health and staleness',async()=>{
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{},className:''});return elements.get(id);};
 const collectedAt=new Date().toISOString(),meta={collectedAt,intervalSeconds:60},sha='abc123456789';
 const fixture={updatedAt:collectedAt,notes:{...meta,data:{goal:'<unsafe>',next:'Continue',agents:[],milestones:[{name:'One',status:'done'}],slice1:{parts:['A','B']}}},repos:{...meta,items:{frontend:{head:{sha},branches:[{name:'main',sha}],commits:[],dirtyCount:0}}},originals:{...meta,ok:true,items:[]},pins:{...meta,reactivescript:sha,solid:sha},github:{...meta,intervalSeconds:300,upstream:{behind:0,recent:[]},threads:[{number:21,inSync:true,headSha:sha,state:'open'}],openPRs:{items:[]}},gates:{...meta,items:{frontend:{state:'passed',sha,result:['Result: PASS']},slice1:{missing:true}}},fuzz:{...meta,missing:true,message:'No summary'},artifacts:{...meta,files:[],rustBranch:{}},runtime:{...meta,agreement:['57.4% agreement']}};
 const context=vm.createContext({document:{getElementById:element},fetch:async()=>({ok:true,json:async()=>fixture}),localStorage:{getItem:()=>null,setItem(){}},setInterval(){},setTimeout(){},Date,console});
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8'),start=html.indexOf('<script>')+8,end=html.indexOf('</script>',start);
 vm.runInContext(html.slice(start,end),context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(element('goal').textContent,'<unsafe>');assert.equal(element('health').textContent,'Healthy');assert.match(element('gate-main').innerHTML,/passed/);
 vm.runInContext('data.originals.ok=false;health()',context);assert.equal(element('health').textContent,'Alert');
 vm.runInContext('data.originals.ok=true;data.notes.collectedAt=new Date(Date.now()-181000).toISOString();health()',context);assert.equal(element('health').textContent,'Needs attention');assert.match(element('updated').textContent,/stale sources/);
 vm.runInContext("data.notes.collectedAt=new Date().toISOString();data.gates.items.frontend.state='skipped';data.gates.items.frontend.reason='skipped: worktree dirty';renderSources();health()",context);assert.equal(element('health').textContent,'Needs attention');assert.match(element('gate-main').innerHTML,/skipped: worktree dirty/);
});
