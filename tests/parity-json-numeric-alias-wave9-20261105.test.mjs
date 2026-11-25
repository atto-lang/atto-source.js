import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse = raw => parseStrictJsonReport(raw, Buffer.byteLength(raw, 'utf8'), 'untrusted parity');

test('numerically integral decimal and exponent forms keep exact integer identity', () => {
  assert.equal(parse('1.000'), 1);
  assert.equal(parse('1e0'), 1);
  assert.equal(parse('100e-2'), 1);
  assert.equal(parse('1.25e0'), 1.25);
});

test('a fractional spelling that rounds to an integer is rejected', () => {
  assert.throws(() => parse('1.0000000000000001'), /lossy fractional JSON integer/);
});

test('nested duplicate keys using escaped Unicode aliases are rejected', () => {
  assert.throws(() => parse('{"outer":{"k":1,"\\u006b":2}}'), /duplicate JSON member/);
});

test('exponentially scaled negative zero cannot enter a receipt', () => {
  assert.throws(() => parse('-0e-30'), /noncanonical negative-zero JSON number/);
});

test('escaped unpaired surrogate fails while the paired rocket survives', () => {
  assert.throws(() => parse('"\\ud800"'), /invalid JSON Unicode surrogate/);
  assert.equal(parse('"\\ud83d\\ude80"'), '🚀');
});
