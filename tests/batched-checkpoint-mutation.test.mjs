import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BatchedCheckpoint} from '../src/batched-checkpoint.mjs';

const source = readFileSync(new URL('../src/batched-checkpoint.mjs', import.meta.url), 'utf8');
function assertCheckpointContract(Type) {
  const observed = [];
  const q = new Type({hardFuel: 129, poll: receipt => observed.push(receipt)});
  for (let unit = 1; unit < 128; unit++) {
    assert.equal(q.completeWorkUnit(), false, `early poll at ${unit}`);
    assert.equal(observed.length, 0, 'slow path reached on unbatched hot edge');
  }
  assert.equal(q.completeWorkUnit(), true, 'missing 128-unit poll');
  assert.equal(q.remainingFuel, 1, 'hard fuel must include pending charges');
  assert.equal(q.completeWorkUnit(), true, 'missing final exact-fuel poll');
  assert.equal(q.remainingFuel, 0);
  assert.deepEqual(observed, [
    {charged: 128, remainingFuel: 1},
    {charged: 1, remainingFuel: 0}
  ]);
  assert.throws(() => q.completeWorkUnit(), /fuel exhausted/);
  assert.throws(() => q.completeWorkUnit(), /terminal/);
}

async function mutatedClass(original, broken, suffix) {
  assert.equal(source.split(original).length, 2, `expected exactly one mutation site: ${suffix}`);
  const mutation = source.replace(original, broken);
  const module = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(mutation)}#${suffix}`);
  return module.BatchedCheckpoint;
}

test('negative mutation: the execution oracle detects missing, per-edge, and refilled polls', async () => {
  assertCheckpointContract(BatchedCheckpoint);
  const where = 'if (this.#pending < this.#next) return false;';
  const mutants = [
    await mutatedClass(where, 'if (true) return false;', 'elide-poll'),
    await mutatedClass(where, 'if (false) return false;', 'poll-every-edge'),
    await mutatedClass('this.#fuel -= charged;', 'this.#fuel += charged;', 'refill-hard-fuel')
  ];
  for (const Mutant of mutants) {
    assert.throws(() => assertCheckpointContract(Mutant), assert.AssertionError,
      'a broken checkpoint must be rejected by the same execution oracle');
  }
});
