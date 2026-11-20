import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableLockQueues} from '../src/durable-lock-queues.mjs';
const job=(actorId,lockId,operationId,bytes=2)=>({actorId,actorGeneration:1,lockId,operationId,bytes});
test('the same actor cannot simultaneously hold two logical lock lanes',()=>{
  const q=new DurableLockQueues(3,{maxLocks:2,maxEntries:4,maxBytes:10,maxPerLock:3});
  const one=q.enqueue(job(1,11,101)),two=q.enqueue(job(1,12,102));
  assert.equal(q.claim(one.ticket),true);
  assert.equal(q.claim(two.ticket),false);
  assert.deepEqual(q.readyHeads(),[]);
  assert.equal(q.finish(one.ticket),null);
  assert.equal(q.claim(two.ticket),true);
  assert.equal(q.finish(two.ticket),null);
  assert.equal(q.snapshot().runningActors,0);
});
test('global duplicate operation IDs fail without adding a second lock or byte charge',()=>{
  const q=new DurableLockQueues(9,{maxLocks:2,maxEntries:2,maxBytes:4});
  const a=q.enqueue(job(1,11,201,3));
  assert.throws(()=>q.enqueue(job(2,12,201,1)),/duplicate outstanding operation/);
  assert.equal(q.snapshot().locks,1);
  assert.equal(q.snapshot().bytes,3);
  assert.throws(()=>q.enqueue(job(2,12,202,2)),/queue capacity exceeded/);
  assert.equal(q.cancelHead(a.ticket),null);
  assert.equal(q.snapshot().entries,0);
});
test('cancelling one waiting ticket preserves FIFO head and revokes old identity',()=>{
  const q=new DurableLockQueues(5);
  const a=q.enqueue(job(1,10,301));
  const b=q.enqueue(job(2,10,302));
  const c=q.enqueue(job(3,10,303));
  q.cancelWaiter(b.ticket);
  assert.throws(()=>q.claim(b.ticket),/stale or foreign durable queue ticket/);
  assert.equal(q.claim(a.ticket),true);
  assert.strictEqual(q.finish(a.ticket),c.ticket);
  assert.equal(q.claim(c.ticket),true);
  assert.equal(q.finish(c.ticket),null);
  assert.equal(q.hasActor(2,1),false);
});
