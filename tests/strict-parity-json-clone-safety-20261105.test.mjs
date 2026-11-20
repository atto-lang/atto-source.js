import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=s=>parseStrictJsonReport(s,65536,'source parity');
test('fresh parsed receipts never alias previously returned objects',()=>{
  const text='{"outer":{"count":3},"values":[1,2,3]}';
  const first=parse(text),second=parse(text);
  assert.deepEqual(first,second);
  first.outer.count=9;first.values.push(4);
  assert.equal(second.outer.count,3);
  assert.deepEqual(second.values,[1,2,3]);
});
test('escaped duplicate member aliases are rejected before materialization',()=>{
  assert.throws(()=>parse(String.raw`{"name":1,"\u006eame":2}`),/duplicate JSON member/);
  assert.deepEqual(parse('{"a":1,"b":2}'),{a:1,b:2});
});
test('prototype pollution keys are forbidden at every nesting level',()=>{
  assert.throws(()=>parse('{"safe":{"constructor":1}}'),/unsafe JSON member/);
  assert.throws(()=>parse('{"nested":[{"prototype":true}]}'),/unsafe JSON member/);
  assert.equal(Object.prototype.polluted,undefined);
});
test('UTF-8 byte budget is inclusive and malformed/surrogate text is denied',()=>{
  const raw='{"greeting":"🚀"}';
  const length=Buffer.byteLength(raw,'utf8');
  assert.equal(parseStrictJsonReport(raw,length,'source parity').greeting,'🚀');
  assert.throws(()=>parseStrictJsonReport(raw,length-1,'source parity'),/oversized JSON report/);
  assert.throws(()=>parse(String.raw`{"bad":"\ud800"}`),/invalid JSON Unicode surrogate/);
});
