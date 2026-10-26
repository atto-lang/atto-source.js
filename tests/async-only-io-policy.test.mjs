import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile} from '../src/compiler.mjs';

const guestReachable = [
  '../src/compiler.mjs',
  '../src/freestanding-core.mjs',
  '../src/freestanding-core-link.mjs',
  '../src/program-v2.mjs',
  '../src/host-bridge.mjs',
  '../src/host-bridge.node.mjs',
  '../src/actor-host.node.mjs',
  '../src/actor-host.browser.mjs',
  '../src/worker-actor-client.mjs',
  '../src/worker-actor-endpoint.mjs',
  '../src/worker-actor.node.mjs',
  '../src/worker-actor.browser.mjs'
];

const forbidden = [
  'readFileSync', 'writeFileSync', 'appendFileSync', 'openSync(', 'readSync(',
  'writeSync(', 'execSync(', 'execFileSync(', 'spawnSync(', 'Atomics.wait(',
  '.wait()', '.wait(', 'XMLHttpRequest'
];

test('guest-reachable JS runtime contains no blocking I/O primitives', async () => {
  for (const relative of guestReachable) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, relative + ' contains forbidden blocking token ' + token);
    }
  }
});

test('generated scalar ESM does not smuggle host I/O or sync fallbacks', () => {
  const output = compile('pub fnc main(): int { return 42; }');
  for (const token of [...forbidden, 'node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process']) {
    assert.equal(output.includes(token), false, 'generated output contains host/blocking token ' + token);
  }
  assert.equal(/\bimport\s/.test(output), false, 'scalar output must remain host-import free');
});
