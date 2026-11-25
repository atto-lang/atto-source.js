import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=s=>parseStrictJsonReport(s,65536,'strict-string');
// Host-only JSON receipt admission, never authenticated execution evidence.
test('invalid escapes, raw controls and unterminated quotes fail closed',()=>{
 for(const s of [
  '{"key":"\\x41"}','{"key":"\\u12G4"}',
  '{"key":"unterminated}','{"key":"a\tb"}',
  '{"key":"\\uD800"}','{"key":"\\uDC00"}',
  '{"key":"\\uD83E\\u0041"}'
 ])assert.throws(()=>parse(s),/invalid JSON|invalid JSON Unicode surrogate/,s);
});
test('paired surrogate aliases and literal Unicode preserve identity',()=>{
 for(const s of [
  '{"value":"\\uD83E\\uDDEA"}',
  '{"value":"🧪"}',
  '{"value":"a\\/b","zero":0}',
  '{"value":"\\u00e9","different":"e\\u0301"}'
 ])assert.deepEqual(parse(s),JSON.parse(s),s);
});
test('decoded Unicode aliases cannot duplicate JSON object keys',()=>{
 for(const s of [
  '{"é":1,"\\u00e9":2}',
  '{"🧪":1,"\\uD83E\\uDDEA":2}',
  '{"name":1,"na\\u006de":2}'
 ])assert.throws(()=>parse(s),/duplicate JSON member/,s);
});
