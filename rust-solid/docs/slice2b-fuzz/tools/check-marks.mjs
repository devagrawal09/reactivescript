// The site marks (marks.mjs) each program of a JSON object {name: ops} reaches, one
// fresh worker per program on the marked copy (run marks.mjs once with no arguments,
// and mark-reduce.mjs once, to write out/solid-mark/mark-worker.mjs).
// Usage (repository root, Node 24): node docs/slice2b-fuzz/tools/check-marks.mjs FILE
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
const dir=process.cwd()+'/out/solid-mark/';
const env={...process.env,SOLID_SIGNALS_URL:pathToFileURL(dir+'index.ts').href};
const marked=ops=>new Promise(res=>{const w=new Worker(new URL('file://'+dir+'mark-worker.mjs'),{env});
 const t=setTimeout(()=>{w.terminate();res({m:{},error:'timeout'})},5000);w.once('message',m=>{clearTimeout(t);w.terminate();res(m)});w.postMessage(ops)});
const progs=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const [k,ops] of Object.entries(progs)){const r=await marked(ops);console.log(k.padEnd(40),r.error??'',JSON.stringify(r.m))}
process.exit(0);
