import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramIRV2,compileProgramV2}
  from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const load=async src=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(src)));

test('typed immutable locals compile from source through canonical IR to ESM',async()=>{
  const source=[
    'pub fnc compute(int input):int{',
    ' const int increment=2;',
    ' const int result=input+increment;',
    ' return result;',
    '}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.functions[0].body.kind,'letLocal');
  assert.equal(ir.functions[0].body.body.kind,'letLocal');
  assert.equal(ir.functions[0].body.body.body.kind,'localRead');
  const portable=JSON.parse(JSON.stringify(ir));
  assert.deepEqual(validateProgramIRV2(portable),ir);
  assert.equal(compileProgramIRV2(portable),compileProgramV2(source));
  const module=await load(source);
  assert.equal(module.compute(40n),42n);
  assert.equal(module.compute(-4n),-2n);
  assert.throws(()=>module.compute(40),/BigInt required/);
});

test('branch-local immutable bindings do not leak, but outer bindings remain visible',async()=>{
  const src=[
    'pub fnc calculate(int n):int{',
    ' const int base=n+1;',
    ' if base>0 then',
    '   const int on_path=base+1;',
    '   return on_path;',
    ' else',
    '   const int other=base-1;',
    '   return other;',
    ' fi',
    '}'
  ].join('\n');
  const mod=await load(src);
  assert.equal(mod.calculate(40n),42n);
  assert.equal(mod.calculate(-5n),-5n);
});

test('bool, Symbol, Option and Result lexical values remain typed',async()=>{
  const src=[
    'pub fnc toggle(bool x):bool{const bool enabled=!x;return enabled;}',
    'pub fnc signal():bool{const Symbol s=#ready;return s==#ready;}',
    'pub fnc option_value():int{const Option<int> v=Some(42);return Option.unwrap_or(v,0);}',
    'pub fnc result_value():int{const Result<int,int> v=Ok(42);return Result.unwrap_or(v,0);}'
  ].join('\n');
  const mod=await load(src);
  assert.equal(mod.toggle(false),true);
  assert.equal(mod.toggle(true),false);
  assert.equal(mod.signal(),true);
  assert.equal(mod.option_value(),42n);
  assert.equal(mod.result_value(),42n);
  assert.throws(()=>mod.toggle(0n),/bool required/);
});

test('initializers execute even if the returned expression ignores their value',async()=>{
  const src=[
    'pub fnc remainder():int{const int ignored=1%0;return 42;}',
    'pub fnc overflow():int{const int ignored=9223372036854775807+1;return 42;}',
    'pub fnc lazy(bool condition):int{',
    ' if condition then',
    '  const int never=1%0;',
    '  return never;',
    ' else',
    '  return 42;',
    ' fi',
    '}'
  ].join('\n');
  const mod=await load(src);
  assert.throws(()=>mod.remainder(),/ORES_I64_DIVISION_BY_ZERO/);
  assert.throws(()=>mod.overflow(),/ORES_I64_OVERFLOW/);
  assert.equal(mod.lazy(false),42n);
  assert.throws(()=>mod.lazy(true),/ORES_I64_DIVISION_BY_ZERO/);
});

test('reject shadowed, duplicate, forward, out-of-scope and type-invalid locals',()=>{
  for(const source of [
    'pub fnc f(int n):int{const int n=4;return n;}',
    'pub fnc f():int{const int n=n+1;return n;}',
    'pub fnc f():int{const bool n=42;return 1;}',
    'pub fnc f():int{const int n=4;const int n=5;return n;}',
    'pub fnc f():int{const int n=4;}',
    'pub fnc f(int n):int{if n>0 then const int a=4;return a;else return a;fi}',
    'pub fnc f():int{return 42;const int later=2;}',
    'pub fnc f():int{const int x=1;return y;}',
    'pub fnc f():int{const int x=1; x=2; return x;}',
    'pub fnc f():int{const int self=1;return self;}'
  ]) assert.throws(()=>compileToProgramIRV2(source),
    /error: program v2:|error: program IR:/,source);
});

test('supplied IR cannot forge a lexical read, type, slot, or lexical lifetime',()=>{
  const source='pub fnc f(int n):int{const int a=n+1;return a;}';
  const base=compileToProgramIRV2(source);
  const change=fn=>{
    const x=JSON.parse(JSON.stringify(base));
    fn(x.functions[0].body,x);return x;
  };
  for(const candidate of [
    change(root=>{root.slot=-1;}),
    change(root=>{root.slot=0.5;}),
    change(root=>{root.type='bool';}),
    change(root=>{root.body.slot=999;}),
    change(root=>{root.body.type='bool';}),
    change(root=>{root.body={kind:'int',value:'42'};root.value={kind:'localRead',slot:root.slot,type:'int'};}),
    change((root,x)=>{x.functions[0].body={kind:'localRead',slot:root.slot,type:'int'};}),
    change((root,x)=>{x.functions[0].body={kind:'letLocal',slot:root.slot,type:'int',value:root.value,
      body:{kind:'letLocal',slot:root.slot,type:'int',value:root.value,body:root.body}};}),
    change((root,x)=>{x.functions[0].body={kind:'letLocal',slot:root.slot,type:'int',
      value:root.value,body:{kind:'int',value:'42'},extra:'unsupported'};})
  ]) assert.throws(()=>compileProgramIRV2(candidate),/error: program IR:/);
});

test('legacy scalar-only source retains stable direct-IR emission',()=>{
  const src='pub fnc f(int n):int{return n+2;}';
  const ir=compileToProgramIRV2(src);
  assert.deepEqual(ir.functions[0].body,{kind:'binary',op:'+',
    left:{kind:'param',index:0},right:{kind:'int',value:'2'}});
  assert.equal(compileProgramIRV2(ir),compileProgramV2(src));
  assert.match(compileProgramV2(src),/function _check\(/);
});
