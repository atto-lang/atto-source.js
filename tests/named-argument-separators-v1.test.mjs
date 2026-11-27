import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

const prefix='fnc f(int a, int b): int { return a * 10 + b; } ';
const source=call=>prefix+'pub fnc main(): int { return '+call+'; }';
const execute=async(src)=>{
  const esm=compileProgramV2(src);
  const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
  return module.main();
};

test('colon, equals and mixed labels share one checked binding plan and execute',async()=>{
  for(const [call,want] of [
    ['f(b:2,a:4)',42n],['f(b=2,a=4)',42n],
    ['f(b:2,a=4)',42n],['f(b=2,a:4)',42n],
    ['f(4,b=2)',42n],['f(b=4,a=2)',24n],
    ['f(b=2,a=40+2)',422n],
  ])assert.equal(await execute(source(call)),want,call);
  assert.deepEqual(compileToProgramIRV2(source('f(b:2,a:4)')),
    compileToProgramIRV2(source('f(b=2,a=4)')));
});

test('duplicate, unknown, misplaced positional, Pair and malformed labels reject',()=>{
  for(const [call,diagnostic] of [
    ['f(a=4,a:2)',/duplicate argument binding/],
    ['f(4,a=2)',/duplicate argument binding/],
    ['f(z=4,b:2)',/unknown named argument/],
    ['f(a=4,2)',/positional argument cannot follow/],
    ['f(a:=4,b=2)',/Pair expressions are unsupported/],
    ['f(a : = 4,b=2)',/Pair expressions are unsupported/],
  ])assert.throws(()=>compileProgramV2(source(call)),diagnostic,call);
});

test('comparison remains positional rather than named binding',async()=>{
  const src='fnc select_value(bool x): int { return x ? 42 : 0; } pub fnc main(): int { val a = 4; return select_value(a == 4); }';
  assert.equal(await execute(src),42n);
});
