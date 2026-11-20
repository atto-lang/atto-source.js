import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=s=>parseStrictJsonReport(s,Buffer.byteLength(s,'utf8'),'receipt');
test('independent records may reuse a key but escaped aliases within one object may not',()=>{
  assert.deepEqual(parse('[{"k":1},{"k":2}]'),[{k:1},{k:2}]);
  assert.throws(()=>parse('{"k":1,"\\u006b":2}'),/duplicate JSON member/);
});
test('noncanonical decimal forms and unsafe integer precision are refused',()=>{
  for(const raw of ['01','+1','1.','1e','9007199254740992','1.0000000000000001'])
    assert.throws(()=>parse('{"n":'+raw+'}'),/JSON/);
});
test('trailing roots and illegal delimiters fail closed',()=>{
  for(const raw of ['true false','[1,]','{"a":1,}','[1,,2]','{"a":1}{}'])
    assert.throws(()=>parse(raw),/JSON/);
});
test('UTF-8 limit rejects multibyte payload one byte below exact threshold',()=>{
  const raw='{"emoji":"🚀"}'; const size=Buffer.byteLength(raw,'utf8');
  assert.deepEqual(parseStrictJsonReport(raw,size,'receipt'),{emoji:'🚀'});
  assert.throws(()=>parseStrictJsonReport(raw,size-1,'receipt'),/oversized JSON report/);
});