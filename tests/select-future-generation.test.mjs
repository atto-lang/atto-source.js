import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorGenerationFence} from '../src/actor-generation-fence.mjs';
import {SelectArbiter} from '../src/select-runtime.mjs';
import {SelectableFutureI64} from '../src/selectable-future-i64.mjs';
import {SelectableI64Channel} from '../src/selectable-i64-channel.mjs';

test('selectable future value and cancellation are terminal readiness',()=>{
  const future=new SelectableFutureI64();
  const select=new SelectArbiter(1);
  const futureCase=select.registerCase(0);
  const outcome={kind:null,value:0n};
  let callbacks=0;

  const wait=future.subscribeReady(subscription=>{
    callbacks++;
    futureCase.tryWin(()=>future.tryCommit(subscription,outcome));
  });
  futureCase.arm(()=>wait.close());

  assert.equal(select.winner,null);
  assert.equal(future.resolve(42n),true);
  assert.equal(future.resolve(43n),false);
  assert.equal(select.winner,0);
  assert.equal(callbacks,1);
  assert.deepEqual(outcome,{kind:'value',value:42n});

  const cancelled=new SelectableFutureI64();
  const cancelledSelect=new SelectArbiter(1);
  const cancelledCase=cancelledSelect.registerCase(0);
  const cancelledOutcome={kind:null,value:0n};
  const cancelledWait=cancelled.subscribeReady(subscription=>{
    cancelledCase.tryWin(
      ()=>cancelled.tryCommit(subscription,cancelledOutcome));
  });
  cancelledCase.arm(()=>cancelledWait.close());

  assert.equal(cancelled.cancel(),true);
  assert.equal(cancelledSelect.winner,0);
  assert.deepEqual(cancelledOutcome,{kind:'cancelled',value:0n});
});

test('stale actor generation cannot consume channel value',()=>{
  const channel=new SelectableI64Channel(1);
  const fence=new ActorGenerationFence();
  const lease=fence.capture();

  const select=new SelectArbiter(1);
  const read=select.registerCase(0);
  let value=0n;
  let callbacks=0;

  const wait=channel.subscribeReadable(subscription=>{
    callbacks++;
    const cell=channel.createReadCell();
    const notifications=channel.createNotificationBatch();
    const won=read.tryWin(
      ()=>lease.tryRun(
        ()=>channel.tryCommitRead(
          subscription,cell,notifications)));
    notifications.dispatch();
    if(won) {
      assert.equal(cell.hasValue,true);
      assert.equal(cell.eof,false);
      value=cell.value;
    }
  });
  read.arm(()=>wait.close());

  assert.equal(fence.advanceGeneration(),2);
  assert.equal(lease.current,false);
  assert.equal(channel.tryWrite(9n),true);
  assert.equal(callbacks,1);
  assert.equal(select.winner,null);
  assert.equal(value,0n);
  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:9n});
  assert.equal(select.cancel(),true);
  assert.equal(channel.pendingReaders,0);
});

test('current actor generation may commit selected read',()=>{
  const channel=new SelectableI64Channel(1);
  const fence=new ActorGenerationFence();
  const lease=fence.capture();

  const select=new SelectArbiter(1);
  const read=select.registerCase(0);
  let value=0n;

  const wait=channel.subscribeReadable(subscription=>{
    const cell=channel.createReadCell();
    const notifications=channel.createNotificationBatch();
    const won=read.tryWin(
      ()=>lease.tryRun(
        ()=>channel.tryCommitRead(
          subscription,cell,notifications)));
    notifications.dispatch();
    if(won) {
      assert.equal(cell.hasValue,true);
      assert.equal(cell.eof,false);
      value=cell.value;
    }
  });
  read.arm(()=>wait.close());

  assert.equal(lease.current,true);
  assert.equal(channel.tryWrite(11n),true);
  assert.equal(select.winner,0);
  assert.equal(value,11n);
});

test('generation fence rejects reentrant generation advance',()=>{
  const fence=new ActorGenerationFence();
  const lease=fence.capture();

  assert.throws(
    ()=>lease.tryRun(()=>{
      fence.advanceGeneration();
      return true;
    }),
    /cannot advance inside a fenced commit/
  );
  assert.equal(fence.generation,1);
  assert.equal(lease.current,true);
});
