import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

test('eq/neq normalize to existing checked typed comparison IR',async()=>{
  const source=[
    'pub fnc same(int a,int b):bool{return a eq b;}',
    'pub fnc different(int a,int b):bool{return a neq b;}',
    'pub fnc precedence(int a):bool{return a+2*3 eq 7;}',
    'pub fnc symbolic():bool{return #ready eq #ready and #ready neq #error;}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.functions[0].body.op,'==');
  assert.equal(ir.functions[1].body.op,'!=');
  assert.equal(ir.functions[3].body.kind,'if');
  assert.equal(ir.functions[3].body.condition.kind,'symbolCompare');
  assert.equal(ir.functions[3].body.condition.op,'==');
  assert.equal(ir.functions[3].body.yes.op,'!=');
  const round=JSON.parse(JSON.stringify(ir));
  assert.deepEqual(validateProgramIRV2(round),ir);
  assert.equal(compileProgramIRV2(round),compileProgramV2(source));
  const m=await load(source);
  assert.equal(m.same(3n,3n),true);
  assert.equal(m.same(3n,4n),false);
  assert.equal(m.different(3n,4n),true);
  assert.equal(m.different(3n,3n),false);
  assert.equal(m.precedence(1n),true);
  assert.equal(m.symbolic(),true);
  assert.throws(()=>m.same(1,true),/BigInt/);
});

test('not/and/or are strict bool operators, with precedence below comparisons',async()=>{
  const src=[
    'pub fnc decision(bool a,bool b,bool c):bool{return a or b and not c;}',
    'pub fnc swapped(bool a,bool b):bool{return not (a and b);}',
    'pub fnc grouped(bool a,bool b,bool c):bool{return (a or b) and c;}',
    'pub fnc ternary(bool a,bool b):int{return a or b ? 42 : 0;}'
  ].join('\n');
  const m=await load(src);
  assert.equal(m.decision(true,false,true),true);
  assert.equal(m.decision(false,true,false),true);
  assert.equal(m.decision(false,true,true),false);
  assert.equal(m.swapped(true,true),false);
  assert.equal(m.swapped(true,false),true);
  assert.equal(m.grouped(true,false,false),false);
  assert.equal(m.grouped(false,true,true),true);
  assert.equal(m.ternary(false,true),42n);
  assert.equal(m.ternary(false,false),0n);
  assert.throws(()=>m.decision(1n,true,false),/bool required/);
});

test('boolean operators short-circuit checked-i64 traps in unselected arms',async()=>{
  const m=await load([
    'pub fnc cheap_and(bool b):bool{return b and (1 % 0 eq 0);}',
    'pub fnc cheap_or(bool b):bool{return b or (9223372036854775807+1 eq 0);}',
    'pub fnc literal_and():bool{return false and (1 % 0 eq 0);}',
    'pub fnc literal_or():bool{return true or (1 % 0 eq 0);}'
  ].join('\n'));
  assert.equal(m.cheap_and(false),false);
  assert.equal(m.cheap_or(true),true);
  assert.equal(m.literal_and(),false);
  assert.equal(m.literal_or(),true);
  assert.throws(()=>m.cheap_and(true),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>m.cheap_or(false),/ORES_I64_OVERFLOW/);
});

test('freestanding core and fieldless methods preserve word-operator semantics',async()=>{
  const esm=compileFreestandingCore([
    'define module core as',
    ' pub fnc permitted(bool enabled,int value):bool{return enabled and value eq 42;}',
    'end'
  ].join('\n'));
  assert.doesNotMatch(esm,/^\s*import\b/m);
  const core=await import('data:text/javascript,'+encodeURIComponent(esm));
  assert.equal(core.core.permitted(true,42n),true);
  assert.equal(core.core.permitted(false,42n),false);
  const mod=await load([
    'pub define class Gate as',
    ' pub allowed(self,bool a,bool b):bool{return a and not b;}',
    'end',
    'pub fnc call():bool{return new Gate().allowed(true,false);}'
  ].join('\n'));
  assert.equal(mod.call(),true);
  assert.equal(new mod.Gate().allowed(false,false),false);
});

test('non-bool source and forged noncanonical comparator IR fail closed',()=>{
  const invalid=[
    'pub fnc bad(int a,int b):bool{return a ne b;}', // obsolete spelling must not be accepted
    'pub fnc bad():bool{return 1 and true;}',
    'pub fnc bad():bool{return true and 1;}',
    'pub fnc bad():bool{return 1 or false;}',
    'pub fnc bad():bool{return false or 1;}',
    'pub fnc bad():bool{return not 1;}',
    'pub fnc bad():int{return true and false;}',
    'pub fnc bad():bool{return true and ;}'
  ];
  for(const src of invalid)
    assert.throws(()=>compileProgramV2(src),/error: program v2:|error: program IR:/,src);
  const ir=compileToProgramIRV2('pub fnc eq_test(int a,int b):bool{return a eq b;}');
  ir.functions[0].body.op='eq';
  assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
});
