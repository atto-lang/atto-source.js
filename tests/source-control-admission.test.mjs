import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';

const base = 'pub fnc main(): int { return 42; }';

test('source ESC/DEL are rejected in comments and literals before emission', () => {
  for (const control of ['\x1b', '\x7f']) {
    for (const source of [
      base + '// ' + control,
      '/*' + control + '*/' + base,
      'pub fnc main():int { let string s = "' + control + '"; return 42; }',
    ]) {
      assert.throws(() => compile(source), /terminal control in source/);
    }
  }
});

test('regular whitespace stays accepted', () => {
  assert.doesNotThrow(() => compile('pub fnc main():int {\r\n\treturn 42;\r\n}'));
});
