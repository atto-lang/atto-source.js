import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const fib=n=>'pub fnc main(): int { return '+n+' |> fnc fib(int v): int { ^ match v over on 0 -> 0, on 1 -> 1, on _ -> fib(v-2)+fib(v-1) end }; }';
async function load(source){
  const es=compileProgramV2(source),ir=compileToProgramIRV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),es);
  return import('data:text/javascript;base64,'+Buffer.from(es).toString('base64'));
}
test('production source and supplied IR compile to matching recursive ESM',async()=>{
  for(const [n,want] of [[0,0n],[1,1n],[10,55n],[20,6765n]])assert.equal((await load(fib(n))).main(),want);
  assert.match(compileProgramV2(fib(55)),/function\* _self/); // compile only
  assert.equal((await load('fnc fib(int v): int {return 999;} '+fib(10))).main(),55n);
  assert.equal((await load('pub fnc main(): int {return 1 |> fnc f(int v): int {return v+2;} |> fnc f(int v): int {return v*14;};}')).main(),42n);
});
test('source restrictions and independent IR context admission',()=>{
  for(const src of [
    'pub fnc main(): int {return 1 |> fnc f(int v): int {return v+x;};}',
    'pub fnc main(): int {return 1 |> fnc f(int v): int {return f(v,v);};}',
    'pub fnc main(): int {return 1 |> fnc f(int f): int {return f;};}',
    'pub fnc main(): int {return true |> fnc f(int v): int {return v;};}',
    'pub fnc main(): int {val x=1 |> fnc f(int v): int {return v;};return f(x);}',
    'routine f(int v): int {return v |> fnc x(int n): int {return x(n);};} pub fnc main(): int {return f(1);}',
    'fnc f(int v): int {return f(v);} pub fnc main(): int {return f(1);}'
  ])assert.throws(()=>compileProgramV2(src),undefined,src);
  const ir=compileToProgramIRV2(fib(10));
  ir.functions[0].body.body={kind:'call',target:0,args:[]};
  assert.throws(()=>compileProgramIRV2(ir));
});
