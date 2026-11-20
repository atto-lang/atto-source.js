import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,16384,'JS');
const names=[
 ['__proto__',String.raw`\u005f\u005fproto\u005f\u005f`],
 ['constructor',String.raw`constr\u0075ctor`],
 ['prototype',String.raw`proto\u0074ype`]
];

test('escaped prototype-magic names are rejected in top-level, array, and nested receipts',()=>{
 for(const [raw,escaped] of names){
  for(const key of [raw,escaped]){
   for(const text of [
    '{"'+key+'":1}',
    '{"results":[{"'+key+'":{"ok":true}}]}',
    '{"meta":{"sub":[{"'+key+'":0}]}}'
   ])assert.throws(()=>parse(text),/unsafe JSON member/,text);
  }
 }
 assert.equal(({}).polluted,undefined);
});

test('non-magic near-neighbors, including escaped spellings, remain distinct data',()=>{
 for(const text of [
  '{"constructors":1,"prototype_id":"ok"}',
  '{"constr\\u0075ctors":2}',
  '{"meta":{"prototyper":true,"__proto__safe":1}}'
 ])assert.deepEqual(parse(text),JSON.parse(text),text);
});