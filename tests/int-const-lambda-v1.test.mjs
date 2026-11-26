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
  assert.equal(await guest(local('|_, _| : int -> 5;', 'return v(41, false);')), 5n);
  assert.equal(await guest(moduleScope('|int _, bool _| : int -> 5;', 'return v(41, false);')), 5n);
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
    [local('|_, _| : int -> 5;', 'return v(41);'), 'E_ARITY'],
    [local('|_, _| : int -> _;', 'return v(41, true);'), 'E_CONST'],
    [local('|int x| : int -> x + 1;', 'return v(true);'), 'E_TYPE'],
    [local('|int x| : int -> x + 1;', 'return v(9223372036854775808);'), 'E_TYPE'],
    [local('|int x| : int -> x + 1;', 'return other(41);'), 'E_CONST'],
    [local('|x| : int -> x + 1;', 'return v(true);'), 'E_TYPE'],
    [moduleScope('|int x| : int -> x + 1;', 'return v();'), 'E_ARITY'],
    ['const fnc v = _ : int -> 5; pub fnc main(): int { return v(41); }', 'E_SYNTAX'],
    ['pub fnc main(): int { val v = fnc(int x) -> x + 1; return 0; }', 'E_SYNTAX'],
    ['pub fnc main(): int { val v = (int x) -> x + 1; return 0; }', 'E_SYNTAX'],
  ];
  for (const [source, code] of cases)
    assert.throws(() => compile(source), {code}, source);
});


test('comments containing legacy lambda heads do not activate unpiped syntax rejection', () => {
  const legal = [
    '// val v = fnc(int x) -> x + 1;\\n',
    '// val v = (int x) -> x + 1;\\n'
  ];
  for (const prefix of legal) {
    const source = prefix.replaceAll('\\n', '\n') + 'pub fnc main(): int { return 40 + 2; }';
    assert.doesNotThrow(() => compile(source), 'lexer must ignore commented-out heads');
  }
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

test('bounded scalar direct-call differential oracles and signed i64 boundaries', async () => {
  const run = async source => {
    const js = compile(source);
    const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
    return mod.main();
  };
  for (let n = -16; n <= 16; n++) {
    const offset = (n * 7) % 19;
    const scalar = local('|int x| : int -> x + ' + offset + ';', 'return v(' + n + ');');
    assert.equal(await run(scalar), BigInt(n + offset), scalar);
    const ignored = local('|_, _| : int -> 5;', 'return v(' + n + ', ' + (n % 2 === 0) + ');');
    assert.equal(await run(ignored), 5n, ignored);
    const missingArg = local('|_, _| : int -> 5;', 'return v(' + n + ');');
    assert.throws(() => compile(missingArg), {code:'E_ARITY'}, missingArg);
  }
  const min = -(1n << 63n), max = (1n << 63n) - 1n;
  for (const edge of [min, max]) {
    assert.equal(await run(local('|int x| : int -> x + 0;', 'return v(' + edge + ');')), edge);
    const increment = edge === max ? 1n : -1n;
    const js = compile(local('|int x| : int -> x + ' + increment + ';', 'return v(' + edge + ');'));
    const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(js));
    assert.throws(() => mod.main(), /E_OVERFLOW/);
  }
});

test('call and literal tuple apply emit exactly the direct callable ESM', async () => {
  const cases = [
    ['|| : int -> 42;', '', 42n],
    ['|int x| : int -> x + 1;', '41', 42n],
    ['|int x, bool _| : int -> x + 1;', '41, true', 42n],
    ['|_, _| : int -> 5;', '41, false', 5n],
    ['|int x| : int -> x + 0;', '-9223372036854775808', -(1n << 63n)],
  ];
  for (const [head,args,result] of cases) {
    const direct = local(head, 'return v(' + args + ');');
    for (const call of ['return v.call(' + args + ');', 'return v.apply(tuple(' + args + '));']) {
      const source = local(head, call);
      assert.equal(compile(source), compile(direct), source);
      assert.equal(await guest(source), result, source);
    }
  }
  const head = '|int x, bool _| : int -> x + 1;';
  assert.equal(compile(moduleScope(head, 'return v.call(41, true);')),
    compile(moduleScope(head, 'return v.apply(tuple(41, true));')));
});

test('intrinsic invocation rejects bad arity, wrong types and unsupported forms', () => {
  const head = '|int x, bool _| : int -> x + 1;';
  for (const [call,code] of [
    ['v.call(41)', 'E_ARITY'],
    ['v.call(0, 41, true)', 'E_TYPE'],
    ['v.apply(tuple(41))', 'E_ARITY'],
    ['v.apply(tuple(41, 42))', 'E_TYPE'],
    ['v.apply(tuple(41, true, 0))', 'E_ARITY'],
    ['v.apply(41, true)', 'E_SYNTAX'],
    ['v.apply(tuple(41, true), 0)', 'E_SYNTAX'],
    ['v.apply(args)', 'E_SYNTAX'],
    ['v.bind(41)', 'E_UNSUPPORTED'],
    ['other.call(41, true)', 'E_CONST'],
  ]) assert.throws(() => compile(local(head, 'return ' + call + ';')), {code}, call);
  assert.throws(() => compile('pub fnc main(): int { const fnc tuple = |int x| : int -> x; return tuple.apply(tuple(42)); }'), {code:'E_UNSUPPORTED'});
});

test('call and apply preserve checked arithmetic overflow', async () => {
  for (const call of ['v.call(9223372036854775807)', 'v.apply(tuple(9223372036854775807))']) {
    const code = compile(local('|int x| : int -> x + 1;', 'return ' + call + ';'));
    const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
    assert.throws(() => mod.main(), /E_OVERFLOW/);
  }
});

test('immutable literal tuples and immediate apply pipelines scalarize to the same ESM', async () => {
  const head = '|int x, bool _| : int -> x + 1;';
  for (let n = -20; n <= 20; n++) {
    const args = n + ', ' + (n % 2 === 0);
    const direct = local(head, 'return v(' + args + ');');
    const prefix = 'val args = tuple(' + args + '); ';
    for (const call of [
      'return tuple(' + args + ') |> v.apply;',
      prefix + 'return v.apply(args);',
      prefix + 'return args |> v.apply;',
    ]) {
      const source = local(head, call);
      assert.equal(compile(source), compile(direct), source);
      assert.equal(await guest(source), BigInt(n + 1), source);
    }
  }
});

test('scalar tuple pipeline admission rejects shadowing, escape and wrong shape', () => {
  const head = '|int x, bool _| : int -> x + 1;';
  for (const [call,code] of [
    ['return tuple(41) |> v.apply;', 'E_ARITY'],
    ['return tuple(41,42) |> v.apply;', 'E_TYPE'],
    ['return tuple(41,true) |> v.bind;', 'E_SYNTAX'],
    ['return tuple(41,true) |> other.apply;', 'E_CONST'],
    ['return tuple(41,true) |> v.apply();', 'E_SYNTAX'],
    ['return args |> v.apply;', 'E_CONST'],
    ['val v = tuple(41,true); return v.apply(args);', 'E_DUPLICATE'],
    ['val tuple = tuple(41,true); return v.apply(args);', 'E_DUPLICATE'],
    ['val args = tuple(41,true); return v.call(41,true);', 'E_UNSUPPORTED'],
    ['val args = tuple(41,true); return v.apply(tuple(41,true));', 'E_UNSUPPORTED'],
    ['val args = tuple(41,true); args = tuple(0,false); return v.apply(args);', 'E_SYNTAX'],
  ]) assert.throws(() => compile(local(head, call)), {code}, call);
});
