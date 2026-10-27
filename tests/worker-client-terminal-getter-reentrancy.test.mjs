import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorkerActorClient} from '../src/worker-actor-client.mjs';

const PROTOCOL='ores.js.worker.v1';
class NodeStub extends EventEmitter {
  terminations=0;
  postMessage() {}
  terminate() {this.terminations++;return Promise.resolve(0);}
  frame(frame) {this.emit('message',frame);}
  fail() {this.emit('messageerror',new Error('reentrant decoding failure'));}
}
class BrowserStub {
  callbacks=new Map();
  terminations=0;
  addEventListener(kind,callback) {this.callbacks.set(kind,callback);}
  postMessage() {}
  terminate() {this.terminations++;}
  frame(frame) {this.callbacks.get('message')({data:frame});}
  fail() {this.callbacks.get('messageerror')({});}
}
const client=worker=>createWorkerActorClient({
  worker,moduleUrl:'file:///trusted/generated.mjs',
  maxPending:3,maxPendingBytes:1024
});

// Real Workers structured-clone control frames, but injected host transports
// can synchronously reenter while a protocol getter is being evaluated.
// Once a nested event revokes the session, no later getter may be consulted.
for(const [host,Factory] of [['node',NodeStub],['browser',BrowserStub]]) {
  for(const [phase,next] of [['protocol','kind'],['kind','id'],['ok','value']]) {
    test(host+' terminal revocation in '+phase+' does not read '+next,async()=>{
      const worker=new Factory(),actor=client(worker);
      worker.frame({protocol:PROTOCOL,kind:'ready'});
      await actor.ready;
      const pending=assert.rejects(actor.request({payload:42n}),/reentrant actor event/);
      assert.equal(actor.pending,1);
      const frame={protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n};
      const values={protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n};
      let reads=0;
      Object.defineProperty(frame,phase,{get(){
        worker.fail();
        return values[phase];
      }});
      Object.defineProperty(frame,next,{get(){
        reads++;
        return values[next];
      }});
      assert.doesNotThrow(()=>worker.frame(frame));
      await pending;
      assert.equal(reads,0,'no post-revocation getter evaluation');
      assert.equal(actor.pending,0);
      assert.equal(actor.pendingBytes,0);
      assert.equal(worker.terminations,1);
      await assert.rejects(actor.request({payload:7n}),/actor closed/);
      await actor.close();
      assert.equal(worker.terminations,1);
    });
  }
}
