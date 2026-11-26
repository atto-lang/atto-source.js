import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

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
