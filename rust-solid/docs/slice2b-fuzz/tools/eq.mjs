// Runs fuzz/solid.mjs over generated programs in ONE process and writes one JSON trace per
// line (docs/SLICE2B-COVERAGE.md); as docs/slice2a-fuzz/tools/eq.mjs, plus slice2b.
//   node eq.mjs slice1|slice2a|slice2b FIRST LAST OUT
// The oracle module is chosen by SOLID_SIGNALS_URL (default: built dist/prod). A reactivity
// halt is recorded in the line. Values are NOT domain-checked here (workers.mjs does that).
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {run}=await import(new URL('fuzz/solid.mjs',root));
const [mode,a,b,o]=process.argv.slice(2);
const gen={slice1:async()=>(await import(new URL('fuzz/generate-slice1.mjs',root))).generateSlice1,
 slice2a:async()=>(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a,
 slice2b:async()=>(await import(new URL('fuzz/generate-slice2b.mjs',root))).generateSlice2b}[mode];
const g=await gen();
let halted=false;const error=console.error;console.error=(...x)=>{if(String(x[0]).startsWith('[REACTIVITY_HALTED]'))halted=true;return error(...x)};
const r=[];
for(let s=+a;s<=+b;s++){let line;try{line=JSON.stringify(await run(g(s)))}catch(e){line=JSON.stringify({error:String(e)})}r.push(halted?JSON.stringify({halted:true,trace:line}):line)}
writeFileSync(o,r.join('\n'));
