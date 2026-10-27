import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

const guestReachable = [
  '../src/select-runtime.mjs',
  '../src/selectable-i64-channel.mjs',
  '../src/selectable-i64-future.mjs',
  '../src/select-continuation-fence.mjs',
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
  [/(?:from\s+|import\s*\()(['"])node:fs(?:\/promises)?\1/, 'Node filesystem APIs (including fs/promises; filesystem worker-pool offload is not strict nonblocking I/O)'],
  [/\bprocess\.getBuiltinModule\s*\(/, 'dynamic Node builtin acquisition'],
  [/\bcreateRequire\s*\(/, 'dynamic CommonJS builtin acquisition'],
  [/\bprocess\.binding\s*\(/, 'internal Node binding acquisition'],
  [/\b(?:readFile|writeFile|appendFile|open|close|stat|lstat|readdir|mkdir|rm|unlink|rename|copyFile)Sync\b/, 'synchronous filesystem API'],
  [/\b(?:exec|execFile|spawn)Sync\b/, 'synchronous child-process API'],
  [/\bAtomics\.wait\s*\(/, 'Atomics.wait'],
  [/\.wait\s*\(/, 'blocking wait primitive'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\b(?:Deno|Bun)\.(?:readTextFileSync|readFileSync|writeTextFileSync|writeFileSync)\b/, 'synchronous alternative-runtime filesystem API']
];

function stripComments(source) {
  let out = '';
  let mode = 'code';
  let quote = '';
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; }
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode === 'string') {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      mode = 'string'; quote = c; out += c; continue;
    }
    out += c;
  }
  if (mode === 'block' || mode === 'string') throw Error('unterminated source while auditing guest runtime');
  return out;
}

function assertAsyncOnly(label, source) {
  const code = stripComments(source);
  for (const [pattern, description] of forbidden) {
    assert.doesNotMatch(code, pattern, label + ': forbidden ' + description);
  }
}

test('guest-reachable JS runtime contains no blocking I/O primitives', async () => {
  for (const relative of guestReachable) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assertAsyncOnly(relative, source);
  }
});

test('generated scalar ESM remains host-import free and async-only', () => {
  const output = compile('pub fnc main(): int { return 42; }');
  assertAsyncOnly('scalar generated ESM', output);
  assert.doesNotMatch(output, /(?:from\s+|import\s*\()(['"])node:/);
  assert.doesNotMatch(output, /\brequire\s*\(/);
});

test('generated program-v2 ESM remains host-import free and async-only', () => {
  const output = compileProgramV2('pub fnc main() -> int { return 42; }');
  assertAsyncOnly('program-v2 generated ESM', output);
  assert.doesNotMatch(output, /(?:from\s+|import\s*\()(['"])node:/);
  assert.doesNotMatch(output, /\brequire\s*\(/);
});

test('policy gate catches representative blocking adapters', () => {
  for (const source of [
    'const x = fs.readFileSync(path);',
    'const {spawnSync: run} = child; run(cmd);',
    'Atomics.wait(view, 0, 0);',
    'Deno.readTextFileSync(path);',
    'worker.wait();',
    "import {readFile} from 'node:fs/promises';",
    "const fs = process.getBuiltinModule('fs');",
    "const req = createRequire(import.meta.url);"
  ]) {
    assert.throws(() => assertAsyncOnly('synthetic', source), assert.AssertionError);
  }
  assert.doesNotThrow(() => assertAsyncOnly('comment-only',
    '// readFileSync(path)\nconst value = Promise.resolve(1);'));
});
