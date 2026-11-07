import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadTsxModules} from '../tsx/modules.ts';
import {resolvePlan} from './resolve.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=(ext:string)=>fileURLToPath(new URL('./fixtures/like.'+ext,import.meta.url));
const read=(p:string)=>{try{return readFileSync(p,'utf8')}catch{return undefined}};
const load=()=>loadTsxModules(fixture('rx'),read);
test('all three checked frontends emit the same data-only plan',()=>{
  const plans=['rx','tsx','yield.tsx'].map(ext=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','plan/emit.ts',fixture(ext)],{cwd:root,encoding:'utf8'})));
  assert.deepEqual(plans[0],plans[1]); assert.deepEqual(plans[0],plans[2]);
  assert.deepEqual(plans[0],JSON.parse(readFileSync(new URL('./like.plan.json',import.meta.url),'utf8')));
});
test('checker errors are not turned into plans',()=>{
  const set=load();const p=set.programs.get(set.order[0])!;
  const component=p.decls.find(d=>d.k==='component')!;
  if(component.k!=='component')throw new Error('fixture');
  const source=component.decls.find(d=>d.k==='source'&&d.name==='shown')!;
  if(source.k!=='source')throw new Error('fixture');source.init={k:'id',name:'missing'};
  assert.throws(()=>resolvePlan(set));
});
test('unsupported expression shapes fail rather than emit partial plans',()=>{
  const set=load();const p=set.programs.get(set.order[0])!;const c=p.decls.find(d=>d.k==='component')!;
  if(c.k!=='component')throw new Error('fixture');const s=c.decls.find(d=>d.k==='source'&&d.name==='likes')!;
  if(s.k!=='source')throw new Error('fixture');s.init={k:'bin',op:'*',l:{k:'lit',v:2},r:{k:'lit',v:3}};
  assert.throws(()=>resolvePlan(set),/unsupported expression/);
});
test('Rust consumes the plan freshly emitted from each frontend', {skip:!process.env.RUST_SCENARIO},()=>{
  const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'slice1-plan-'));
  try{for(const ext of ['rx','tsx','yield.tsx']){
    const plan=join(dir,ext+'.json');
    execFileSync(process.execPath,['--experimental-strip-types','plan/emit.ts',fixture(ext),plan],{cwd:root});
    const frames=JSON.parse(execFileSync(process.env.RUST_SCENARIO!,[plan,fixture('scenario.json')],{encoding:'utf8'}));
    const scenario=JSON.parse(readFileSync(fixture('scenario.json'),'utf8'));
    assert.deepEqual(frames,scenario.steps.map((s:any)=>s.frame));
  }}finally{rmSync(dir,{recursive:true,force:true})}
});
