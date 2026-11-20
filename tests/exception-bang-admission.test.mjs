import test from 'node:test';
import assert from 'node:assert/strict';
import {compile as compileScalar} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

// Both JS source compilers must fail before host JavaScript can impersonate
// a typed AttoLang Error/Result, unwind, or supervisor CONTROL transition.
for (const op of ['trap!', 'throw!', 'raise!', 'panic!']) {
  test('JS scalar and program-v2 fail closed on '+op,()=>{
    const source='fnc main():int{return '+op+' value;}';
    assert.throws(()=>compileScalar(source),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
    assert.throws(()=>compileProgramV2(source),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
  });
}

test('comments and identifier substrings are not exceptional control',()=>{
  const source='fnc main():int{return 42;} // trap! throw! raise! panic!';
  assert.doesNotThrow(()=>compileScalar(source));
  assert.doesNotThrow(()=>compileProgramV2(source));
});
