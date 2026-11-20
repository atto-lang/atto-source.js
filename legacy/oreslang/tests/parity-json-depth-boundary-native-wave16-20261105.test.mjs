import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=s=>parseStrictJsonReport(s,Buffer.byteLength(s,'utf8'),'receipt');
test('depth 64 leaf is admitted and depth 65 leaf is denied',()=>{
  const nested=n=>'['.repeat(n)+'0'+']'.repeat(n);
  let value=parse(nested(64));
  for(let i=0;i<64;i++){assert.equal(value.length,1);value=value[0];}
  assert.equal(value,0);
  assert.throws(()=>parse(nested(65)),/depth or complexity exceeded/);
});
test('node budget is exact at 20,000 including the root',()=>{
  const text=n=>'['+Array(n).fill('0').join(',')+']';
  assert.equal(parse(text(19999)).length,19999);
  assert.throws(()=>parse(text(20000)),/depth or complexity exceeded/);
});
test('escaping an existing key remains duplicate within its own scope',()=>{
  assert.deepEqual(parse('[{"k":1},{"\\u006b":2}]'),[{k:1},{k:2}]);
  assert.throws(()=>parse('[{"k":1,"\\u006b":2}]'),/duplicate JSON member/);
});
test('CR LF TAB are admitted as JSON whitespace but BOM and NEL are not',()=>{
  assert.deepEqual(parse('\r\n\t{"x":1}\t'),{x:1});
  for(const prefix of ['\ufeff','\u0085'])assert.throws(()=>parse(prefix+'{"x":1}'),/JSON/);
});