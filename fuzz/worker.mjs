import {parentPort} from 'node:worker_threads';
import {run} from './solid.mjs';
parentPort.on('message',async ops=>{try{parentPort.postMessage({expected:await run(ops,progress=>parentPort.postMessage({progress}))})}catch(e){parentPort.postMessage({invalid:'oracle-error',detail:e.stack})}});
