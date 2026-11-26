import test from 'node:test';
import assert from 'node:assert/strict';
import {CountedSelectI64Batch as Batch} from '../src/counted-select-i64-batch.mjs';
import {SelectableI64Channel as Channel} from '../src/selectable-i64-channel.mjs';
import {SelectableI64Future as Future} from '../src/selectable-i64-future.mjs';
test('aggregate publishes immutable exact cardinality only after retirement',async()=>{
  const a=new Channel(4);for(const v of [10n,20n,30n,40n])a.tryWrite(v);
  const b=new Batch(3,[a]);let settled=false;b.completion.then(()=>{settled=true;});
  for(let i=0;i<3;i++){
    assert.equal(b.pump(),true);await Promise.resolve();assert.equal(settled,false);
    assert.equal(b.pump(),true);await Promise.resolve();assert.equal(settled,i===2);
  }
  const result=await b.completion;assert.deepEqual(result,[10n,20n,30n]);
  assert.throws(()=>{result[0]=99n;},TypeError);
  assert.equal(a.tryRead().value,40n);assert.equal(a.pendingReaders,0);
  assert.equal(b.cancel(),false);assert.equal(b.pump(),false);
});
test('cancel detaches pending registrations without cancelling producer',async()=>{
  const f=new Future(),b=new Batch(2,[f]);
  const rejected=assert.rejects(b.completion,{name:'AbortError'});
  assert.equal(b.pump(),true);assert.equal(b.pump(),false);assert.equal(f.pendingWaiters,1);
  assert.equal(b.cancel(),true);assert.equal(f.pendingWaiters,0);await rejected;
  assert.equal(f.status,'pending');f.resolve(42n);
});
test('exhaustion and zero are distinct terminal outcomes',async()=>{
  const f=new Future();f.resolve(1n);const b=new Batch(2,[f,f]);
  const rejected=assert.rejects(b.completion,/SelectExhausted/);
  assert.equal(b.pump(),true);assert.equal(b.pump(),true);await rejected;
  assert.equal(f.pendingWaiters,0);
  assert.deepEqual(await new Batch(0,null).completion,[]);
});
test('notification reentry cannot cancel a committed batch',async()=>{
  const a=new Channel(1);a.tryWrite(42n);const b=new Batch(1,[a]);
  const sub=a.subscribeWritable(()=>assert.throws(()=>b.cancel(),/reentry/));
  assert.equal(b.pump(),true);assert.equal(b.pump(),true);
  assert.deepEqual(await b.completion,[42n]);assert.equal(a.notificationFailure,null);sub.close();
});
