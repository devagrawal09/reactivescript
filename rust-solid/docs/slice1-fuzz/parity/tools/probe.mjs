// Private out-of-distribution probe: same worker oracle and exact comparison
// as fuzz/run.mjs, different (wider) program generator. Not an official score.
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createInterface} from 'node:readline';
import {writeFileSync,mkdirSync} from 'node:fs';
const root=process.cwd()+'/'; // run from the repository root
const [mode,start,count]=[process.argv[2],+process.argv[3],+process.argv[4]];
function gen(seed){
 let state=seed>>>0;const rnd=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};const n=m=>Math.floor(rnd()*m);
 const ops=[],put=(op,r={})=>ops.push({op,...r});const read=id=>({op:'read',id}),add=(a,b)=>({op:'add',a,b});
 put('signal',{id:'s',value:n(4)});put('signal',{id:'t',value:n(4)});put('signal',{id:'o',value:n(4),optimistic:true});
 const srcs=['s','t','o'];
 if(mode!=='plain'&&n(2))put('memo',{id:'m',expr:add(read(srcs[n(3)]),read(srcs[n(3)]))}),srcs.push('m');
 put('effect',{id:'v1',expr:add(read(srcs[n(srcs.length)]),read(srcs[n(srcs.length)])),render:true});
 if(n(2))put('effect',{id:'v2',expr:read(srcs[n(srcs.length)]),render:n(2)===0});
 put('flush');
 const open=[];let a=0;
 for(let i=0;i<14;i++){const k=n(9);
  if(k<2)put('write',{id:['s','t','o'][n(3)],value:n(8)});
  else if(k===2)put('flush');
  else if(k===3)put('read',{id:srcs[n(srcs.length)]});
  else if(k<6&&open.length<(mode==='overlap'?3:1)){const f='f'+a;const slices=[{writes:Array.from({length:1+n(2)},()=>({id:['s','t','o'][n(3)],value:n(8)})),flight:f}];if(n(2))slices.push({writes:[{id:['s','t','o'][n(3)],value:n(8)}]});put('action',{id:'a'+a++,slices});open.push(f)}
  else if(open.length){const f=open.splice(n(open.length),1)[0];if(n(2))put('resolve',{flight:f,value:n(8)});else put('reject',{flight:f,message:'no'})}
 }
 for(const f of open)put('resolve',{flight:f,value:1});
 put('flush');for(const id of srcs)put('read',{id});return ops;
}
function oracle(ops){const w=new Worker(new URL('fuzz/worker.mjs','file://'+root));return new Promise(res=>{const t=setTimeout(()=>{w.terminate();res({invalid:'timeout'})},3000);w.on('message',r=>{if('progress'in r)return;clearTimeout(t);w.terminate();res(r)});w.on('error',e=>{clearTimeout(t);res({invalid:String(e)})});w.postMessage(ops)})}
const child=spawn(root+'target/debug/slice1-driver',[],{stdio:['pipe','pipe','inherit']});const lines=createInterface({input:child.stdout});
const rust=ops=>new Promise(r=>{lines.once('line',l=>r(JSON.parse(l)));child.stdin.write(JSON.stringify(ops)+'\n')});
mkdirSync(root+'out/probe/'+mode,{recursive:true});
let agree=0,invalid=0;const classes={};
for(let s=start;s<start+count;s++){const ops=gen(s);const ref=await oracle(ops);if(ref.invalid){invalid++;continue}const act=await rust(ops);
 if(JSON.stringify(ref.expected)===JSON.stringify(act)){agree++;continue}
 const i=Array.isArray(act)?ref.expected.findIndex((x,i)=>JSON.stringify(x)!==JSON.stringify(act[i])):-1;
 const k=act.driver_error?'rust-'+act.driver_error:(ref.expected[i]?.[0]??'end')+'-'+(act[i]?.[0]??'end');
 classes[k]??={count:0,seed:s};classes[k].count++;writeFileSync(root+`out/probe/${mode}/fail-${s}.json`,JSON.stringify({seed:s,ops,expected:ref.expected,actual:act},null,1));}
child.stdin.end();console.log(JSON.stringify({mode,start,count,agree,invalid,classes}));
