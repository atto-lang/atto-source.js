import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileProgramV2 } from '../src/program-v2.mjs';

const rows = readFileSync(new URL('../contracts/atto-xo-checked-debit-v1/cases.tsv', import.meta.url), 'utf8').trimEnd().split('\n');
assert.equal(rows.length, 7);
const ids = new Set();
for (const row of rows) {
  const fields = row.split('|');
  assert.equal(fields.length, 8);
  const [id, expected, , , , , , source] = fields;
  assert.ok(!ids.has(id), id);
  ids.add(id);
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
