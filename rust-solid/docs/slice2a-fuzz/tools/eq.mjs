// Runs fuzz/solid.mjs over generated programs in ONE process and writes one JSON
// trace per line (docs/SLICE2A-COVERAGE.md). Run from the repository root.
//   node eq.mjs slice1|slice2a FIRST LAST OUT
// The oracle module is chosen by SOLID_SIGNALS_URL (default: built dist/prod).
// A reactivity halt (console.error '[REACTIVITY_HALTED]') is recorded in the line.
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {run}=await import(new URL('fuzz/solid.mjs',root));
const [mode,a,b,o]=process.argv.slice(2);
const gen=mode==='slice1'?(await import(new URL('fuzz/generate-slice1.mjs',root))).generateSlice1:(await import(new URL('fuzz/generate-slice2a.mjs',root))).generateSlice2a;
let halted=false;const error=console.error;console.error=(...x)=>{if(String(x[0]).startsWith('[REACTIVITY_HALTED]'))halted=true;return error(...x)};
const r=[];
for(let s=+a;s<=+b;s++){let line;try{line=JSON.stringify(await run(gen(s)))}catch(e){line=JSON.stringify({error:String(e)})}r.push(halted?JSON.stringify({halted:true,trace:line}):line)}
writeFileSync(o,r.join('\n'));
