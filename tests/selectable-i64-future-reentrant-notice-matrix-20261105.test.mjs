import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectableI64Future} from '../src/selectable-i64-future.mjs';

test('resolved future notifies all existing waiters without duplicate commits',()=>{
  const future=new SelectableI64Future({maxWaiters:2}),ready=[];
  const first=future.subscribeReady(subscription=>ready.push(subscription));
  const second=future.subscribeReady(subscription=>ready.push(subscription));
  assert.equal(future.resolve(42n),true);
  assert.equal(future.status,'value');
  assert.equal(ready.length,2);
  const result=future.createResultCell();
  assert.equal(future.tryCommit(ready[0],result),true);
  assert.equal(result.value,42n);
  assert.equal(result.status,'value');
  assert.equal(future.tryCommit(first,result),false);
  assert.equal(result.status,'pending','failed commit resets borrowed result cell');
  assert.equal(future.tryCommit(second,result),true);
  assert.equal(result.value,42n);
  assert.equal(future.pendingWaiters,0);
});

test('late readiness callbacks execute immediately but consume only once',()=>{
  const future=new SelectableI64Future({maxWaiters:1});
  assert.equal(future.resolve(-7n),true);
  let notified=0;
  const subscription=future.subscribeReady(()=>notified++);
  const result=future.createResultCell();
  assert.equal(notified,1);
  assert.equal(future.tryCommit(subscription,result),true);
  assert.equal(result.value,-7n);
  assert.equal(future.tryCommit(subscription,result),false);
  assert.equal(future.pendingWaiters,0);
});

test('throwing one notification does not prevent other waiter delivery',()=>{
  const future=new SelectableI64Future({maxWaiters:2}),boom=new Error('boom');
  const first=future.subscribeReady(()=>{throw boom;});
  let delivered=0;
  future.subscribeReady(()=>{delivered++;});
  assert.equal(future.resolve(8n),true);
  assert.equal(future.notificationFailure,boom);
  assert.equal(delivered,1);
  assert.equal(future.tryCommit(first,future.createResultCell()),true);
  assert.equal(future.resolve(9n),false,'completion is single-assignment');
});

test('out-of-range integers and non-BigInt values cannot settle the future',()=>{
  const future=new SelectableI64Future();
  for(const input of [0,1.5,1n<<63n,-(1n<<63n)-1n])
    assert.throws(()=>future.resolve(input),/signed i64 BigInt/);
  assert.equal(future.status,'pending');
  assert.equal(future.resolve(-(1n<<63n)),true);
  assert.equal(future.resolve((1n<<63n)-1n),false);
});
