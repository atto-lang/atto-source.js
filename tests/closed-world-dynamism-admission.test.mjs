// Experimental JS/ESM backend: these are compiler-front-end denial tests,
// not evidence that the JavaScript engine itself is GC-free or native AOT.
// Dynamic executable code is never a permitted fallback for missing AttoLang
// source constructs. Keep these cases explicit as the grammar grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIR,compileIR} from '../src/compiler.mjs';
import {
  compileProgramV2,compileToProgramIRV2,compileProgramIRV2
} from '../src/program-v2.mjs';

const wrap = expr => 'pub fnc main():int{return '+expr+';}';
const knownClass = 'pub define class Box as pub answer(self):int{return 42;} end ';

test('program-v2 unknown runtime code-generation/reflection calls fail before ESM', () => {
  const sources = [
    wrap('eval(42)'), wrap('Function(42)'), wrap('Reflect.get(1)'),
    wrap('Object.create(1)'), wrap('globalThis.eval(42)'),
    wrap('new Proxy()'), wrap('new MissingClass()'),
    knownClass + wrap('new Box(1)'),
    knownClass + wrap('new Box().missing()'),
    knownClass + wrap('new Box().answer(1)'),
    'define class Secret as private_value():int{return 1;} end '+
      wrap('new Secret().private_value()'),
    'define class Rec as pub f(self):int{return new Rec().f();} end',
    'define class Calls as pub f(self):int{return evaluate(1);} end',
    'pub fnc main():int{return rt borrow 1;}',
    'pub fnc main():int{return rt take 1;}',
    'suspends fnc main():int{return 42;}',
    'pub fnc main():int{return new Box().prototype;}',
    'pub fnc main():int{return import(1);}'
  ];
  for(const source of sources) {
    assert.throws(() => compileToProgramIRV2(source),
      /error: program v2:|error: program IR:/, source);
    assert.throws(() => compileProgramV2(source),
      /error: program v2:|error: program IR:/, source);
  }
});

test('scalar-v1 denies dynamic calls and ownership that lacks typed lowering', () => {
  for(const source of [
    'pub fnc main(): int {return eval(42);}',
    'pub fnc main(): int {return Function(42);}',
    'pub fnc main(): int {return new Proxy();}',
    'pub fnc main(): int {return rt borrow 1;}',
    'pub fnc main(): int {return rt take 1;}',
    'pub fnc main(): int {return Reflect.get(1);}'
  ]) {
    assert.throws(() => compileToIR(source),
      /CompileError|ScalarIRError|error:|unsupported/, source);
    assert.throws(() => compile(source),
      /CompileError|ScalarIRError|error:|unsupported/, source);
  }
});

test('finite known-class dispatch compiles without a runtime eval or proxy', async () => {
  const source = knownClass+wrap('new Box().answer()');
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.classes.length,1);
  assert.equal(ir.classes[0].methods.length,1);
  assert.equal(ir.functions[0].body.kind,'methodCall');
  const output=compileProgramIRV2(ir);
  assert.equal(output,compileProgramV2(source));
  assert.doesNotMatch(output,/\beval\s*\(|new\s+Function\s*\(|new\s+Proxy\s*\(/);
  const mod=await import('data:text/javascript,'+encodeURIComponent(output));
  assert.equal(mod.main(),42n);
  assert.equal(new mod.Box().answer(),42n);
});

test('a statically resolved callable named eval is not dynamic JavaScript eval', async () => {
  // Do not ban identifiers by spelling. The source eval(...) resolves to a
  // statically compiled AttoLang function, not the JS global eval primitive.
  const scalar='fnc eval(int x): int {return x;} pub fnc main(): int {return eval(42);}';
  const scalarIR=compileToIR(scalar);
  const scalarJS=compileIR(scalarIR);
  assert.doesNotMatch(scalarJS,/\beval\s*\(/);
  const scalarMod=await import('data:text/javascript,'+encodeURIComponent(scalarJS));
  assert.equal(scalarMod.main(),42n);
});

test('scalar-v1 denies pointer intrinsics and legacy mutable borrow spelling', () => {
  const negatives = [
    ['rt ref 1', /pointer-style runtime operation rt ref/],
    ['rt deref 1', /pointer-style runtime operation rt deref/],
    ['rt unref 1', /pointer-style runtime operation rt unref/],
    ['rt raw 1', /pointer-style runtime operation rt raw/],
    ['rt borrow mut 1', /legacy 'rt borrow mut'/]
  ];
  for(const [expression, diagnostic] of negatives) {
    const source='pub fnc main(): int {return '+expression+';}';
    assert.throws(() => compileToIR(source), diagnostic, source);
    assert.throws(() => compile(source), diagnostic, source);
  }
  // Canonical rt mut borrow is legal in the language but this narrow scalar
  // transpiler must refuse it until it has actual typed loan lowering.
  assert.throws(
    () => compileToIR('pub fnc main(): int {return rt mut borrow 1;}'),
    /runtime ownership operation requires typed lowering/
  );
});
