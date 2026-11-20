import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,16384,'untrusted parity report');

test('escaped aliases cannot bypass nested duplicate-key detection',()=>{
  assert.throws(()=>parse(String.raw`{"name":1,"\u006eame":2}`),/duplicate JSON member/);
  assert.throws(()=>parse(String.raw`{"outer":{"caf\u00e9":1,"café":2}}`),/duplicate JSON member/);
});

test('escaped prototype keys and lone UTF-16 surrogate code units are denied',()=>{
  assert.throws(()=>parse(String.raw`{"\u005f\u005fproto__":1}`),/unsafe JSON member/);
  assert.throws(()=>parse(String.raw`{"value":"\uD800"}`),/invalid JSON Unicode surrogate/);
  assert.throws(()=>parse(String.raw`{"value":"\uDE80"}`),/invalid JSON Unicode surrogate/);
});

test('canonical surrogate pair survives byte identity without lossy replacement',()=>{
  const value=parse(String.raw`{"value":"\uD83D\uDE80"}`);
  assert.deepEqual(value,{value:'🚀'});
  assert.deepEqual(parse('{"value":"café"}'),{value:'café'});
});
