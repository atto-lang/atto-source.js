import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkerActorClient } from '../src/worker-actor-client.mjs';

const PROTOCOL = 'ores.js.worker.v1';
class FakeWorker extends EventEmitter {
  sent = [];
  terminated = 0;
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated++; return Promise.resolve(0); }
  frame(kind, more = {}) { this.emit('message', {protocol: PROTOCOL, kind, ...more}); }
  deliveries() { return this.sent.filter((frame) => frame.kind === 'deliver'); }
}
const spawn = (worker, options = {}) => createWorkerActorClient({
  worker, moduleUrl: 'file:///trusted/worker-test.mjs', maxPending: 4,
  maxPendingBytes: 4000, ...options
});
const tick = () => new Promise((resolve) => queueMicrotask(resolve));

test('pre-ready send snapshots ownership before the caller mutates its graph', async () => {
  const worker = new FakeWorker();
  const actor = spawn(worker);
  const bytes = new Uint8Array([5, 6, 7]);
  const payload = {nested: {id: 41}, bytes, flags: [true, false]};
  const reply = actor.request(payload);
  assert.equal(actor.pending, 1);
  assert.ok(actor.pendingBytes > 0);
  payload.nested.id = 99;
  payload.flags[0] = false;
  bytes[0] = 88;
  worker.frame('ready');
  await actor.ready;
  await tick();
  const frame = worker.deliveries()[0];
  assert.ok(frame, 'accepted message must dispatch after startup');
  assert.equal(frame.id, 1);
  assert.deepEqual(frame.value.nested, {id: 41});
  assert.deepEqual(frame.value.flags, [true, false]);
  assert.deepEqual([...frame.value.bytes], [5, 6, 7]);
  assert.notEqual(frame.value.bytes.buffer, bytes.buffer);
  worker.frame('result', {id: 1, ok: true, value: 42});
  assert.equal(await reply, 42);
  assert.equal(actor.pending, 0);
  assert.equal(actor.pendingBytes, 0);
  await actor.close();
});

test('successful Worker reply is copied before the caller observes it', async () => {
  const worker = new FakeWorker();
  const actor = spawn(worker);
  worker.frame('ready');
  await actor.ready;
  const reply = actor.request({ask: 1});
  await tick();
  const original = {result: new Uint8Array([1, 2, 3]), nested: {ok: true}};
  worker.frame('result', {id: 1, ok: true, value: original});
  original.result[0] = 77;
  original.nested.ok = false;
  const observed = await reply;
  assert.deepEqual([...observed.result], [1, 2, 3]);
  assert.equal(observed.nested.ok, true);
  assert.notEqual(observed.result.buffer, original.result.buffer);
  assert.equal(actor.pendingBytes, 0);
  await actor.close();
});

test('nested callable payloads are denied without reserving mailbox credit', async () => {
  const worker = new FakeWorker();
  const actor = spawn(worker);
  worker.frame('ready');
  await actor.ready;
  for (const payload of [
    {callback: () => 1},
    {deep: {callback: () => 1}},
    new Map([['callback', () => 1]]),
    new Set([() => 1])
  ]) {
    await assert.rejects(actor.request(payload), /unsupported actor wire/);
    assert.equal(actor.pending, 0);
    assert.equal(actor.pendingBytes, 0);
  }
  await tick();
  assert.equal(worker.deliveries().length, 0);
  const accepted = actor.request({number: 9});
  await tick();
  assert.equal(worker.deliveries().length, 1);
  assert.equal(worker.deliveries()[0].id, 1, 'rejected data must not consume message IDs');
  worker.frame('result', {id: 1, ok: true, value: 9});
  assert.equal(await accepted, 9);
  await actor.close();
});

test('oversized rejection does not consume a mailbox ID or strand bytes', async () => {
  const worker = new FakeWorker();
  const actor = spawn(worker, {maxPendingBytes: 180});
  await assert.rejects(actor.request({body: 'x'.repeat(100)}), /byte capacity exceeded/);
  assert.equal(actor.pending, 0);
  assert.equal(actor.pendingBytes, 0);
  const reply = actor.request({ok: true});
  worker.frame('ready');
  await actor.ready;
  await tick();
  assert.equal(worker.deliveries()[0].id, 1);
  worker.frame('result', {id: 1, ok: true, value: true});
  assert.equal(await reply, true);
  assert.equal(actor.pendingBytes, 0);
  await actor.close();
});

test('forged callable response revokes every pending reservation exactly once', async () => {
  const worker = new FakeWorker();
  const actor = spawn(worker);
  worker.frame('ready');
  await actor.ready;
  const first = assert.rejects(actor.request({request: 1}), /invalid actor response payload/);
  const second = assert.rejects(actor.tell({request: 2}), /invalid actor response payload/);
  await tick();
  assert.equal(actor.pending, 2);
  worker.frame('result', {id: 1, ok: true, value: {callback: () => 1}});
  await Promise.all([first, second]);
  assert.equal(actor.pending, 0);
  assert.equal(actor.pendingBytes, 0);
  assert.equal(worker.terminated, 1);
  worker.frame('result', {id: 2, ok: true, value: 42});
  assert.equal(actor.pending, 0);
  await actor.close();
  assert.equal(worker.terminated, 1);
});

// Experimental Worker boundary tests, not evidence of isoactor heaps,
// native zero-GC, or compiler-backed actor guest execution.
