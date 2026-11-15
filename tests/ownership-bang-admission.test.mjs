import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR} from '../src/compiler.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';

const source = expression => 'pub fnc main(): int { return '+expression+'; }';

test('both JS scalar frontends deny contextual ownership until typed IR', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    for (const expression of [
      'copy!42', 'take!42', 'borrow! value',
      'borrow!mut value', 'borrow! mut value', 'share!value',
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
