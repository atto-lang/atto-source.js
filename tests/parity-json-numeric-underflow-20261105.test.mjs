import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,16384,'untrusted numeric evidence');

test('fractional integers rounded by IEEE-754 cannot impersonate exact receipts',()=>{
  for(const value of ['1.0000000000000001','-1.0000000000000001'])
    assert.throws(()=>parse(value),/lossy fractional JSON integer/,value);
  assert.equal(parse('1.0000000000000000'),1);
  assert.equal(parse('1e3'),1000);
  assert.equal(parse('1e-3'),0.001);
});

test('negative zero, exponent underflow and overflow are noncanonical',()=>{
  assert.throws(()=>parse('-0e-999'),/noncanonical negative-zero JSON number/);
  assert.throws(()=>parse('1e-9999'),/underflow JSON number/);
  assert.throws(()=>parse('1e9999'),/non-finite JSON number/);
  assert.equal(parse('0e-9999'),0);
});

test('UTF-8 report limits count bytes, not JS UTF-16 code units',()=>{
  const report='{"value":"🚀"}';
  const exact=Buffer.byteLength(report,'utf8');
  assert.deepEqual(parseStrictJsonReport(report,exact,'report'),{value:'🚀'});
  assert.throws(()=>parseStrictJsonReport(report,exact-1,'report'),/missing or oversized JSON report/);
});
