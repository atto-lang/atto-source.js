import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {compile as compileScalar,CompileError} from '../src/compiler.mjs';
import {compileProgramV2,compileAttoScalarV1,ProgramCompileError} from '../src/program-v2.mjs';

const legacy='fnc main(): int { return 42; }';
const sources=[
  'fnc int <- main() { return 42; }',
  'int <- main() { return 42; }',
  'fnc int • main() { return 42; }',
  'int • main() { return 42; }',
  'fnc int <- main() begin return 42; end',
  'int•main(){return 42;}',
];

test('return-first int scalar and program-v2 emit byte-identical ESM',()=>{
  const baselineScalar=compileScalar(legacy);
  const baselineV2=compileProgramV2(legacy);
  const baselineAtto=compileAttoScalarV1(legacy);
  for(const source of sources){
    assert.equal(compileScalar(source),baselineScalar,source);
    assert.equal(compileProgramV2(source),baselineV2,source);
    assert.equal(compileAttoScalarV1(source),baselineAtto,source);
    assert.equal(runInNewContext(compileScalar(source)+'\n_f0()'),42n,source);
    assert.equal(runInNewContext(compileProgramV2(source)+'\n_f0()'),42n,source);
  }
});

test('parameterized return-first int has the same direct-call result',()=>{
  const legacy='fnc double(int x):int{return x+x;}';
  for(const header of ['fnc int <- double(int x)','int • double(int x)']){
    const src=header+'{return x+x;}';
    assert.equal(compileScalar(src),compileScalar(legacy));
    assert.equal(compileProgramV2(src),compileProgramV2(legacy));
  }
});

test('no implicit type coercion, redundant annotation or unsupported arrow',()=>{
  const invalid=[
    'fnc int ← main(){return 42;}',
    'fnc int <- main():int{return 42;}',
    'fnc int <- main()',
    'int <- main() begin return 42;',  // unterminated block
    'void <- main(){return;}',
    'int <- main(){return 42;} trailing',
  ];
  for(const source of invalid){
    assert.throws(()=>compileScalar(source),CompileError,source);
    assert.throws(()=>compileProgramV2(source),ProgramCompileError,source);
  }
});

test('exception effects stay explicitly unsupported in both source compilers',()=>{
  for(const keyword of ['trap!','throw!','raise!','panic!']){
    const src='fnc int <- main() { return '+keyword+' value; }';
    assert.throws(()=>compileScalar(src),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
    assert.throws(()=>compileProgramV2(src),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
  }
});
