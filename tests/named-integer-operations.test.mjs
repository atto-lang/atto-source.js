// Raw % remains reserved in both compilers. Program-v2 admits canonical
// integer ^^ and caret returns; the legacy scalar profile is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileProgramV2} from '../src/program-v2.mjs';
import {compile} from '../src/compiler.mjs';

const MIN = '(-9223372036854775807 - 1)';
const COMPILERS = {'program-v2': compileProgramV2, 'scalar': compile};

async function evaluate(compiler, source) {
  const dir = await mkdtemp(join(tmpdir(), 'ores-named-int-'));
  try {
    const file = join(dir, 'program.mjs');
    await writeFile(file, compiler(source));
    return (await import(pathToFileURL(file).href)).main();
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}
const intMain = expr => 'pub fnc main(): int { return ' + expr + '; }';
const boolMain = expr => 'pub fnc main(): bool { return ' + expr + '; }';

for (const [label, compiler] of Object.entries(COMPILERS)) {
  test(label + ': Integer.rem, Integer.mod and Integer.bitXor match signed-i64 semantics', async () => {
    for (const [expr, expected] of [
      ['Integer.rem(-9, 4)', -1n], ['Integer.rem(9, -4)', 1n], ['Integer.rem(-9, -4)', -1n],
      ['Integer.rem(' + MIN + ', -1)', 0n], ['Integer.rem(5, ' + MIN + ')', 5n],
      ['Integer.mod(-9, 4)', 3n], ['Integer.mod(-9, -4)', 3n], ['Integer.mod(9, -4)', 1n],
      ['Integer.mod(' + MIN + ', -1)', 0n], ['Integer.mod(-1, ' + MIN + ')', 9223372036854775807n],
      ['Integer.bitXor(5, 3)', 6n], ['Integer.bitXor(' + MIN + ', 9223372036854775807)', -1n],
      ['Integer.rem(17, 5) * 3 + 4', 10n],
    ]) assert.equal(await evaluate(compiler, intMain(expr)), expected, expr);
  });

  test(label + ': Integer.mod by zero reports the checked division-by-zero code', async () => {
    await assert.rejects(evaluate(compiler, intMain('Integer.mod(5, 0)')), /ORES_I64_DIVISION_BY_ZERO/);
  });

  test(label + ': reserved operators are rejected with their replacement', () => {
    for (const [source, message] of [
      [intMain('9 % 4'), /'%' is reserved.*Integer\.rem/],
      [intMain('5 ^ 3'), label==='program-v2'?/E_OPERATOR_CARET.*\^\^/:/'\^' is reserved.*Integer\.bitXor/],
      [boolMain('true ^^ false'), label==='program-v2'?/boolean expression required/:/'\^\^' is reserved.*Xor\(a, b\)/],
      [intMain('Integer.pow(2, 3)'), /Integer\.pow is unsupported/],
    ]) assert.throws(() => compiler(source), message, source);
  });
}

test('program-v2: Integer.rem by zero reports the checked division-by-zero code', async () => {
  await assert.rejects(evaluate(compileProgramV2, intMain('Integer.rem(5, 0)')), /ORES_I64_DIVISION_BY_ZERO/);
});

test('program-v2: Xor(a, b) truth table', async () => {
  for (const [a, b, expected] of [
    ['true', 'true', false], ['true', 'false', true], ['false', 'true', true], ['false', 'false', false],
  ]) assert.equal(await evaluate(compileProgramV2, boolMain('Xor(' + a + ', ' + b + ')')), expected, a + ',' + b);
});

test('program-v2: Xor(a, b) evaluates both arguments, left first', async () => {
  // A trapping right argument must run whichever value the left one has.
  for (const left of ['true', 'false'])
    await assert.rejects(
      evaluate(compileProgramV2, boolMain('Xor(' + left + ', Integer.rem(1, 0) == 0)')),
      /ORES_I64_DIVISION_BY_ZERO/, 'left ' + left);
  // The left argument's failure wins over the right argument's.
  await assert.rejects(
    evaluate(compileProgramV2, boolMain('Xor(Integer.rem(1, 0) == 0, 9223372036854775807 + 1 == 0)')),
    /ORES_I64_DIVISION_BY_ZERO/);
});

test('program-v2: malformed calls and shadowing are rejected, not silently rebound', () => {
  for (const [source, message] of [
    [intMain('Integer.rem(5)'), /requires two arguments/],
    [intMain('Integer.rem(5, 2, 1)'), /requires two arguments/],
    [intMain('Integer.rem(a: 5, b: 2)'), /positional arguments/],
    [boolMain('Xor(a: true, b: false)'), /positional arguments/],
    ['pub fnc Xor(bool a, bool b): bool { return a; }\n' + boolMain('Xor(true, true)'), /'Xor' is a reserved builtin name/],
    ['define module Integer as\n  pub fnc rem(int a, int b): int { return 7; }\nend\n' + intMain('Integer.rem(1, 2)'),
      /reserved portable intrinsic module name Integer/],
  ]) assert.throws(() => compileProgramV2(source), message, source);
});

test('program-v2: canonical integer XOR agrees with named bitXor', async()=>{
  assert.equal(await evaluate(compileProgramV2,intMain('5 ^^ 3')),6n);
  assert.equal(await evaluate(compileProgramV2,intMain('Integer.bitXor(5, 3)')),6n);
});
