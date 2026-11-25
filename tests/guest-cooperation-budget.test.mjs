import test from 'node:test';
import assert from 'node:assert/strict';
import {GuestCooperationBudget,GuestFuelExhausted,COOPERATION_POLL_INTERVAL,MAX_METERED_BLOCK_WEIGHT} from '../src/guest-cooperation-budget.mjs';

test('runtime slow poll is precisely periodic even after dispatch cap', () => {
  const meter = new GuestCooperationBudget(10_000);
  assert.equal(COOPERATION_POLL_INTERVAL, 128);
  let polls = 0;
  for (let step = 1; step <= 2048; step++) {
    const due = meter.charge_backedge();
    assert.equal(due, step % 128 === 0, 'must never devolve to per-backedge polling');
    if (due) polls++;
  }
  assert.equal(polls, 16);
  assert.equal(meter.slow_polls_due, 16);
  assert.equal(meter.remaining_fuel, 7952);
});

test('resume resets fairness only and cannot replenish hard fuel', () => {
  const meter = new GuestCooperationBudget(256);
  for (let turn = 0; turn < 8; turn++) {
    meter.begin_dispatch();
    for (let i = 0; i < 32; i++) {
      const due = meter.charge_backedge();
      assert.equal(due, turn % 4 === 3 && i === 31);
    }
    assert.equal(meter.backedges_this_dispatch, 32);
  }
  assert.equal(meter.remaining_fuel, 0);
  meter.begin_dispatch();
  assert.throws(() => meter.charge_backedge(), GuestFuelExhausted);
});

test('operation charging prevents recursion and helper work from being free', () => {
  const meter = new GuestCooperationBudget(6);
  meter.charge_operation(4);
  assert.equal(meter.remaining_fuel, 2);
  assert.equal(meter.charge_backedge(2), false);
  assert.throws(() => meter.charge_operation(1), GuestFuelExhausted);
});

test('invalid and fractional credits cannot bypass tenant accounting', () => {
  for (const fuel of [0, -1, NaN, Infinity, 1.5, 100_000_001]) {
    assert.throws(() => new GuestCooperationBudget(fuel), RangeError);
  }
  const meter = new GuestCooperationBudget(1);
  for (const weight of [0, -1, NaN, Infinity, 0.5, 129, 513, 100_000_001]) {
    assert.throws(() => meter.charge_backedge(weight), RangeError);
  }
  assert.equal(meter.remaining_fuel, 1);
});


test('repeated short dispatches cannot reset lifetime poll phase', () => {
  const meter = new GuestCooperationBudget(10_000);
  let charged = 0, polls = 0;
  for (let dispatch = 0; dispatch < 8; dispatch++) {
    meter.begin_dispatch();
    for (let i = 0; i < 127; i++) {
      charged++;
      const due = meter.charge_backedge();
      assert.equal(due, charged % 128 === 0);
      if (due) polls++;
    }
    assert.equal(meter.backedges_this_dispatch, 127);
  }
  assert.equal(polls, 7);
  assert.equal(meter.remaining_fuel, 10_000 - 8 * 127);
});

test('failure leaves exact fuel intact and never advances poll phase', () => {
  const meter = new GuestCooperationBudget(129);
  for (let i = 0; i < 127; i++) assert.equal(meter.charge_backedge(), false);
  assert.throws(() => meter.charge_backedge(3), GuestFuelExhausted);
  assert.equal(meter.remaining_fuel, 2);
  assert.equal(meter.slow_polls_due, 0);
  assert.equal(meter.charge_backedge(2), true);
  assert.equal(meter.remaining_fuel, 0);
  assert.equal(meter.slow_polls_due, 1);
  assert.throws(() => meter.charge_backedge(), GuestFuelExhausted);
  assert.equal(meter.slow_polls_due, 1);
});

test('recursive helper calls trigger checkpoint eligibility without loop backedges', () => {
  const meter = new GuestCooperationBudget(600);
  let due = 0;
  for (let depth = 1; depth <= 256; depth++)
    if (meter.charge_operation(1)) due++;
  assert.equal(due, 2);
  assert.equal(meter.slow_polls_due, 2);
  assert.equal(meter.backedges_this_dispatch, 0);
  assert.equal(meter.remaining_fuel, 344);
});

test('weighted basic-block metering crosses phase once, without refill', () => {
  const meter = new GuestCooperationBudget(650);
  assert.equal(MAX_METERED_BLOCK_WEIGHT, 128);
  assert.equal(meter.charge_operation(127), false);
  assert.equal(meter.charge_operation(2), true);
  for (let i = 0; i < 4; i++)
    assert.equal(meter.charge_operation(128), true);
  assert.equal(meter.remaining_fuel, 9);
  assert.equal(meter.slow_polls_due, 5);
  assert.throws(() => meter.charge_operation(129), RangeError);
  assert.throws(() => meter.charge_operation(10), GuestFuelExhausted);
  assert.equal(meter.remaining_fuel, 9);
  assert.equal(meter.slow_polls_due, 5);
});

test('recursive and weighted charges count toward per-dispatch fairness, failed charges do not', () => {
  const meter = new GuestCooperationBudget(300);
  assert.equal(meter.work_units_this_dispatch, 0);
  for (let i = 0; i < 64; i++) assert.equal(meter.charge_operation(1), false);
  assert.equal(meter.backedges_this_dispatch, 0);
  assert.equal(meter.work_units_this_dispatch, 64);
  assert.equal(meter.charge_operation(64), true);
  assert.equal(meter.slow_polls_due, 1);
  assert.equal(meter.work_units_this_dispatch, 128);
  assert.equal(meter.charge_backedge(128), true);
  assert.equal(meter.backedges_this_dispatch, 1);
  assert.equal(meter.work_units_this_dispatch, 256);
  assert.throws(() => meter.charge_operation(45), GuestFuelExhausted);
  assert.throws(() => meter.charge_backedge(0), RangeError);
  assert.equal(meter.work_units_this_dispatch, 256);
  assert.equal(meter.backedges_this_dispatch, 1);
  assert.equal(meter.slow_polls_due, 2);
  meter.begin_dispatch();
  assert.equal(meter.work_units_this_dispatch, 0);
  assert.equal(meter.backedges_this_dispatch, 0);
  assert.equal(meter.remaining_fuel, 44);
  assert.equal(meter.slow_polls_due, 2);
  assert.equal(meter.charge_operation(44), false);
  assert.throws(() => meter.charge_operation(1), GuestFuelExhausted);
});
