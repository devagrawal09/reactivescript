// First divergence between the traced Solid copy (trace-copy.mjs) and the Rust
// runtime's SLICE1_TRACE output for one program (a JSON op array, or a fuzz
// failure/reduced file with an `ops` field). Needs `cargo build`.
// Usage (repository root): node docs/slice2a-fuzz/tools/trace-diff.mjs FILE [context]
import {execFileSync,spawnSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';
const [file,ctx='25']=process.argv.slice(2);let ops=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(ops))ops=ops.ops;
writeFileSync('out/trace-ops.json',JSON.stringify(ops));
const solid=execFileSync(process.execPath,['--import','./out/solid-trace/register.mjs','out/solid-trace/trace-run.mjs','out/trace-ops.json'],{encoding:'utf8'}).trimEnd().split('\n');
const r=spawnSync('target/debug/slice1-driver',{input:JSON.stringify(ops)+'\n',encoding:'utf8',env:{...process.env,SLICE1_TRACE:'1'}});
const rust=r.stderr.split('\n').filter(l=>/^(OP|LOG|R|RD|N|W|E|P|C|L|J|S|H|SS|IS) /.test(l));
for(let i=0;i<Math.max(solid.length,rust.length);i++)if(solid[i]!==rust[i]){
 for(let j=Math.max(0,i-+ctx);j<i;j++)console.log('   ',solid[j]);
 console.log('S>>',solid[i]);console.log('R>>',rust[i]);
 for(let j=i+1;j<Math.min(solid.length,i+15);j++)console.log('S  ',solid[j]);process.exit(1)}
console.log('identical',solid.length,'lines');
