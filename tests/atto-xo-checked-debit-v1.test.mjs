import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedDebitCases } from './checked-debit-corpus.mjs';
import { compileProgramV2 } from '../src/program-v2.mjs';

for (const {id, expected, source} of checkedDebitCases()) {
  test('Atto-XO checked debit compiled JS: ' + id, async () => {
    const esm = compileProgramV2(source);
    const { main } = await import('data:text/javascript,' + encodeURIComponent(esm));
    if (expected === 'overflow') {
      assert.throws(() => main(), /ORES_I64_OVERFLOW/);
    } else {
      assert.equal(main(), BigInt(expected));
    }
  });
}
