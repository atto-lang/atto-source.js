import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

const program=expr=>'fnc increment(int n):int { return n+1; } pub fnc main():int { return '+expr+'; }';
const load=async expr=>import('data:text/javascript,'+encodeURIComponent(compileProgramV2(program(expr))));
test('conditional receivers compose and execute real ESM guests',async()=>{
  for(const expr of [
    '42 |> if is int then 30 else 20 fi',
    '42 |> is type int ? 30 : 20',
    '42 |> > 10 ? 30 : 20',
    'true |> ? 30 : 20',
    'true |> if then 30 else 20 fi',
    'false |> ifnot then 30 else 20 fi',
    '42 |> if > 10 then 30 else 20 fi',
    '42 |> eq 42 |> ? 30 : 20'
  ]) assert.equal((await load(expr)).main(),30n,expr);
  assert.equal((await load('42 |> await |> if > 10 then 30 else 20 fi |> increment |> > 30 |> ? 100 : 200')).main(),100n);
  assert.equal((await load('true |> ? 30 : 20 |> increment')).main(),31n);
  assert.equal((await load('false |> ? 30 : 20 |> increment')).main(),21n);
});
test('ordinary and receiver comparison conditional IR is identical',()=>{
  const expected=compileToProgramIRV2(program('42 > 10 ? 30 : 20'));
  assert.deepEqual(compileToProgramIRV2(program('42 |> > 10 ? 30 : 20')),expected);
  assert.deepEqual(compileToProgramIRV2(program('42 |> if > 10 then 30 else 20 fi')),expected);
});
test('conditional laziness and mandatory evaluation of int type test',async()=>{
  for(const expr of ['true |> if then 30 else 1 / 0 fi','false |> ? 1 / 0 : 30','42 |> is int ? 30 : 1 / 0'])
    assert.equal((await load(expr)).main(),30n);
  const failing=await load('(1 / 0) |> is type int ? 30 : 20');
  assert.throws(()=>failing.main());
});
test('malformed and wrong typed receiver stages fail before ESM emission',()=>{
  for(const expr of [
    '42 |> if 42 > 10 then 30 else 20 fi',
    '42 |> if > 10 then 30 fi',
    '42 |> if then 30 else 20 fi',
    'true |> ? 30',
    'true |> ? 30 : false',
    'true |> is int ? 30 : 20',
    '42 |> is type Dog ? 30 : 20'
  ])assert.throws(()=>compileProgramV2(program(expr)),/error:/,expr);
});
