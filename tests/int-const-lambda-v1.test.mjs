import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, check} from '../src/compiler.mjs';

// These actually import and invoke generated ESM. They do not claim a
// browser-Wasm, general closure or non-scalar source-language implementation.
const local = (head, call = 'return v(41);') =>
  `pub fnc main(): int { const fnc v = ${head} ${call} }`;
const moduleScope = (head, call = 'return v(41);') =>
  `const fnc v = ${head} pub fnc main(): int { ${call} }`;
async function guest(source) {
  const code = compile(source);
  assert.equal(code, compile(source), 'deterministic compiled output');
  assert.equal(check(source), true);
  assert.doesNotMatch(code, /(?:eval\s*\(|new Function|globalThis\.|process\.exit)/);
  const mod = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
  return mod.main();
}

test('six scalar const fnc sources compile to real executing ESM guest', async () => {
  assert.equal(await guest(local('|_| : int -> 5;')), 5n);
  assert.equal(await guest(local('|_| : int -> 5;', 'return v(true);')), 5n);
  assert.equal(await guest(local('|| : int -> 5;', 'return v();')), 5n);
  assert.equal(await guest(local('|int x| : int -> x + 1;')), 42n);
  assert.equal(await guest(local('|x: int| : int -> x + 1;')), 42n);
  assert.equal(await guest(moduleScope('|int _| : int -> 5;')), 5n);
  // No reinterpretation through the untyped legacy scalar IR parser.
  assert.throws(() => compileToIR(local('|_| : int -> 5;')), /error:/);
});

test('invalid lambda heads, arity, scopes, capture and types fail closed', () => {
  const cases = [
    [local('_ : int -> 5;'), 'E_SYNTAX'],
    [local('x : int -> x + 1;'), 'E_SYNTAX'],
    [local('|| : int -> 5;'), 'E_ARITY'],
    [local('|_| : int -> 5;', 'return v();'), 'E_ARITY'],
    [moduleScope('|_| : int -> 5;'), 'E_INFER'],
    ['pub fnc main(): int { val runtime = 41; const fnc v = |_| : int -> runtime; return v(41); }', 'E_CONST'],
    [local('|int x, int x| : int -> x;', 'return v(3, 4);'), 'E_DUPLICATE'],
    [local('|bool x| : int -> x;', 'return v(true);'), 'E_TYPE'],
    [local('|_| : int -> _;'), 'E_CONST'],
    [local('|int x| : int -> x + 1;', 'return v(true);'), 'E_TYPE'],
    [local('|int x| : int -> x + 1;', 'return v(9223372036854775808);'), 'E_TYPE'],
    [local('|int x| : int -> x + 1;', 'return other(41);'), 'E_CONST'],
    [local('|x| : int -> x + 1;', 'return v(true);'), 'E_TYPE'],
    [moduleScope('|int x| : int -> x + 1;', 'return v();'), 'E_ARITY'],
    ['const fnc v = _ : int -> 5; pub fnc main(): int { return v(41); }', 'E_SYNTAX'],
  ];
  for (const [source, code] of cases)
    assert.throws(() => compile(source), {code}, source);
});

test('compiled scalar guest traps signed i64 overflow rather than wrapping', async () => {
  const source = local('|int x| : int -> x + 1;', 'return v(9223372036854775807);');
  const mod = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compile(source)));
  assert.throws(() => mod.main(), /E_OVERFLOW/);
});

test('legacy checked path and previously executable typed void lambdas remain distinct', async () => {
  const source = 'pub fnc main(): int { return 40 + 2; }';
  assert.doesNotThrow(() => compile(source));
  const v = 'pub fnc main(): int { const v = |int x| -> { return; }; v(5); return 42; }';
  const mod = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compile(v)));
  assert.equal(mod.main(), 42n);
});
