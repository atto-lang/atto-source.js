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
  'int <- main() return 42; end',
  'fnc int • main() return 42; end',
  'int <- main() return 42; end;',
  'fnc int <- main() begin return 42; end;',
  'int • main() return 42; end.',
  'fnc int <- main() begin return 42; end.',
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

test('shared Atto conformance return-first int guest variants preserve observable exit 42',()=>{
  // Identical declaration bodies to atto-platform-conformance PR #83
  // fixtures int_{fnc,bare}_return_first_{brace,begin,end}.atto.
  const declarations=[
    'fnc int <- calculate(int x) begin return x * 2; end',
    'int <- calculate(int x) { return x * 2; }',
    'int <- calculate(int x) return x * 2; end',
    'int <- calculate(int x) begin return x * 2; end',
    'fnc int <- calculate(int x) { return x * 2; }',
  ];
  for(const declaration of declarations){
    const source=declaration+'\npub fnc main() -> int { return calculate(21); }\n';
    for(const compiled of [
      compileScalar(source),compileProgramV2(source),compileAttoScalarV1(source)]){
      // The generated guest has an ordinary ESM named export. The VM harness
      // calls its internal _f1 after removing only that export declaration.
      const executable=compiled.replace(/^export \{[^\n]*\};\n?/gm,'');
      assert.equal(runInNewContext(executable+'\n_f1()'),42n,declaration);
    }
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


test('return-first infer proves int before lowering and executes canonical guest variants',()=>{
  const declarations=[
    'fnc infer <- calculate_other(){return 42;}',
    'infer <- calculate_other() return 42; end',
    'infer • calculate_other() begin return 42; end',
    'fnc infer • calculate_other(){return 42;}',
    'infer <- calculate_other() {return 42;}',
    'fnc infer <- calculate_other() begin return 42; end',
  ];
  const legacy='fnc calculate_other():int{return 42;}\npub fnc main() -> int {return calculate_other();}';
  const baseline=[compileScalar(legacy),compileProgramV2(legacy),compileAttoScalarV1(legacy)];
  for(const declaration of declarations){
    const source=declaration+'\npub fnc main() -> int {return calculate_other();}';
    const generated=[compileScalar(source),compileProgramV2(source),compileAttoScalarV1(source)];
    for(let i=0;i<generated.length;i++){
      assert.equal(generated[i],baseline[i],declaration);
      const executable=generated[i].replace(/^export \{[^\n]*\};\n?/gm,'');
      assert.equal(runInNewContext(executable+'\n_f1()'),42n,declaration);
    }
  }
});

test('program-v2 supports pure void return-first functions without inventing effects',()=>{
  const variants=[
    'fnc void <- reset() {}',
    'void <- reset() begin end',
    'void <- reset() end',
    'fnc void • reset() return; end',
  ];
  const baseline=compileProgramV2('fnc reset():void{}');
  for(const source of variants){
    const generated=compileProgramV2(source);
    assert.equal(generated,baseline,source);
    assert.equal(runInNewContext(generated+'\n_f0()'),undefined,source);
    assert.throws(()=>compileScalar(source),CompileError,source);
    assert.throws(()=>compileAttoScalarV1(source),ProgramCompileError,source);
  }
});

test('inference, void value returns, and duplicate identities fail closed',()=>{
  for(const source of [
    'fnc infer <- f(){return other();}',
    'fnc infer <- f(){return true;}',
    'fnc infer <- f(){return z;}',
  ]){
    assert.throws(()=>compileScalar(source),CompileError,source);
    assert.throws(()=>compileProgramV2(source),
      e=>e instanceof ProgramCompileError&&/INFER_UNSUPPORTED/.test(e.message),source);
  }
  assert.throws(()=>compileProgramV2('fnc void <- f(){return 42;}'),
    e=>e instanceof ProgramCompileError&&/RETURN_VOID_VALUE/.test(e.message));
  assert.throws(()=>compileProgramV2(
    'infer <- f(){return 42;} fnc f():int{return 1;}'),
    e=>e instanceof ProgramCompileError&&/duplicate/.test(e.message));
});
test('no implicit type coercion, redundant annotation or unsupported arrow',()=>{
  const invalid=[
    'fnc int ← main(){return 42;}',
    'fnc int <- main():int{return 42;}',
    'fnc int <- main()',
    'int <- main() begin return 42;',  // unterminated block
    'void <- main(){return 42;}',
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

test('return-first end punctuation is bounded and does not authorize other trailing source',()=>{
  const invalid=[
    'fnc int <- main() return 42; end..',
    'int • main() begin return 42; end;;',
    'int <- main(){return 42;}.',
    'int <- main() return 42; end. fnc extra(): int {return 1;}',
  ];
  for(const source of invalid){
    assert.throws(()=>compileScalar(source),CompileError,source);
    assert.throws(()=>compileProgramV2(source),ProgramCompileError,source);
  }
});
