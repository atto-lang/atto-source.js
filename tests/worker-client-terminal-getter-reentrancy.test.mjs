import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorkerActorClient,rejectUnsupportedWorkerPlacement} from '../src/worker-actor-client.mjs';

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

test('patched Map iteration cannot orphan outstanding receipts on worker failure',async()=>{
  const worker=new NodeStub(),actor=client(worker);
  worker.frame({protocol:PROTOCOL,kind:'ready'});await actor.ready;
  const requests=[actor.request({payload:1n}),actor.tell({payload:2n})];
  const outcomes=requests.map(p=>p.then(()=> 'resolved',error=>error.message));
  assert.equal(actor.pending,2);
  const values=Map.prototype.values,clear=Map.prototype.clear;
  const iteratorProto=Object.getPrototypeOf(values.call(new Map()));
  const next=iteratorProto.next;
  try{
    Map.prototype.values=function*(){};
    Map.prototype.clear=function(){return undefined;};
    iteratorProto.next=function(){return {done:true};};
    worker.fail();
  }finally{
    Map.prototype.values=values;
    Map.prototype.clear=clear;
    iteratorProto.next=next;
  }
  let timer;
  try{
    const settled=await Promise.race([
      Promise.all(outcomes),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),500);})
    ]);
    assert.deepEqual(settled,[
      'worker message decoding failure','worker message decoding failure'
    ],'every receipt must settle even when host Map iterators are replaced');
  }finally{clearTimeout(timer);}
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  assert.equal(worker.terminations,1);
  await actor.close();
});

test('patched Map.set and size cannot bypass client mailbox admission',async()=>{
  const worker=new NodeStub();
  const actor=createWorkerActorClient({worker,moduleUrl:'file:///trusted/generated.mjs',
    maxPending:1,maxPendingBytes:1024});
  worker.frame({protocol:PROTOCOL,kind:'ready'});await actor.ready;
  const set=Map.prototype.set;
  let first;
  try{
    Map.prototype.set=function(){return this;};
    first=actor.request({payload:7n});
    assert.equal(actor.pending,1,'native set must retain the first receipt');
  }finally{Map.prototype.set=set;}
  const size=Object.getOwnPropertyDescriptor(Map.prototype,'size');
  let overflow;
  try{
    Object.defineProperty(Map.prototype,'size',{...size,get(){return 0;}});
    assert.equal(actor.pending,1,'pending count must ignore patched getter');
    overflow=actor.tell({payload:8n});
  }finally{Object.defineProperty(Map.prototype,'size',size);}
  await assert.rejects(overflow,/mailbox capacity exceeded/);
  worker.frame({protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n});
  assert.equal(await first,42n);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  await actor.close();
});

test('patched Map.get/delete cannot forge unexpected response or retain credit',async()=>{
  const worker=new NodeStub(),actor=client(worker);
  worker.frame({protocol:PROTOCOL,kind:'ready'});await actor.ready;
  const result=actor.request({payload:9n});
  const get=Map.prototype.get,del=Map.prototype.delete;
  try{
    Map.prototype.get=function(){return undefined;};
    Map.prototype.delete=function(){return false;};
    worker.frame({protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n});
  }finally{
    Map.prototype.get=get;
    Map.prototype.delete=del;
  }
  assert.equal(await result,42n);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  await actor.close();
});


test('poisoned Function.prototype.call cannot strand pending receipts on fatal',async()=>{
  const worker=new NodeStub(),actor=client(worker);
  worker.frame({protocol:PROTOCOL,kind:'ready'});await actor.ready;
  const outcomes=[actor.request({payload:1n}),actor.tell({payload:2n})]
    .map(p=>p.then(()=>'resolved',e=>e.message));
  const original=Function.prototype.call,apply=Reflect.apply;
  const values=Map.prototype.values;
  const iteratorNext=Object.getPrototypeOf(values.call(new Map())).next;
  let intercepted=0;
  try{
    Function.prototype.call=function(receiver,...args){
      if(this===values||this===iteratorNext){
        intercepted++;
        return this===values?{next(){return {done:true};}}:{done:true};
      }
      return apply(original,this,[receiver,...args]);
    };
    worker.fail();
  }finally{Function.prototype.call=original;}
  assert.equal(intercepted,0,'pending iteration must not invoke a guest-patched call');
  let timer;
  try{
    const outcome=await Promise.race([
      Promise.all(outcomes),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),500);})
    ]);
    assert.deepEqual(outcome,[
      'worker message decoding failure','worker message decoding failure'
    ]);
  }finally{clearTimeout(timer);}
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  assert.equal(worker.terminations,1);
  await actor.close();
});

test('poisoned Function.prototype.call cannot spoof Map receipt lookup',async()=>{
  const worker=new NodeStub(),actor=client(worker);
  worker.frame({protocol:PROTOCOL,kind:'ready'});await actor.ready;
  const pending=actor.request({payload:9n});
  const original=Function.prototype.call,apply=Reflect.apply;
  const get=Map.prototype.get,del=Map.prototype.delete;
  let intercepted=0;
  try{
    Function.prototype.call=function(receiver,...args){
      if(this===get||this===del){intercepted++;return undefined;}
      return apply(original,this,[receiver,...args]);
    };
    worker.frame({protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n});
  }finally{Function.prototype.call=original;}
  assert.equal(intercepted,0);
  assert.equal(await pending,42n);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  await actor.close();
});

test('guest Array iterator cannot conceal unsupported Worker placement',()=>{
  const original=Array.prototype[Symbol.iterator];
  let intercepted=0,error;
  try{
    Array.prototype[Symbol.iterator]=function*(){intercepted++;};
    try{rejectUnsupportedWorkerPlacement({placement:'cpu'});}
    catch(e){error=e;}
  }finally{Array.prototype[Symbol.iterator]=original;}
  assert.match(String(error),/cannot guarantee CPU\/GPU placement/);
  assert.equal(intercepted,0);
});

test('guest Function.prototype.call cannot conceal unsupported Worker placement',()=>{
  const original=Function.prototype.call,apply=Reflect.apply;
  const hasOwn=Object.prototype.hasOwnProperty;
  let intercepted=0,error;
  try{
    Function.prototype.call=function(receiver,...args){
      if(this===hasOwn){intercepted++;return false;}
      return apply(original,this,[receiver,...args]);
    };
    try{rejectUnsupportedWorkerPlacement({gpuDeviceId:1});}
    catch(e){error=e;}
  }finally{Function.prototype.call=original;}
  assert.match(String(error),/cannot guarantee CPU\/GPU placement/);
  assert.equal(intercepted,0);
});
