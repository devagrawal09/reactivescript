// Runs fuzz/solid.mjs over generated slice-1 programs in one process and
// writes one JSON trace per line. Run from the repository root; the oracle
// module is chosen by SOLID_SIGNALS_URL (default: the built dist/prod).
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=pathToFileURL(process.cwd()+'/');
const {run}=await import(new URL('fuzz/solid.mjs',root));
const {generateSlice1}=await import(new URL('fuzz/generate-slice1.mjs',root));
const [a,b,o]=process.argv.slice(2);const r=[];
for(let s=+a;s<=+b;s++)r.push(JSON.stringify(await run(generateSlice1(s))));
writeFileSync(o,r.join('\n'));
