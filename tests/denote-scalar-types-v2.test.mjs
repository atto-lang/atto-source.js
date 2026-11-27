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
    'denote type Count = int','denote type Count = 5 | bool;',
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

test('literal denotations prove immutable local membership before scalar lowering',async()=>{
  for(const binding of ['const Dice a = 5;','val Dice a = 6;','val Again a = 7;','val Dice a = -5;']){
    const source='denote type Dice = -5 | 5 | 6 | 7; denote type Again = Dice; pub fnc main(): int { '+binding+' return a + 42 - a; }';
    assert.equal(await (await load(source)).main(),42n);
  }
  const source='denote type Dice = 5 | 6 | 7; pub fnc main(): int { const Dice a = 5; return a + 37; }';
  const control='pub fnc main(): int { val int a = 5; return a + 37; }';
  assert.deepEqual(compileToProgramIRV2(source),compileToProgramIRV2(control));
});
test('literal denotations fail closed before integer erasure at unproved boundaries',()=>{
  for(const [body,diagnostic] of [
    ['const Dice a = 8; return 42;', /E_DENOTE_MEMBERSHIP|not a proven member/],
    ['val Dice a = true; return 42;', /not a proven member/],
    ['val int x = 5; val Dice a = x; return 42;', /not a proven member/],
    ['val Dice a = 4 + 1; return 42;', /not a proven member/],
    ['val Dice a = 5; a = 8; return a;', /E_STRING_REBIND/],
    ['val a : Dice = 5; return a;', /literal denotation requires/],
    ['let Dice a = 5; return a;', /unsupported|expected|requires/i],
  ]) assert.throws(()=>compileProgramV2('denote type Dice = 5 | 6 | 7; pub fnc main(): int { '+body+' }'),diagnostic,body);
  for(const source of [
    'denote type Dice = 5 | 6; fnc id(Dice a): int { return a; } pub fnc main(): int { return id(5); }',
    'denote type Dice = 5 | 6; pub fnc main(): Dice { return 5; }',
    'denote type Dice = 5 | 5; pub fnc main(): int { return 42; }',
    'denote type Dice = 9223372036854775808 | 5; pub fnc main(): int { return 42; }',
    'denote type Dice = 5 | ; pub fnc main(): int { return 42; }',
    'denote type Dice = 5 | 6; denote type Dice = int; pub fnc main(): int { return 42; }'
  ]) assert.throws(()=>compileProgramV2(source),undefined,source);
});
