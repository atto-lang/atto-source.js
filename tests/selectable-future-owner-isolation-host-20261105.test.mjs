import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectableI64Future} from '../src/selectable-i64-future.mjs';

test('foreign future cannot consume another owner subscription',()=>{
  const a=new SelectableI64Future({maxWaiters:1});
  const b=new SelectableI64Future({maxWaiters:1});
  const ticket=a.subscribeReady(()=>{});
  const cell=b.createResultCell();
  assert.equal(a.resolve(7n),true);
  assert.equal(b.tryCommit(ticket,cell),false);
  assert.equal(cell.status,'pending');
  assert.equal(a.tryCommit(ticket,cell),true);
  assert.equal(cell.value,7n);
});
test('reused waiter slot does not revive closed generation',()=>{
  const future=new SelectableI64Future({maxWaiters:1});
  const stale=future.subscribeReady(()=>{});
  assert.equal(stale.close(),true);
  const live=future.subscribeReady(()=>{});
  assert.equal(stale.active,false);
  future.resolve(19n);
  const cell=future.createResultCell();
  assert.equal(future.tryCommit(stale,cell),false);
  assert.equal(future.tryCommit(live,cell),true);
  assert.equal(cell.value,19n);
  assert.equal(future.pendingWaiters,0);
});
test('failed observer cannot prevent another notification or settlement',()=>{
  const future=new SelectableI64Future({maxWaiters:2});
  future.subscribeReady(()=>{throw new Error('bad observer')});
  let notified=0;
  const other=future.subscribeReady(()=>{notified++});
  assert.equal(future.resolve(29n),true);
  assert.equal(notified,1);
  assert.match(future.notificationFailure.message,/bad observer/);
  const cell=future.createResultCell();
  assert.equal(future.tryCommit(other,cell),true);
  assert.equal(cell.value,29n);
  assert.equal(future.resolve(30n),false);
});
