import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR} from '../src/compiler.mjs';

const spellings = [
  'define pub fnc answer(): int { return 42; }',
  'pub define fnc answer(): int { return 42; }',
  'pub fnc answer(): int { return 42; }'
];

test('scalar JS: define/public ordering produces identical compiler IR and output', async () => {
  const expectedIR = compileToIR(spellings[0]);
  const expectedSource = compile(spellings[0]);
  for (const source of spellings) {
    assert.deepEqual(compileToIR(source), expectedIR, source);
    assert.equal(compile(source), expectedSource, source);
    const ns = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(compile(source)));
    assert.equal(ns.answer(), 42n);
  }
});

test('scalar JS: module members omit define canonically but legacy spellings compile', () => {
  const canonical = 'define module api as pub fnc answer(): int { return 42; } end';
  for (const legacy of [
    'define module api as define pub fnc answer(): int { return 42; } end',
    'define module api as pub define fnc answer(): int { return 42; } end',
  ]) {
    assert.deepEqual(compileToIR(legacy), compileToIR(canonical));
    assert.equal(compile(legacy), compile(canonical));
  }
});

test('scalar JS: duplicated define or conflicting visibility fails closed', () => {
  for (const bad of [
    'define define pub fnc answer(): int { return 42; }',
    'define pub pub fnc answer(): int { return 42; }',
    'pub define pub fnc answer(): int { return 42; }',
    'define module api as define define fnc answer(): int { return 42; } end'
  ]) {
    assert.throws(() => compile(bad), /error:/, bad);
  }
});

test('scalar JS: class and actor syntax is still unsupported, not falsely certified', () => {
  for (const source of [
    'define pub class Cart as pub fnc new(): Cart { return new Cart(); } end',
    'define actor Probe as define pub fnc ping(): int { return 1; } end'
  ]) assert.throws(() => compile(source), /error:/, source);
});
