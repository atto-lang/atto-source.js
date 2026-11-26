import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {createWorkerCompletionCapabilitiesV1} from '../src/worker-completion-capability-v1.mjs';
import {Worker, MessageChannel} from 'node:worker_threads';

for (const [name, postTurn] of [
  ['inline callback', run => run()],
  ['throwing host', () => {throw new Error('host unavailable');}],
]) {
  test(`${name}: admission reports failure and no guest turn runs`, () => {
    let ran = 0;
    const loop = createWorkerControlLoop({postTurn});
    assert.equal(loop.attachOwner('a', 1), true);
    assert.equal(loop.admitData('a', 1, () => ran++), false);
    assert.equal(ran, 0);
    assert.equal(loop.stats.closed, true);
    assert.equal(loop.stats.ready, 0);
  });
  test(`${name}: completion cannot report successful admission`, () => {
    let ran = 0;
    const loop = createWorkerControlLoop({postTurn});
    const auth = createWorkerCompletionCapabilitiesV1({loop, owner: 'a', epoch: 1});
    const grant = auth.reserve(() => ran++);
    assert.equal(auth.complete({...grant, value: 42n}), false);
    assert.equal(auth.stats.accepted, 0);
    assert.equal(auth.stats.pending, 0);
    assert.equal(auth.complete({...grant, value: 42n}), false);
    assert.equal(ran, 0);
    assert.equal(loop.stats.closed, true);
    assert.equal(loop.stats.suspended, 0);
  });
}

test('real Worker completion stages behind a full runnable queue, then resumes once', async t => {
  const turns = [], results = [];
  const loop = createWorkerControlLoop({maxReady: 1, postTurn: run => turns.push(run)});
  const auth = createWorkerCompletionCapabilitiesV1({loop, owner: 'a', epoch: 1});
  const grant = auth.reserve(value => results.push(value));
  assert.equal(loop.admitData('a', 1, () => {results.push('sibling');}), true);
  const channel = new MessageChannel();
  auth.bindPort(channel.port1);
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    parentPort.once('message',({port,grant})=>{
      port.postMessage({...grant,value:42n});
      port.postMessage({...grant,value:42n});
    });`, {eval:true});
  t.after(async () => {auth.close(); channel.port1.close(); await worker.terminate();});
  worker.postMessage({port: channel.port2, grant}, [channel.port2]);
  for (let i = 0; i < 400 && auth.stats.rejected === 0; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(auth.stats.accepted, 1);
  assert.equal(auth.stats.rejected, 1);
  assert.equal(loop.stats.settled, 1);
  assert.deepEqual(results, []);
  while (turns.length) turns.shift()();
  assert.deepEqual(results, ['sibling', 42n]);
  assert.equal(loop.stats.suspended, 0);
  assert.equal(loop.stats.settled, 0);
});
