import http from 'node:http';
import path from 'node:path';
import { promises as fs,createWriteStream } from 'node:fs';
import { format } from 'node:util';
import { ROOT,loadStatus,atomicJSON,collectLocal,collectGithub,checkGates,gateSnapshot,stop } from './collect.mjs';
process.chdir(ROOT);
const log=createWriteStream(path.join(ROOT,'server.log'),{flags:'a'});
for(const level of ['log','warn','error'])console[level]=(...args)=>log.write(new Date().toISOString()+' '+level.toUpperCase()+' '+format(...args)+'\n');
let snapshot=await loadStatus(),localRun=null,githubRun=null,gateCheck=null,writeQueue=Promise.resolve(),closing=false;
for(const name of ['repos','originals','pins','github','gates','fuzz','artifacts','runtime','notes'])if(!snapshot[name])snapshot[name]={collectedAt:new Date().toISOString(),intervalSeconds:name==='github'?300:60,error:'Initial collection running'};
function save(){const value=snapshot;writeQueue=writeQueue.catch(error=>console.error(error)).then(()=>atomicJSON(path.join(ROOT,'status.json'),value));return writeQueue;}
async function merge(values){snapshot={...snapshot,...values,updatedAt:new Date().toISOString()};await save();}
function refreshLocal(){
  if(localRun)return localRun;
  localRun=collectLocal().then(merge).then(()=>console.log('Local collection complete')).catch(error=>console.error('Local collection:',error)).finally(()=>{localRun=null;});
  return localRun;
}
function refreshGithub(){
  if(githubRun)return githubRun;
  githubRun=collectGithub(snapshot.pins,snapshot.github).then(github=>merge({github})).then(()=>console.log('GitHub collection complete')).catch(error=>console.error('GitHub collection:',error)).finally(()=>{githubRun=null;});
  return githubRun;
}
async function gatesChanged(){await merge({gates:await gateSnapshot()});}
function refreshGates(){if(gateCheck)return gateCheck;gateCheck=checkGates(gatesChanged).catch(error=>console.error('Gate check:',error)).finally(()=>{gateCheck=null;});return gateCheck;}
await save();
const server=http.createServer(async(req,res)=>{
  const send=(code,type,body)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'"});res.end(body);};
  if(req.method!=='GET')return send(405,'text/plain; charset=utf-8','GET only');
  try{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/refresh'){void refreshLocal().then(refreshGithub);return send(202,'application/json',JSON.stringify({accepted:true,message:'Sources refreshing; this request does not start a gate.'}));}
    if(pathname==='/status.json')return send(200,'application/json; charset=utf-8',await fs.readFile(path.join(ROOT,'status.json')));
    if(pathname==='/'||pathname==='/index.html')return send(200,'text/html; charset=utf-8',await fs.readFile(path.join(ROOT,'index.html')));
    send(404,'text/plain; charset=utf-8','Not found');
  }catch(error){console.error('HTTP:',error);send(500,'application/json',JSON.stringify({error:error.message}));}
});
let port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
for(;;){try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});break;}catch(error){if(error.code==='EADDRINUSE'&&port<65535)port++;else throw error;}}
await fs.writeFile(path.join(ROOT,'server.pid'),String(process.pid)+'\n');
await fs.writeFile(path.join(ROOT,'server.port'),String(port)+'\n');
console.log('Listening http://127.0.0.1:'+port+'/ PID '+process.pid);
void refreshLocal().then(refreshGithub);void refreshGates();
const localTimer=setInterval(()=>{void refreshLocal();void refreshGates();},60000);
const githubTimer=setInterval(()=>{void refreshGithub();},300000);
async function shutdown(){if(closing)return;closing=true;clearInterval(localTimer);clearInterval(githubTimer);stop();server.close();await writeQueue;await fs.rm(path.join(ROOT,'server.pid'),{force:true});log.end(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
process.on('uncaughtException',error=>{console.error(error);void shutdown();});
