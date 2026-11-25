import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse = raw => parseStrictJsonReport(raw, Buffer.byteLength(raw, 'utf8'), 'parity input');

test('only JSON whitespace separates values and members', () => {
  assert.deepEqual(parse(' \r\n\t{"ready": true, "items": [1, 2]}\t '), {ready: true, items: [1, 2]});
  for (const bad of ['\v0', '\ufeff0', '[1,\u20282]'])
    assert.throws(() => parse(bad), /invalid JSON report/);
});

test('prototype magic names and escaped aliases are never admitted as JSON authority', () => {
  for (const key of ['__proto__', 'constructor', 'prototype'])
    assert.throws(() => parse(JSON.stringify({[key]: 1})), /unsafe JSON member/);
  assert.throws(() => parse('{"\\u005f\\u005fproto__":1}'), /unsafe JSON member/);
  assert.throws(() => parse('{"key":1,"\\u006bey":2}'), /duplicate JSON member/);
});

test('failed untrusted input cannot poison independent successful parses', () => {
  assert.throws(() => parse('{"x":1,"x":2}'), /duplicate JSON member/);
  assert.deepEqual(parse('{"x":2,"y":null}'), {x:2, y:null});
  assert.throws(() => parse('[-0]'), /noncanonical negative-zero/);
  assert.deepEqual(parse('[0,1]'), [0,1]);
});
