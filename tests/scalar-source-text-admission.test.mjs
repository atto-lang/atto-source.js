import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, check, CompileError} from '../src/compiler.mjs';
import {compileProgramV2, compileToProgramIRV2, checkProgramV2, ProgramCompileError} from '../src/program-v2.mjs';

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

test('scalar-v1 honors the exact UTF-8 source byte boundary',()=>{
  // ASCII source uses one byte per UTF-16 code unit, so this source has
  // exactly the 262144-byte limit including its source comment and program.
  const accepted='//'+'a'.repeat(262144-3-PROGRAM.length)+'\n'+PROGRAM;
  assert.equal(new TextEncoder().encode(accepted).length,262144);
  assert.equal(check(accepted),true);
  const tooLarge=accepted+' ';
  for(const entry of [compileToIR,compile,check]) {
    assert.throws(()=>entry(tooLarge),
      err=>err instanceof CompileError && /invalid or oversized source/.test(err.message));
  }
});

test('program-v2: reject over-budget UTF-16 input before scanning or encoding',()=>{
  const huge='//'+'a'.repeat(262144)+'\\n'+PROGRAM+'\\0';
  for(const entry of [compileToProgramIRV2,compileProgramV2,checkProgramV2]) {
    assert.throws(()=>entry(huge),
      err=>err instanceof ProgramCompileError &&
        /oversized or invalid source/.test(err.message),
      entry.name+' must apply the cheap source budget before scanning NUL');
  }
});

test('program-v2: accept exact UTF-8 source budget and reject a single excess byte',()=>{
  const exact='//'+'a'.repeat(262144-3-PROGRAM.length)+'\\n'+PROGRAM;
  assert.equal(new TextEncoder().encode(exact).length,262144);
  for(const entry of [compileToProgramIRV2,compileProgramV2,checkProgramV2]) {
    assert.doesNotThrow(()=>entry(exact),entry.name+' exact limit');
    assert.throws(()=>entry(exact+'a'),
      err=>err instanceof ProgramCompileError &&
        /oversized or invalid source/.test(err.message),
      entry.name+' must reject 262145 bytes');
  }
  // Valid UTF-16 length alone does not imply valid UTF-8 byte length.
  const multibyte='//'+'\\u{1f680}'.repeat(65536)+'\\n'+PROGRAM;
  assert.ok(multibyte.length<262144);
  assert.ok(new TextEncoder().encode(multibyte).length>262144);
  assert.throws(()=>compileProgramV2(multibyte),
    err=>err instanceof ProgramCompileError &&
      /oversized or invalid source/.test(err.message));
});
