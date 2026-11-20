import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile, compileToIR, check} from '../src/compiler.mjs';

// This suite gates the legacy scalar subset only. It does NOT certify full
// guest AOT, zero-GC, ownership/actor runtime support, or program-v2 parity.
const prefix = 'pub fnc main(): int { return ';
const suffix = '; }';
const unsupported = [
  ['runtime-eval-call', prefix + 'eval(1)' + suffix],
  ['runtime-proxy-constructor', prefix + 'Proxy(1)' + suffix],
  ['unregistered-reflection', prefix + 'reflect(1)' + suffix],
  ['dynamic-class-expression', prefix + 'new Proxy(1)' + suffix],
  ['host-global-access', prefix + 'process.exit(1)' + suffix],
  ['dynamic-import', prefix + 'import(1)' + suffix],
  ['unsupported-power-operator', prefix + '2 ^ 3' + suffix],
  ['unsupported-double-caret', prefix + '2 ^^ 3' + suffix],
  ['inline-monkey-patch', 'pub fnc main(): int { return 42; } Foo.prototype.method = 1;'],
  ['runtime-closure-transport', 'pub fnc main(): int { send(channel, closure); return 42; }'],
  ['raw-pointer-borrow', prefix + '&value' + suffix],
  ['untyped-ownership-transfer', prefix + 'rt take value' + suffix],
];

for (const [name, source] of unsupported) {
  test('scalar subset fails closed before JS emission: ' + name, () => {
    assert.throws(() => compileToIR(source), /error:/, name);
    assert.throws(() => compile(source), /error:/, name);
    assert.throws(() => check(source), /error:/, name);
  });
}

test('keywords in ignored comments do not spuriously trigger forbidden-runtime matching', () => {
  const canonical = 'pub fnc main(): int { return 42; }';
  const comments = [
    '// eval(1) new Proxy(1) import(1)',
    '/* eval(1) new Proxy(1) import(1) */',
    '/* outer /* eval(1) */ new Proxy(1) */',
  ];
  for (const comment of comments) {
    assert.equal(compile(canonical + '\n' + comment), compile(canonical));
  }
});

test('ordinary symbols named eval or Proxy never grant host eval or proxy capability', () => {
  const generated = compile('pub fnc eval(): int { return 42; } pub fnc Proxy(): int { return eval(); }');
  assert.doesNotMatch(generated, /\beval\s*\(/);
  assert.doesNotMatch(generated, /\bnew\s+Proxy\s*\(/);
  assert.doesNotMatch(generated, /\bFunction\s*\(/);
  assert.doesNotMatch(generated, /\bimport\s*\(/);
  assert.match(generated, /export/);
});

test('CLI does not publish generated JS for denied runtime code generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atto-js-aot-deny-'));
  const source = join(dir, 'denied.ores');
  const output = join(dir, 'denied.mjs');
  try {
    await writeFile(source, prefix + 'eval(1)' + suffix, {mode: 0o600});
    const run = spawnSync(process.execPath,
      [resolve('bin/oreslang-jsc.mjs'), source, '--out=' + output], {encoding: 'utf8'});
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /error:/);
    await assert.rejects(readFile(output), {code: 'ENOENT'});
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
