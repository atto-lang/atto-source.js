import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=source=>parseStrictJsonReport(source,4096,'fractional-boundary');

test('exact decimal integers with trailing zeroes or exponents retain their value',()=>{
  for(const source of ['1.0000','10.000e-1','1.2e1','-5.0',
                       '9007199254740991.0','0.125','5e-324']) {
    assert.deepEqual(parse(source),JSON.parse(source),source);
  }
});

test('rounded fractional integers fail before full JSON object materialization',()=>{
  const unsafe=['1.0000000000000001','2.0000000000000001',
                '-1.0000000000000001','9007199254740991.1'];
  const original=JSON.parse;
  let calls=0;
  try {
    JSON.parse=(...args)=>{calls++;return original(...args);};
    for(const source of unsafe)
      assert.throws(()=>parse(source),/lossy fractional JSON integer/,source);
    assert.equal(calls,0,'unsafe numeric tokens must fail before materialization');
  } finally {
    JSON.parse=original;
  }
});

test('representable fractional values are not falsely rejected as rounded integers',()=>{
  for(const source of ['1.0000000000000001e1','-2.5e-10','0.125','5e-324'])
    assert.deepEqual(parse(source),JSON.parse(source),source);
});
