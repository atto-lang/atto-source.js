import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=s=>parseStrictJsonReport(s,Buffer.byteLength(s,'utf8'),'alias-test');
test('escaped aliases are still duplicate JSON members',()=>{
 assert.throws(()=>parse('{"a":1,"\\u0061":2}'),/duplicate JSON member/);
});
test('escaped prototype-magic aliases fail before materialization',()=>{
 assert.throws(()=>parse('{"\\u005f\\u005fproto\\u005f\\u005f":1}'),/unsafe JSON member/);
});
test('underflow and signed-zero numeric forms are not receipts',()=>{
 assert.throws(()=>parse('1e-999'),/underflow JSON number/);
 assert.throws(()=>parse('-0'),/noncanonical negative-zero JSON number/);
});
test('ordinary astral JSON remains valid within exact UTF-8 byte bound',()=>{
 const report=parse('{"safe":1,"astral":"🚀"}');
 assert.equal(report.safe,1);
 assert.equal(report.astral,'🚀');
});
