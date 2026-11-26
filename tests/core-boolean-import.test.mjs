import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
import {CORE_BOOLEAN_CALLABLES,coreBooleanIntrinsic} from '../src/core-boolean-intrinsics.mjs';
const load=source=>import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));

test('core Boolean callable identities are distinct, pure and immutable',()=>{
  assert.deepEqual(CORE_BOOLEAN_CALLABLES.map(x=>x.canonical),['core/bool/And','core/bool/Or','core/bool/Xor']);
  for(const entry of CORE_BOOLEAN_CALLABLES){
    assert.equal(entry.scope,'core');assert.equal(entry.allocation,'none');
    assert.equal(coreBooleanIntrinsic(entry.name),entry);assert.ok(Object.isFrozen(entry));
  }
  assert.equal(coreBooleanIntrinsic('and'),null);
});
test('canonical module and shorthand imports execute the same typed reductions',async()=>{
  for(const selector of ['atto.core/bool','core/bool','atto.core/bool.atto','core/bool.atto']){
    const source='import module gates from "'+selector+'";\n'+
      'pub fnc main(): int { val bool a = gates.Xor(true,false); val bool b = gates.And(true,false); val bool c = gates.Or(true,false); val bool d = gates.Xor([true,false]); val bool e = gates.And([true,false,true,true,true]); val bool f = gates.Or([true,false,true,false]); if a and not b and c and d and not e and f and gates.And([]) and not gates.Or([]) and not gates.Xor([]) then return 42; else return 7; fi }';
    assert.equal((await load(source)).main(),42n,selector);
  }
});
test('explicit module bindings retain lazy scalar and eager array evaluation',async()=>{
  const guest=await load('import module gates from "atto.core/bool";\n'+[
    'fnc fail(int n):bool{return Integer.rem(1,n) eq 0;}',
    'pub fnc a():bool{return gates.And(false,fail(0));}',
    'pub fnc b():bool{return gates.Or(true,fail(0));}',
    'pub fnc c():bool{return gates.Xor(false,fail(0));}',
    'pub fnc d():bool{return gates.And([false,fail(0)]);}',
    'pub fnc e():bool{return gates.Or([true,fail(0)]);}'
  ].join('\n'));
  assert.equal(guest.a(),false);assert.equal(guest.b(),true);
  for(const name of ['c','d','e'])assert.throws(()=>guest[name](),/ORES_I64_DIVISION_BY_ZERO/);
});
test('invalid selectors, spoofing, shadowing and bad operands fail before emission',()=>{
  const pre='import module gates from "atto.core/bool";\n';
  for(const src of [
    pre+'pub fnc bad():bool{return gates.And(true,1);}',
    pre+'pub fnc bad():bool{return gates.Xor([],[true]);}',
    pre+'pub fnc bad():bool{return gates.And();}',
    pre+'pub fnc bad():bool{return gates.Not(true);}',
    pre+'pub fnc bad():int{val int gates=1;return gates;}',
    pre+'define module gates as pub fnc And(bool x,bool y):bool{return true;} end pub fnc main():int{return 42;}',
    pre+'import module gates from "core/bool"; pub fnc main():int{return 42;}',
    'import module gates from "ores.core/bool"; pub fnc main():int{return 42;}',
    'import module gates from "atto.core/../bool"; pub fnc main():int{return 42;}'
  ])assert.throws(()=>compileProgramV2(src),/error:/,src);
});
