import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';

const canonical = 'pub fnc negate(bool value): bool { return !value; }';
const alias = 'pub fnc negate(boolean value): boolean { return !value; }';
const named = 'pub fnc negate(value: boolean): boolean { return !value; }';
async function guest(source){
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
}
test('boolean alias produces the same validated IR and ESM as bool',()=>{
  for(const s of [alias,named]){
    assert.deepEqual(compileToProgramIRV2(s),compileToProgramIRV2(canonical));
    assert.equal(compileProgramV2(s),compileProgramV2(canonical));
  }
});
test('generated guest executes both truth values and refuses coercion',async()=>{
  const g=await guest(alias);
  assert.equal(g.negate(true),false);
  assert.equal(g.negate(false),true);
  for(const v of [0,1,0n,1n,'true',null,undefined,{}])
    assert.throws(()=>g.negate(v),/bool required/);
});
test('guest callable argument and return interoperate with canonical bool',async()=>{
  const g=await guest('fnc yes(boolean x): bool { return x; } pub fnc main(): int { if yes(true) then return 42; else return 0; fi }');
  assert.equal(g.main(),42n);
});
test('wrong-case names and unsupported nominal wrappers do not become scalars',()=>{
  for(const name of ['Bool','BOOL','Boolean','BOOLEAN','bOoL','Int','Integer','String']){
    assert.throws(()=>compileProgramV2('pub fnc bad('+name+' x): bool { return true; }'),/unsupported scalar type/);
    assert.throws(()=>compileProgramV2('pub fnc bad(): '+name+' { return true; }'),/unsupported scalar type/);
  }
});
test('implicit int to bool and bool to int are rejected by typed IR',()=>{
  for(const s of ['pub fnc bad(): boolean { return 42; }','pub fnc bad(): int { return true; }',
    'fnc f(boolean v): bool { return v; } pub fnc bad(): bool { return f(1); }']){
    assert.throws(()=>compileProgramV2(s));
  }
});
test('a value binding named boolean is not textually rewritten',async()=>{
  const g=await guest('pub fnc identity(boolean: int): int { return boolean; }');
  assert.equal(g.identity(42n),42n);
});
test('class or module shadowing is refused rather than silently selecting alias',()=>{
  const cls='define class boolean as pub fnc value(): int { return 42; } end';
  const mod='define module boolean as pub fnc value(): int { return 42; } end';
  for(const decl of [cls,mod]){
    for(const s of [decl+' '+alias,alias+' '+decl])
      assert.throws(()=>compileProgramV2(s),/E_TYPE_ALIAS_SHADOWED/);
    assert.doesNotThrow(()=>compileProgramV2(decl));
  }
});
