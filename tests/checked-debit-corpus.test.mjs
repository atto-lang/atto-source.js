import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedDebitCases, corpusBytes } from './checked-debit-corpus.mjs';

test('shared checked debit exact bytes and value/fault census (host only)', () => {
  const cases = checkedDebitCases();
  assert.equal(cases.length, 7);
  assert.equal(cases.filter(c => c.expected !== 'overflow').length, 3);
  assert.equal(cases.filter(c => c.expected === 'overflow').length, 4);
});

test('corpus pin rejects mutations to source, oracle, order, and newline', () => {
  const bytes = corpusBytes();
  const text = bytes.toString('utf8');
  const rows = text.trimEnd().split('\n');
  for (const mutant of [
    text.replace('return price*shares+fee', 'return price+shares+fee'),
    text.replace('normal|42|', 'normal|43|'),
    [...rows].reverse().join('\n') + '\n',
    text.trimEnd()
  ]) {
    assert.notEqual(mutant, text);
    assert.throws(() => checkedDebitCases(Buffer.from(mutant)), /SHA-256 mismatch/);
  }
});
