import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR} from '../src/compiler.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';

const source = expression => 'pub fnc main(): int { return '+expression+'; }';

test('both JS scalar frontends deny contextual ownership until typed IR', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    for (const expression of [
      'copy!42', 'take!42', 'borrow! value',
      'borrow!mut value', 'borrow! mut value',
      'mut borrow!value', 'mut borrow! value', 'share!value',
    ]) {
      assert.throws(() => compile(source(expression)),
        /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/, expression);
    }
  }
});

test('comments do not create ownership effects', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { /* borrow! mut value */ return 42; }'));
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { // borrow! mut value\n return 42; }'));
  }
});

test('spaced bang and inequality are not classified as ownership aliases', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    for (const expression of ['copy !value', 'copy!=value', 'copy!eq value']) {
      try {compile(source(expression));}
      catch (error) {
        assert.doesNotMatch(String(error.message),
          /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/, expression);
      }
    }
  }
});

test('legacy rt mutable borrowing is source-compatible but must fail typed lowering', () => {
  for (const expression of ['rt borrow mut value', 'rt mut borrow value']) {
    assert.throws(() => compileToIR(source(expression)),
      /runtime ownership operation requires typed lowering/, expression);
  }
});

test('nested ownership-looking comments remain inert in both JS compilers', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { /* outer /* borrow! mut value */ '+
      'middle /* copy!42 */ */ return 42; }'));
    assert.throws(() => compile('pub fnc main(): int { /* outer /* copy!42 */ return 42; }'),
      /unterminated comment/, 'unclosed nested comment must never emit IR');
    assert.throws(() => compile(
      'pub fnc main(): int { '+'/*'.repeat(65)+'*/'.repeat(65)+' return 42; }'),
      /comment nesting/, 'nested comments are bounded to 64');
  }
});
