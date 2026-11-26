import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const load=src=>import('data:text/javascript,'+encodeURIComponent(compileProgramV2(src)));
const names=['And','Or','Xor'];
test('exact six typed declarations compile and execute',async()=>{
  const src=`pub fnc main(): int {
    val bool a = Xor(true, false);
    val bool b = And(true, false);
    val bool c = Or(true, false);
    val bool d = Xor([true, false]);
    val bool e = And([true, false, true, true, true]);
    val bool f = Or([true, false, true, false]);
    if a and not b and c and d and not e and f then return 42; else return 0; fi
  }`;
  const ir=compileToProgramIRV2(src);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(src));
  assert.equal((await load(src)).main(),42n);
});
test('exhaustive emitted scalar and literal-pack truth tables',async()=>{
  for(let n=0;n<=6;n++){
    const args=Array.from({length:n},(_,i)=>'bool b'+i).join(',');
    const vars=Array.from({length:n},(_,i)=>'b'+i).join(',');
    const defs=names.flatMap(name=>[
      'pub fnc pack_'+name+'('+args+'):bool{return '+name+'(['+vars+']);}',
      ...(n>=2?['pub fnc scalar_'+name+'('+args+'):bool{return '+name+'('+vars+');}']:[])
    ]).join('\n');
    const guest=await load(defs);
    for(let mask=0;mask<2**n;mask++){
      const values=Array.from({length:n},(_,i)=>Boolean(mask&(1<<i)));
      const count=values.filter(Boolean).length;
      for(const name of names){
        const want=name==='And'?count===n:name==='Or'?count>0:count%2===1;
        assert.equal(guest['pack_'+name](...values),want);
        if(n>=2)assert.equal(guest['scalar_'+name](...values),want);
      }
    }
  }
});
test('scalar laziness differs from eager pack construction',async()=>{
  const guest=await load([
    'fnc fail(int n):bool{return Integer.rem(1,n) eq 0;}',
    'pub fnc and_skip():bool{return And(false,fail(0));}',
    'pub fnc or_skip():bool{return Or(true,fail(0));}',
    'pub fnc and_reach():bool{return And(true,fail(0));}',
    'pub fnc or_reach():bool{return Or(false,fail(0));}',
    'pub fnc xor_reach():bool{return Xor(false,fail(0),true);}',
    'pub fnc and_pack():bool{return And([false,fail(0)]);}',
    'pub fnc or_pack():bool{return Or([true,fail(0)]);}',
    'pub fnc xor_pack():bool{return Xor([true,fail(0)]);}'
  ].join('\n'));
  assert.equal(guest.and_skip(),false);
  assert.equal(guest.or_skip(),true);
  for(const name of ['and_reach','or_reach','xor_reach','and_pack','or_pack','xor_pack'])
    assert.throws(()=>guest[name](),/ORES_I64_DIVISION_BY_ZERO/,name);
});
test('invalid arity and types fail before ESM output',()=>{
  for(const name of names){
    for(const args of ['', 'true', '1,2', 'false,1', 'true,1', '[true,1]', '[[true]]', '[true],[false]', 'a:true,b:false', Array(33).fill('true').join(',')]){
      assert.throws(()=>compileProgramV2('pub fnc bad():bool{return '+name+'('+args+');}'),/error:/,name+'('+args+')');
    }
  }
  assert.throws(()=>compileProgramV2('pub fnc bad():int{val bool x = [true,false];return 0;}'),/error:/);
});
