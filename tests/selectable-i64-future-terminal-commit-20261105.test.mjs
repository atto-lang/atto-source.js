import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectableI64Future} from '../src/selectable-i64-future.mjs';

test('invalid signed i64 does not commit and minimum commits only once',()=>{
  const f=new SelectableI64Future({maxWaiters:2});
  assert.throws(()=>f.resolve(7),/signed i64/);
  assert.throws(()=>f.resolve(1n<<63n),/signed i64/);
  assert.equal(f.status,'pending');
  let notices=0;
  const sub=f.subscribeReady(()=>notices++);
  assert.equal(f.resolve(-(1n<<63n)),true);
  assert.equal(notices,1);
  const cell=f.createResultCell();
  assert.equal(f.tryCommit(sub,cell),true);
  assert.equal(cell.status,'value');
  assert.equal(cell.value,-(1n<<63n));
  assert.equal(f.tryCommit(sub,cell),false);
  assert.equal(cell.status,'pending');
  assert.equal(f.cancel(),false);
});
test('throwing subscriber cannot starve another subscriber',()=>{
  const f=new SelectableI64Future({maxWaiters:2});
  const bad=f.subscribeReady(()=>{throw Error('notice failure')});
  let called=0;
  const good=f.subscribeReady(()=>called++);
  assert.equal(f.resolve(42n),true);
  assert.equal(called,1);
  assert.equal(f.notificationFailure.message,'notice failure');
  assert.equal(f.pendingWaiters,2);
  assert.equal(bad.close(),true);
  assert.equal(good.close(),true);
  assert.equal(f.pendingWaiters,0);
});
test('late terminal subscriber consumes cancellation once',()=>{
  const f=new SelectableI64Future({maxWaiters:1});
  assert.equal(f.cancel(),true);
  let seen=0;
  const sub=f.subscribeReady(token=>{assert.equal(token.active,true);seen++;});
  assert.equal(seen,1);
  const cell=f.createResultCell();
  assert.equal(f.tryCommit(sub,cell),true);
  assert.equal(cell.status,'cancelled');
  assert.equal(f.tryCommit(sub,cell),false);
  assert.equal(sub.close(),false);
});
