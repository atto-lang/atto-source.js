import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {compileToIR} from '../src/compiler.mjs';
import {compileToProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';

const source = expression => 'pub fnc main(): int { return '+expression+'; }';

test('both JS frontends deny unsupported ownership and compact bang spellings', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    for (const expression of [
      'copy!42', 'copy!!42', 'take!42', 'move!42', 'move! 42', 'borrow! value',
      'borrow!mut value', 'borrow! mut value',
      'mut borrow!value', 'mut borrow! value', 'share!value',
      'borrow!\nmut value', 'borrow!/* checked loan */mut value',
      'mut borrow!\nvalue',
    ]) {
      const suffix = /^(?:mut )?(?:copy!!|copy!|take!|move!|borrow!|share!)/.exec(expression)[0];
      const code = /[ \t\r\n\v\f]/.test(expression[suffix.length] ?? '')
        ? /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/ : /E_BANG_KEYWORD_WHITESPACE/;
      assert.throws(() => compile(source(expression)), code, expression);
    }
  }
});

test('compiler CLI denies ownership operators before ESM publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atto-js-borrow-'));
  const cli = fileURLToPath(new URL('../bin/oreslang-jsc.mjs', import.meta.url));
  const input = join(dir, 'guest.atto');
  const output = join(dir, 'guest.mjs');
  try {
    for (const options of [[], ['--program-v2'], ['--atto-scalar-v1']]) {
      for (const expression of ['take! 42', 'move! 42', 'borrow! mut value', 'share! 42', ...(options.length===0?['copy! 42','copy!! 42']:[])]) {
        writeFileSync(input, source(expression));
        const result = spawnSync(process.execPath, [cli, ...options, input, '--out='+output],
          {encoding:'utf8', timeout:10000});
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/, expression);
        assert.equal(existsSync(output), false, expression);
      }
      // Both explicit checked program profiles must execute scalar copies;
      // the default legacy frontend remains reject-only.
      for (const expression of options.length ? ['copy! 42', 'copy!! (20 + 22)'] : []) {
        writeFileSync(input, source(expression));
        const compiled = spawnSync(process.execPath, [cli, ...options, input, '--out='+output],
          {encoding:'utf8', timeout:10000});
        assert.ifError(compiled.error);
        assert.equal(compiled.status, 0, compiled.stderr);
        const ran = spawnSync(process.execPath,
          ['--input-type=module', '-e', 'const guest = await import(process.argv[1]); console.log(String(guest.main()));',
            pathToFileURL(output).href], {encoding:'utf8', timeout:10000});
        assert.ifError(ran.error);
        assert.equal(ran.status, 0, ran.stderr);
        assert.equal(ran.stdout.trim(), '42');
        rmSync(output);
      }
      writeFileSync(input, source('42 /* inert borrow! mut and copy!! */'));
      const good = spawnSync(process.execPath, [cli, ...options, input, '--out='+output],
        {encoding:'utf8', timeout:10000});
      assert.ifError(good.error);
      assert.equal(good.status, 0, good.stderr);
      const guest = spawnSync(process.execPath,
        ['--input-type=module', '-e', 'const guest = await import(process.argv[1]); console.log(String(guest.main()));',
          pathToFileURL(output).href], {encoding:'utf8', timeout:10000});
      assert.ifError(guest.error);
      assert.equal(guest.status, 0, guest.stderr);
      assert.equal(guest.stdout.trim(), '42');
      rmSync(output);
    }
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});

test('comments do not create ownership effects', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { /* borrow! mut value */ return 42; }'));
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { // borrow! mut value\n return 42; }'));
  }
});

test('spaced bang and inequality are not classified as ownership aliases', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    for (const expression of ['copy !value', 'copy!=value', 'copy!eq value']) {
      try {compile(source(expression));}
      catch (error) {
        assert.doesNotMatch(String(error.message),
          /OWNERSHIP_BANG_BACKEND_UNSUPPORTED/, expression);
      }
    }
  }
});

test('legacy rt mutable borrowing is source-compatible but must fail typed lowering', () => {
  for (const expression of ['rt borrow mut value', 'rt mut borrow value']) {
    assert.throws(() => compileToIR(source(expression)),
      /runtime ownership operation requires typed lowering/, expression);
  }
});

test('nested ownership-looking comments remain inert in both JS compilers', () => {
  for (const compile of [compileToIR, compileToProgramIRV2]) {
    assert.doesNotThrow(() => compile(
      'pub fnc main(): int { /* outer /* borrow! mut value */ '+
      'middle /* copy!42 */ */ return 42; }'));
    assert.throws(() => compile('pub fnc main(): int { /* outer /* copy!42 */ return 42; }'),
      /unterminated comment/, 'unclosed nested comment must never emit IR');
    assert.throws(() => compile(
      'pub fnc main(): int { '+'/*'.repeat(65)+'*/'.repeat(65)+' return 42; }'),
      /comment nesting/, 'nested comments are bounded to 64');
  }
});

test('checked program-v2 scalar copy compiles and executes without aliasing or unchecked arithmetic', async()=>{
  for (const [body,result] of [
    ['return copy! 42;',42n],
    ['return copy!! (20 + 22);',42n],
    ['return (copy! 20) + (copy!! 22);',42n],
    ['return copy! (-9223372036854775808);',-9223372036854775808n]
  ]){
    const esm=compileProgramV2('pub fnc main(): int { '+body+' }');
    const guest=await import('data:text/javascript;base64,'+Buffer.from(esm).toString('base64'));
    assert.equal(guest.main(),result);
  }
  const checked=await import('data:text/javascript;base64,'+Buffer.from(compileProgramV2(source('copy!! (9223372036854775807 + 1)'))).toString('base64'));
  assert.throws(()=>checked.main(),/overflow/i);
  const bool=await import('data:text/javascript;base64,'+Buffer.from(compileProgramV2('pub fnc main(): bool { return copy!! true; }')).toString('base64'));
  assert.equal(bool.main(),true);
  assert.throws(()=>compileToIR(source('copy! 42')),/OWNERSHIP_BANG_BACKEND_UNSUPPORTED/);
  assert.throws(()=>compileToProgramIRV2(source('copy! Some(42)')),/E_COPY_UNSUPPORTED_TYPE/);
  assert.throws(()=>compileToProgramIRV2(source('copy!! 1.5')),/E_COPY_UNSUPPORTED_TYPE/);
  assert.throws(()=>compileToProgramIRV2(source('copy! unknown')),/unresolved identifier/);
  assert.throws(()=>compileToProgramIRV2(source('copy!!! 42')),/E_BANG_KEYWORD_WHITESPACE/);
});
