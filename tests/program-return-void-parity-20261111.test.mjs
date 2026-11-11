import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileProgramV2,compileProgramIRV2,compileToProgramIRV2
} from '../src/program-v2.mjs';

const load = async source => import('data:text/javascript;charset=utf-8,' +
  encodeURIComponent(compileProgramV2(source)));

test('pure void functions use real transpiled ESM; nonvoid explicit returns unchanged', async () => {
  const source = [
    'pub fnc empty(): void {}',
    'pub fnc stop(int value): void { return; }',
    'pub fnc arrow() -> void :: return; end',
    'define module m as pub fnc note(): void {} end',
    'pub fnc answer(): int { return 42; }',
    'pub define class C as pub method noop():void{} end'
  ].join('\n');
  const ir = compileToProgramIRV2(source);
  for (const name of ['empty','stop','arrow']) {
    const f = ir.functions.find(f => f.name === name);
    assert.equal(f.returnType,'void');
    assert.equal(f.body,null);
  }
  const compiled = compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compiled);
  const guest = await load(source);
  assert.equal(guest.empty(),undefined);
  assert.equal(guest.stop(1n),undefined);
  assert.equal(guest.arrow(),undefined);
  assert.equal(guest.m.note(),undefined);
  assert.equal(new guest.C().noop(),undefined);
  assert.equal(guest.answer(),42n);
  assert.throws(() => guest.stop(1), /signed i64 BigInt/);
  assert.throws(() => guest.stop(), /overload arity mismatch/);
});

test('explicit-return negatives reject before JS emission', () => {
  const negatives = [
    'pub fnc bad(): int {}',
    'pub fnc bad(): bool {}',
    'pub fnc bad(): int { return; }',
    'pub fnc bad(): void { return 1; }',
    'pub fnc bad(): void { return true; }',
    'pub fnc bad(): void { 1; }',
    'pub fnc bad(): void { other(); }',
    'pub fnc bad(): void { if true then return; fi }',
    'pub fnc bad(): int { if true then return 1; fi }',
    'pub fnc bad(): int { return voided(); } fnc voided(): void {}'
  ];
  for (const source of negatives) {
    assert.throws(() => compileToProgramIRV2(source), /error: program (v2|IR):/,source);
    assert.throws(() => compileProgramV2(source), /error: program (v2|IR):/,source);
  }
});

test('strict IR rejects forged void values and nonvoid fallthrough', () => {
  const valid = compileToProgramIRV2('pub fnc noop():void{} pub fnc answer():int{return 7;}');
  const copy = () => JSON.parse(JSON.stringify(valid));
  const forgedVoid = copy();
  forgedVoid.functions[0].body = {kind:'int',value:'7'};
  assert.throws(() => compileProgramIRV2(forgedVoid), /void function body must be null/);
  const forgedNonvoid = copy();
  forgedNonvoid.functions[1].body = null;
  assert.throws(() => compileProgramIRV2(forgedNonvoid), /nonvoid function requires an expression body/);
  const forgedType = copy();
  forgedType.functions[0].returnType = 'not-a-type';
  assert.throws(() => compileProgramIRV2(forgedType), /unsupported function return type/);
  const getter = copy();
  let reads = 0;
  Object.defineProperty(getter.functions[0],'body',{
    enumerable:true,get(){reads++;throw Error('getter must not execute');}
  });
  assert.throws(() => compileProgramIRV2(getter), /accessor|missing\/extra fields|data/i);
  assert.equal(reads,0);
});
