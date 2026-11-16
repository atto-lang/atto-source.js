import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';

const safe = 'pub fnc main(): int { return 42; }';

test('JS backend rejects terminal ESC and DEL even in comments and literals', () => {
  for (const control of ['\x1b', '\x7f']) {
    for (const source of [
      '/* hidden' + control + ' */ ' + safe,
      '// hidden' + control + '\n' + safe,
      safe + ' // ' + control,
      '"inside' + control + '"'
    ]) {
      const at = source.indexOf(control);
      assert.throws(() => compile(source),
        new RegExp('terminal control in source at UTF-16 offset ' + at + '$'));
    }
  }
});

test('JS source preflight preserves first-invalid precedence and Unicode offsets', () => {
  assert.throws(() => compile('\0\x1b'),
    /NUL in source/);
  assert.throws(() => compile('\x7f\0'),
    /terminal control in source at UTF-16 offset 0$/);
  assert.throws(() => compile('/* 😀 */\x1b'),
    /terminal control in source at UTF-16 offset 8$/);
});

test('normal Unicode comments and visible escapes stay admissible', () => {
  assert.doesNotThrow(() => compile('/* café 😀 */ ' + safe));
  assert.doesNotThrow(() => compile('// literal \\u001b is visible\n' + safe));
});
