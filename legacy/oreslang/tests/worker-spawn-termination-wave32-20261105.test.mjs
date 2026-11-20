import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

// Only failed construction cleanup; normal actor client close has distinct semantics.
test('terminates exactly once and preserves return contract', () => {
  let calls = 0;
  const result = terminateFailedWorkerSpawn({terminate() { ++calls; return 0; }});
  assert.equal(result, undefined);
  assert.equal(calls, 1);
});

test('synchronous termination exceptions do not hide original constructor failure', () => {
  const original = new Error('invalid worker actor configuration');
  let observed;
  try {
    try {
      throw original;
    } catch (err) {
      terminateFailedWorkerSpawn({terminate() { throw new Error('secondary terminate failure'); }});
      throw err;
    }
  } catch (err) {
    observed = err;
  }
  assert.strictEqual(observed, original);
});

test('asynchronous terminate rejection is observed by the cleanup routine', async () => {
  let reject;
  const terminated = new Promise((_, r) => {reject = r;});
  terminateFailedWorkerSpawn({terminate() { return terminated; }});
  reject(new Error('worker already stopped'));
  await new Promise((resolve) => setImmediate(resolve));
  // A missed rejection handler would fail this Node test runner.
  assert.ok(true);
});

test('undefined worker is a safe secondary failure after admission rejects', () => {
  assert.doesNotThrow(() => terminateFailedWorkerSpawn(undefined));
});
