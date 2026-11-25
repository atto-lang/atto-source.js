import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker, TranspileError} from '../src/transpile-worker.mjs';

const scalar = 'pub fnc main(): int { return 42; }';
const actor = `define actor Counter as
 let int total = 0;
 receive(ActorMail<int> mail): void {
  self.total = self.total + mail.value;
  stdio.println(self.total);
  return;
 }
end
pub fnc main(): int { val counter = spawn Counter(); return 0; }`;
const controls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
  0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
test('reject all Trojan Source bidi controls, even in skipped comments', () => {
  for (const cp of controls) {
    const ch = String.fromCodePoint(cp);
    for (const src of [scalar + '// ' + ch, '/* ' + ch + ' */ ' + scalar,
      scalar.replace('return', '/*' + ch + '*/return'),
      actor + '\n// ' + ch]) {
      assert.throws(() => transpile_to_worker(src), error =>
        error instanceof TranspileError && error.code === 'E_BIDI_CONTROL',
        'U+' + cp.toString(16));
    }
  }
});
test('allow ordinary Unicode comments and visible escape sequences', () => {
  for (const src of [scalar, '// café 🦊\n' + scalar,
    '// visible literal \\u202e\n' + scalar, actor]) {
    assert.doesNotThrow(() => transpile_to_worker(src));
  }
});
