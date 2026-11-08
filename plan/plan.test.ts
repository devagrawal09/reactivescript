import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {loadTsxModules} from '../tsx/modules.ts';
import {resolvePlan} from './resolve.ts';
import {resolvePlanV2} from './resolve-v2.ts';
import {runScenario} from '../slices/run-js.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=(ext:string)=>fileURLToPath(new URL('../slices/like/like.'+ext,import.meta.url));
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

// Plan schema v2 (docs/PLAN-V2.md). emit.ts picks the schema from the slice scenario's format version: the tracker
// (scenario version 2) emits v2, like (version 1) emits v1 above, and --schema 2 emits like's v2 plan. The three checked
// frontends must emit byte-identical plans; the saved artifacts are emitted, never handwritten; and the plan alone,
// built with Solid 2's own primitives (plan/solid-plan.ts), must render each scenario's exact frames.
const slice=(name:string,file:string)=>fileURLToPath(new URL('../slices/'+name+'/'+file,import.meta.url));
const saved=(name:string)=>fileURLToPath(new URL('./'+name,import.meta.url));
const emit=(...args:string[])=>spawnSync(process.execPath,['--experimental-strip-types','plan/emit.ts',...args],{cwd:root,encoding:'utf8'});
const emitted=(...args:string[])=>{const r=emit(...args);assert.equal(r.status,0,r.stderr);return r.stdout;};
for(const [name,artifact,flags] of [['tracker','tracker.plan.json',[]],['like','like.plan-v2.json',['--schema','2']]] as const){
  test('plan v2: TSX, RX and yield emit the same '+name+' plan, byte-identical to '+artifact,()=>{
    const plans=['rx','tsx','yield.tsx'].map(ext=>emitted(...flags,slice(name,name+'.'+ext)));
    assert.equal(plans[1],plans[0]);
    assert.equal(plans[2],plans[0]);
    assert.equal(plans[0],readFileSync(saved(artifact),'utf8'));
    assert.equal(JSON.parse(plans[0]).version,2);
  });
  test('plan v2: the '+name+' plan alone, built with Solid primitives, renders the scenario frames',async()=>{
    const scenario=slice(name,name+'.scenario.json');
    const frames=(JSON.parse(readFileSync(scenario,'utf8')).steps as {frame:string}[]).map(s=>s.frame);
    assert.deepEqual(await runScenario(scenario,'plan',{plan:saved(artifact)}),frames);
  });
}

const trackerRx=slice('tracker','tracker.rx');
const loadTracker=(text:string)=>loadTsxModules(trackerRx,p=>p===trackerRx?text:read(p));
test('plan v2: unsupported shapes and facts the plan cannot encode are refused, never emitted partially',()=>{
  const rx=read(trackerRx)!;
  for(const [from,to,error] of [
    ['unassigned = filter(shown, issue => issue.assignee == "").length;','unassigned = filter(shown, issue => issue.assignee == "").length * 2;',/unsupported operator \*/],
    ['status := "Could not assign #" + id;','status := `Could not assign #${id}`;',/unsupported expression tpl/],
    ['<em>{status}</em>','<em>{status}</em><Other/>',/UNKNOWN_COMPONENT/],
    ['<em>{status}</em>','<em class="a">{status}</em>',/attributes other than parameterless event handlers/],
    ['source mode := "all";','source mode := "all";\n  source unused := 1.5;',/unsupported literal 1.5/],
    ['} catch (error) {\n      status := "Could not assign #" + id;','} catch (error) {\n      status := error.message;',/unresolved error/],
    ['source shown = issues.list;','source shown = peek(issues.list);',/unsupported expression peek/],
    ['status := "Could not assign #" + id;','status := "Could not assign #" + id;\n      claim(id);',/nested transactions/],
    ['mode := mode == "all" ? "open" : "all"','let x = await assignIssue(1)',/a plain handler never awaits/],
    ['mode := mode == "all" ? "open" : "all"','try { mode := "open" } catch (e) { mode := "all" }',/a plain handler has no try/],
    ['<button onClick={() => { claim(issue.id) }}>','<button onClick={(e) => { claim(issue.id) }}>',/parameterless event handlers/],
    // An inferred action (AC-1b: it writes and awaits) is lifted out of the row, so it may not capture the row item.
    ['<button onClick={() => { claim(issue.id) }}>','<button onClick={() => { try { let o = await assignIssue(issue.id); status := o } catch (e) { status := "x" } }}>',/unresolved issue/],
    ['export default component Tracker() {','component Other() { <p>x</p> }\n\nexport default component Tracker() {',/one component and imports/],
  ] as const){
    const changed=rx.replace(from,to);
    assert.notEqual(changed,rx,from);
    assert.throws(()=>resolvePlanV2(loadTracker(changed)),error,to);
  }
  const aliased=rx.replace('import { assignIssue }','import { assignIssue as assign }').replace('await assignIssue(id)','await assign(id)');
  assert.throws(()=>resolvePlanV2(loadTracker(aliased)),/aliased host imports are outside plan v2/);
  // The v1 builder refuses the tracker outright; it is never a v1 plan.
  assert.throws(()=>resolvePlan(loadTracker(rx)),/unsupported expression rec/);
});

// A scratch slice directory: the tracker's RX source (possibly changed), host declaration and, optionally, scenario.
const scratch=(rx:string,scenario:boolean)=>{
  const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'tracker-plan-'));
  writeFileSync(join(dir,'tracker.rx'),rx);
  copyFileSync(slice('tracker','api.d.rx'),join(dir,'api.d.rx'));
  if(scenario)copyFileSync(slice('tracker','tracker.scenario.json'),join(dir,'tracker.scenario.json'));
  return dir;
};
test('plan v2: checker errors in the tracker are not turned into plans, by the builder or by emit.ts',()=>{
  const rx=read(trackerRx)!;
  for(const [from,to,code] of [
    ['source shown = issues.list;','source shown = missing.list;','UNBOUND'],
    ['source status := "";','source status := "";\n  source copy := mode;','SNAPSHOT_INITIALIZER'],
    ['<button onClick={() => { claim(issue.id) }}>','<button onClick={() => { let o = await assignIssue(issue.id); status := o }}>','UNCAUGHT_ACTION_FAILURE'],
  ] as const){
    const changed=rx.replace(from,to);
    assert.notEqual(changed,rx,from);
    assert.throws(()=>resolvePlanV2(loadTracker(changed)),new RegExp('"code":"'+code+'"'),to);
    const dir=scratch(changed,true);
    try{
      const out=join(dir,'plan.json'),r=emit(join(dir,'tracker.rx'),out);
      assert.notEqual(r.status,0,to);
      assert.match(r.stderr,new RegExp(code));
      assert.equal(r.stdout,'');
      assert.equal(read(out),undefined,'no plan file is written');
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
});
test('emit.ts: the plan schema follows the slice scenario\'s format version, and is refused without one',()=>{
  const dir=scratch(read(trackerRx)!,false);
  try{
    const input=join(dir,'tracker.rx');
    const r=emit(input);
    assert.notEqual(r.status,0); assert.equal(r.stdout,''); assert.match(r.stderr,/no scenario .*tracker\.scenario\.json to choose the plan schema/);
    assert.equal(emitted('--schema','2',input),readFileSync(saved('tracker.plan.json'),'utf8'));
    const v1=emit('--schema','1',input);
    assert.notEqual(v1.status,0); assert.equal(v1.stdout,''); assert.match(v1.stderr,/unsupported expression rec/);
    for(const bad of [['--schema','3',input],['--schema'],[input,join(dir,'a.json'),'extra'],[join(dir,'api.d.rx')]]){
      const b=emit(...bad);
      assert.notEqual(b.status,0,bad.join(' ')); assert.equal(b.stdout,'');
    }
    writeFileSync(join(dir,'tracker.scenario.json'),JSON.stringify({version:3}));
    const v3=emit(input);
    assert.notEqual(v3.status,0); assert.match(v3.stderr,/format version 3/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

// Rust leg for the tracker plan, wired like the like leg above: skipped unless RUST_SCENARIO is set. With RUST_SCENARIO
// set, the test exists only when RUST_PLAN_V2=1 declares that binary a v2 consumer (rust-tracker's is; rust-solid's v1
// consumer refuses the plan). It is listed in baselines/subset-tests.json, and verify-pinned.sh always exports
// RUST_PLAN_V2=1, so a gate run that does not run it, or whose binary is not a v2 consumer, fails (PLAN-V2.md "Gate").
const rustV2=process.env.RUST_PLAN_V2;
if(rustV2!==undefined&&rustV2!=='1')throw new Error('RUST_PLAN_V2 must be 1 or unset');
if(!process.env.RUST_SCENARIO||rustV2==='1')
  test('Rust consumes the tracker plan freshly emitted from each frontend',{skip:!process.env.RUST_SCENARIO},()=>{
    const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'slice2-plan-'));
    const scenario=slice('tracker','tracker.scenario.json');
    try{for(const ext of ['rx','tsx','yield.tsx']){
      const plan=join(dir,ext+'.json');
      execFileSync(process.execPath,['--experimental-strip-types','plan/emit.ts',slice('tracker','tracker.'+ext),plan],{cwd:root});
      assert.equal(readFileSync(plan,'utf8'),readFileSync(saved('tracker.plan.json'),'utf8'));
      const frames=JSON.parse(execFileSync(process.env.RUST_SCENARIO!,[plan,scenario],{encoding:'utf8'}));
      assert.deepEqual(frames,JSON.parse(readFileSync(scenario,'utf8')).steps.map((s:any)=>s.frame));
    }}finally{rmSync(dir,{recursive:true,force:true})}
  });
