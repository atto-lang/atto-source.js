import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker, isMainThread, parentPort} from 'node:worker_threads';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

// Host Worker isolation test, not compiler-generated guest execution.
if (!isMainThread) {
  const fence = new SelectContinuationFence({maxTickets:2});
  const ticket = fence.register(), pending = fence.register();
  let reject;
  const gate = new Promise((_, r) => { reject = r; });
  const invocation = fence.tryInvoke(ticket, () => gate);
  const observed = invocation.then(() => false, e => e.message === 'expected failure');
  parentPort.on('message', async ({op, foreign}) => {
    try {
      if (op === 'stop') {
        assert.equal(fence.tryClaim(foreign), null);
        assert.equal(fence.advance(1), false);
        assert.equal(fence.close(), true);
        assert.equal(pending.active, false);
        assert.equal(fence.executing, 1);
        assert.equal(fence.retirementReady, false);
        parentPort.postMessage({op, executing:fence.executing});
      } else if (op === 'probe') {
        parentPort.postMessage({op, executing:fence.executing, ready:fence.retirementReady});
      } else if (op === 'settle') {
        reject(new Error('expected failure'));
        assert.equal(await observed, true);
        assert.equal(fence.retirementReady, true);
        const successor = new SelectContinuationFence({maxTickets:2, generation:2});
        assert.equal(successor.tryClaim(ticket), null);
        assert.equal(successor.tryClaim(pending), null);
        assert.equal(successor.tryClaim(foreign), null);
        const fresh = successor.register();
        let result = 0;
        assert.equal(await successor.tryInvoke(fresh, async () => { result = 42; }), true);
        assert.equal(result, 42);
        assert.equal(successor.close(), true);
        assert.equal(successor.retirementReady, true);
        parentPort.postMessage({op, ready:fence.retirementReady, result});
      } else {
        throw new Error(`unexpected operation ${op}`);
      }
    } catch (error) {
      parentPort.postMessage({error:String(error), stack:error.stack});
    }
  });
  // A cloned ticket must not acquire authority, even when its public fields match.
  parentPort.postMessage({op:'start', pending});
} else {
  const receive = (worker, op) => new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onError = error => { cleanup(); reject(error); };
    const onExit = code => onError(new Error(`worker exited before ${op}: ${code}`));
    const onMessage = message => {
      cleanup();
      if (message.error) reject(new Error(message.stack || message.error));
      else if (message.op !== op) reject(new Error(`expected ${op}, got ${message.op}`));
      else resolve(message);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
  const request = (worker, op, foreign) => {
    const response = receive(worker, op);
    worker.postMessage({op, foreign});
    return response;
  };
  test('eight isolated Workers settle independently and reject cloned stale tickets', {timeout:30000}, async () => {
    const workers = [];
    try {
      const starts = [];
      for (let i = 0; i < 8; i++) {
        const worker = new Worker(new URL(import.meta.url));
        workers.push(worker);
        starts.push(receive(worker, 'start'));
      }
      const receipts = await Promise.all(starts);
      for (let i = 0; i < workers.length; i++) {
        const foreign = receipts[(i + 1) % workers.length].pending;
        assert.equal((await request(workers[i], 'stop', foreign)).executing, 1);
      }
      for (let i = workers.length - 1; i >= 0; i--) {
        const result = await request(workers[i], 'settle', receipts[i].pending);
        assert.equal(result.ready, true);
        assert.equal(result.result, 42);
        if (i > 0) {
          const peer = await request(workers[i - 1], 'probe');
          assert.equal(peer.executing, 1);
          assert.equal(peer.ready, false);
        }
      }
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  });
}
