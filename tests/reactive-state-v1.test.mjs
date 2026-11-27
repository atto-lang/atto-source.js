import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untracked, diffKeyed, applyKeyedOps, ReactiveError } from '../src/reactive-state-v1.mjs';

const code = (fn) => { try { fn(); } catch (e) { return e instanceof ReactiveError ? e.code : `other:${e}`; } return 'no-error'; };

test('diamond dependencies are glitch-free and run once per write', () => {
  const first = signal('Ada');
  const last = signal('Lovelace');
  const full = computed(() => `${first.get()} ${last.get()}`);
  const initials = computed(() => `${first.get()[0]}${last.get()[0]}`);
  const seen = [];
  effect(() => seen.push(`${full.get()} (${initials.get()})`));
  first.set('Grace');
  batch(() => { first.set('Alan'); last.set('Turing'); });
  assert.deepEqual(seen, ['Ada Lovelace (AL)', 'Grace Lovelace (GL)', 'Alan Turing (AT)']);
});

test('computeds are lazy, memoized, and cut off on equal results', () => {
  const n = signal(3);
  let parityRuns = 0, labelRuns = 0, effectRuns = 0;
  const parity = computed(() => { parityRuns++; return n.get() % 2; });
  const label = computed(() => { labelRuns++; return parity.get() === 0 ? 'even' : 'odd'; });
  assert.equal(parityRuns, 0, 'lazy until read');
  effect(() => { effectRuns++; label.get(); });
  n.set(5); // parity unchanged (1): label and effect must not re-run
  assert.deepEqual([parityRuns, labelRuns, effectRuns], [2, 1, 1]);
  n.set(6);
  assert.deepEqual([parityRuns, labelRuns, effectRuns], [3, 2, 2]);
  n.set(6); // Object.is-equal write is a no-op
  assert.deepEqual([parityRuns, labelRuns, effectRuns], [3, 2, 2]);
  assert.equal(label.get(), 'even');
  assert.equal(labelRuns, 2, 'memoized read');
});

test('dependencies are re-tracked so conditional reads unsubscribe', () => {
  const useA = signal(true), a = signal(1), b = signal(10);
  const runs = [];
  effect(() => runs.push(useA.get() ? a.get() : b.get()));
  b.set(11); // not read yet
  useA.set(false);
  a.set(2); // no longer read
  b.set(12);
  assert.deepEqual(runs, [1, 11, 12]);
});

test('cleanup runs before re-run and on dispose; disposed effects stay silent', () => {
  const s = signal(0);
  const log = [];
  const dispose = effect(() => { const v = s.get(); log.push(`run ${v}`); return () => log.push(`clean ${v}`); });
  s.set(1);
  dispose();
  s.set(2);
  dispose();
  assert.deepEqual(log, ['run 0', 'clean 0', 'run 1', 'clean 1']);
});

test('nested batches flush once at the outermost boundary, in effect creation order', () => {
  const a = signal(0), b = signal(0);
  const order = [];
  effect(() => { a.get(); order.push('e1'); });
  effect(() => { b.get(); order.push('e2'); });
  order.length = 0;
  batch(() => { b.set(1); batch(() => a.set(1)); a.set(2); assert.deepEqual(order, []); });
  assert.deepEqual(order, ['e1', 'e2']);
});

test('untracked reads do not subscribe', () => {
  const a = signal(1), b = signal(1);
  let runs = 0;
  effect(() => { runs++; a.get(); untracked(() => b.get()); });
  b.set(2);
  a.set(2);
  assert.equal(runs, 2);
});

test('cycles, impure computeds and runaway effects fail closed', () => {
  const self = computed(() => self.get() + 1);
  assert.equal(code(() => self.get()), 'E_REACTIVE_CYCLE');
  const s = signal(0);
  const bad = computed(() => { s.set(1); return 0; });
  assert.equal(code(() => bad.get()), 'E_REACTIVE_WRITE_IN_COMPUTED');
  const ping = signal(0);
  const stop = effect(() => { const v = ping.get(); if (v > 0) ping.set(v + 1); });
  assert.equal(code(() => ping.set(1)), 'E_REACTIVE_EFFECT_LOOP');
  stop();
  ping.set(0); // system remains usable after the loop error
});

// ---- keyed list diff ----
function lisLength(seq) {
  const tails = [];
  for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
  return tails.length;
}
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

test('keyed diff transforms old to new with the minimum number of moves', () => {
  for (let trial = 0; trial < 500; trial++) {
    const universe = Array.from({ length: 20 }, (_, i) => `k${i}`);
    const pick = () => universe.filter(() => rnd(3) !== 0).sort(() => rnd(3) - 1);
    const oldKeys = pick(), newKeys = pick();
    const ops = diffKeyed(oldKeys, newKeys);
    assert.deepEqual(applyKeyedOps(oldKeys, ops), newKeys, `trial ${trial}`);
    const kept = oldKeys.filter((k) => newKeys.includes(k));
    const keptNewOrder = newKeys.filter((k) => kept.includes(k)).map((k) => kept.indexOf(k));
    const moves = ops.filter((o) => o.op === 'move').length;
    assert.equal(moves, kept.length - lisLength(keptNewOrder), `trial ${trial} minimal moves`);
    assert.equal(ops.filter((o) => o.op === 'insert').length, newKeys.length - kept.length);
    assert.equal(ops.filter((o) => o.op === 'remove').length, oldKeys.length - kept.length);
  }
});

test('keyed diff edge cases and duplicate keys', () => {
  assert.deepEqual(diffKeyed(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(diffKeyed([], ['a']), [{ op: 'insert', key: 'a', before: null }]);
  assert.deepEqual(diffKeyed(['a'], []), [{ op: 'remove', key: 'a' }]);
  assert.equal(diffKeyed(['a', 'b', 'c'], ['c', 'b', 'a']).filter((o) => o.op === 'move').length, 2);
  assert.equal(code(() => diffKeyed(['a', 'a'], ['a'])), 'E_REACTIVE_DUPLICATE_KEY');
  assert.equal(code(() => diffKeyed(['a'], ['b', 'b'])), 'E_REACTIVE_DUPLICATE_KEY');
});

test('signals drive a keyed view end to end', () => {
  const todos = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]);
  const keys = computed(() => todos.get().map((x) => x.id));
  let rendered = [];
  const opLog = [];
  effect(() => { const next = keys.get(); const ops = diffKeyed(rendered, next); opLog.push(ops.length); rendered = applyKeyedOps(rendered, ops); });
  todos.update((xs) => [xs[2], xs[0], xs[1]]); // rotate: 1 move
  todos.update((xs) => xs.filter((x) => x.id !== 1)); // 1 remove
  assert.deepEqual(rendered, [3, 2]);
  assert.deepEqual(opLog, [3, 1, 1]);
});
