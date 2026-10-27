import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorkerActorClient} from '../src/worker-actor-client.mjs';

const PROTOCOL='ores.js.worker.v1';
class NodeWorker extends EventEmitter {
  posted=[];
  terminations=0;
  postMessage(frame){this.posted.push(frame);}
  terminate(){this.terminations++;return Promise.resolve(0);}
  ready(){this.emit('message',{protocol:PROTOCOL,kind:'ready'});}
  fail(kind){
    if(kind==='error')this.emit('error',new Error('injected error'));
    else this.emit('messageerror',new Error('injected decode error'));
  }
}
class BrowserWorker {
  posted=[];
  terminations=0;
  callbacks=new Map();
  addEventListener(type,callback){this.callbacks.set(type,callback);}
  postMessage(frame){this.posted.push(frame);}
  terminate(){this.terminations++;}
  ready(){this.callbacks.get('message')({data:{protocol:PROTOCOL,kind:'ready'}});}
  fail(kind){this.callbacks.get(kind)({});}
}

// Bound a deliberately failing regression instead of letting an orphaned
// promise hang the entire Node worker suite until its CI timeout.
async function requireClosedRejection(promise){
  let timer;
  const outcome=await Promise.race([
    promise.then(()=>({state:'resolved'}),error=>({state:'rejected',message:String(error.message)})),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({state:'timeout'}),500);})
  ]);
  clearTimeout(timer);
  assert.equal(outcome.state,'rejected','copy-time revocation must settle receipt');
  assert.match(outcome.message,/actor closed/);
}

for (const [kind,Factory] of [['node',NodeWorker],['browser',BrowserWorker]]) {
  for (const isReady of [false,true]) {
    for (const event of ['error','messageerror']) {
      for (const operation of ['request','tell']) {
        test(kind+' '+(isReady?'ready':'pre-ready')+' '+event+
          ' during payload clone does not resurrect '+operation,async()=>{
          const worker=new Factory();
          const actor=createWorkerActorClient({
            worker,moduleUrl:'file:///trusted/actor.mjs',
            exportName:'receive',mode:'handler',maxPending:2,maxPendingBytes:1024
          });
          const readyFailure=isReady?null:assert.rejects(actor.ready,/worker (message decoding|execution) failure/);
          if(isReady){worker.ready();await actor.ready;}
          const original=globalThis.structuredClone;
          let invoked=0;
          let result;
          try {
            globalThis.structuredClone=(value,...args)=>{
              if(invoked++===0)worker.fail(event);
              return original(value,...args);
            };
            result=actor[operation]({args:[40n,2n]});
          } finally {
            globalThis.structuredClone=original;
          }
          await requireClosedRejection(result);
          if(readyFailure)await readyFailure;
          assert.equal(invoked,1,'injection must occur during successful ownership copy');
          assert.equal(actor.pending,0,'no late pending receipt after shutdown');
          assert.equal(actor.pendingBytes,0,'no late byte-credit reservation');
          assert.equal(worker.posted.filter(frame=>frame.kind==='deliver').length,0);
          assert.equal(worker.terminations,1,'exactly one termination attempt');
          await actor.close();
          assert.equal(worker.terminations,1,'close must be idempotent');
        });
      }
    }
  }
}
