import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const template='fnc identity<T>(T value): T { return value; } ';
const guest=expr=>template+'pub fnc main(): int { return '+expr+'; }';
test('named, positional, inferred and named-runtime calls execute the same int specialization',async()=>{
  for(const expr of ['identity<int>(42)','identity<T=int>(42)',
    'identity<T=int>(value:42)','identity(42)',
    'identity<T=int>(20)+identity<int>(22)']){
    const source=guest(expr);
    const ir=compileToProgramIRV2(source);
    assert.equal(ir.functions.length,2);
    assert.equal(ir.functions[0].pub,false);
    assert.equal(Object.hasOwn(ir.functions[0],'genericParameter'),false);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(source));
    const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
    assert.equal(mod.main(),42n,expr);
    assert.equal(Object.hasOwn(mod,'identity'),false);
  }
});
test('generic declaration, type kind, delimiter and runtime argument errors reject before ESM',()=>{
  for(const expr of ['identity<U=int>(42)','identity<t=int>(42)','identity<T=3>(42)',
    'identity<T=bool>(true)','identity<T=int,T=int>(42)','identity<T=int,bool>(42)',
    'identity[T=int](42)','identity<T=int](42)','identity<T=int>(true)',
    'identity(true)','identity<T=int>(other:42)','identity<T=int>(value:42,value:42)']){
    assert.throws(()=>compileProgramV2(guest(expr)),/error: program/,expr);
  }
  for(const source of [
    'pub fnc identity<T>(T value): T { return value; }',
    'fnc identity[T](T value): T { return value; }',
    'fnc identity<T>(T value): T { return value+1; }',
    template+'pub fnc main(int identity): int { return identity<T=int>(42); }',
    template+'fnc identity(int a,int b):int{return a;} pub fnc main():int{return identity<int>(42);}',
    'fnc ordinary(int value):int{return value;} pub fnc main():int{return ordinary<T=int>(42);}'
  ])assert.throws(()=>compileProgramV2(source),/error: program/,source);
});
test('ordinary comparison is not reinterpreted as generic call',async()=>{
  const source='pub fnc main(): int { return 1 < 2 ? 42 : 0; }';
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(mod.main(),42n);
});

test('canonical imperative do disambiguates comparisons and generic calls',async()=>{
  for(const [source,want] of [
    ['pub fnc main(): int { if 1 < 2 do return 42; fi return 0; }',42n],
    [template+'pub fnc main(): int { if 2 < 1 do return identity<int>(0); else return identity<T=int>(42); fi }',42n],
    ['pub fnc main(): int { if true do return 42; else return Integer.rem(1,0); fi }',42n],
    ['pub fnc main(): int { if false do return Integer.rem(1,0); fi return 42; }',42n]
  ]){
    const ir=compileToProgramIRV2(source);
    const esm=compileProgramV2(source);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
    const m=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
    assert.equal(m.main(),want,source);
  }
  for(const source of [
    'pub fnc main(): int { if 1 do return 42; fi return 0; }',
    'pub fnc main(): int { if true do return 42; }',
    'pub fnc main(): int { if true do 42; fi return 0; }',
    'pub fnc main(): int { return if true do return 42; fi; }'
  ])assert.throws(()=>compileProgramV2(source),/error: program/,source);
});
