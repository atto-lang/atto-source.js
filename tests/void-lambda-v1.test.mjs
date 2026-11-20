import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, check} from '../src/compiler.mjs';

const forms = [
  '|int foo, string x| -> { return; };',
  '|foo: int, x: string| -> { return; }',
  '|foo: int, x: string| -> void { return; }',
  '|foo: int, x: string| : void -> { return; }'
];
const guest = (form, suffix = 'v(5, "ok");\nreturn 42;') =>
  'pub fnc main(): int {\nconst v = ' + form + '\n' + suffix + '\n}';

test('four equivalent void lambdas emit deterministic actual runnable ESM', async () => {
  for (const form of forms) {
    const source = guest(form);
    const code = compile(source);
    assert.equal(code, compile(source), 'deterministic emitted JS: ' + form);
    assert.equal(check(source), true);
    const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
    assert.equal(mod.main(), 42n, form);
    assert.match(code, /function _lambda/);
    assert.doesNotMatch(code, /(?:eval\s*\(|new Function|process\.exit|globalThis\.)/);
  }
});

test('mixed parameter orders type-check and invoke with preserved argument order', async () => {
  for (const form of [
    '|int foo, x: string| : void -> { return; };',
    '|foo: int, string x| -> void { return; };'
  ]) {
    const code = compile(guest(form));
    const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
    assert.equal(mod.main(), 42n);
  }
});

test('void lambda rejects forged execution effects, malformed signatures, arity and types', () => {
  for (const form of [
    '|int foo, foo: string| -> { return; };',
    '|void foo, string x| -> { return; };',
    '|int foo, string x| : int -> { return; };',
    '|int foo, string x| : void { return; };',
    '|int foo, string x| -> void { return 7; };',
    '|int foo, string x| -> { process.exit(1); };',
    '|int foo, string x| -> { return; }; let y = 3;',
    '|int foo, string x| -> { return; } v(5, "ok");'
  ]) assert.throws(() => compile(guest(form)), /error:/, form);

  for (const invalidSource of [
    guest(forms[0], 'v(5, 3);\nreturn 42;'),
    guest(forms[0], 'v(5, "ok", "extra");\nreturn 42;'),
    guest(forms[0], 'v(5, "ok");\nreturn 9223372036854775808;'),
    guest(forms[0], 'v(5, "ok");\nglobalThis.pwn();\nreturn 42;'),
    guest(forms[0], 'other(5, "ok");\nreturn 42;'),
    guest(forms[0], 'v(5, "\\u006f");\nreturn 42;')
  ]) assert.throws(() => compile(invalidSource), /error:/);

  // No silent reinterpretation as an ordinary scalar expression or access
  // to the unsafe scalar IR compiler contract.
  assert.throws(() => compileToIR(guest(forms[0])), /error:/);
  assert.doesNotThrow(() => compile('pub fnc main(): int { return 40 + 2; }'));
});

test('shared four negative fixture families retain exact diagnostic codes', () => {
  const cases = [
    ['|int foo, foo: string| -> { return; };', 'E_DUPLICATE'],
    ['|foo: int, x: string| : void -> { return 7; };', 'E_TYPE'],
    ['|void foo, string x| : void -> { return; };', 'E_TYPE'],
    ['|foo: int, x: string| -> void return;', 'E_SYNTAX']
  ];
  for (const [form, code] of cases) {
    assert.throws(() => compile(guest(form)), {code}, form);
  }
});
