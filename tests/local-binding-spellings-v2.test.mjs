import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';

const source = statement => 'pub fnc main(): int { '+statement+' return x; }';
const execute = async input => {
  const esm = compileProgramV2(input);
  const ns = await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
  return ns.main();
};
test('ordinary fixed int declarations share the checked ESM binding path',async()=>{
  const forms=['int x = 42;','const x = 42;','const int x = 42;',
    'const x :int = 42;','const x as int = 42;',
    'val int x = 42;','val x as int = 42;',
    'const mut int x = 42;','const mut x : int = 42;',
    'const mut x as int = 42;'];
  const expected=compileToProgramIRV2(source(forms[0]));
  for(const form of forms){
    assert.deepEqual(compileToProgramIRV2(source(form)),expected,form);
    assert.equal(await execute(source(form)),42n,form);
  }
});
test('typed let spelling is independent from fixed scalar qualifier',async()=>{
  for(const form of ['let int x = 42;','let x :int = 42;','let x as int = 42;'])
    assert.equal(await execute(source(form)),42n,form);
});
test('eager runtime constant does not require a compile-time literal',async()=>{
  const program='fnc value(): int { return 42; } '+source('const x as int = value();');
  assert.equal(await execute(program),42n);
});
test('malformed, incompatible and duplicate declarations fail before ESM emission',()=>{
  for(const body of ['const x as int = true;','const x as = 42;',
    'const x as int;','const int x = 1; const x as int = 42;',
    'val int x = 1; const mut int x = 42;',
    'const mut int x = 1; x = 42;','int x = 1; x = 42;'])
    assert.throws(()=>compileProgramV2(source(body)),undefined,body);
});
