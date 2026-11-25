import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse = source => parseStrictJsonReport(source, 262144, 'parity');

test('raw C0 controls cannot hide in JSON labels or receipt keys',()=>{
  for(const point of [0,1,9,10,13,31]){
    const ch=String.fromCharCode(point);
    for(const source of [
      '{"label":"before'+ch+'after"}',
      '{"key'+ch+'name":true}',
      '["before'+ch+'after"]'
    ])assert.throws(()=>parse(source),/invalid JSON report/,String(point));
  }
});

test('escaped controls are JSON strings; UTF-8 byte ceilings remain exact',()=>{
  for(const source of [
    '{"label":"line\\nsecond","backend":"wasm"}',
    '{"label":"nul\\u0000allowed","backend":"llvm"}',
    JSON.stringify({label:'日本語😀',backend:'java'})
  ])assert.deepEqual(parse(source),JSON.parse(source));
  const source=JSON.stringify('😀é'.repeat(8));
  const bytes=Buffer.byteLength(source,'utf8');
  assert.deepEqual(parseStrictJsonReport(source,bytes,'parity'),JSON.parse(source));
  assert.throws(()=>parseStrictJsonReport(source,bytes-1,'parity'),/missing or oversized/);
});
