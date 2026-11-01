import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, compileIR} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

// These are fail-closed admission regressions, not cross-backend guest parity.
const valid = 'pub fnc main(): int {return 42;}';

test('scalar source rejects NUL even inside a comment', () => {
  assert.throws(() => compile('// comment\u0000\n'+valid), /NUL in source/);
});

test('scalar source rejects unpaired high and low UTF-16 surrogates', () => {
  for (const bad of ['\uD800','\uDC00']) {
    assert.throws(() => compile('//'+bad+'\n'+valid), /invalid UTF-16 in source/);
  }
});

test('scalar checked-i64 directive cannot silently select wrapping arithmetic', () => {
  for (const prefix of [
    '// oreslang:checked-i64-v1\n',
    '// oreslang:checked-i64-v1',
    '//  oreslang:checked-i64-unknown\n'
  ]) {
    assert.throws(() => compile(prefix+'\n'+valid), /checked-i64 source requires program-v2/);
  }
});

test('program-v2 rejects displaced or duplicated checked-i64 directives', () => {
  const directive='// oreslang:checked-i64-v1\n';
  assert.throws(() => compileProgramV2('\n'+directive+valid), /checked-i64-v1: malformed/);
  assert.throws(() => compileProgramV2(directive+directive+valid), /checked-i64-v1: malformed/);
});

test('scalar generated ESM never embeds source comments', () => {
  const code=compile('// SECRET_SOURCE_COMMENT_MARKER\n'+valid);
  assert.doesNotMatch(code, /SECRET_SOURCE_COMMENT_MARKER/);
  assert.match(code, /export/);
});

test('scalar IR rejects an accessor replacing an existing field', () => {
  const ir=compileToIR(valid);
  Object.defineProperty(ir,'functions',{enumerable:true,configurable:true,get(){
    throw new Error('untrusted getter executed');
  }});
  assert.throws(() => compileIR(ir), error =>
    error?.message !== 'untrusted getter executed');
});

test('unverified cross-file imports are rejected by program-v2', () => {
  assert.throws(
    () => compileProgramV2('import billing; '+valid),
    /cross-file import requires verified source graph lowering/
  );
});

test('unsupported actor declarations do not emit misleading ESM', () => {
  assert.throws(
    () => compileProgramV2('define isolated actor Worker as end'),
    /error: program v2:/
  );
});
