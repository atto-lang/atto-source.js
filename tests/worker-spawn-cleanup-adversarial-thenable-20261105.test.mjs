import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

test('a throwing termination-method getter cannot mask the original spawn failure', () => {
  const original = Error('original worker configuration failure');
  const cleanup = Object.create(null);
  let lookups = 0;
  Object.defineProperty(cleanup, 'terminate', {get() {
    lookups++;
    throw Error('hostile method getter');
  }});
  assert.throws(() => {
    try { throw original; }
    catch (error) { terminateFailedWorkerSpawn(cleanup); throw error; }
  }, error => error === original);
  assert.equal(lookups, 1);
});

test('a thenable with a throwing then getter is observed without throwing to caller', async () => {
  let terminations = 0;
  let thenLookups = 0;
  const worker = {terminate() {
    terminations++;
    const result = Object.create(null);
    Object.defineProperty(result, 'then', {get() {
      thenLookups++;
      throw Error('then assimilation failed');
    }});
    return result;
  }};
  assert.doesNotThrow(() => terminateFailedWorkerSpawn(worker));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(terminations, 1);
  assert.equal(thenLookups, 1);
});

test('successful and absent termination results do not change cleanup behavior', async () => {
  for (const result of [undefined, null, 0, false, Promise.resolve(1)]) {
    let calls = 0;
    assert.doesNotThrow(() => terminateFailedWorkerSpawn({terminate() {calls++;return result;}}));
    assert.equal(calls, 1);
  }
  await Promise.resolve();
});
