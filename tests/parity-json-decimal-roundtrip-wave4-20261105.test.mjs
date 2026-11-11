import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';
const read = text => parseStrictJsonReport(text, Buffer.byteLength(text, 'utf8'), 'receipt');

test('admit exact safe decimal numbers without mutating their interpretation', () => {
  assert.deepEqual(read('{"integer":9007199254740991,"scaled":100e-2,"fraction":1.25}'),
    {integer:9007199254740991,scaled:1,fraction:1.25});
  assert.equal(read('0e-9999'), 0);
});

test('reject fractional token rounded to a trusted integer', () => {
  for (const token of ['1.0000000000000001','2.0000000000000001','1e-324']) {
    assert.throws(() => read(token), /lossy fractional JSON integer|underflow JSON number/, token);
  }
  assert.throws(() => read('9007199254740992'), /unsafe JSON integer precision/);
});

test('reject negative zero, underflow and nonfinite numeric magnitude', () => {
  for (const token of ['-0','-0.0','-1e-9999'])
    assert.throws(() => read(token), /noncanonical negative-zero JSON number/, token);
  assert.throws(() => read('1e309'), /non-finite JSON number/);
});

test('byte cap is inclusive for multibyte Unicode but one byte shorter denies it', () => {
  const input='{"emoji":"🚀"}';
  const length=Buffer.byteLength(input,'utf8');
  assert.deepEqual(parseStrictJsonReport(input,length,'receipt'),{emoji:'🚀'});
  assert.throws(() => parseStrictJsonReport(input,length-1,'receipt'),/missing or oversized JSON report/);
});
