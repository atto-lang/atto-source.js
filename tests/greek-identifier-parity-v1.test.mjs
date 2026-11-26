import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR} from '../src/compiler.mjs';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

import {isIdentifier} from '../src/portable-unicode-identifier-v1.mjs';

const run = async (compiler, source) =>
  import('data:text/javascript,' + encodeURIComponent(compiler(source)));

test('scalar source and IR resolve Greek parameters by slot, not spelling at runtime', async () => {
  const greek = 'pub fnc sum(int φ, int π, int ε, int ρ): int { return φ + π + ε + ρ; }';
  const ascii = 'pub fnc sum(int a, int b, int c, int d): int { return a + b + c + d; }';
  const mod = await run(compile, greek);
  assert.equal(mod.sum(10n, 20n, 30n, 40n), 100n);
  assert.equal(compile(greek), compile(ascii));
  assert.equal(compileToIR(greek).functions.length, 1);
});

test('program v2 resolves Greek locals, parameters, case and script distinctly', async () => {
  const source = 'pub fnc main(int φ, int π): int { let int ε = 30; let int ρ = 40; let int p = 2; let int Φ = 3; let int ε_value = ε; let int xφ = Φ; let int ρ2 = ρ; return φ + π + ε_value + ρ2 + p + xφ; }';
  const mod = await run(compileProgramV2, source);
  assert.equal(mod.main(10n,20n),105n);
});

test('Greek name failures do not bypass source or binding checks', () => {
  for (const compiler of [compile, compileProgramV2]) {
    assert.throws(() => compiler('pub fnc main(): int { return ρ; }'), /unresolved|unbound/);
    assert.throws(() => compiler('pub fnc main(int ρ, int ρ): int { return ρ; }'), /duplicate|shadow/);
    assert.throws(() => compiler('pub fnc main(int ρ\u202e): int { return ρ; }'), /bidirectional|bidi/i);
    assert.throws(() => compiler('pub fnc main(int ∑): int { return 1; }'));
  }
  assert.throws(() => compileProgramV2('pub fnc main(): int { return #ρ; }'), /Symbol/);
});

test('Han source, uppercase Greek, and supplementary scalars resolve without aliasing', async () => {
  const scalar = 'pub fnc 合計(int 数量, int 價格, int 𠮷, int Ω): int { return 数量 + 價格 + 𠮷 + Ω; }';
  assert.equal((await run(compile,scalar)).合計(3n,7n,11n,2n),23n);
  const source = 'pub fnc main(int 数量, int 價格): int { let int 結果 = 数量 * 價格; let int 价格 = 2; let int 𠮷 = 3; let int x変数 = 4; let int Ω = 5; let int ω = 6; return 結果 + 价格 + 𠮷 + x変数 + Ω + ω; }';
  assert.equal((await run(compileProgramV2,source)).main(3n,7n),41n);
});

test('portable Unicode validator retains identifier budget, spelling, and scalar boundaries', () => {
  for(const s of ['Φ','Π','Ε','Ρ','数量','價格','変数','𠮷','x𠮷2','〇','ρ2'])
    assert.ok(isIdentifier(s),s);
  for(const s of ['¬','¬a','∑','1変数','a\n','a\u202e','\ud800','𠮷'.repeat(65)])
    assert.equal(isIdentifier(s),false,JSON.stringify(s));
  assert.ok(isIdentifier('𠮷'.repeat(64)));
});

test('Unicode negation is the exact typed Boolean NOT alias, not a bang suffix', async () => {
  const ascii = 'pub fnc negate(bool value): bool { return !value; }';
  const unicode = ascii.replace('!value','¬value');
  assert.deepEqual(compileToProgramIRV2(unicode),compileToProgramIRV2(ascii));
  assert.equal(compileProgramV2(unicode),compileProgramV2(ascii));
  const mod = await run(compileProgramV2,
    'pub fnc negate(bool b): bool { return ¬b; } pub fnc twice(bool b): bool { return ¬¬b; } pub fnc precedence(bool a, bool b): bool { return ¬a && b; }');
  for(const a of [false,true]){
    assert.equal(mod.negate(a),!a);
    assert.equal(mod.twice(a),a);
    for(const b of [false,true])assert.equal(mod.precedence(a,b),!a&&b);
  }
  for(const source of [
    'pub fnc main(): bool { return ¬1; }',
    'pub fnc main(bool b): bool { return b¬; }',
    'pub fnc main(bool b): bool { return b ¬ true; }',
    'pub fnc main(bool b): bool { return b ¬= true; }',
    'pub fnc main(bool b): bool { return b ¬eq true; }',
    'pub fnc main(): int { return #価格; }'
  ])assert.throws(()=>compileProgramV2(source),undefined,source);
});
