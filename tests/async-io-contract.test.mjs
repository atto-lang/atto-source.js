import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

import {compile} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const guestReachableRuntime = [
  'src/actor-host.browser.mjs',
  'src/actor-host.node.mjs',
  'src/worker-actor-client.mjs',
  'src/host-bridge.mjs',
  'src/host-bridge.node.mjs',
  'src/freestanding-core.mjs',
  'src/freestanding-core-link.mjs',
];

const forbidden = [
  [/(?:from\s+|import\s*\()(['"])node:fs\1/, 'node:fs (use node:fs/promises in host adapters)'],
  [/\b(?:readFile|writeFile|appendFile|open|close|stat|lstat|readdir|mkdir|rm|unlink|rename|copyFile)Sync\b/, 'synchronous filesystem API'],
  [/\b(?:exec|execFile|spawn)Sync\b/, 'synchronous child-process API'],
  [/\bAtomics\.wait\s*\(/, 'Atomics.wait'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest (sync mode cannot be admitted)'],
  [/\b(?:Deno|Bun)\.(?:readTextFileSync|readFileSync|writeTextFileSync|writeFileSync)\b/, 'synchronous alternative-runtime filesystem API'],
];

function assertAsyncOnly(label, source) {
  for (const [pattern, description] of forbidden) {
    assert.doesNotMatch(source, pattern, label + ': forbidden ' + description);
  }
}

test('guest-reachable runtime modules contain no blocking I/O primitives', async () => {
  for (const relative of guestReachableRuntime) {
    const source = await readFile(resolve(root, relative), 'utf8');
    assertAsyncOnly(relative, source);
  }
});

test('generated scalar ESM does not acquire blocking or ambient host I/O', () => {
  const generated = compile('pub fnc main(): int { return 42; }');
  assertAsyncOnly('scalar generated ESM', generated);
  assert.doesNotMatch(generated, /(?:from\s+|import\s*\()(['"])node:/);
  assert.doesNotMatch(generated, /\brequire\s*\(/);
});

test('generated program-v2 ESM does not acquire blocking or ambient host I/O', () => {
  const generated = compileProgramV2('pub fnc main() -> int { return 42; }');
  assertAsyncOnly('program-v2 generated ESM', generated);
  assert.doesNotMatch(generated, /(?:from\s+|import\s*\()(['"])node:/);
  assert.doesNotMatch(generated, /\brequire\s*\(/);
});

test('guard catches representative disguised blocking adapters', () => {
  for (const source of [
    'const x = fs.readFileSync(path);',
    'const {spawnSync: run} = child; run(cmd);',
    'Atomics.wait(view, 0, 0);',
    'Deno.readTextFileSync(path);',
  ]) {
    assert.throws(() => assertAsyncOnly('synthetic', source), assert.AssertionError);
  }
});
