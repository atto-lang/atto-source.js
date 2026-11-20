import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbolWireJsonV1, stringifySymbolWireV1, validateSymbolWireV1,
  SymbolWireV1Error} from '../src/symbol-wire-v1.mjs';

test('escaped JSON authority aliases are recognized before duplicate detection', () => {
  const valid = parseSymbolWireJsonV1(String.raw`{"$symbol":"process","\u006eame":"ready"}`);
  assert.deepEqual({...valid}, {'$symbol': 'process', name: 'ready'});
  for (const forged of [
    String.raw`{"$symbol":"process","\u0024symbol":"stable","name":"ready"}`,
    String.raw`{"$symbol":"process","name":"ready","\u006eame":"error"}`,
    String.raw`{"\u0024symbol":"process","$symbol":"stable","name":"ready"}`,
    String.raw`{"$symbol":"process","name":"ready","n\u0061me":"error"}`
  ]) assert.throws(() => parseSymbolWireJsonV1(forged), /duplicate JSON member/, forged);
});

test('Unicode normalization and UTF-8 byte budget are applied after JSON unescaping', () => {
  const canonical = 'é'.repeat(128);
  assert.equal(new TextEncoder().encode(canonical).length, 256);
  const admitted = parseSymbolWireJsonV1(stringifySymbolWireV1({'$symbol':'process', name:canonical}));
  assert.equal(admitted.name, canonical);
  for (const bad of [
    {'$symbol':'process', name: 'é'.repeat(129)},
    {'$symbol':'process', name: 'cafe\u0301'},
    {'$symbol':'process', name: '\ud800'}
  ]) assert.throws(() => validateSymbolWireV1(bad), SymbolWireV1Error);
  assert.throws(() => parseSymbolWireJsonV1(
    String.raw`{"$symbol":"process","name":"cafe\u0301"}`
  ), /NFC/);
});

test('decoded wire values remain frozen null-prototype records, never original objects', () => {
  const source = {'$symbol':'process', name:'ready'};
  const decoded = validateSymbolWireV1(source, {policy:'untrusted-core'});
  source.name='untrusted';
  assert.equal(decoded.name, 'ready');
  assert.equal(Object.getPrototypeOf(decoded), null);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.hasOwn(decoded, 'name'), true);
});
