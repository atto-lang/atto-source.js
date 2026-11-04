import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2}
  from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

const arithmetic=[
  'pub define class Calculator as',
  '  double(int value):int{const int multiplier=2;return value*multiplier;}',
  '  pub calculate(int input):int{const int adjusted=input+1;return self.double(adjusted);}',
  '  pub implicit(int input):int{const int adjusted=input+1;return double(adjusted);}',
  'end'
].join('\n');

test('typed const in private methods and lexical self calls execute end to end',async()=>{
  const ir=compileToProgramIRV2(arithmetic);
  const methods=ir.classes[0].methods;
  assert.equal(methods[0].body.kind,'letLocal');
  assert.equal(methods[1].body.kind,'letLocal');
  assert.equal(methods[1].body.body.kind,'selfCall');
  assert.equal(methods[2].body.body.kind,'selfCall');
  const serialized=JSON.parse(JSON.stringify(ir));
  assert.deepEqual(validateProgramIRV2(serialized),ir);
  assert.equal(compileProgramIRV2(serialized),compileProgramV2(arithmetic));
  const mod=await load(arithmetic);
  const calculator=new mod.Calculator();
  assert.equal(calculator.calculate(20n),42n);
  assert.equal(calculator.implicit(20n),42n);
  assert.equal(calculator.double,undefined);
  assert.throws(()=>mod.Calculator.prototype.calculate.call({},20n),/invalid Oreslang receiver/);
  const f=calculator.calculate;
  assert.throws(()=>f(20n),/invalid Oreslang receiver/);
  assert.throws(()=>calculator.calculate(20),/BigInt required/);
});

test('unqualified method calls prefer class members over file-level functions',async()=>{
  const source=[
    'fnc helper(int x):int{return x+100;}',
    'pub define class Box as',
    '  helper(int x):int{const int one=1;return x+one;}',
    '  pub calculate(int x):int{const int next=x+1;return helper(next);}',
    'end'
  ].join('\n');
  const mod=await load(source);
  assert.equal(new mod.Box().calculate(40n),42n);
});

test('explicit self disambiguates local or parameter names from methods',async()=>{
  const source=[
    'pub define class Numbers as',
    '  plus(int a):int{return a+1;}',
    '  pub value(int plus):int{const int local=plus;return self.plus(local);}',
    '  pub choose():int{const int plus=41;return self.plus(plus);}',
    'end'
  ].join('\n');
  const mod=await load(source);
  assert.equal(new mod.Numbers().value(41n),42n);
  assert.equal(new mod.Numbers().choose(),42n);
  for(const src of [
    'pub define class Numbers as plus(int a):int{return a+1;} pub f(int plus):int{return plus(1);} end',
    'pub define class Numbers as plus(int a):int{return a+1;} pub f():int{const int plus=41;return plus(1);} end'
  ])assert.throws(()=>compileToProgramIRV2(src),/lexical name shadows implicit method call/);
});

test('named self call evaluates lexical arguments in source order',async()=>{
  const source=[
    'pub define class Picker as',
    ' pick(int a,int b):int{return a;}',
    ' pub choose(int x):int{const int result=x+2;return self.pick(b:9,a:result);}',
    ' pub fail_first():int{const int x=7;return self.pick(b:1%0,a:9223372036854775807+1);}',
    ' pub overflow_first():int{const int x=7;return self.pick(a:9223372036854775807+1,b:1%0);}',
    'end'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes[0].methods[1].body.body.kind,'namedSelfCall');
  assert.deepEqual(ir.classes[0].methods[1].body.body.paramOrder,[1,0]);
  const picker=new (await load(source)).Picker();
  assert.equal(picker.choose(40n),42n);
  assert.throws(()=>picker.fail_first(),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>picker.overflow_first(),/ORES_I64_OVERFLOW/);
});

test('branch locals and portable bool/Symbol/Option/Result types remain isolated',async()=>{
  const source=[
    'pub define class Choice as',
    ' pub selected(bool choose,int n):int{',
    '  const int first=n+1;',
    '  if choose then const int on_path=first+1;return on_path;',
    '  else const int fallback=first-1;return fallback;fi',
    ' }',
    ' pub truth(bool input):bool{const bool b=!input;return b;}',
    ' pub symbol():bool{const Symbol s=#ready;return s==#ready;}',
    ' pub option():int{const Option<int> v=Some(42);return Option.unwrap_or(v,0);}',
    ' pub result():int{const Result<int,int> v=Ok(42);return Result.unwrap_or(v,0);}',
    'end'
  ].join('\n');
  const o=new (await load(source)).Choice();
  assert.equal(o.selected(true,40n),42n);
  assert.equal(o.selected(false,40n),40n);
  assert.equal(o.truth(false),true);
  assert.equal(o.symbol(),true);
  assert.equal(o.option(),42n);
  assert.equal(o.result(),42n);
  assert.throws(()=>o.truth(0n),/bool required/);
});

test('initializer traps run exactly once before the result; unselected branches stay lazy',async()=>{
  const source=[
    'pub define class Faults as',
    ' pub overflow():int{const int ignored=9223372036854775807+1;return 42;}',
    ' pub remainder():int{const int ignored=1%0;return 42;}',
    ' pub choose(bool flag):int{',
    ' if flag then const int denied=1%0;return denied;',
    ' else const int safe=42;return safe;fi',
    ' }',
    'end'
  ].join('\n');
  const f=new (await load(source)).Faults();
  assert.throws(()=>f.overflow(),/ORES_I64_OVERFLOW/);
  assert.throws(()=>f.remainder(),/ORES_I64_DIVISION_BY_ZERO/);
  assert.equal(f.choose(false),42n);
  assert.throws(()=>f.choose(true),/ORES_I64_DIVISION_BY_ZERO/);
});

test('reject invalid lexical scopes, recursion, method values, and root escapes',()=>{
  for(const source of [
    'pub define class A as pub f():int{const int x=x+1;return x;} end',
    'pub define class A as pub f(int x):int{const int x=1;return x;} end',
    'pub define class A as pub f():int{const bool x=1;return 2;} end',
    'pub define class A as pub f():int{const int x=1;const int x=2;return x;} end',
    'pub define class A as pub f():int{const int x=1;} end',
    'pub define class A as pub f(bool flag):int{if flag then const int x=2;return x;else return x;fi} end',
    'pub define class A as pub f():int{const int x=1;return self.f;} end',
    'pub define class A as pub f():int{const int x=1;return self.f();} end',
    'pub define class A as pub f():int{const int x=1;return pkg::f();} end',
    'pub define class A as pub f():int{return unknown();} end'
  ])assert.throws(()=>compileToProgramIRV2(source),
    /error: program v2:|error: program IR:/,source);
});

test('forged method-local IR cannot manufacture scopes, wrong types, cycles or bad calls',()=>{
  const base=compileToProgramIRV2(arithmetic);
  const change=mutate=>{
    const ir=JSON.parse(JSON.stringify(base));
    mutate(ir,ir.classes[0].methods[1].body);
    return ir;
  };
  const invalid=[
    change((_,node)=>{node.slot=-1;}),
    change((_,node)=>{node.slot=0.5;}),
    change((_,node)=>{node.type='symbol';}),
    change((_,node)=>{node.body.args[0].slot=999;}),
    change((_,node)=>{node.body.methodIndex=999;}),
    change((_,node)=>{node.body.methodIndex=1;}),
    change((_,node)=>{node.value={kind:'localRead',slot:node.slot,type:'int'};}),
    change((_,node)=>{node.body={kind:'localRead',slot:node.slot,type:'bool'};}),
    change((_,node)=>{node.body={kind:'letLocal',slot:node.slot,type:'int',
      value:{kind:'int',value:'1'},body:{kind:'int',value:'42'}};}),
    change((ir,node)=>{node.body={kind:'namedSelfCall',methodIndex:0,
      args:[node.body.args[0]],paramOrder:[1]};}),
    change((_,node)=>{node.extra='unsafe';})
  ];
  for(const ir of invalid)
    assert.throws(()=>compileProgramIRV2(ir),/error: program IR:/);
});

test('legacy function const and free-standing class methods still compile',async()=>{
  const source=[
    'pub fnc compute(int n):int{const int v=n+2;return v;}',
    'pub define class Plain as',
    ' pub plus_one(int n):int{return n+1;}',
    'end'
  ].join('\n');
  const mod=await load(source);
  assert.equal(mod.compute(40n),42n);
  assert.equal(new mod.Plain().plus_one(41n),42n);
});
