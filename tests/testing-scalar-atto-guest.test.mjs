import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProgramV2} from '../src/program-v2.mjs';

// These tests compile the JS backend's own .atto library source into ESM
// and EXECUTE its guest functions on Node. They are not Java or LLVM runs,
// and do not imply full TestSuite, std import or native AOT support.
const library = readFileSync(new URL('../stdlib/testing_scalar.atto', import.meta.url), 'utf8');
const vectors = [
  ['equal-pass', 'equal_int(42, 42)', 0n],
  ['equal-fail', 'equal_int(42, 41)', 1n],
  ['not-equal-pass', 'not_equal_int(42, 41)', 0n],
  ['not-equal-fail', 'not_equal_int(42, 42)', 1n],
  ['greater-pass', 'greater_than_int(42, 41)', 0n],
  ['greater-too-small', 'greater_than_int(41, 42)', 1n],
  ['greater-equality', 'greater_than_int(42, 42)', 1n],
  ['less-pass', 'less_than_int(41, 42)', 0n],
  ['less-too-large', 'less_than_int(42, 41)', 1n],
  ['less-equality', 'less_than_int(42, 42)', 1n],
  ['range-lower', 'in_range_int(40, 40, 42)', 0n],
  ['range-upper', 'in_range_int(42, 40, 42)', 0n],
  ['range-middle', 'in_range_int(41, 40, 42)', 0n],
  ['range-below', 'in_range_int(39, 40, 42)', 1n],
  ['range-above', 'in_range_int(43, 40, 42)', 1n],
  ['range-inverted', 'in_range_int(41, 42, 40)', 1n],
  ['range-i64-min', 'in_range_int(-9223372036854775808, -9223372036854775808, 9223372036854775807)', 0n],
  ['range-i64-max', 'in_range_int(9223372036854775807, -9223372036854775808, 9223372036854775807)', 0n],
  ['combined-pass', 'combine_status(equal_int(42, 42), less_than_int(41, 42))', 0n],
  ['combined-fail', 'combine_status(equal_int(42, 42), greater_than_int(42, 42))', 1n],
  ['combined-two-fails', 'combine_status(equal_int(42, 41), less_than_int(42, 41))', 1n],
];

for (const [name, expression, expected] of vectors) {
  test('JS-compiled backend-local .atto testing scalar: ' + name, async () => {
    const source = library + '\npub fnc main(): int { return ' + expression + '; }\n';
    const generated = compileProgramV2(source);
    assert.ok(typeof generated === 'string' && generated.length > 0, 'compiler must emit real JS');
    const guest = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(generated));
    assert.equal(guest.main(), expected, name);
  });
}

test('JS-compiled local test helper preserves explicit 0/1 and signed-i64 BigInt', async () => {
  const source = library + '\npub fnc main(): int { return in_range_int(41, 40, 42); }\n';
  const guest = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(compileProgramV2(source)));
  assert.equal(guest.main(), 0n);
  assert.equal(guest.greater_than_int(42n, 42n), 1n);
  assert.equal(guest.less_than_int(41n, 42n), 0n);
  assert.equal(guest.in_range_int(43n, 40n, 42n), 1n);
});
