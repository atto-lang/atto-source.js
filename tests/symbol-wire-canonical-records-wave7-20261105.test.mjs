import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSymbolWireV1, symbolWireEqualV1,
  stringifySymbolWireV1, parseSymbolWireJsonV1
} from '../src/symbol-wire-v1.mjs';

test('canonical process records are immutable own-data copies', () => {
  const source = {$symbol:'process', name:'ready'};
  const copy = validateSymbolWireV1(source, {policy:'untrusted-core'});
  assert.equal(Object.getPrototypeOf(copy), null);
  assert.ok(Object.isFrozen(copy));
  source.name = 'error';
  assert.equal(copy.name, 'ready');
  assert.equal(stringifySymbolWireV1(copy), '{"$symbol":"process","name":"ready"}');
  assert.ok(symbolWireEqualV1(copy, {$symbol:'process',name:'ready'}));
  assert.equal(symbolWireEqualV1(copy, {$symbol:'process',name:'error'}), false);
});

test('NFC aliases, bidi formatting, unpaired surrogates and uppercase stable IDs are denied', () => {
  for (const name of ['e\u0301', '\u202e', '\ud800', 'a'.repeat(257)]) {
    assert.throws(() => validateSymbolWireV1({$symbol:'process',name}));
  }
  assert.throws(() => validateSymbolWireV1({
    $symbol:'stable', name:'12345678-1234-1234-1234-ABCDEF123456'
  }));
  assert.equal(validateSymbolWireV1({
    $symbol:'stable', name:'12345678-1234-1234-1234-abcdef123456'
  }).$symbol, 'stable');
});

test('JSON escaped duplicate member aliases and trailing content are denied', () => {
  assert.throws(() => parseSymbolWireJsonV1('{"$symbol":"process","name":"ready","\\u006eame":"error"}'));
  assert.throws(() => parseSymbolWireJsonV1('{"$symbol":"process","name":"ready"} true'));
  assert.equal(parseSymbolWireJsonV1(' {"$symbol":"process","name":"ready"} ').name, 'ready');
});

test('accessors are rejected without executing caller code', () => {
  let read = 0;
  const value = {$symbol:'process'};
  Object.defineProperty(value, 'name', {enumerable:true, get() {read++; return 'ready';}});
  assert.throws(() => validateSymbolWireV1(value));
  assert.equal(read, 0);
  const options = {};
  Object.defineProperty(options, 'policy', {enumerable:true, get() {read++; return 'trusted';}});
  assert.throws(() => validateSymbolWireV1({$symbol:'process',name:'ready'}, options));
  assert.equal(read, 0);
});