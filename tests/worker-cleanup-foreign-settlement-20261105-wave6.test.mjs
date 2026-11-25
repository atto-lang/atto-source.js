import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

test('a foreign thenable that resolves then rejects cannot replace the constructor exception', async () => {
  const constructionFailure = Error('failed to configure worker');
  let terminations = 0, assimilations = 0;
  const worker = {terminate() {
    terminations++;
    return {then(resolve, reject) {
      assimilations++;
      resolve('exited');
      reject(Error('late duplicate termination failure'));
    }};
  }};
  assert.throws(() => {
    try {throw constructionFailure;}
    catch (error) {terminateFailedWorkerSpawn(worker); throw error;}
  }, error => error === constructionFailure);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(terminations, 1);
  assert.equal(assimilations, 1);
});

test('missing termination capability is swallowed in failed-spawn cleanup only', () => {
  const original = Error('configuration failed');
  assert.throws(() => {
    try {throw original;}
    catch (error) {terminateFailedWorkerSpawn(Object.create(null)); throw error;}
  }, error => error === original);
  assert.doesNotThrow(() => terminateFailedWorkerSpawn(null));
});

test('separate cleanup requests each attempt termination exactly once', async () => {
  let calls = 0;
  const worker = {terminate() {calls++; return Promise.resolve();}};
  terminateFailedWorkerSpawn(worker);
  terminateFailedWorkerSpawn(worker);
  await Promise.resolve();
  assert.equal(calls, 2);
});
