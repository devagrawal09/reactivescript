// The --render oracle worker (fuzz/run.mjs starts one per program with --conditions=browser).
// Fail-closed: an uncaught reactive error ([REACTIVITY_HALTED]) or any throw makes the program
// invalid (oracle-halted / oracle-error) instead of a trace.
import {parentPort} from 'node:worker_threads';
const {runRender}=await import('./universal.mjs');
let halted=false;const error=console.error;console.error=(...a)=>{if(String(a[0]).startsWith('[REACTIVITY_HALTED]'))halted=true;return error(...a)};
parentPort.on('message',ops=>{try{const expected=runRender(ops);parentPort.postMessage(halted?{invalid:'oracle-halted'}:{expected})}catch(e){parentPort.postMessage({invalid:'oracle-error',detail:e.stack})}});
