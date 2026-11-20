import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import {compileProgramV2} from '../src/program-v2.mjs';

// Shared cross-backend expression inventory, not an attestation that native
// LLVM/Wasm or .NET Native AOT binaries executed. The explicit JS source
// header selects the checked-i64 experimental profile.
const ROOT = new URL('../contracts/v1/numeric-parity/', import.meta.url);
const REVIEWED = {
  "source-i64-cases.json": "bbc319c19ecd007109d33592e210091eb267e5a2",
  "source-i64-overflow-cases.json": "2ce0b0ff5c52e54a788280fd64d67fa8dc32614a"
};
const POSITIVE = [
  {
    "id": "precedence",
    "expression": "2+3*4",
    "expected": "14"
  },
  {
    "id": "grouping",
    "expression": "(2+3)*4",
    "expected": "20"
  },
  {
    "id": "signed-multiplication",
    "expression": "(8-3)*5+2",
    "expected": "27"
  },
  {
    "id": "subtraction",
    "expression": "100-(3+2)-19",
    "expected": "76"
  },
  {
    "id": "negative-result",
    "expression": "3*4-2*5-7",
    "expected": "-5"
  },
  {
    "id": "max-minus-one",
    "expression": "9223372036854775807-1",
    "expected": "9223372036854775806"
  },
  {
    "id": "signed-minimum",
    "expression": "-9223372036854775808",
    "expected": "-9223372036854775808"
  }
];
const OVERFLOW = [
  {
    "id": "positive-add-overflow",
    "source": "9223372036854775807+1",
    "expected": "reject-or-runtime-error"
  },
  {
    "id": "negative-sub-overflow",
    "source": "-9223372036854775808-1",
    "expected": "reject-or-runtime-error"
  },
  {
    "id": "positive-multiply-overflow",
    "source": "3037000500*3037000500",
    "expected": "reject-or-runtime-error"
  },
  {
    "id": "negative-unary-overflow",
    "source": "-(-9223372036854775808)",
    "expected": "reject-or-runtime-error"
  }
];

function gitBlobSha(bytes) {
  return createHash('sha1').update('blob ' + bytes.length)
    .update(Buffer.from([0])).update(bytes).digest('hex');
}
async function reviewedManifest(name, expected, status) {
  assert.ok(Object.hasOwn(REVIEWED, name), 'unknown manifest');
  const path = new URL(name, ROOT);
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() &&
    stat.size > 0 && stat.size <= 8192, 'invalid numeric source fixture');
  const bytes = await readFile(path);
  assert.equal(bytes.length, stat.size, 'source fixture changed during read');
  assert.equal(gitBlobSha(bytes), REVIEWED[name], 'cross-backend source fixture drift');
  const data = JSON.parse(bytes.toString('utf8'));
  const keys = status === 'requires-executable-negative-tests'
    ? ['cases', 'policy', 'schema_version', 'scope', 'status']
    : ['cases', 'schema_version', 'scope', 'status'];
  assert.deepEqual(Object.keys(data).sort(), keys);
  assert.equal(data.schema_version, '1.0.0');
  assert.equal(data.status, status);
  assert.equal(typeof data.scope, 'string');
  assert.deepEqual(data.cases, expected);
  assert.equal(new Set(data.cases.map(row => row.id)).size, expected.length);
  if (status === 'requires-executable-negative-tests')
    assert.equal(data.policy, 'no-wrapping-i64');
  return data.cases;
}
function guestSource(expression) {
  // The shared fixture carries audited expression text, not a complete
  // language program or a host-provided JS expression.
  return '// oreslang:checked-i64-v1' + String.fromCharCode(10) +
    'pub fnc main(): int { return ' + expression + '; }' +
    String.fromCharCode(10);
}
async function runGuest(source) {
  const js = compileProgramV2(source);
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
}

test('checked-i64: seven .NET/Wasm portable expressions execute as exact JS BigInts', async t => {
  const rows = await reviewedManifest('source-i64-cases.json', POSITIVE,
    'reference-only-not-compiled-execution');
  for (const row of rows) {
    await t.test(row.id, async () => {
      const guest = await runGuest(guestSource(row.expression));
      assert.equal(guest.main(), BigInt(row.expected));
    });
  }
});

test('checked-i64: four Wasm/LLVM overflow cases cannot silently wrap in JS', async t => {
  const rows = await reviewedManifest('source-i64-overflow-cases.json', OVERFLOW,
    'requires-executable-negative-tests');
  for (const row of rows) {
    await t.test(row.id, async () => {
      assert.equal(row.expected, 'reject-or-runtime-error');
      // This JS profile specifically requires a runtime RangeError; the
      // shared contract permits source-time refusal in other backends.
      const guest = await runGuest(guestSource(row.source));
      assert.throws(() => guest.main(), error =>
        error instanceof RangeError &&
        error.message.startsWith('ORES_I64_OVERFLOW:'));
    });
  }
});
