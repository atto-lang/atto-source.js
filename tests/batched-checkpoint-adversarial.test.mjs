import test from 'node:test';
import assert from 'node:assert/strict';
import {BatchedCheckpoint} from '../src/batched-checkpoint.mjs';

const intervals = [64, 128, 256, 512];
const lengths = [0, 1, 2, 63, 64, 65, 127, 128, 129, 255, 256, 257,
  511, 512, 513, 1023, 1024, 1025, 4097];

for (const interval of intervals) {
  test(`exact slow-poll model for ${interval}-unit batches and final hard quota`, () => {
    // Deterministic boundary matrix plus fuzz-shaped, reproducible lengths.
    let seed = 0x1eaf4b37;
    const cases = [...lengths];
    for (let i = 0; i < 32; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      cases.push(seed % 2049);
    }
    for (const fuel of cases) {
      const polls = [];
      const quota = new BatchedCheckpoint({interval, hardFuel: fuel,
        poll(receipt) {
          assert(Object.isFrozen(receipt), 'guest must not mutate poll receipt');
          polls.push(receipt);
        }});
      for (let committed = 1; committed <= fuel; committed++) {
        const shouldPoll = committed % interval === 0 || committed === fuel;
        assert.equal(quota.completeWorkUnit(), shouldPoll,
          `interval=${interval}, fuel=${fuel}, committed=${committed}`);
        assert.equal(quota.remainingFuel, fuel - committed);
      }
      const expected = [];
      for (let at = interval; at < fuel; at += interval)
        expected.push({charged: interval, remainingFuel: fuel - at});
      if (fuel) expected.push({charged: fuel % interval || interval, remainingFuel: 0});
      assert.deepEqual(polls, expected, `poll receipt mismatch for fuel=${fuel}`);
      assert.throws(() => quota.completeWorkUnit(), /fuel exhausted/);
      assert.throws(() => quota.completeWorkUnit(), /terminal/);
      assert.equal(polls.length, expected.length, 'exhaustion must not invoke slow poll');
    }
  });
}

test('interleaved logical tasks retain independent quotas across handoffs', () => {
  const aPolls = [], bPolls = [];
  const a = new BatchedCheckpoint({hardFuel: 129, poll: x => aPolls.push(x)});
  const b = new BatchedCheckpoint({hardFuel: 257, poll: x => bPolls.push(x)});
  for (let i = 0; i < 129; i++) {
    a.completeWorkUnit();
    b.completeWorkUnit();
  }
  assert.equal(a.remainingFuel, 0);
  assert.equal(b.remainingFuel, 128);
  assert.throws(() => a.completeWorkUnit(), /fuel exhausted/);
  for (let i = 0; i < 128; i++) b.completeWorkUnit();
  assert.equal(b.remainingFuel, 0);
  assert.deepEqual(aPolls.map(x => x.charged), [128, 1]);
  assert.deepEqual(bPolls.map(x => x.charged), [128, 128, 1]);
  assert.throws(() => b.completeWorkUnit(), /fuel exhausted/);
});

test('cancellation at the batched boundary is terminal without extra work', () => {
  let polls = 0;
  const q = new BatchedCheckpoint({hardFuel: 1000, poll() {
    polls++;
    throw Error('cancelled');
  }});
  for (let i = 1; i < 128; i++) {
    assert.equal(q.completeWorkUnit(), false);
    assert.equal(polls, 0);
  }
  assert.throws(() => q.completeWorkUnit(), /cancelled/);
  assert.equal(polls, 1);
  assert.equal(q.remainingFuel, 872);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
  assert.equal(polls, 1);
});

test('near MAX_SAFE_INTEGER budget does not round off pending charges', () => {
  const fuel = Number.MAX_SAFE_INTEGER;
  const polls = [];
  const q = new BatchedCheckpoint({hardFuel: fuel, interval: 512,
    poll: r => polls.push(r)});
  for (let i = 1; i <= 1025; i++) {
    assert.equal(q.completeWorkUnit(), i % 512 === 0);
    assert.equal(q.remainingFuel, fuel - i);
  }
  assert.deepEqual(polls.map(r => r.charged), [512, 512]);
  assert.equal(q.remainingFuel, fuel - 1025);
});

test('synchronous thenable getter failure closes the logical checkpoint', () => {
  const q = new BatchedCheckpoint({hardFuel: 1,
    poll: () => Object.defineProperty({}, 'then', {get() { throw Error('host getter'); }})});
  assert.throws(() => q.completeWorkUnit(), /host getter/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
});
