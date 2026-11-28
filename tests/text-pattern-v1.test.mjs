import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, P, parse, PatternError } from '../src/text-pattern-v1.mjs';

const code = (fn) => { try { fn(); } catch (e) { return e instanceof PatternError ? e.code : `other:${e}`; } return 'no-error'; };

test('classic ReDoS patterns run in linear time', () => {
  for (const src of ['(a+)+$', '(a|a)*$', '(a*)*b', '(x+x+)+y', '^(\\w+\\s?)*$']) {
    const p = compilePattern(src);
    const hostile = 'a'.repeat(20000) + '!';
    const t0 = performance.now();
    p.test(hostile.replaceAll('a', src.includes('x') ? 'x' : 'a'));
    assert.ok(performance.now() - t0 < 2000, `${src} took too long`);
  }
});

test('captures follow leftmost-first (Perl-style) priority', () => {
  assert.deepEqual(compilePattern('(\\d+)-(\\d+)').match('id 12-345 x'), { start: 3, end: 9, text: '12-345', groups: ['12', '345'] });
  assert.equal(compilePattern('a|ab').match('ab').text, 'a');
  assert.equal(compilePattern('ab|a').match('ab').text, 'ab');
  assert.equal(compilePattern('a+').match('caaat').text, 'aaa');
  assert.equal(compilePattern('a+?').match('caaat').text, 'a');
  assert.deepEqual(compilePattern('(a)|(b)').match('b').groups, [undefined, 'b']);
  assert.deepEqual(compilePattern('(?:ab)+(c)').match('ababc').groups, ['c']);
});

test('agrees with host RegExp on a deterministic corpus of safe patterns', () => {
  const cases = [
    ['[a-c]{2,3}', ['xxabcabc', 'a', 'cab']], ['^\\s*(\\w+)\\s*=\\s*(\\d+)$', ['  x = 42', 'x=', 'y=7']],
    ['colou?r', ['color colour', 'colr']], ['[^,]+', [',,a,b', '']], ['\\d{3}-\\d{4}', ['call 555-1234 now', '55-1234']],
    ['(\\w+)@(\\w+)\\.com', ['me: bob@ex.com.', 'nope@x.org']], ['a{2}b{0,1}c*', ['aabccc', 'abc', 'aac']],
    ['.+', ['line1\nline2']], ['x*', ['yyy', '']], ['(a|b)*c', ['ababc', 'abab']],
  ];
  for (const [src, inputs] of cases) {
    const ours = compilePattern(src);
    const host = new RegExp(src, 'u');
    for (const input of inputs) {
      const h = host.exec(input);
      const o = ours.match(input);
      assert.equal(o === null, h === null, `${src} on ${JSON.stringify(input)}`);
      if (h) {
        assert.equal(o.start, h.index, src);
        assert.equal(o.text, h[0], src);
        assert.deepEqual(o.groups, h.slice(1), src);
      }
    }
  }
});

test('anchors, fullMatch, matchAll and non-BMP code points', () => {
  assert.equal(compilePattern('^b').match('ab'), null);
  assert.equal(compilePattern('a$').match('aba').start, 2);
  assert.ok(compilePattern('\\d+').fullMatch('123'));
  assert.equal(compilePattern('\\d+').fullMatch('123x'), null);
  assert.deepEqual([...compilePattern('\\d+').matchAll('a1b22c333')].map((m) => m.text), ['1', '22', '333']);
  assert.deepEqual([...compilePattern('x*').matchAll('ab')].map((m) => [m.start, m.end]), [[0, 0], [1, 1], [2, 2]]);
  const emoji = compilePattern('.(.)');
  assert.deepEqual(emoji.match('😀😁').groups, ['😁'], 'dot consumes a whole code point');
  assert.ok(compilePattern('[😀-😂]').test('x😁'));
});

test('non-linear features and malformed patterns fail closed', () => {
  assert.equal(code(() => compilePattern('(a)\\1')), 'E_PATTERN_UNSUPPORTED');
  assert.equal(code(() => compilePattern('a(?=b)')), 'E_PATTERN_UNSUPPORTED');
  assert.equal(code(() => compilePattern('(?<n>a)')), 'E_PATTERN_UNSUPPORTED');
  assert.equal(code(() => compilePattern('\\bword')), 'E_PATTERN_UNSUPPORTED');
  for (const bad of ['(a', 'a)', '[a-', '*a', 'a{3,1}', '[z-a]', '\\q', 'a|*', '^*']) {
    assert.equal(code(() => compilePattern(bad)), 'E_PATTERN_SYNTAX', bad);
  }
  assert.equal(code(() => compilePattern('a{1001}')), 'E_PATTERN_BUDGET');
  assert.equal(code(() => compilePattern('(a{1000}){1000}')), 'E_PATTERN_BUDGET');
  assert.equal(code(() => compilePattern('x'.repeat(5000))), 'E_PATTERN_BUDGET');
});

// A complete JSON-subset parser built from combinators.
const ws = P.re('\\s*', 'whitespace');
const tok = (s) => P.map(P.seq(P.lit(s), ws), () => s);
const json = P.lazy(() => value);
const number = P.map(P.seq(P.re('-?\\d+(?:\\.\\d+)?', 'number'), ws), ([n]) => Number(n));
const string = P.map(P.seq(P.re('"[^"\\\\]*"', 'string'), ws), ([s]) => s.slice(1, -1));
const array = P.map(P.seq(tok('['), P.sepBy(json, tok(',')), tok(']')), ([, items]) => items);
const pair = P.map(P.seq(string, tok(':'), json), ([k, , v]) => [k, v]);
const object = P.map(P.seq(tok('{'), P.sepBy(pair, tok(',')), tok('}')), ([, ps]) => Object.fromEntries(ps));
const value = P.alt(object, array, string, number, P.map(tok('true'), () => true), P.map(tok('null'), () => null));
const document = P.map(P.seq(ws, json, P.eof), ([, v]) => v);

test('parser combinators build a JSON-subset parser', () => {
  assert.deepEqual(parse(document, ' {"a": [1, -2.5, "x"], "b": {"c": null, "d": true}} ').value,
    { a: [1, -2.5, 'x'], b: { c: null, d: true } });
  assert.deepEqual(parse(document, '[]').value, []);
});

test('parse errors report furthest position, line/col and expected set', () => {
  const r = parse(document, '{"a": [1, 2\n  "b"]}');
  assert.equal(r.ok, false);
  assert.deepEqual([r.line, r.col], [2, 3]);
  assert.deepEqual(r.expected, ['","', '"]"']);
  const trailing = parse(document, '[1] x');
  assert.equal(trailing.ok, false);
  assert.deepEqual(trailing.expected, ['end of input']);
});

test('many() stops on zero-width progress instead of looping forever', () => {
  const r = parse(P.seq(P.many(P.re('x*')), P.eof), '');
  assert.equal(r.ok, true);
});
