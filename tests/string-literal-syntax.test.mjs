import test from 'node:test';
import assert from 'node:assert/strict';
import {scanStringLiteral} from '../src/string-literal-syntax.mjs';
import {compile, compileToIR} from '../src/compiler.mjs';

test('single and double quoted source literals are atomic and quote-safe', () => {
  for (const source of [
    "'single'", '"double"', "'a\\'b'", '"a\\\"b"',
    "'opposite \"quote\"'", '"opposite \'quote\'"',
    "'line\\\ncontinued'", "'unicode \\u0041'", '"hex \\x41"',
    "'raw\nnewline'", "'\\q'", "'\\x0G'", "'\\uD83D\\uDE00'"
  ]) {
    const value = scanStringLiteral(source);
    assert.equal(value.kind, 'string', source);
    assert.equal(value.end, source.length, source);
    assert.equal(value.parts.length, 1, source);
    assert.equal(value.parts[0].raw, source.slice(1, -1), source);
  }
});

test('templates keep raw multiline and balanced nested interpolations', () => {
  const source = '`start ${call({a: "}", b: 1}, /* { */ `nested ${other}`)} end`';
  const scanned = scanStringLiteral(source);
  assert.equal(scanned.kind, 'template');
  assert.equal(scanned.end, source.length);
  assert.equal(scanned.parts.filter(part => part.kind === 'interpolation').length, 1);
  assert.match(scanned.parts[1].source, /nested/);
  for (const literal of ['`raw\nline`', '`escaped \\${not_interpolation}`']) {
    const parsed = scanStringLiteral(literal);
    assert.equal(parsed.parts.filter(part => part.kind === 'interpolation').length, 0);
  }
});

test('literal parser is bounded and fails closed on malformed strings', () => {
  for (const source of [
    "'unclosed", "'\\u12X4'", "'\\uD800'", "'\\uDFFF'", "'\\u{1f600}'",
    '`invalid \\x41`', '`invalid \\q`', '`invalid \\u{1f600}`',
    '`comment only ${/* comment */}`',
    '`line comment only ${ // ignored\n }`',
    '`bad ${  }`', '`bad ${call(1)`', '`bad ${/* unterminated}`',
    '`bad ${"unterminated}`', '`bad ${a /* ${ */ + b`'
  ]) assert.throws(() => scanStringLiteral(source), SyntaxError, source);
  assert.throws(() => scanStringLiteral('`x ${`'.repeat(70)), SyntaxError);
});

test('i64 scalar compiler preserves lexical boundaries, but rejects typed String lowering', () => {
  const expr = src => 'pub fnc main(): int { return ' + src + '; }';
  for (const literal of ["'select { hidden }'", '"/* hidden */"', '`select ${x} end`']) {
    assert.throws(() => compileToIR(expr(literal)),
      /quoted strings and template interpolation require typed String lowering/,literal);
    assert.throws(() => compile(expr(literal)),
      /quoted strings and template interpolation require typed String lowering/,literal);
  }
  for (const bad of ["'\\u12X4'", '`invalid \\q`', '`bad ${oops`']) {
    assert.throws(() => compile(expr(bad)),
      /unterminated|invalid Unicode escape|invalid template escape/,bad);
  }
  // Existing signed-i64 path remains executable, and comments remain trivia.
  assert.doesNotThrow(() => compile('pub fnc main(): int { /* ` ${ } */ return 42; }'));
});
