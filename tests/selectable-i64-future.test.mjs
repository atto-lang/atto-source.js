import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectArbiter} from '../src/select-runtime.mjs';
import {SelectableI64Future,ActorGenerationFence} from '../src/selectable-i64-future.mjs';

test('future waits for resolution and selects ready value once',()=>{
  const future=new SelectableI64Future();
  const select=new SelectArbiter(1);
  const reg=select.registerCase(0);
  const receipt=future.createReceipt();
  const sub=future.subscribeReady(token=>{
    assert.equal(reg.tryWin(()=>future.tryCommitReady(token,receipt)),true);
  });
  reg.arm(()=>sub.close());
  assert.equal(future.pendingWaiters,1);
  assert.equal(select.winner,null);
  assert.equal(future.resolve(42n),true);
  assert.equal(future.resolve(43n),false);
  assert.equal(select.winner,0);
  assert.equal(receipt.status,'resolved');
  assert.equal(receipt.value,42n);
  assert.equal(future.pendingWaiters,0);
});

test('future reject and cancel are separate terminal outcomes',()=>{
  for (const status of ['rejected','cancelled']) {
    const future=new SelectableI64Future();
    const select=new SelectArbiter(1);
    const reg=select.registerCase(0);
    const receipt=future.createReceipt();
    const sub=future.subscribeReady(token=>{
      assert.equal(reg.tryWin(()=>future.tryCommitReady(token,receipt)),true);
    });
    reg.arm(()=>sub.close());
    if(status==='rejected')future.reject(new Error('failure'));
    else future.cancel();
    assert.equal(select.winner,0);
    assert.equal(receipt.status,status);
    if(status==='rejected')
      assert.match(receipt.error.message,/failure/);
    else assert.equal(receipt.error,null);
  }
});

test('future loser cancellation does not consume later resolution',()=>{
  const future=new SelectableI64Future();
  const select=new SelectArbiter(1);
  const reg=select.registerCase(0);
  const receipt=future.createReceipt();
  let callbacks=0;
  const sub=future.subscribeReady(token=>{
    callbacks++;
    reg.tryWin(()=>future.tryCommitReady(token,receipt));
  });
  reg.arm(()=>sub.close());
  assert.equal(select.cancel(),true);
  assert.equal(future.pendingWaiters,0);
  future.resolve(12n);
  assert.equal(callbacks,0);
  assert.equal(select.winner,null);
  assert.equal(receipt.status,'pending');
});

test('stale future subscription cannot become new winner',()=>{
  const future=new SelectableI64Future();
  const stale=future.subscribeReady(()=>{});
  assert.equal(stale.close(),true);
  const receipt=future.createReceipt();
  future.resolve(5n);
  assert.equal(future.tryCommitReady(stale,receipt),false);
  const fresh=future.subscribeReady(token=>{
    assert.equal(future.tryCommitReady(token,receipt),true);
  });
  assert.equal(fresh.active,false);
  assert.equal(receipt.value,5n);
});

test('future completion callback failure cannot undo settled value',()=>{
  const future=new SelectableI64Future();
  future.subscribeReady(()=>{throw new Error('observer failed');});
  assert.equal(future.resolve(9n),true);
  assert.equal(future.status,'resolved');
  assert.match(future.notificationFailure?.message??'',/observer failed/);
});

test('retired generation suppresses late future callback and select win',()=>{
  const fence=new ActorGenerationFence();
  const token=fence.capture();
  const future=new SelectableI64Future();
  const select=new SelectArbiter(1);
  const reg=select.registerCase(0);
  const receipt=future.createReceipt();
  const sub=future.subscribeReady(subscription=>{
    if(!token.valid)return;
    reg.tryWin(()=>token.valid &&
      future.tryCommitReady(subscription,receipt));
  });
  reg.arm(()=>sub.close());
  assert.equal(fence.retire(),true);
  assert.equal(token.valid,false);
  assert.equal(future.resolve(77n),true);
  assert.equal(select.winner,null);
  assert.equal(receipt.status,'pending');
  assert.equal(fence.physicallyRetired,true);
  select.cancel();
  assert.equal(future.pendingWaiters,0);
});

test('physical retirement remains blocked during a live continuation',()=>{
  const fence=new ActorGenerationFence();
  const token=fence.capture();
  assert.equal(token.runIfCurrent(()=>{
    assert.equal(fence.retire(),true);
    assert.equal(fence.physicallyRetired,false);
  }),true);
  assert.equal(fence.physicallyRetired,true);
  let called=false;
  assert.equal(token.runIfCurrent(()=>{called=true;}),false);
  assert.equal(called,false);
  assert.equal(fence.retire(),false);
});

test('future rejects invalid bounds and forged result receipts',()=>{
  const future=new SelectableI64Future();
  assert.throws(()=>future.resolve(1),/BigInt/);
  assert.throws(()=>future.resolve(1n<<63n),/BigInt/);
  assert.throws(()=>future.tryCommitReady(null,{}),/createReceipt/);
  assert.throws(()=>new SelectableI64Future({maxWaiters:0}),/maxWaiters/);
});
