import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorkerActorClient} from '../src/worker-actor-client.mjs';

const protocol='ores.js.worker.v1';
const spawn=worker=>createWorkerActorClient({
  worker,moduleUrl:'file:///trusted/mock.mjs',maxPending:2
});
class NodeStub extends EventEmitter {
  terminations=0;
  postMessage() {}
  terminate() {
    this.terminations++;
    return Promise.reject(new Error('injected terminate rejection'));
  }
}
test('rejected Node termination cannot orphan startup receipts or reject unhandled',async()=>{
  const worker=new NodeStub(),actor=spawn(worker);
  const ready=assert.rejects(actor.ready,/invalid actor frame/);
  const pending=assert.rejects(actor.request({n:1}),/invalid actor frame/);
  worker.emit('message',{protocol:'wrong',kind:'ready'});
  await Promise.all([ready,pending]);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  worker.emit('messageerror',new Error('late'));
  assert.equal(worker.terminations,1);
  await assert.rejects(actor.close(),/injected terminate rejection/);
  assert.equal(worker.terminations,1);
  await new Promise(resolve=>setImmediate(resolve));
});
test('synchronous browser terminate throw cannot escape error callback',async()=>{
  class BrowserStub {
    listeners=new Map();
    terminations=0;
    addEventListener(name,fn){this.listeners.set(name,fn);}
    postMessage() {}
    terminate(){this.terminations++;throw Error('injected browser terminate throw');}
    frame(data){this.listeners.get('message')?.({data});}
  }
  const worker=new BrowserStub(),actor=spawn(worker);
  const ready=assert.rejects(actor.ready,/invalid actor frame/);
  const pending=assert.rejects(actor.tell({n:1}),/invalid actor frame/);
  assert.doesNotThrow(()=>worker.frame({protocol,kind:'unexpected'}));
  await Promise.all([ready,pending]);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  await assert.rejects(actor.close(),/injected browser terminate throw/);
  assert.equal(worker.terminations,1);
});
test('reentrant Worker error during termination is bounded to one attempt',async()=>{
  class ReentrantStub extends EventEmitter {
    terminations=0;
    postMessage() {}
    terminate(){
      this.terminations++;
      this.emit('error',new Error('reentrant error'));
      return Promise.resolve(0);
    }
  }
  const worker=new ReentrantStub(),actor=spawn(worker);
  const ready=assert.rejects(actor.ready,/invalid actor frame/);
  const pending=assert.rejects(actor.request({n:1}),/invalid actor frame/);
  assert.doesNotThrow(()=>worker.emit('message',{protocol:'wrong',kind:'ready'}));
  await Promise.all([ready,pending]);
  assert.equal(actor.pending,0);
  assert.equal(worker.terminations,1);
  await actor.close();
  assert.equal(worker.terminations,1);
});
