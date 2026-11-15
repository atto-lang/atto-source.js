import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.mjs';

const safe = 'pub fnc main(): int { return 42; }';
const bidiControls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

test('JS scalar frontend rejects Trojan Source controls even in skipped comments', () => {
  for (const point of bidiControls) {
    const hidden = String.fromCodePoint(point);
    assert.throws(() => compile(safe + ' // ' + hidden), /bidirectional Unicode control in source/, 'U+' + point.toString(16));
    assert.throws(() => compile('/* ' + hidden + ' */ ' + safe), /bidirectional Unicode control in source/, 'U+' + point.toString(16));
  }
});

test('ordinary non-ASCII comments and literal ASCII escape text stay valid', () => {
  assert.doesNotThrow(() => compile('// café\n' + safe));
  assert.doesNotThrow(() => compile('// literal \\u202e is not a bidi control\n' + safe));
});
