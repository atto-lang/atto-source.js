import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,262144,'Java');

test('accepts pretty reports, escaped strings, arrays and distinct nested keys',()=>{
  const source=' {"backend":"graal", "results":[ {"id":"a\\\"b", "observed_exit":42}, {"id":"a\\\"b", "observed_exit":43} ], "meta":{"id":"independent"}} ';
  assert.deepEqual(parse(source),JSON.parse(source));
});

test('rejects duplicate names anywhere, including escaped key aliases',()=>{
  for(const source of [
    '{"backend":"js","backend":"graal"}',
    '{"backend":"js","\\u0062ackend":"graal"}',
    '{"results":[{"id":"one","id":"two"}]}',
    '{"results":[{"meta":{"x":1,"x":2}}]}',
    '{"results":[{"meta":{"a\\u0022b":1,"a\\\"b":2}}]}',
    '{"results":[{"meta":{"\\uD83D\\uDE00":1,"😀":2}}]}'
  ])assert.throws(()=>parse(source),/duplicate JSON member/,source);
});

test('preserves size, invalid JSON, and depth/complexity budgets',()=>{
  assert.throws(()=>parseStrictJsonReport(3,10,'JS'),/missing or oversized/);
  assert.throws(()=>parseStrictJsonReport(' '.repeat(10),9,'JS'),/missing or oversized/);
  for(const source of ['{"a":}', '{"a":1,}', '[1,]','{'])
    assert.throws(()=>parse(source),/invalid JSON report/);
  assert.throws(()=>parse('['.repeat(65)+'0'+']'.repeat(65)),/depth or complexity exceeded/);
  const many='['+Array.from({length:20001},()=> '0').join(',')+']';
  assert.throws(()=>parse(many),/depth or complexity exceeded/);
});
