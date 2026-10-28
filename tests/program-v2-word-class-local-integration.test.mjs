import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2}
  from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

test('lexical bool locals preserve and/or precedence and short-circuiting',async()=>{
  const source=[
    'pub fnc choose(bool a,bool b,bool c):bool{',
    ' const bool left=a or b and not c;',
    ' return left;',
    '}',
    'pub fnc group(bool a,bool b,bool c):bool{',
    ' const bool result=(a or b) and c;',
    ' return result;',
    '}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.functions[0].body.kind,'letLocal');
  assert.equal(ir.functions[0].body.value.kind,'if');
  assert.equal(ir.functions[0].body.value.no.kind,'if');
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(ir))),ir);
  assert.equal(compileProgramIRV2(ir),compileProgramV2(source));
  const mod=await load(source);
  assert.equal(mod.choose(true,false,true),true);
  assert.equal(mod.choose(false,true,false),true);
  assert.equal(mod.choose(false,true,true),false);
  assert.equal(mod.group(true,false,false),false);
  assert.equal(mod.group(false,true,true),true);
});

test('lexical const and word comparisons in class methods evaluate correctly',async()=>{
  const source=[
    'pub define class Calculator as',
    ' check(int n):bool{const int next=n+1;return next eq 42;}',
    ' pub approved(int n,bool gate):bool{',
    '  const int adjusted=n+1;',
    '  const bool yes=gate and self.check(n);',
    '  return yes or adjusted neq 42;',
    ' }',
    ' pub denied(int n):bool{',
    '  const bool keep=not (self.check(n) and false);',
    '  return keep;',
    ' }',
    'end'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes[0].methods[0].body.kind,'letLocal');
  assert.equal(ir.classes[0].methods[1].body.kind,'letLocal');
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(ir))),ir);
  const mod=await load(source);
  const calculator=new mod.Calculator();
  assert.equal(calculator.approved(41n,true),true);
  assert.equal(calculator.approved(41n,false),false);
  assert.equal(calculator.approved(40n,false),true);
  assert.equal(calculator.denied(41n),true);
  assert.equal(calculator.check,undefined);
});

test('boolean short circuit preserves lazy checked i64 failures in methods',async()=>{
  const source=[
    'pub define class Gate as',
    ' dangerous():bool{const int x=1%0;return x eq 0;}',
    ' pub allow(bool enabled):bool{const bool yes=enabled or self.dangerous();return yes;}',
    ' pub deny(bool enabled):bool{const bool no=enabled and self.dangerous();return no;}',
    ' pub overflow(bool enabled):bool{',
    '  const bool yes=enabled or (9223372036854775807+1 eq 0);',
    '  return yes;',
    ' }',
    'end'
  ].join('\n');
  const mod=await load(source);
  const gate=new mod.Gate();
  assert.equal(gate.allow(true),true);
  assert.equal(gate.deny(false),false);
  assert.equal(gate.overflow(true),true);
  assert.throws(()=>gate.allow(false),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>gate.deny(true),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>gate.overflow(false),/ORES_I64_OVERFLOW/);
});

test('named self calls from lexical arguments work under boolean operators',async()=>{
  const source=[
    'pub define class Choices as',
    ' choose(bool first,bool second):bool{return first or second;}',
    ' pub selected(bool input):bool{',
    '  const bool next=not input;',
    '  const bool result=self.choose(second:next,first:input);',
    '  return result and true;',
    ' }',
    'end'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes[0].methods[1].body.body.value.kind,'namedSelfCall');
  assert.deepEqual(ir.classes[0].methods[1].body.body.value.paramOrder,[1,0]);
  const mod=await load(source);
  assert.equal(new mod.Choices().selected(true),true);
  assert.equal(new mod.Choices().selected(false),true);
});

test('Symbol word equality preserves canonical comparison and nominal typing',async()=>{
  const source=[
    'pub define class Marker as',
    ' pub matches():bool{',
    '  const Symbol ready=#ready;',
    '  const Symbol error=#error;',
    '  const bool matches=ready eq #ready and ready neq error;',
    '  return matches;',
    ' }',
    'end'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes[0].methods[0].body.body.body.value.kind,'if');
  assert.equal(ir.classes[0].methods[0].body.body.body.value.condition.kind,'symbolCompare');
  const mod=await load(source);
  assert.equal(new mod.Marker().matches(),true);
});

test('guard against malformed logical typing and obsolete ne spelling in locals',()=>{
  const invalid=[
    'pub fnc f():bool{const bool n=1 and true;return n;}',
    'pub fnc f():bool{const bool n=true and 1;return n;}',
    'pub fnc f():bool{const bool n=1 or false;return n;}',
    'pub fnc f():bool{const bool n=false or 1;return n;}',
    'pub fnc f():bool{const bool n=not 1;return n;}',
    'pub fnc f():int{const int n=true and false;return n;}',
    'pub fnc f():bool{const bool n=1 ne 1;return n;}',
    'pub define class X as pub f():bool{const bool v=1 and true;return v;} end',
    'pub define class X as pub f():bool{const bool v=not 2;return v;} end'
  ];
  for(const source of invalid)
    assert.throws(()=>compileToProgramIRV2(source),/error: program v2:|error: program IR:/,source);
});

test('forged word-operator IR cannot bypass canonical comparison and bool types',()=>{
  const base=compileToProgramIRV2([
    'pub fnc f(bool enabled,int n):bool{',
    ' const bool result=enabled and n eq 42;',
    ' return result;',
    '}'
  ].join('\n'));
  const mutate=fn=>{
    const copy=JSON.parse(JSON.stringify(base));
    fn(copy.functions[0].body,copy);
    return copy;
  };
  for(const ir of [
    mutate(root=>{root.value.condition={kind:'int',value:'1'};}),
    mutate(root=>{root.value.yes.op='eq';}),
    mutate(root=>{root.value.yes.op='and';}),
    mutate(root=>{root.value.no={kind:'int',value:'0'};}),
    mutate(root=>{root.body.type='int';}),
    mutate(root=>{root.type='int';})
  ]) assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
});

test('unmodified scalar-only sources remain representable without local nodes',async()=>{
  const source='pub fnc f(int n):int{return n+2;}';
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.functions[0].body.kind,'binary');
  assert.equal(compileProgramIRV2(ir),compileProgramV2(source));
  const module=await load(source);
  assert.equal(module.f(40n),42n);
});
