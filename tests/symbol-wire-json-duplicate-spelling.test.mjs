// Host wire-admission tests; not compiled Symbol parity evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbolWireJsonV1, SymbolWireV1Error} from '../src/symbol-wire-v1.mjs';

test('duplicate names are detected after JSON escape decoding, independent of spelling', () => {
  const invalid = [
    '{"$symbol":"process","name":"ready","\\u006eame":"error"}',
    '{"$symbol":"process","\\u0024symbol":"stable","name":"ready"}',
    '{"name":"ready","$symbol":"process","name":"error"}'
  ];
  for (const source of invalid) {
    assert.throws(() => parseSymbolWireJsonV1(source),
      error => error instanceof SymbolWireV1Error && /duplicate JSON member/.test(error.message));
  }
});

test('escaped value spelling is decoded before Symbol identity validation', () => {
  const result = parseSymbolWireJsonV1('{"name":"re\\u0061dy","$symbol":"process"}');
  assert.equal(result.$symbol, 'process');
  assert.equal(result.name, 'ready');
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => parseSymbolWireJsonV1('{"$symbol":"process","name":"e\\u0301"}'),
    /already be NFC/);
});

test('trailing content, malformed value shape, and over-budget UTF-8 input fail closed', () => {
  for (const input of [
    '{"$symbol":"process","name":"ready"} {}',
    '{"$symbol":"process","name":null}',
    '{"$symbol":"process","name":"ready",}',
    ' '.repeat(2049) + '{"$symbol":"process","name":"ready"}'
  ]) assert.throws(() => parseSymbolWireJsonV1(input), SymbolWireV1Error);
});
