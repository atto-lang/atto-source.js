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

test('raw Unicode surrogate pairs are valid but isolated code units are denied', () => {
  for (const quote of ["'", '"', '`']) {
    const pair = quote + String.fromCharCode(0xd83d, 0xde00) + quote;
    assert.equal(scanStringLiteral(pair).end, pair.length);
    for (const isolated of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
      const bad = quote + String.fromCharCode(isolated) + quote;
      assert.throws(() => scanStringLiteral(bad), /unpaired Unicode surrogate/);
    }
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
    '`invalid \\' + '\n' + 'newline`',
    '`comment only ${/* comment */}`',
    '`line comment only ${ // ignored\n }`',
    '`bad ${  }`', '`bad ${call(1)`', '`bad ${/* unterminated}`',
    '`bad ${"unterminated}`', '`bad ${a /* ${ */ + b`'
  ]) assert.throws(() => scanStringLiteral(source), SyntaxError, source);
  assert.throws(() => scanStringLiteral('`x ${`'.repeat(70)), SyntaxError);
});

test('Java-v1 interpolation, brace and template depth limits are exact', () => {
  const tick = '`';
  const many = n => tick + '${"x"}'.repeat(n) + tick;
  assert.equal(scanStringLiteral(many(1024)).end, many(1024).length);
  assert.throws(() => scanStringLiteral(many(1025)), /template substitution limit/);
  const braces = n => tick + '${' + '{'.repeat(n) + 'x' + '}'.repeat(n) + '}' + tick;
  assert.equal(scanStringLiteral(braces(255)).end, braces(255).length);
  assert.throws(() => scanStringLiteral(braces(256)), /brace nesting limit/);
  const nested = n => tick + '${`'.repeat(n) + 'x' + '`}'.repeat(n) + tick;
  assert.equal(scanStringLiteral(nested(16)).end, nested(16).length);
  assert.throws(() => scanStringLiteral(nested(17)), /nesting limit/);
});
test('deterministic quote/template source fuzz remains bounded', () => {
  let state = 0xc01d1234;
  const alphabet = "abc01{}$/*'\"`\\\\ \\n\\rux()";
  for (let k = 0; k < 24000; k++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let source = k % 3 === 0 ? "'" : k % 3 === 1 ? '"' : '`';
    const size = state % 120;
    for (let j = 0; j < size; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      source += alphabet[state % alphabet.length];
    }
    if ((k & 1) === 0) source += source[0];
    try {
      const value = scanStringLiteral(source);
      assert.ok(value.end > 0 && value.end <= source.length);
    } catch (error) {
      assert.ok(error instanceof SyntaxError, String(error));
    }
  }
});
test('Unicode UTF-8 source with multiline template and comments stays bounded', () => {
  const alphabet = ['a', 'b', '{', '}', '$', '/', '*', '`',
    '\\', '\"', "'", ' ', '\n', '\r', '\u0085', '\u2028',
    '\u2029', 'é', '💻', '中', '\t', 'x'];
  let state = 0x42ff3391;
  for (let k = 0; k < 30000; k++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let source = k % 3 === 0 ? "'" : k % 3 === 1 ? '\"' : '`';
    const count = state % 100;
    for (let j = 0; j < count; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      source += alphabet[state % alphabet.length];
    }
    if ((k & 1) === 0) source += source[0];
    try {
      const parsed = scanStringLiteral(source);
      assert.ok(parsed.end > 0 && parsed.end <= source.length);
      assert.ok(parsed.raw.length > 0);
    } catch (error) {
      assert.ok(error instanceof SyntaxError, String(error));
    }
  }
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
