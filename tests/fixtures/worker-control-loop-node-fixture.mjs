import {parentPort} from 'node:worker_threads';
import {createWorkerControlLoop} from '../../src/worker-control-loop.mjs';

const loop = createWorkerControlLoop();
loop.attachOwner('node-task', 1);
let ticket = loop.beginSuspension('node-task', 1, value => {
  parentPort.postMessage({kind: 'resumed', value});
});
parentPort.on('message', msg => {
  if (msg?.kind === 'complete') {
    parentPort.postMessage({kind: 'before'});
    const accepted = loop.complete(ticket, msg.value);
    parentPort.postMessage({kind: 'after', accepted});
  } else if (msg?.kind === 'retire') {
    const retired = loop.retireOwner('node-task', 1);
    const stale = loop.complete(ticket, 999);
    const attached = loop.attachOwner('node-task', 2);
    ticket = loop.beginSuspension('node-task', 2, value => {
      parentPort.postMessage({kind: 'resumed2', value});
    });
    parentPort.postMessage({kind: 'retired', retired, stale, attached});
  } else if (msg?.kind === 'close') {
    loop.close();
    parentPort.postMessage({kind: 'closed', stats: loop.stats});
  }
});
parentPort.postMessage({kind:'ready'});
