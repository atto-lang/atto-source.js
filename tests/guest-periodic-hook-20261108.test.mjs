import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GuestCooperationBudget,GuestCooperationFailed,GuestFuelExhausted
} from '../src/guest-cooperation-budget.mjs';

test('128-unit slow hook remains amortized across 4096 committed guest backedges',()=>{
  const meter=new GuestCooperationBudget(4096);
  let polls=0;
  const receipts=[];
  for(let step=1;step<=4096;step++){
    const due=meter.charge_and_poll(1,receipt=>{
      assert.ok(Object.isFrozen(receipt));
      polls++;
      receipts.push(receipt);
    });
    assert.equal(due,step%128===0);
  }
  assert.equal(polls,32);
  assert.equal(meter.slow_polls_due,32);
  assert.equal(meter.remaining_fuel,0);
  assert.equal(receipts[31].remaining_fuel,0);
  assert.equal(receipts[31].poll_index,32);
  assert.equal(receipts[31].work_units_this_dispatch,4096);
  assert.throws(()=>meter.charge_and_poll(1,()=>{}),GuestFuelExhausted);
});

test('repeated short carrier dispatches cannot reset the slow phase or refill fuel',()=>{
  const meter=new GuestCooperationBudget(512);
  const boundaries=[];
  for(let turn=0;turn<64;turn++){
    meter.begin_dispatch();
    for(let i=0;i<8;i++){
      const due=meter.charge_and_poll(1,receipt=>{boundaries.push({turn,index:i,poll:receipt.poll_index});});
      assert.equal(due,turn%16===15&&i===7);
    }
    assert.equal(meter.work_units_this_dispatch,8);
  }
  assert.deepEqual(boundaries.map(x=>x.poll),[1,2,3,4]);
  assert.equal(meter.remaining_fuel,0);
});

test('invalid hook is rejected before charging, and callbacks do not run on fast path',()=>{
  const meter=new GuestCooperationBudget(200);
  assert.throws(()=>meter.charge_and_poll(1,null),TypeError);
  assert.equal(meter.remaining_fuel,200);
  let invoked=0;
  for(let i=0;i<127;i++)
    assert.equal(meter.charge_and_poll(1,()=>{invoked++;}),false);
  assert.equal(invoked,0);
  assert.equal(meter.charge_and_poll(1,()=>{invoked++;}),true);
  assert.equal(invoked,1);
});

test('slow-hook exception consumes charged fuel then permanently poisons this logical task',()=>{
  const meter=new GuestCooperationBudget(256);
  for(let i=0;i<127;i++)meter.charge_and_poll(1,()=>{throw Error('must not run');});
  assert.throws(()=>meter.charge_and_poll(1,()=>{throw Error('scheduler failure');}),/scheduler failure/);
  assert.equal(meter.remaining_fuel,128,'already committed work cannot be refilled');
  assert.throws(()=>meter.charge_operation(1),GuestCooperationFailed);
  assert.throws(()=>meter.begin_dispatch(),GuestCooperationFailed);
  assert.equal(meter.remaining_fuel,128);
});

test('async scheduler callbacks are prohibited and cannot be silently awaited',()=>{
  const meter=new GuestCooperationBudget(128);
  for(let i=0;i<127;i++)meter.charge_and_poll(1,()=>{});
  assert.throws(()=>meter.charge_and_poll(1,async()=>{}),GuestCooperationFailed);
  assert.throws(()=>meter.charge_backedge(),GuestCooperationFailed);
});

test('reentrant slow-hook charge poisons even if the callback suppresses its error',()=>{
  const meter=new GuestCooperationBudget(256);
  for(let i=0;i<127;i++)meter.charge_and_poll(1,()=>{});
  assert.throws(()=>meter.charge_and_poll(1,()=>{
    assert.throws(()=>meter.charge_operation(1),GuestCooperationFailed);
  }),GuestCooperationFailed);
  assert.equal(meter.remaining_fuel,128);
  assert.throws(()=>meter.begin_dispatch(),GuestCooperationFailed);
});
