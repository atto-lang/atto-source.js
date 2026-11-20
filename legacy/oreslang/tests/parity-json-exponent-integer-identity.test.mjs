import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

// Host-only strict JSON parser regression; not compiled AttoLang guest evidence.
const parse=source=>parseStrictJsonReport(source,262144,'JS');

test('exact integer exponent spellings and genuinely fractional data survive admission',()=>{
  for(const source of [
    '1e3','1.5e1','1.25e2','0.0e999',
    '9007199254740991.0','9.007199254740991e15',
    '{"count":15e0,"fraction":0.125}',
    '["1.0000000000000001",3]'
  ])assert.deepEqual(parse(source),JSON.parse(source),source);
});

test('fractional spellings that round to safe integers fail closed',()=>{
  for(const source of [
    '1.0000000000000001','2.0000000000000001',
    '0.99999999999999999','9007199254740990.9',
    '-0.99999999999999999',
    '{"run_id":1.0000000000000001}',
    '[0.99999999999999999,1]'
  ])assert.throws(()=>parse(source),/lossy fractional JSON integer/,source);
});

test('signed zero, overflow, underflow and nonfinite values remain distinct',()=>{
  for(const [source,diagnostic] of [
    ['-0.0e999',/negative-zero/],
    ['1e-324',/underflow/],
    ['1e999',/non-finite/],
    ['9007199254740992',/unsafe JSON integer precision/]
  ])assert.throws(()=>parse(source),diagnostic,source);
});
