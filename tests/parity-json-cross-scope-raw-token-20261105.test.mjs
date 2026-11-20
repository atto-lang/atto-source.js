import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse = source => parseStrictJsonReport(source, Buffer.byteLength(source, 'utf8'), 'untrusted parity report');

test('decoded key identities remain object-local across arrays and nested records', () => {
  const safe = '[{"outer":{"\\u0061":1}},{"outer":{"a":2}}]';
  assert.deepEqual(parse(safe), [{outer:{a:1}}, {outer:{a:2}}]);
  for (const duplicate of [
    '{"outer":{"a":1,"\\u0061":2}}',
    '[{"a":1,"\\u0061":2}]',
    '{"x":0,"\\u0078":1}'
  ]) assert.throws(() => parse(duplicate), /duplicate JSON member/);
});

test('escaped prototype-magic keys are forbidden even when spelled indirectly', () => {
  for (const key of ['"\\u005f\\u005fproto\\u005f\\u005f"', '"con\\u0073tructor"', '"proto\\u0074ype"']) {
    assert.throws(() => parse(`{"safe":1,${key}:2}`), /unsafe JSON member/);
  }
  assert.deepEqual(parse('{"safe":1,"notPrototype":2}'), {safe:1,notPrototype:2});
});

test('one complete JSON value is required; comments, extra values and lone surrogates fail', () => {
  for (const raw of ['{"ok":1} true', '{"ok":1}/* comment */', '{"ok":1}\n{}'])
    assert.throws(() => parse(raw), /invalid JSON report/);
  for (const raw of ['{"name":"\\uD800"}', '{"name":"\\uDC00"}', '{"name":"\\uD800x"}'])
    assert.throws(() => parse(raw), /invalid JSON Unicode surrogate/);
  assert.deepEqual(parse('{"name":"\\uD83D\\uDE00","ready":true}'), {name:'😀',ready:true});
});
