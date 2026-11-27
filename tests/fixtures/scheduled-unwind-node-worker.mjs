import {parentPort,workerData} from 'node:worker_threads';
import {createCompiledUnwindProbe} from './scheduled-unwind-worker-probe.mjs';
const guest=await import('data:text/javascript,'+encodeURIComponent(workerData));
const probe=createCompiledUnwindProbe(guest,msg=>parentPort.postMessage(msg));
parentPort.on('message',msg=>{try{probe(msg);}catch(e){parentPort.postMessage({kind:'guest-error',message:String(e)});}});
