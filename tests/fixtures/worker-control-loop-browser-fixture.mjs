import {createWorkerControlLoop} from '../../src/worker-control-loop.mjs';
import {createUnwindProbe} from './worker-unwind-probe.mjs';
const loop=createWorkerControlLoop();
const unwind=createUnwindProbe(loop,frame=>self.postMessage(frame));
loop.attachOwner('browser-task',1);
let ticket=loop.beginSuspension('browser-task',1,value=>{
  self.postMessage({kind:'resumed',value});
});
self.addEventListener('message',event=>{
  const msg=event.data;
  if(unwind(msg))return;
  if(msg?.kind==='complete'){
    self.postMessage({kind:'before'});
    const accepted=loop.complete(ticket,msg.value);
    self.postMessage({kind:'after',accepted});
  }else if(msg?.kind==='retire'){
    const retired=loop.retireOwner('browser-task',1);
    const stale=loop.complete(ticket,999);
    const attached=loop.attachOwner('browser-task',2);
    ticket=loop.beginSuspension('browser-task',2,value=>{
      self.postMessage({kind:'resumed2',value});
    });
    self.postMessage({kind:'retired',retired,stale,attached});
  }else if(msg?.kind==='close'){
    loop.close();
    self.postMessage({kind:'closed',closed:loop.stats.closed});
  }
});
self.postMessage({kind:'ready'});
