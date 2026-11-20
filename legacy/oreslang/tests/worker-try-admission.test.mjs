import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorkerActorClient} from '../src/worker-actor-client.mjs';
import {copyOwnedValueWithBytes} from '../src/worker-actor-copy.mjs';

const PROTOCOL='ores.js.worker.v1';
class StubWorker extends EventEmitter {
  posted=[];
  terminated=0;
  postMessage(message) {this.posted.push(message);}
  terminate() {this.terminated++;return Promise.resolve(0);}
  frame(kind,extra={}) {this.emit('message',{protocol:PROTOCOL,kind,...extra});}
}
const create=(worker,opts={})=>createWorkerActorClient({
  worker,moduleUrl:'file:///trusted/source.mjs',mode:'handler',
  maxPending:1,maxPendingBytes:4096,...opts
});

test('tryTell reserves one exact owned frame without waiting for Worker readiness',async()=>{
  const worker=new StubWorker(), actor=create(worker);
  const input={value:4, nested:{tag:'original'}};
  const accepted=actor.tryTell(input);
  assert.equal(accepted.accepted,true);
  assert.ok(Object.isFrozen(accepted));
  assert.equal(actor.pending,1);
  input.nested.tag='caller mutation';
  const full=actor.tryTell({value:5});
  assert.deepEqual(full,{accepted:false,reason:'actor mailbox capacity exceeded'});
  assert.equal(actor.pending,1);
  worker.frame('ready');await actor.ready;await Promise.resolve();
  const sent=worker.posted.find(x=>x.kind==='deliver');
  assert.equal(sent.id,1);
  assert.equal(sent.reply,false);
  assert.equal(sent.value.nested.tag,'original');
  worker.frame('result',{id:1,ok:true,value:null});
  assert.equal(await accepted.completion,undefined);
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  const next=actor.tryRequest({value:6});
  assert.equal(next.accepted,true);await Promise.resolve();
  const second=worker.posted.find(x=>x.kind==='deliver'&&x.id===2);
  assert.ok(second);
  assert.equal(second.reply,true);
  worker.frame('result',{id:2,ok:true,value:9});
  assert.equal(await next.completion,9);
  await actor.close();
});

test('byte capacity refusal is non-throwing, debits no credit and does not consume ID',async()=>{
  const payload={note:'x'.repeat(300)};
  const charge=copyOwnedValueWithBytes(payload).bytes;
  const worker=new StubWorker(),actor=create(worker,{maxPending:3,maxPendingBytes:charge+2});
  const accepted=actor.tryTell(payload);
  assert.equal(accepted.accepted,true);
  const reserved=actor.pendingBytes;
  assert.equal(reserved,charge);
  assert.deepEqual(actor.tryTell(payload),
    {accepted:false,reason:'actor mailbox byte capacity exceeded'});
  assert.equal(actor.pendingBytes,reserved);
  assert.equal(actor.pending,1);
  worker.frame('ready');await actor.ready;await Promise.resolve();
  worker.frame('result',{id:1,ok:true,value:null});
  await accepted.completion;
  assert.equal(actor.pendingBytes,0);
  const next=actor.tryTell(payload);
  assert.equal(next.accepted,true);await Promise.resolve();
  assert.ok(worker.posted.some(frame=>frame.kind==='deliver'&&frame.id===2));
  worker.frame('result',{id:2,ok:true,value:null});
  await next.completion;
  await actor.close();
});

test('invalid payload fails typed, never disguised as ordinary backpressure',async()=>{
  const worker=new StubWorker(),actor=create(worker);
  assert.throws(()=>actor.tryTell(()=>{}));
  assert.equal(actor.pending,0);
  assert.equal(actor.pendingBytes,0);
  await assert.rejects(actor.tell(()=>{}));
  const receipt=actor.tryTell({status:'okay'});
  assert.equal(receipt.accepted,true);
  const rejected=assert.rejects(receipt.completion,/actor closed/);
  await actor.close();
  await rejected;
  assert.deepEqual(actor.tryTell({status:'late'}),{accepted:false,reason:'actor closed'});
  assert.equal(actor.pendingBytes,0);
});
