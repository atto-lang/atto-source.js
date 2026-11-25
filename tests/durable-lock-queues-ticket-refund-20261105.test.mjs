import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableLockQueues} from '../src/durable-lock-queues.mjs';

const enqueue=(queue,lockId,operationId,actorId,bytes,actorGeneration=1)=>
 queue.enqueue({actorId,actorGeneration,lockId,operationId,bytes});

test('waiter cancellation refunds both byte quota and operation ID before next claim',()=>{
 const q=new DurableLockQueues(10,{maxLocks:1,maxEntries:2,maxPerLock:2,maxBytes:5});
 const first=enqueue(q,1,41,1,3);
 const canceled=enqueue(q,1,42,2,2);
 assert.equal(q.snapshot().bytes,5);
 assert.throws(()=>enqueue(q,1,43,3,1),/capacity exceeded/);
 q.cancelWaiter(canceled.ticket);
 assert.equal(q.snapshot().bytes,3);
 assert.throws(()=>q.claim(canceled.ticket),/stale or foreign/);
 const replacement=enqueue(q,1,42,2,2);
 assert.equal(replacement.head,false);
 assert.strictEqual(q.cancelHead(first.ticket),replacement.ticket);
 assert.equal(q.claim(replacement.ticket),true);
 assert.strictEqual(q.finish(replacement.ticket),null);
 assert.deepEqual({entries:q.snapshot().entries,bytes:q.snapshot().bytes}, {entries:0,bytes:0});
});

test('quiescing forbids new claims but permits an already claimed head to drain',()=>{
 const q=new DurableLockQueues(11);
 const active=enqueue(q,8,1,5,4);
 assert.equal(q.claim(active.ticket),true);
 q.quiesce();
 assert.equal(q.drained,false);
 assert.equal(q.snapshot().accepting,false);
 assert.throws(()=>enqueue(q,8,2,5,4),/quiescing/);
 assert.strictEqual(q.finish(active.ticket),null);
 assert.equal(q.drained,true);
});

test('ticket snapshots cannot be substituted, but different actor generations are independent',()=>{
 const q=new DurableLockQueues(12);
 const first=enqueue(q,1,1,7,2,1),second=enqueue(q,2,2,7,2,2);
 assert.throws(()=>q.claim({...first.ticket}),/stale or foreign/);
 assert.equal(q.claim(first.ticket),true);
 assert.equal(q.claim(second.ticket),true);
 assert.equal(q.snapshot().runningActors,2);
 q.finish(first.ticket);q.finish(second.ticket);
 assert.equal(q.snapshot().runningActors,0);
});
