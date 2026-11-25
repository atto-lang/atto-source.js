import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMERIC_PROBES,CHECKED_I64_SOURCE_DIRECTIVE,numericProbeGuestSource}
 from '../src/js-numeric-boundary-v1.mjs';

test('all sixteen numeric witnesses have distinct IDs and executable source identities',()=>{
 assert.equal(NUMERIC_PROBES.length,16);
 assert.equal(new Set(NUMERIC_PROBES.map(p=>p.id)).size,16);
 assert.equal(CHECKED_I64_SOURCE_DIRECTIVE,'// oreslang:checked-i64-v1\n');
 for(const probe of NUMERIC_PROBES){
  const source=numericProbeGuestSource(probe.expression);
  assert.equal(source,CHECKED_I64_SOURCE_DIRECTIVE+
   'pub fnc main(): int {return '+probe.expression+';}\n');
  assert.equal(source.indexOf('pub fnc main'),CHECKED_I64_SOURCE_DIRECTIVE.length);
  assert.ok(Object.isFrozen(probe));
 }
});

test('caller cannot forge arbitrary expression, alternate whitespace or source-body injection',()=>{
 const valid=NUMERIC_PROBES[0].expression;
 for(const forged of [null,7,{},valid+' ',valid+'\n',valid+';',valid+'; } pub fnc exploit(): int { return 1;', '0', '1+2']){
  assert.throws(()=>numericProbeGuestSource(forged),
    /unlisted checked-i64 numeric witness expression/);
 }
 assert.ok(numericProbeGuestSource(valid).startsWith(CHECKED_I64_SOURCE_DIRECTIVE));
});

test('overflow, division-by-zero and positive controls remain distinct and non-certified',()=>{
 const kinds=NUMERIC_PROBES.reduce((acc,p)=>(acc[p.expected_kind]=(acc[p.expected_kind]||0)+1,acc),{});
 assert.deepEqual(kinds,{'value':8,'checked-overflow':7,'division-by-zero':1});
 const overflow=NUMERIC_PROBES.find(p=>p.id==='intermediate-add-overflow');
 assert.equal(overflow.expected_kind,'checked-overflow');
 assert.equal(overflow.expected_value,null);
 const zero=NUMERIC_PROBES.find(p=>p.id==='modulo-by-zero');
 assert.equal(zero.expected_kind,'division-by-zero');
 assert.ok(numericProbeGuestSource(zero.expression).includes('return Integer.rem(1, 0);'));
});
