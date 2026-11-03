import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, compileIR} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
  let getterCalls=0;
  Object.defineProperty(ir,'functions',{enumerable:true,configurable:true,get(){
    getterCalls++;
    throw new Error('untrusted getter executed');
  }});
  assert.throws(() => compileIR(ir), /error: scalar IR:.*accessor/);
  assert.equal(getterCalls,0,'IR getter must not be evaluated');
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

test('AttoLang .atto source compiles through the legacy-name JS CLI',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-js-cli-'));
  try {
    const input=join(dir,'main.atto');
    await writeFile(input,'pub fnc main(): int {return 40+2;}\n');
    const cli=fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url));
    const checked=spawnSync(process.execPath,[cli,'--program-v2','--check',input],
      {encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);
    assert.equal(checked.stdout,'OK\n');
    const emitted=spawnSync(process.execPath,[cli,'--program-v2',input],
      {encoding:'utf8'});
    assert.equal(emitted.status,0,emitted.stderr);
    const ns=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(emitted.stdout));
    assert.equal(ns.main(),42n);
  } finally {await rm(dir,{recursive:true,force:true});}
});
