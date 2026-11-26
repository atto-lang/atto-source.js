import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerCompletionCapabilitiesV1 } from '../src/worker-completion-capability-v1.mjs';

// Trusted host loop double: isolates the capability decoder and failure boundary.
// This is not a guest or production scheduler execution test.
function setup(complete = () => true) {
  const deliveries = [], cancellations = [];
  const loop = {
    attachOwner: () => true,
    retireOwner: () => true,
    beginSuspension: () => ({}),
    complete(ticket, value) { deliveries.push(value); return complete(ticket, value); },
    cancel(ticket) { cancellations.push(ticket); return true; },
  };
  const auth = createWorkerCompletionCapabilitiesV1({loop, owner: 'worker-a', epoch: 1, maxPending: 1});
  const grant = auth.reserve(() => {});
  return {auth, grant, deliveries, cancellations};
}
const frame = grant => ({...grant, value: 42n});
for (const [name, extra] of [
  ['symbol field', f => Object.defineProperty(f, Symbol('extra'), {value: true})],
  ['non-enumerable field', f => Object.defineProperty(f, 'extra', {value: true})],
]) test(`reject ${name} without consuming grant`, () => {
  const {auth, grant, deliveries} = setup();
  assert.equal(auth.complete(extra(frame(grant))), false);
  assert.equal(auth.stats.pending, 1);
  assert.deepEqual(deliveries, []);
  assert.equal(auth.complete(frame(grant)), true);
});
test('decode own data descriptors once, never read through a proxy get trap', () => {
  const {auth, grant, deliveries} = setup();
  let gets = 0;
  const proxy = new Proxy(frame(grant), {get(target, key, receiver) {
    gets++;
    return key === 'value' ? 999n : Reflect.get(target, key, receiver);
  }});
  assert.equal(auth.complete(proxy), true);
  assert.equal(gets, 0);
  assert.deepEqual(deliveries, [42n]);
});
test('getter is rejected without evaluation', () => {
  const {auth, grant, deliveries} = setup();
  let reads = 0;
  const input = frame(grant);
  Object.defineProperty(input, 'value', {get() { reads++; return 42n; }});
  assert.equal(auth.complete(input), false);
  assert.equal(reads, 0);
  assert.deepEqual(deliveries, []);
});
test('failed trusted loop admission consumes the grant and releases pending quota', () => {
  const {auth, grant, deliveries, cancellations} = setup(() => {throw new Error('scheduler failed');});
  assert.equal(auth.complete(frame(grant)), false);
  assert.equal(auth.stats.pending, 0);
  assert.equal(auth.complete(frame(grant)), false);
  assert.deepEqual(deliveries, [42n]);
  assert.equal(cancellations.length, 1);
  assert.ok(auth.reserve(() => {}));
});
test('negative admission and replay are rejected', () => {
  const {auth, grant, deliveries} = setup(() => false);
  assert.equal(auth.complete(frame(grant)), false);
  assert.equal(auth.stats.pending, 0);
  assert.equal(auth.complete(frame(grant)), false);
  assert.deepEqual(deliveries, [42n]);
});
test('ordinary completion stays single-use', () => {
  const {auth, grant, deliveries} = setup();
  assert.equal(auth.complete(frame(grant)), true);
  assert.equal(auth.complete(frame(grant)), false);
  assert.deepEqual(deliveries, [42n]);
  assert.equal(auth.stats.accepted, 1);
});
