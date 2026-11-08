import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileUntrusted,compileIRUntrusted,compileToIR} from '../src/compiler.mjs';

const source = 'pub fnc main(): int { return 7; }';

test('untrusted scalar entry budget polls once every 128 guest entries', async () => {
  const output = compileUntrusted(source);
  assert.match(output, /if\(\+\+_cooperateTicks!==128\)return/);
  assert.match(output, /if\(--_remainingPolls<0\)throw/);
  const module = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(output));
  // At 128, 256, ... 4096 entries, 32 slow-path checks have fired.
  for (let i = 0; i < 4096; ++i) assert.equal(module.main(), 7n);
  assert.throws(() => module.main(), /untrusted execution budget exceeded/);
  assert.throws(() => module.main(), /untrusted execution budget exceeded/);
});

test('trusted output unchanged; untrusted rejects the same malformed IR', () => {
  assert.doesNotMatch(compile(source), /_cooperateTicks/);
  assert.equal(compileIRUntrusted(compileToIR(source)), compileUntrusted(source));
  assert.throws(() => compileUntrusted('pub fnc main(): int { return 1 / 0; }'), /error:/);
  assert.throws(() => compileUntrusted('pub fnc main(): int { return main(); }'), /recursive call cycle/);
});
