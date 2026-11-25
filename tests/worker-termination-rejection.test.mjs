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

import {Worker} from 'node:worker_threads';
import {spawnNodeActor} from '../src/actor-host.node.mjs';
import {spawnBrowserActor} from '../src/actor-host.browser.mjs';

test('Node spawn cleanup observes rejected terminate without masking invalid configuration',async()=>{
  const original=Worker.prototype.terminate;
  let calls=0;
  Worker.prototype.terminate=function(...args) {
    calls++;
    // Actually release the real worker; only the returned termination promise
    // is adversarial. The host must observe the injected rejection.
    void Promise.resolve(original.apply(this,args)).catch(()=>{});
    return Promise.reject(new Error('injected Node cleanup rejection'));
  };
  try {
    assert.throws(()=>spawnNodeActor({
      moduleUrl:'file:///trusted/generated.mjs',maxPending:0
    }),/invalid mailbox limit/);
  } finally {
    Worker.prototype.terminate=original;
  }
  assert.equal(calls,1);
  // Node's test runner also flags an unhandledRejection after this turn.
  await new Promise(resolve=>setImmediate(resolve));
});

test('Browser spawn cleanup preserves original failure across throwing/rejecting terminate',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{
    configurable:true,value:{href:'https://example.test/app',origin:'https://example.test'}
  });
  try {
    for(const outcome of ['throw','reject']) {
      let calls=0;
      class StubBrowserWorker {
        addEventListener() {}
        postMessage() {}
        terminate() {
          calls++;
          if(outcome==='throw')throw new Error('injected browser cleanup throw');
          return Promise.reject(new Error('injected browser cleanup rejection'));
        }
      }
      assert.throws(()=>spawnBrowserActor({
        moduleUrl:'https://example.test/trusted/generated.mjs',
        WorkerCtor:StubBrowserWorker,maxPendingBytes:0
      }),/invalid actor mailbox byte limit/);
      assert.equal(calls,1);
    }
  } finally {
    if(previous)Object.defineProperty(globalThis,'location',previous);
    else delete globalThis.location;
  }
  await new Promise(resolve=>setImmediate(resolve));
});
