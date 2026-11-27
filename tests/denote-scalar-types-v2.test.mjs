import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';

const load=async source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileProgramV2(source)));

test('scalar denotation is transparent through typed IR and emitted ESM',async()=>{
  const control='fnc id(int n): int { return n; } pub fnc main(): int { val int a = 42; return id(a); }';
  const alias='denote type Count = int; denote type Total = Count; fnc id(Count n): Total { return n; } pub fnc main(): Total { val Count a = 42; return id(a); }';
  assert.deepEqual(compileToProgramIRV2(alias),compileToProgramIRV2(control));
  assert.equal(await (await load(alias)).main(),42n);
});

test('bool denotation preserves checking and result',async()=>{
  const src='denote type Flag = bool; fnc identity(Flag b): Flag { return b; } pub fnc main(): int { return identity(true) ? 42 : 0; }';
  assert.equal(await (await load(src)).main(),42n);
  assert.throws(()=>compileProgramV2('denote type Flag = bool; fnc identity(Flag b): Flag { return b; } pub fnc main(): int { return identity(42) ? 42 : 0; }'));
});

test('invalid or unsupported denotations never emit ESM',()=>{
  const main=' pub fnc main(): int { return 42; }';
  for(const decl of [
    'denote type Count = ;','denote type Count as int;',
    'denote type Count = int','denote type Count = 5 | 6 | 7;',
    'denote type Count = Count;','denote type Count = Missing;',
    'denote type Count = int; denote type Count = bool;',
    'denote type String = int;','denote type Count<T> = T;',
    'denote pub type Count = int;','denote actor Count;',
    'denote type Count = int; define class Count as end',
    'use namespace n; denote type Count = int;',
  ]) assert.throws(()=>compileProgramV2(decl+main),undefined,decl);
});

test('contextual spelling does not change ordinary identifiers or comments',async()=>{
  const source='// denote type Count = bool;\nfnc denote(int n): int { return n; } pub fnc main(): int { return denote(42); }';
  assert.equal(await (await load(source)).main(),42n);
});
