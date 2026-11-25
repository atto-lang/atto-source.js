import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, CompileError} from '../src/compiler.mjs';

const bad = [
  'define actor Meter as let int counter = 0; end',
  'pub fnc main(): int { this.handle_state(critical-write |s| -> { s.counter += 1; }); return 42; }',
  'pub fnc main(): int { this.handle_state(critical-read |s| -> { s.counter; }); return 42; }',
  'pub fnc main(): int { return this.state.counter; }',
  'pub fnc main(): int { return borrow! mut this.state.counter; }',
  'pub fnc main(): int { if true then this.handle_state(critical-write |s| -> { s.counter += 1; }); else return 42; fi return 0; }'
];
test('JS scalar compiler does not emit actor-state CFG, loans or unverified guard effects', () => {
  for (const source of bad) {
    for (const compileFn of [compileToIR, compile]) {
      assert.throws(() => compileFn(source),
        error => error instanceof CompileError && /^error: /.test(error.message), source);
    }
  }
});
test('JS actor-borrow denial is scoped to source tokens, not ignored comment text', () => {
  assert.doesNotThrow(() => compile('pub fnc main(): int { /* critical-write handle_state borrow! */ return 42; }'));
});
