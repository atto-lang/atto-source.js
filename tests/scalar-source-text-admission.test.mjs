import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, check, CompileError} from '../src/compiler.mjs';
import {compileProgramV2, ProgramCompileError} from '../src/program-v2.mjs';

const PROGRAM='pub fnc main(): int { return 42; }';

test('scalar-v1 refuses malformed source text even inside ignored comments',()=>{
  const invalid=[
    ['line-comment NUL','// ignored\0\n'+PROGRAM,/NUL in source/],
    ['block-comment NUL','/* ignored\0 */\n'+PROGRAM,/NUL in source/],
    ['trailing NUL',PROGRAM+'\0',/NUL in source/],
    ['line-comment lone high','// ignored \ud800\n'+PROGRAM,/invalid UTF-16 source/],
    ['block-comment lone low','/* ignored \udc00 */\n'+PROGRAM,/invalid UTF-16 source/],
    ['trailing lone high',PROGRAM+'\ud800',/invalid UTF-16 source/],
    ['trailing lone low',PROGRAM+'\udc00',/invalid UTF-16 source/],
    ['two high surrogates','// ignored \ud800\ud800\n'+PROGRAM,/invalid UTF-16 source/],
    ['high then ASCII','// ignored \ud83dA\n'+PROGRAM,/invalid UTF-16 source/],
    ['paired followed by low','// ignored \ud83d\ude80\udc00\n'+PROGRAM,/invalid UTF-16 source/]
  ];
  for(const [name,source,reason] of invalid) {
    for(const entry of [compileToIR,compile,check]) {
      assert.throws(()=>entry(source),
        err=>err instanceof CompileError && reason.test(err.message),
        name+': '+entry.name+' must reject malformed source');
    }
    assert.throws(()=>compileProgramV2(source),
      err=>err instanceof ProgramCompileError && reason.test(err.message),
      name+': program-v2 must reject same source');
  }
});

test('scalar-v1 admits valid surrogate pairs and literal replacement characters',async()=>{
  for(const prefix of [
    '// valid surrogate pair \ud83d\ude80\n',
    '/* valid surrogate pair \ud83d\ude80 */\n',
    '// valid U+FFFD \ufffd\n',
    '/* valid U+FFFD \ufffd */\n'
  ]) {
    const source=prefix+PROGRAM;
    assert.equal(check(source),true);
    const js=compile(source);
    const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
    assert.equal(mod.main(),42n);
    assert.doesNotThrow(()=>compileProgramV2(source));
  }
});

test('scalar-v1 preserves UTF-8 byte budget with valid multibyte source',()=>{
  const oversized='//'+ '\ud83d\ude80'.repeat(65536)+'\n'+PROGRAM;
  for(const entry of [compileToIR,compile,check]) {
    assert.throws(()=>entry(oversized),
      err=>err instanceof CompileError && /invalid or oversized source/.test(err.message));
  }
});