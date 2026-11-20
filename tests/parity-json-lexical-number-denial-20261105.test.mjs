import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,Buffer.byteLength(text,'utf8'),'receipt');
test('exact integral decimal exponents preserve admitted numeric value',()=>{
  assert.deepEqual(parse('{"x":1.200e2,"y":-2.0}'),{x:120,y:-2});
});
test('rounded, underflowing and nonfinite numeric receipts are refused',()=>{
  for(const text of ['{"n":1.0000000000000001}','{"n":-0e10}',
    '{"n":1e-9999}','{"n":1e9999}'])
    assert.throws(()=>parse(text),/JSON/);
});
test('nested escaped-name aliases and prototype keys cannot enter a receipt',()=>{
  for(const text of ['{"outer":{"a":1,"\\u0061":2}}',
    '{"outer":{"constructor":1}}','{"outer":{"__proto__":{}}}'])
    assert.throws(()=>parse(text),/JSON/);
});
test('valid astral Unicode admits, lone surrogate is rejected',()=>{
  assert.deepEqual(parse('{"label":"\\ud83d\\ude80"}'),{label:'🚀'});
  assert.throws(()=>parse('{"label":"\\ud83d"}'),/surrogate/);
});