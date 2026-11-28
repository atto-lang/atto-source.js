import {parentPort,workerData} from 'node:worker_threads';
import {createCompiledRecoveryProbe} from './scheduled-recover-worker-probe.mjs';
const guest=await import('data:text/javascript,'+encodeURIComponent(workerData));
const probe=createCompiledRecoveryProbe(guest,msg=>parentPort.postMessage(msg));
parentPort.on('message',msg=>{try{probe(msg);}catch(e){parentPort.postMessage({kind:'recover-error',message:String(e)});}});
