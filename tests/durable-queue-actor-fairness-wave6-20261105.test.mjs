import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableLockQueues} from '../src/durable-lock-queues.mjs';

const job=(actorId,lockId,operationId,bytes=2)=>({
  actorId,actorGeneration:1,lockId,operationId,bytes
});

test('a logical actor cannot claim two lock heads concurrently; lanes remain FIFO',()=>{
  const q=new DurableLockQueues(7,{maxLocks:2,maxEntries:4,maxPerLock:3,maxBytes:20});
  const first=q.enqueue(job(1,1,11));
  const waiter=q.enqueue(job(2,1,12));
  const other=q.enqueue(job(1,2,13));
  assert.equal(first.head,true);
  assert.equal(waiter.head,false);
  assert.equal(other.head,true);
  assert.equal(q.claim(first.ticket),true);
  assert.equal(q.claim(other.ticket),false);
  assert.deepEqual(q.readyHeads(),[]);
  assert.strictEqual(q.finish(first.ticket),waiter.ticket);
  assert.equal(q.claim(other.ticket),true);
  assert.equal(q.claim(waiter.ticket),true);
  assert.equal(q.finish(other.ticket),null);
  assert.equal(q.finish(waiter.ticket),null);
  assert.equal(q.snapshot().entries,0);
  assert.equal(q.snapshot().bytes,0);
});

test('capacity rejection leaves accounting intact and a cancelled ticket cannot replay',()=>{
  const q=new DurableLockQueues(11,{maxLocks:1,maxEntries:2,maxPerLock:2,maxBytes:5});
  const first=q.enqueue(job(1,1,21,3));
  const waiting=q.enqueue(job(2,1,22,2));
  assert.throws(()=>q.enqueue(job(3,1,23,1)),/queue capacity exceeded/);
  assert.deepEqual([q.snapshot().entries,q.snapshot().bytes],[2,5]);
  q.cancelWaiter(waiting.ticket);
  assert.throws(()=>q.claim(waiting.ticket),/stale or foreign durable queue ticket/);
  assert.throws(()=>q.claim({...first.ticket}),/stale or foreign durable queue ticket/);
  const replacement=q.enqueue(job(3,1,23,2));
  assert.strictEqual(q.cancelHead(first.ticket),replacement.ticket);
  assert.equal(q.cancelHead(replacement.ticket),null);
  assert.equal(q.snapshot().entries,0);
});

test('quiesce forbids new admissions and claims but permits finishing current work',()=>{
  const q=new DurableLockQueues(3);
  const current=q.enqueue(job(1,1,31));
  assert.equal(q.claim(current.ticket),true);
  q.quiesce();
  assert.equal(q.drained,false);
  assert.throws(()=>q.enqueue(job(2,1,32)),/quiescing/);
  assert.throws(()=>q.claim(current.ticket),/new claims forbidden/);
  assert.equal(q.finish(current.ticket),null);
  assert.equal(q.drained,true);
  assert.ok(Object.isFrozen(q.snapshot()));
});
