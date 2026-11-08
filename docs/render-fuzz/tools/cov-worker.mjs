// One --render program for cov-run.mjs; the worker exits on its own so V8 writes its coverage.
import {workerData,parentPort} from 'node:worker_threads';
const {runRender}=await import('../../../fuzz/universal.mjs');
let r;try{runRender(workerData);r='trace'}catch(e){r='oracle-error'}
parentPort.postMessage(r);parentPort.close();
