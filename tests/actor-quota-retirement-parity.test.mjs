import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorGenerationFence} from '../src/actor-generation-fence.mjs';
import {copyOwnedValueWithBytes} from '../src/worker-actor-copy.mjs';

// Host copy and generation-fence coverage only: this does not implement
// actor-private arenas, physical reclamation or source-level copy! semantics.
test('denied copy admissions preserve caller values and sibling continuity', () => {
  const first = new ActorGenerationFence();
  const sibling = new ActorGenerationFence();
  const firstLease = first.capture();
  const siblingLease = sibling.capture();
  const source = { marker: 17, bytes: new Uint8Array([1, 2, 3]) };
  const peer = { marker: 9 };
  const retained = copyOwnedValueWithBytes(source);
  const siblingValue = copyOwnedValueWithBytes(peer);
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  oversized[0] = 42;
  for (let i = 0; i < 8; i++) {
    assert.throws(() => copyOwnedValueWithBytes(oversized), /byte budget exceeded/);
    assert.equal(oversized[0], 42);
    assert.equal(oversized.byteLength, 8 * 1024 * 1024 + 1);
    assert.equal(firstLease.current, true);
    assert.equal(siblingLease.current, true);
  }
  const tail = copyOwnedValueWithBytes(new Uint8Array([8]));
  assert.equal(tail.bytes, 1);
  assert.equal(tail.value[0], 8);
  assert.equal(retained.value.marker, 17);
  assert.deepEqual([...retained.value.bytes], [1, 2, 3]);
  assert.equal(first.close(), true);
  let invoked = 0;
  assert.equal(firstLease.tryRun(() => { invoked++; return true; }), false);
  assert.equal(invoked, 0);
  assert.equal(siblingLease.tryRun(() => {
    assert.equal(siblingValue.value.marker, 9);
    return true;
  }), true);
  const restarted = new ActorGenerationFence();
  assert.equal(restarted.capture().tryRun(() => true), true);
  assert.equal(firstLease.current, false);
  assert.equal(source.marker, 17);
  assert.deepEqual([...source.bytes], [1, 2, 3]);
});
