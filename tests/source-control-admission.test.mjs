import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';

const base = 'pub fnc main(): int { return 42; }';

test('source ESC/DEL are rejected in comments and literals before emission', () => {
  for (const control of ['\x1b', '\x7f']) {
    for (const source of [
      base + '// ' + control,
      '/*' + control + '*/' + base,
      'pub fnc main():int { let string s = "' + control + '"; return 42; }',
    ]) {
      assert.throws(() => compile(source), /terminal control in source/);
      assert.throws(() => compileToProgramIRV2(source), /terminal control in source/);
    }
  }
});

test('regular whitespace stays accepted', () => {
  assert.doesNotThrow(() => compile('pub fnc main():int {\r\n\treturn 42;\r\n}'));
});


test('scalar and program-v2 reject ESC/DEL before syntax scanning with identical UTF-16 offsets', () => {
  for (const control of ['\x1b','\x7f']) {
    for (const source of [
      base + ' // hidden' + control,
      '/* hidden' + control + ' */ ' + base,
      '// hidden' + control + '\n' + base,
      'pub fnc main(): int { val s = "text' + control + '"; return 42; }',
      '/* 😀 */' + control + '\n' + base,
    ]) {
      const pos = source.indexOf(control);
      const expected = new RegExp('terminal control in source at UTF-16 offset ' + pos + '$');
      assert.throws(() => compile(source), expected);
      assert.throws(() => compileToProgramIRV2(source), expected);
    }
  }
  for (const candidate of ['\0\x1b', '\0\x7f']) {
    assert.throws(() => compile(candidate), /NUL in source/);
    assert.throws(() => compileToProgramIRV2(candidate), /NUL in source/);
  }
});

test('scalar and program-v2 reject the same complete Trojan Source bidi control set', () => {
  const bidi = [0x061c,0x200e,0x200f,0x202a,0x202b,0x202c,0x202d,0x202e,
    0x2066,0x2067,0x2068,0x2069];
  for (const cp of bidi) {
    const char = String.fromCodePoint(cp);
    for (const source of [base + ' // '+char, '/* '+char+' */ '+base,
      'pub fnc main(): int { val s = "'+char+'"; return 42; }']) {
      const at = source.indexOf(char);
      assert.throws(() => compile(source), /bidirectional Unicode control in source/,
        'scalar U+'+cp.toString(16));
      assert.throws(() => compileToProgramIRV2(source),
        new RegExp('bidirectional Unicode control in source at UTF-16 offset ' + at + '$'),
        'program-v2 U+'+cp.toString(16));
    }
  }
});

test('source admission keeps normal Unicode comments and visible escapes inert', () => {
  for (const source of [
    '/* café 😀 */ '+base,
    '// visible text \\\\u001b and \\\\u202e are not raw controls\n'+base,
  ]) {
    assert.doesNotThrow(() => compile(source));
    assert.doesNotThrow(() => compileToProgramIRV2(source));
  }
});
