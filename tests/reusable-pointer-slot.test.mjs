import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIR} from '../src/compiler.mjs';
const prefix='pub fnc main(): int { let a: int = 42; let mut RawPointer<int> p = RawPointer.empty<int>(); ';
test('closed reusable slots compile to executable scalar ESM',async()=>{
  const fixtures=[
    'pub fnc main(): int { let a: int = 40; let b: int = 2; let mut RawPointer<int> p = RawPointer.empty<int>(); ref! p to a; val first = deref! p; unref! p; ref! p to b; val second = deref! p; unref! p; return first + second; }',
    'pub fnc main(): int { let mut RawPointer<int> p = RawPointer.empty<int>(); return 42; }',
    prefix+'ref! p to a; unref! p; return a; }',
  ];
  for(const source of fixtures){
    const code=compile(source);
    assert.equal(code,compile('pub fnc main(): int { return 42; }'));
    const module=await import('data:text/javascript,'+encodeURIComponent(code));
    assert.equal(module.main(),42n);
  }
});
test('invalid slot source never emits scalar IR or ESM',()=>{
  for(const body of ['val x = deref! p; return x;','p = null; return 42;',
    'ref! p to a; unref! p; unref! p; return 42;',
    'ref! p to a; ref! p to a; unref! p; return 42;',
    'ref! p to a; return 42;','return p;',
    'ref ! p to a; unref! p; return 42;',
    'ref!p to a; unref! p; return 42;',
    'ref! p to a; val x = deref!p; unref! p; return x;',
    'ref! p to a; unref!p; return 42;',
    'ref!/* separator */p to a; unref! p; return 42;',
    'ref!\u00a0p to a; unref! p; return 42;',
    'ref! p to missing; unref! p; return 42;',
    'return 9223372036854775807 + 1;',
    'ref! p to a; val p = deref! p; unref! p; return 42;']){
    for(const fn of [compile,compileToIR])assert.throws(()=>fn(prefix+body+' }'),/E_POINTER_SLOT_PROFILE/,body);
  }
  assert.throws(()=>compile(prefix+'return 42; } pub fnc other(): int { return 0; }'),/E_POINTER_SLOT_PROFILE/);
});
test('comments cannot activate slot syntax',()=>{
  assert.equal(compile('pub fnc main(): int { return 42; } // RawPointer ref!'),compile('pub fnc main(): int { return 42; }'));
});

test('ASCII whitespace after slot bang is accepted',async()=>{
  const code=compile(prefix+'ref!\t p to a; val x = deref!\n p; unref!\r\n p; return x; }');
  const module=await import('data:text/javascript,'+encodeURIComponent(code));
  assert.equal(module.main(),42n);
});
