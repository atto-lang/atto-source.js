import test from 'node:test';
import assert from 'node:assert/strict';
import {BatchedCheckpoint} from '../src/batched-checkpoint.mjs';

for (const interval of [64, 128, 256, 512]) {
  test(`no slow poll before ${interval}th verified work unit`, () => {
    const polls = [];
    const checkpoint = new BatchedCheckpoint({interval, hardFuel: interval * 3, poll: x => polls.push(x)});
    for (let i = 1; i < interval; i++) {
      assert.equal(checkpoint.completeWorkUnit(), false);
      assert.equal(polls.length, 0);
      assert.equal(checkpoint.remainingFuel, interval * 3 - i);
    }
    assert.equal(checkpoint.completeWorkUnit(), true);
    assert.deepEqual(polls, [{charged: interval, remainingFuel: interval * 2}]);
  });
}

test('short final batch enforces exact quota without resetting at a handoff', () => {
  const batches = [];
  const q = new BatchedCheckpoint({hardFuel: 129, poll: x => batches.push(x)});
  for (let i = 0; i < 128; i++) q.completeWorkUnit();
  assert.equal(q.remainingFuel, 1);
  assert.equal(q.completeWorkUnit(), true);
  assert.equal(q.remainingFuel, 0);
  assert.deepEqual(batches.map(x => x.charged), [128, 1]);
  assert.throws(() => q.completeWorkUnit(), /fuel exhausted/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
});

test('zero fuel prevents even one work unit and cannot be replenished', () => {
  const q = new BatchedCheckpoint({hardFuel: 0, poll() { assert.fail('unexpected poll'); }});
  assert.throws(() => q.completeWorkUnit(), /fuel exhausted/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
});

test('failure and reentry in trusted poll are fail-closed', () => {
  let q;
  q = new BatchedCheckpoint({interval: 64, hardFuel: 1000, poll() { q.completeWorkUnit(); }});
  for (let i = 0; i < 63; i++) q.completeWorkUnit();
  assert.throws(() => q.completeWorkUnit(), /reentrant/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
});

test('reject async poll, invalid interval and invalid hard budget', () => {
  assert.throws(() => new BatchedCheckpoint({interval: 100, hardFuel: 5, poll() {}}), /interval/);
  assert.throws(() => new BatchedCheckpoint({hardFuel: -1, poll() {}}), /hardFuel/);
  assert.throws(() => new BatchedCheckpoint({hardFuel: Infinity, poll() {}}), /hardFuel/);
  assert.throws(() => new BatchedCheckpoint({hardFuel: 5}), /synchronous poll/);
  const q = new BatchedCheckpoint({hardFuel: 1, poll: async () => {}});
  assert.throws(() => q.completeWorkUnit(), /must not suspend/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
});
