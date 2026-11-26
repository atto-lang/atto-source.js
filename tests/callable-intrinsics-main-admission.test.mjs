import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, IncrementalSession, CompileError} from '../src/compiler.mjs';

const source = 'pub fnc main(): int { const fnc f = |int x| : int -> x + 1; return f.apply((41,)); }';

test('closed callable dispatch runs through current compiler entry point', async () => {
  const direct = source.replace('f.apply((41,))', 'f(41)');
  const pipeline = source.replace('f.apply((41,))', '(41,) |> f.apply');
  const expected = compile(direct);
  for (const candidate of [source, pipeline]) {
    const code = compile(candidate);
    assert.equal(code, expected);
    const guest = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
    assert.equal(guest.main(), 42n);
  }
  assert.throws(() => compileToIR(source), /error:/);
  assert.throws(() => new IncrementalSession().build(source), /error:/);
});

test('callable dispatch preserves current source admission gates', () => {
  for (const [prefix,diagnostic] of [
    ['//\x1b\n', /terminal control/],
    ['//\u202e\n', /bidirectional Unicode control/],
    ['//\u0000\n', /NUL in source/],
    ['//\ud800\n', /invalid UTF-16/],
    ['// oreslang:checked-i64\n', /checked-i64 source requires program-v2/],
  ]) assert.throws(() => compile(prefix+source), diagnostic);
  assert.throws(() => compile(source.replace('f.apply((41,))','copy! f.apply((41,))')), /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/);
  assert.throws(() => compile(source.replace('f.apply((41,))','f.try_publish(41)')), /Topic.try_publish/);
  assert.throws(() => compile(source.replace('f.apply((41,))','(41,) | > f.apply')), /error:/);
  assert.throws(() => compile('@noalloc '+source), /error:/);
});

test('ordinary scalar and incremental entrypoints remain equivalent', () => {
  const ordinary='pub fnc main(): int { return 40 + 2; }';
  assert.equal(new IncrementalSession().build(ordinary).code, compile(ordinary));
  assert.equal(compile('// literal | in comment\n'+ordinary), compile(ordinary));
  assert.throws(() => compile('pub fnc main(): int { return 40 | 2; }'), /error:/);
});

test('unrelated bar syntax retains the scalar compiler diagnostic type', () => {
  for (const text of [
    'pub fnc main(): int { this.handle_state(critical-write |s| -> { s.counter += 1; }); return 42; }',
    'pub fnc main(): int { this.handle_state(critical-read |s| -> { s.counter; }); return 42; }',
    'pub fnc main(): int { return 40 | 2; }',
  ]) {
    for (const entry of [compile, compileToIR])
      assert.throws(() => entry(text), error => error instanceof CompileError && /^error: /.test(error.message), text);
  }
});
