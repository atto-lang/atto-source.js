import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=(text,maximum=16384)=>parseStrictJsonReport(text,maximum,'js');
const escapedA=String.fromCharCode(92)+'u0061';

test('nested escaped aliases cannot create duplicate semantic receipt keys',()=>{
  const cases=[
    '{"outer":[{"a":1,"'+escapedA+'":2}]}',
    '[{"a":1,"b":2},{"'+escapedA+'":1,"a":2}]'
  ];
  for(const text of cases)
    assert.throws(()=>parse(text),/duplicate JSON member/);
});

test('escaped name is legal in a different object and distinct escaped names remain distinct',()=>{
  const text='{"outer":[{"a":1,"b":2},{"'+escapedA+'":3}]}';
  assert.deepEqual(parse(text),{outer:[{a:1,b:2},{a:3}]});
});

test('UTF-8 multibyte report has exact admitted byte ceiling, not UTF-16 length',()=>{
  const text='{"text":"☃️"}';
  const exact=Buffer.byteLength(text,'utf8');
  assert.ok(exact>text.length);
  assert.equal(parse(text,exact).text,'☃️');
  assert.throws(()=>parse(text,exact-1),/missing or oversized JSON report/);
});
