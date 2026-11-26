import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToProgramIRV2,compileProgramV2,compileProgramIRV2} from '../src/program-v2.mjs';

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

test('bool and boolean immutable local bindings produce identical typed IR',async()=>{
  const source='pub fnc main(): int { val boolean x=true; if x then return 42; fi return 0; }';
  const canonical=source.replace('boolean','bool');
  const ir=compileToProgramIRV2(source);
  assert.deepEqual(ir,compileToProgramIRV2(canonical));
  assert.match(JSON.stringify(ir),/"kind":"boolLocal"/);
  assert.match(JSON.stringify(ir),/"kind":"boolCapture"/);
  assert.equal((await guest(source)).main(),42n);
  assert.equal((await guest(source.replace('true','false'))).main(),0n);
});
test('bool locals preserve callable types and do not coerce numbers',async()=>{
  const source='fnc yes(bool b):bool{return b;} pub fnc main():int{val boolean x=yes(true);if yes(x) then return 42; fi return 0;}';
  assert.equal((await guest(source)).main(),42n);
  for(const s of [
    'pub fnc bad():int{val boolean x=1;return 42;}',
    'pub fnc bad():int{val bool x=true;return x;}',
    'pub fnc bad():bool{val int x=1;return x;}',
    'pub fnc bad():int{val boolean x=x;return 42;}',
    'pub fnc bad():int{val boolean x=true;val boolean x=false;return 42;}'
  ])assert.throws(()=>compileProgramV2(s));
});
test('untrusted IR cannot change bool capture or initializer types',()=>{
  const source='pub fnc main():int{val boolean x=true;if x then return 42;fi return 0;}';
  const ir=compileToProgramIRV2(source);
  const local=ir.functions[0].body;
  assert.equal(local.kind,'boolLocal');
  const wrong=structuredClone(ir);
  wrong.functions[0].body.init={kind:'int',value:'1'};
  assert.throws(()=>compileProgramIRV2(wrong));
  const wrongCapture=structuredClone(ir);
  wrongCapture.functions[0].body.body.condition.kind='capture';
  assert.throws(()=>compileProgramIRV2(wrongCapture),/capture type mismatch/);
});
test('shadowing and unsupported uppercase local annotations fail closed',()=>{
  const local='pub fnc main():int{val boolean x=true;return 42;}';
  assert.throws(()=>compileProgramV2('define module boolean as pub fnc value():int{return 42;} end '+local),/E_TYPE_ALIAS_SHADOWED/);
  assert.throws(()=>compileProgramV2(local.replace('boolean','Bool')));
});
