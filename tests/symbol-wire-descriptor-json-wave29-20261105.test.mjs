import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSymbolWireJsonV1,
  validateSymbolWireV1,
  stringifySymbolWireV1,
  symbolWireEqualV1,
} from '../src/symbol-wire-v1.mjs';

// Host-boundary regressions only: not generated AttoLang guest execution.
test('escaped JSON member aliases cannot evade duplicate-key admission', () => {
  const duplicate = '{"$symbol":"process","na\\u006de":"ready","name":"error"}';
  assert.throws(() => parseSymbolWireJsonV1(duplicate), /duplicate JSON member name/);
  assert.throws(
    () => parseSymbolWireJsonV1('{"$symbol":"process","name":"ready"} trailing'),
    /trailing JSON data/,
  );
});

test('descriptor snapshot refuses accessors without evaluating a caller getter', () => {
  let calls = 0;
  const input = Object.create(null);
  Object.defineProperties(input, {
    '$symbol': {value: 'process', enumerable: true},
    name: {get() { calls++; return 'ready'; }, enumerable: true},
  });
  assert.throws(() => validateSymbolWireV1(input), /accessor/);
  assert.equal(calls, 0);
});

test('canonical policy retains immutable data identity and restricts untrusted names', () => {
  const wire = parseSymbolWireJsonV1('{"$symbol":"process","name":"ready"}', {
    policy: 'untrusted-core',
  });
  assert.equal(Object.getPrototypeOf(wire), null);
  assert.ok(Object.isFrozen(wire));
  assert.equal(stringifySymbolWireV1(wire), '{"$symbol":"process","name":"ready"}');
  assert.equal(symbolWireEqualV1(wire, {$symbol: 'process', name: 'ready'}), true);
  assert.throws(
    () => validateSymbolWireV1({$symbol: 'process', name: 'other'}, {policy: 'untrusted-core'}),
    /denied by untrusted-core policy/,
  );
  assert.throws(
    () => validateSymbolWireV1({$symbol: 'stable', name: '00000000-0000-0000-0000-000000000001'}, {policy: 'untrusted-core'}),
    /denied by untrusted-core policy/,
  );
});
