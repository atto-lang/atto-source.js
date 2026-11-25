import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, check, CompileError} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const wrapping = 'pub fnc main(): int { return 9223372036854775807 + 1; }';
const checked = '// oreslang:checked-i64-v1\n' + wrapping;

test('scalar-v1 refuses explicit checked-i64 profile rather than silently wrapping', () => {
  for (const source of [
    checked,
    ' //oreslang:checked-i64-v1\r\n' + wrapping,
    '// oreslang:checked-i64-v2\n' + wrapping,
    wrapping + '\n// oreslang:checked-i64-v1',
    '// oreslang:checked-i64-v1\n// oreslang:checked-i64-v1\n' + wrapping,
    'pub fnc main(): int { return 9223372036854775807' +
      ' /* ignored nested comment */ + 1; } // oreslang:checked-i64-v1'
  ]) {
    for (const entry of [compileToIR, compile, check]) {
      assert.throws(() => entry(source), err =>
        err instanceof CompileError &&
        /checked-i64 source requires program-v2/.test(err.message),
        'fail closed on explicit numeric profile: ' + source);
    }
  }
});

test('scalar-v1 permits ordinary line/block comments without treating them as directives', async () => {
  for (const source of [
    '// explanatory comment\n' + wrapping,
    '/* // oreslang:checked-i64-v1 */\n' + wrapping,
    '// note: oreslang:checked-i64-v1 is not an active directive\n' + wrapping
  ]) {
    const mod = await import('data:text/javascript;charset=utf-8,' +
      encodeURIComponent(compile(source)));
    assert.equal(mod.main(), -(1n << 63n));
  }
});

test('program-v2 checked mode traps while legacy unmarked scalar-v1 still wraps', async () => {
  const checkedModule = await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(compileProgramV2(checked)));
  assert.throws(() => checkedModule.main(), err =>
    err instanceof RangeError && err.message.startsWith('ORES_I64_OVERFLOW:'));
  const scalarModule = await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(compile(wrapping)));
  assert.equal(scalarModule.main(), -(1n << 63n));
});
