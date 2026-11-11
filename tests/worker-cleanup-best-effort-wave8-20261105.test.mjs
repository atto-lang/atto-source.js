import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

test('absent or malformed termination adapters cannot replace admission failure', () => {
  for (const worker of [null, undefined, {}, {terminate:null}, {terminate:42}]) {
    assert.doesNotThrow(() => terminateFailedWorkerSpawn(worker));
  }
});

test('a throwing termination getter cannot overwrite the original constructor error', () => {
  const original = Error('original construction denial');
  let reads = 0;
  const worker = {get terminate() {reads++; throw Error('cleanup getter failure');}};
  let observed;
  try {throw original;} catch (error) {
    observed = error;
    assert.doesNotThrow(() => terminateFailedWorkerSpawn(worker));
  }
  assert.strictEqual(observed, original);
  assert.equal(reads, 1);
});

test('synchronous successful termination results are not treated as new authority', () => {
  let calls = 0;
  for (const value of [undefined, 0, 'done']) {
    assert.doesNotThrow(() => terminateFailedWorkerSpawn({
      terminate() {calls++; return value;}
    }));
  }
  assert.equal(calls, 3);
});
