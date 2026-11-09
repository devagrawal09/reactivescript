import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
// The repository root: dashboard/ sits beside frontend/, rust-solid/, docs/ and the pinned checkouts (scripts/setup.sh).
const BASE = path.resolve(ROOT, '..');
// The branch whose HEAD the frontend gate checks; the dashboard never switches branches.
const GATE_BRANCH = process.env.DASHBOARD_GATE_BRANCH || 'solid-model';
const CACHE = path.join(ROOT, 'cache');
const repos = Object.fromEntries(['frontend','slice1-js','slice1-plan','rust-solid','reactivescript-pr'].map(name => [name, path.join(BASE,name)]));
const now = () => new Date().toISOString();
const exists = file => fs.access(file).then(() => true, () => false);
const message = error => error?.message || String(error);
const env = { ...process.env, GIT_OPTIONAL_LOCKS:'0' };
const children = new Set();

export function command(bin,args,{cwd=ROOT,timeout=25000,signal,customEnv=env}={}) {
  return new Promise((resolve,reject) => {
    const child=spawn(bin,args,{cwd,env:customEnv,signal,detached:true,stdio:['ignore','pipe','pipe']});
    children.add(child);
    let stdout='',stderr='',done=false;
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);children.delete(child);error?reject(error):resolve(value);};
    const abort=()=>{kill();finish(new Error('Collection cancelled or timed out'));};
    const timer=setTimeout(()=>{kill();finish(new Error(bin+' timed out after '+timeout/1000+'s'));},timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{if(stdout.length<16000000)stdout+=chunk;});
    child.stderr.on('data',chunk=>{if(stderr.length<16000000)stderr+=chunk;});
    child.on('error',error=>finish(error));
    child.on('close',code=>finish(null,{code,stdout,stderr}));
  });
}
async function git(dir,args,signal) {
  const value=await command('git',['-C',dir,...args],{signal});
  if(value.code!==0)throw new Error(value.stderr.trim()||'Git command failed');
  return value.stdout.trimEnd();
}
async function api(endpoint,signal) {
  const value=await command('gh',['api','--method','GET',endpoint],{signal,timeout:35000});
  if(value.code!==0)throw new Error(value.stderr.trim()||'GitHub request failed');
  return JSON.parse(value.stdout);
}
async function safe(fn) {try{return await fn();}catch(error){return {error:message(error)};}}
async function section(fn,intervalSeconds=60,timeout=45000) {
  const controller=new AbortController();let timer;
  try {
    const value=await Promise.race([fn(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Source timed out after '+timeout/1000+'s'));},timeout);})]);
    return {...value,collectedAt:now(),intervalSeconds};
  } catch(error){return {error:message(error),collectedAt:now(),intervalSeconds};}
  finally{clearTimeout(timer);}
}
export async function atomicJSON(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+process.pid+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n');
  await fs.rename(temporary,file);
}
export async function loadStatus(){try{return JSON.parse(await fs.readFile(path.join(ROOT,'status.json'),'utf8'));}catch{return {};}}
async function repository(dir,signal) {
  if(!await exists(dir))return {path:dir,missing:true};
  const [branch,commits,status,branches]=await Promise.all([
    git(dir,['branch','--show-current'],signal),
    git(dir,['log','-5','--format=%H%x09%s%x09%cI'],signal),
    git(dir,['status','--porcelain=v1','--untracked-files=all'],signal),
    git(dir,['branch','-a','--format=%(refname:short)%09%(objectname)%09%(subject)'],signal)
  ]);
  const history=commits.split('\n').filter(Boolean).map(line=>{const [sha,subject,date]=line.split('\t');return {sha,subject,date};});
  return {path:dir,branch:branch||'(detached)',head:history[0],commits:history,dirtyCount:status?status.split('\n').length:0,
    branches:branches.split('\n').filter(Boolean).map(line=>{const [name,sha,subject]=line.split('\t');return {name,sha,subject};}),
    ...(dir===repos.frontend?{worktrees:await git(dir,['worktree','list','--porcelain'],signal)}:{})};
}
async function originals(signal) {
  // The pinned checkouts scripts/setup.sh creates, expected clean at frontend/pins.json's commits.
  const pinned=(await pins()).raw;
  const targets=[
    {name:'reactivescript',path:path.join(BASE,'reactivescript'),expectedSha:pinned.reactivescript?.commit,expectedDirty:0},
    {name:'solid-next',path:path.join(BASE,'solid-next'),expectedSha:pinned.solid?.commit,expectedDirty:0}
  ];
  const items=await Promise.all(targets.map(async target=>({...target,...await safe(async()=>{
    const sha=await git(target.path,['rev-parse','HEAD'],signal);
    const status=await git(target.path,['status','--porcelain=v1'],signal);
    const dirtyCount=status?status.split('\n').length:0;
    return {sha,dirtyCount,ok:(!target.expectedSha||target.expectedSha===sha)&&dirtyCount===target.expectedDirty};
  })})));
  return {ok:items.every(item=>item.ok),items};
}
async function pins(){const raw=JSON.parse(await fs.readFile(path.join(repos.frontend,'pins.json'),'utf8'));return {reactivescript:raw.reactivescript?.commit,solid:raw.solid?.commit,raw};}
async function fuzz(){
  const dir=path.join(repos.frontend,'.out/fuzz');
  if(!await exists(dir))return {missing:true,message:'No fuzz output directory'};
  const candidates=await Promise.all((await fs.readdir(dir,{withFileTypes:true})).filter(item=>item.isDirectory()).map(item=>safe(async()=>{const file=path.join(dir,item.name,'summary.json');return {file,mtime:(await fs.stat(file)).mtimeMs};})));
  const latest=candidates.filter(item=>item.file).sort((a,b)=>b.mtime-a.mtime)[0];
  if(!latest)return {missing:true,message:'No fuzz summary.json found'};
  const summary=JSON.parse(await fs.readFile(latest.file,'utf8'));
  return {file:latest.file,modifiedAt:new Date(latest.mtime).toISOString(),seeds:summary.seeds??summary.config?.seeds??null,tally:summary.tally??summary.totals??null,summary};
}
async function artifacts(signal){
  const dir=path.join(BASE,'docs/scratch/slice1');const files=[];
  async function walk(current){for(const item of await fs.readdir(current,{withFileTypes:true})){const file=path.join(current,item.name);if(item.isDirectory())await walk(file);else files.push({name:path.relative(dir,file),modifiedAt:(await fs.stat(file)).mtime.toISOString()});}}
  const missing=!await exists(dir);if(!missing)await walk(dir);
  return {directory:dir,missing,files:files.sort((a,b)=>a.name.localeCompare(b.name)),likePlanPresent:files.some(item=>item.name==='like.plan.json'||item.name.endsWith('/like.plan.json')),rustBranch:await safe(async()=>({sha:await git(repos['rust-solid'],['rev-parse','--verify','refs/heads/slice1'],signal)})),rustSliceDocPresent:await exists(path.join(repos['rust-solid'],'docs/SLICE1.md'))};
}
async function runtime(){
  const file=path.join(repos['rust-solid'],'docs/STATUS.md'),text=await fs.readFile(file,'utf8');
  return {file,headlines:text.split('\n').filter(line=>/^#{1,3}\s/.test(line)).slice(0,15),agreement:text.split('\n').filter(line=>/agreement|[0-9]+(?:\.[0-9]+)?\s*%/i.test(line)).slice(0,20)};
}
export async function collectLocal(){
  const jobs={repos:signal=>Promise.all(Object.entries(repos).map(async([name,dir])=>[name,await safe(()=>repository(dir,signal))])).then(items=>({items:Object.fromEntries(items)})),originals,pins,fuzz,artifacts,runtime,notes:async()=>({data:JSON.parse(await fs.readFile(path.join(ROOT,'notes.json'),'utf8'))})};
  return Object.fromEntries(await Promise.all(Object.entries(jobs).map(async([name,fn])=>[name,await section(fn)])));
}
export async function collectGithub(pinSection,previous={}){
  return section(async signal=>{
    const base='repos/ryansolid/reactivescript';
    const upstreamPromise=safe(async()=>{
      const main=await api(base+'/commits/main',signal);
      const pin=pinSection?.reactivescript;if(!pin)return {mainSha:main.sha,error:'ReactiveScript pin is unavailable'};
      const compare=await api(base+'/compare/'+pin+'...main',signal);
      let commits=compare.commits||[];
      if(compare.ahead_by>250)commits=(await api(base+'/commits?sha=main&per_page=5',signal)).reverse();
      return {pin,mainSha:main.sha,behind:compare.ahead_by,recent:commits.slice(-5).reverse().map(c=>({sha:c.sha,subject:c.commit.message.split('\n')[0]}))};
    });
    const threadsPromise=Promise.all([1,20,21,33].map(async number=>({number,...await safe(async()=>{
      const issue=await api(base+'/issues/'+number,signal);
      const last=issue.comments?(await api(base+'/issues/'+number+'/comments?per_page=1&page='+issue.comments,signal))[0]:null;
      const thread={number,title:issue.title,url:issue.html_url,state:issue.state,draft:false,comments:issue.comments,updatedAt:issue.updated_at,lastComment:last?{id:last.id,author:last.user.login,date:last.created_at,url:last.html_url}:null};
      if(number===21){
        const pr=await api(base+'/pulls/21',signal);
        thread.draft=pr.draft;thread.headSha=pr.head.sha;thread.headBranch=pr.head.ref;thread.headRepo=pr.head.repo?.full_name;
        const refs=[...new Set(['refs/heads/tsx-frontend-demo-v3','refs/remotes/origin/tsx-frontend-demo-v3','refs/heads/'+pr.head.ref,'refs/remotes/origin/'+pr.head.ref,'refs/remotes/'+pr.head.user?.login+'/'+pr.head.ref])];
        thread.localRefs=await Promise.all(refs.map(ref=>safe(async()=>({ref,sha:await git(repos['reactivescript-pr'],['rev-parse','--verify',ref],signal)}))));
        thread.localSha=thread.localRefs.find(item=>item.sha===pr.head.sha)?.sha||thread.localRefs.find(item=>item.sha)?.sha||null;
        thread.inSync=thread.localRefs.some(item=>item.sha===pr.head.sha);
      }
      const old=previous.threads?.find(t=>t.number===number);
      thread.newExternalComment=!!last&&last.user.login!=='devagrawal09'&&last.id!==old?.lastComment?.id;
      return thread;
    })})));
    const prsPromise=safe(async()=>{const items=[];for(let page=1;page<=20;page++){const batch=await api(base+'/pulls?state=open&per_page=100&page='+page,signal);items.push(...batch);if(batch.length<100)break;}return {items:items.map(pr=>({number:pr.number,title:pr.title,updatedAt:pr.updated_at,draft:pr.draft,url:pr.html_url}))};});
    const [upstream,threads,openPRs]=await Promise.all([upstreamPromise,threadsPromise,prsPromise]);
    return {upstream,threads,openPRs};
  },300,120000);
}

let gateBusy=false,active=null,stopping=false,gateController=null,initialized=false;
let states={},queue=[];const queued=new Set();
async function initGates(){if(initialized)return;const old=await loadStatus();states=old.gates?.items||{};initialized=true;}
export async function gateSnapshot(){await initGates();return {collectedAt:now(),intervalSeconds:60,busy:gateBusy,active,queued:queue.map(({name,sha})=>({name,sha})),items:{...states}};}
export function parseGate(text){
  const lines=text.replace(/\u001b\[[0-9;]*m/g,'').split(/\r?\n/);
  const values=label=>lines.filter(line=>new RegExp('^\\s*'+label+'\\s*:','i').test(line)).map(line=>line.trim());
  return {result:values('Result'),tests:values('Tests'),fuzz:values('Fuzz'),diagnostics:lines.filter(line=>/diagnostic|\bTS[0-9]{4}\b/i.test(line)).slice(-100),tail:lines.filter(Boolean).slice(-35)};
}
async function gateTarget(name,dir){
  if(!await exists(dir))return {name,missing:true};
  const workingSha=await git(dir,['rev-parse','HEAD']);
  const status=await git(dir,['status','--porcelain=v1','--untracked-files=all']);
  return {name,dir,workingSha,dirty:!!status,sha:name==='frontend'?await git(dir,['rev-parse','--verify','refs/heads/'+GATE_BRANCH]):workingSha,branch:name==='frontend'?GATE_BRANCH:await git(dir,['branch','--show-current'])};
}
export async function checkGates(changed=async()=>{}){
  if(stopping)return;await initGates();
  for(const[name,dir]of [['frontend',repos.frontend],['slice1',repos['slice1-js']]]){
    const target=await safe(()=>gateTarget(name,dir));
    if(target.error||target.missing){states={...states,[name]:{...target,state:target.missing?'missing':'error',collectedAt:now()}};continue;}
    const key=name+':'+target.sha,cacheFile=path.join(CACHE,'gates',name,target.sha+'.json');
    if(target.dirty){states={...states,[name]:{...target,state:'skipped',reason:'skipped: worktree dirty',collectedAt:now()}};continue;}
    if(await exists(cacheFile)){states={...states,[name]:await safe(async()=>JSON.parse(await fs.readFile(cacheFile,'utf8')))};continue;}
    if(queued.has(key))continue;
    if(target.sha!==target.workingSha){states={...states,[name]:{...target,state:'blocked',error:'Worktree is not at '+GATE_BRANCH+'; read-only mode cannot check it out.'}};continue;}
    queued.add(key);queue.push({...target,key,cacheFile});states={...states,[name]:{...target,state:'queued'}};
  }
  await changed();if(!gateBusy)void drain(changed);
}
async function runGate(target){
  const startedAt=now();
  const cleanStatus=await git(target.dir,['status','--porcelain=v1','--untracked-files=all']);
  const currentSha=await git(target.dir,['rev-parse','HEAD']);
  if(cleanStatus)return {name:target.name,sha:target.sha,branch:target.branch,state:'skipped',reason:'skipped: worktree dirty',startedAt,finishedAt:now()};
  if(currentSha!==target.sha)return {name:target.name,sha:target.sha,branch:target.branch,state:'skipped',reason:'skipped: HEAD changed while queued',startedAt,finishedAt:now()};
  const outDir=path.join(CACHE,'gates',target.name,target.sha,'verify');
  const tmp=path.join(CACHE,'tmp');
  await fs.mkdir(outDir,{recursive:true});await fs.mkdir(tmp,{recursive:true});
  gateController=new AbortController();if(stopping)throw new Error('Server stopped');
  const logFile=path.join(CACHE,'gates',target.name,target.sha+'.log');
  const result=await command('npm',['run','verify:subset'],{cwd:target.dir,timeout:600000,signal:gateController.signal,customEnv:{...env,OUT:outDir,TMPDIR:tmp+'/',npm_config_cache:path.join(CACHE,'npm'),npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_fund:'false'}});
  gateController=null;
  const text=result.stdout+'\n'+result.stderr;await fs.writeFile(logFile,text);
  const parsed=parseGate(text);
  const afterSha=await git(target.dir,['rev-parse','HEAD']);
  const afterStatus=await git(target.dir,['status','--porcelain=v1','--untracked-files=all']);
  const changed=afterSha!==target.sha||!!afterStatus;
  return {name:target.name,sha:target.sha,branch:target.branch,state:changed?'skipped':result.code===0&&!parsed.result.some(line=>/\bfail(?:ed|ure)?\b/i.test(line))?'passed':'failed',...(changed?{reason:afterStatus?'skipped: worktree dirty':'skipped: HEAD changed during gate'}:{}),exitCode:result.code,startedAt,finishedAt:now(),logFile:path.relative(ROOT,logFile),outDir:path.relative(ROOT,outDir),runLocation:target.dir,isolatedCopy:false,...parsed};
}
async function drain(changed){
  if(gateBusy||stopping)return;gateBusy=true;
  try{while(queue.length&&!stopping){
    const target=queue.shift();active={name:target.name,sha:target.sha,startedAt:now()};states={...states,[target.name]:{name:target.name,sha:target.sha,branch:target.branch,state:'running',startedAt:active.startedAt}};await changed();
    let value;try{value=await runGate(target);}catch(error){value={name:target.name,sha:target.sha,branch:target.branch,state:'error',error:message(error),startedAt:active.startedAt,finishedAt:now()};}
    if(value.state!=='skipped')await atomicJSON(target.cacheFile,value);states={...states,[target.name]:value};queued.delete(target.key);active=null;await changed();console.log('Gate',target.name,target.sha,value.state,value.error||value.reason||'');
  }}catch(error){console.error('Gate queue:',error);}finally{gateBusy=false;active=null;await changed();}
}
export function stop(){stopping=true;gateController?.abort();for(const child of children){try{process.kill(-child.pid,'SIGKILL');}catch{}}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const old=await loadStatus(),local=await collectLocal();
  const github=await collectGithub(local.pins,old.github);
  await atomicJSON(path.join(ROOT,'status.json'),{schemaVersion:1,updatedAt:now(),...local,github,gates:await gateSnapshot()});
  console.log('Snapshot written');
}
