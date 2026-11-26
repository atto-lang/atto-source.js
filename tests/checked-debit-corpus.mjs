import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pin = 'e6e3394d5d62ec1f8171053b74a3b68389c41d5c797d81c14f561d1ca097a28b';
const outcomes = new Map([
  ['normal', '42'], ['control', '43'], ['max-valid', '42'],
  ['fee-overflow', 'overflow'], ['notional-overflow', 'overflow'],
  ['overflow-cancel', 'overflow'], ['overflow-dead-result', 'overflow']
]);
export const corpusBytes = () => readFileSync(new URL('../contracts/atto-xo-checked-debit-v1/cases.tsv', import.meta.url));
export function checkedDebitCases(bytes = corpusBytes()) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin, 'shared checked-debit corpus SHA-256 mismatch');
  const rows = bytes.toString('utf8').split('\n');
  assert.equal(rows.pop(), '', 'expected canonical final newline');
  assert.equal(rows.length, outcomes.size);
  const seen = new Set();
  return rows.map(row => {
    const fields = row.split('|');
    assert.equal(fields.length, 8);
    const [id, expected, , , , , , source] = fields;
    assert.ok(outcomes.has(id) && !seen.has(id), id);
    assert.equal(expected, outcomes.get(id), id);
    seen.add(id);
    return {id, expected, source};
  });
}
