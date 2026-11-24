import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkerActorClient } from '../src/worker-actor-client.mjs';

const PROTOCOL='ores.js.worker.v1';
class StubWorker extends EventEmitter {
  sent=[];termCount=0;
  postMessage(value){this.sent.push(value);}
  terminate(){this.termCount++;return Promise.resolve(0);}
  deliver(frame){this.emit('message',frame);}
  ready(){this.deliver({protocol:PROTOCOL,kind:'ready'});}
  result(id,ok,value){this.deliver({protocol:PROTOCOL,kind:'result',id,ok,value});}
}
const makeClient=worker=>createWorkerActorClient({
  worker,moduleUrl:'file:///trusted/test.mjs',maxPending:4,maxPendingBytes:2048
});
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

test('flapping kind getter must not turn a pre-ready result into a ready frame',async()=>{
  const worker=new StubWorker(),actor=makeClient(worker);
  const readyRejection=assert.rejects(actor.ready,/actor result before ready/);
  const pendingRejection=assert.rejects(actor.request({n:1}),/actor result before ready/);
  let reads=0;
  const frame={protocol:PROTOCOL,id:1,ok:true,value:99};
  Object.defineProperty(frame,'kind',{get(){reads++;return reads===1?'result':'ready';}});
  assert.doesNotThrow(()=>worker.deliver(frame));
  await Promise.all([readyRejection,pendingRejection]);
  assert.equal(reads,1,'validated kind must not be reread to dispatch a different branch');
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  assert.equal(worker.termCount,1);
  await actor.close();
});

test('changing ok getter cannot transform a negative receipt into protocol shutdown',async()=>{
  const worker=new StubWorker(),actor=makeClient(worker);
  worker.ready();await actor.ready;
  const rejected=assert.rejects(actor.request({n:1}),/actor delivery failed: denied/);
  const second=actor.request({n:2});
  await tick();
  let reads=0;
  const frame={protocol:PROTOCOL,kind:'result',id:1,error:'denied'};
  Object.defineProperty(frame,'ok',{get(){reads++;return reads===1?false:true;}});
  worker.deliver(frame);
  await rejected;
  assert.equal(reads,1);
  assert.equal(worker.termCount,0,'a normal negative result must not kill the Worker');
  assert.equal(actor.pending,1,'other outstanding receipt must survive');
  assert.ok(actor.pendingBytes>0);
  worker.result(2,true,42);
  assert.equal(await second,42);
  assert.equal(actor.pending,0);assert.equal(actor.pendingBytes,0);
  await actor.close();
  assert.equal(worker.termCount,1);
});

test('single successful status read snapshots reply and refunds credit once',async()=>{
  const worker=new StubWorker(),actor=makeClient(worker);
  worker.ready();await actor.ready;
  const reply=actor.request({n:1});
  await tick();
  let reads=0;
  const value={bytes:new Uint8Array([1,2,3])};
  const frame={protocol:PROTOCOL,kind:'result',id:1,value};
  Object.defineProperty(frame,'ok',{get(){reads++;return reads===1?true:false;}});
  worker.deliver(frame);
  value.bytes[0]=99;
  const result=await reply;
  assert.equal(reads,1);
  assert.deepEqual([...result.bytes],[1,2,3]);
  assert.equal(actor.pending,0);assert.equal(actor.pendingBytes,0);
  await actor.close();
});

test('undefined status getter terminates and releases every pending receipt',async()=>{
  const worker=new StubWorker(),actor=makeClient(worker);
  worker.ready();await actor.ready;
  const first=assert.rejects(actor.request({n:1}),/invalid actor response/);
  const second=assert.rejects(actor.tell({n:2}),/invalid actor response/);
  let reads=0;
  const frame={protocol:PROTOCOL,kind:'result',id:1};
  Object.defineProperty(frame,'ok',{get(){reads++;return reads===1?undefined:true;}});
  worker.deliver(frame);
  await Promise.all([first,second]);
  assert.equal(reads,1);
  assert.equal(actor.pending,0);assert.equal(actor.pendingBytes,0);
  assert.equal(worker.termCount,1);
  await actor.close();
});

test('thrown status accessor still fails closed and cannot strand reservations',async()=>{
  const worker=new StubWorker(),actor=makeClient(worker);
  worker.ready();await actor.ready;
  const first=assert.rejects(actor.request({n:1}),/invalid actor frame/);
  const second=assert.rejects(actor.request({n:2}),/invalid actor frame/);
  const frame={protocol:PROTOCOL,kind:'result',id:1};
  Object.defineProperty(frame,'ok',{get(){throw new Error('hostile accessor');}});
  assert.doesNotThrow(()=>worker.deliver(frame));
  await Promise.all([first,second]);
  assert.equal(actor.pending,0);assert.equal(actor.pendingBytes,0);
  assert.equal(worker.termCount,1);
  await actor.close();
});

// Stub transport tests do not prove backend guest actor execution or isolation.
