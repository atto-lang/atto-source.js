import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileUntrusted,compileIRUntrusted,compileToIR} from '../src/compiler.mjs';

const source = 'pub fnc main(): int { return 7; }';

test('untrusted scalar entry budget polls once every 128 guest entries', async () => {
  const output = compileUntrusted(source);
  assert.match(output, /if\(\+\+_cooperateTicks!==128\)return/);
  assert.match(output, /if\(--_remainingPolls===0\)/);
  const module = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(output));
  // At 128, 256, ... 4096 entries, 32 slow-path checks have fired.
  for (let i = 0; i < 4095; ++i) assert.equal(module.main(), 7n);
  const terminal = error => error?.code === 'ATTO_GUEST_FUEL_EXHAUSTED' &&
    /untrusted execution budget exceeded/.test(error.message);
  assert.throws(() => module.main(), terminal);
  assert.throws(() => module.main(), terminal);
});

test('trusted output unchanged; untrusted rejects the same malformed IR', () => {
  assert.doesNotMatch(compile(source), /_cooperateTicks/);
  assert.equal(compileIRUntrusted(compileToIR(source)), compileUntrusted(source));
  assert.throws(() => compileUntrusted('pub fnc main(): int { return 1 / 0; }'), /error:/);
  assert.throws(() => compileUntrusted('pub fnc main(): int { return main(); }'), /recursive call cycle/);
});

test('entry quota is shared among distinct exports, not reset per public function', async () => {
  const output = compileUntrusted(
    'pub fnc first(): int { return 11; } '+
    'pub fnc second(): int { return 22; }');
  const module = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(output));
  for (let i = 1; i <= 4095; ++i)
    assert.equal(i % 2 ? module.first() : module.second(),i % 2 ? 11n : 22n);
  assert.throws(() => module.second(),error=>error?.code==='ATTO_GUEST_FUEL_EXHAUSTED');
  assert.throws(() => module.first(),error=>error?.code==='ATTO_GUEST_FUEL_EXHAUSTED');
});

test('nested helper entries consume the same quota as entrypoints', async () => {
  const output = compileUntrusted(
    'fnc helper(): int { return 7; } '+
    'pub fnc main(): int { return helper(); }');
  const module = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(output));
  for (let i=0;i<2047;++i) assert.equal(module.main(),7n);
  assert.throws(() => module.main(),error=>error?.code==='ATTO_GUEST_FUEL_EXHAUSTED');
});
