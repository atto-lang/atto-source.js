import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  compileProgramV2, compileToProgramIRV2, compileProgramIRV2
} from '../src/program-v2.mjs';

// The final artifact, not merely the typed IR, is the unit under test.
// These are JS backend execution observations for the common scalar subset;
// they are NOT authenticated Java/GraalVM or LLVM guest-execution receipts.
const fixtures=[
  {
    id:'literal-and-arithmetic',
    source:'pub fnc main():int{return (40+4)*2-46;}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'integer-over-2pow53',
    source:'pub fnc main():int{return 9007199254740993+1;}',
    check:m=>assert.equal(m.main(),9007199254740994n)
  },
  {
    id:'signed-i64-min-literal',
    source:'pub fnc main():int{return -9223372036854775808;}',
    check:m=>assert.equal(m.main(),-(1n<<63n))
  },
  {
    id:'precedence-and-unary',
    source:'pub fnc main():int{return -(2+3)*4+62;}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'forward-call',
    source:'pub fnc main():int{return plus(40,2);} fnc plus(int x,int y):int{return x+y;}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'arity-only-overloads',
    source:'pub fnc pick():int{return 42;} pub fnc pick(int x):int{return x+1;}',
    check:m=>{assert.equal(m.pick(),42n);assert.equal(m.pick(41n),42n);
      assert.throws(()=>m.pick(1n,2n),/overload arity mismatch/);}
  },
  {
    id:'private-module-call-not-exported',
    source:'define module calc as fnc inc(int x):int{return x+1;} pub fnc answer():int{return inc(41);} end',
    check:m=>{assert.equal(m.calc.answer(),42n);assert.equal(m.calc.inc,undefined);
      assert.equal(Object.getPrototypeOf(m.calc),null);assert.equal(Object.isFrozen(m.calc),true);}
  },
  {
    id:'named-arguments-source-order',
    source:'fnc digits(int a,int b,int c):int{return a*100+b*10+c;} pub fnc main():int{return digits(c:2,a:0,b:4);}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'boolean-typed-operators',
    source:'pub fnc decide(bool a,bool b):bool{return not a or b;}',
    check:m=>{assert.equal(m.decide(false,false),true);assert.equal(m.decide(true,false),false);
      assert.throws(()=>m.decide(1n,true),/bool required/);}
  },
  {
    id:'word-equality',
    source:'pub fnc equal(int a,int b):bool{return a eq b;}',
    check:m=>{assert.equal(m.equal(42n,42n),true);assert.equal(m.equal(42n,41n),false);}
  },
  {
    id:'typed-ternary',
    source:'pub fnc pick(bool enabled):int{return enabled ? 42 : 7;}',
    check:m=>{assert.equal(m.pick(true),42n);assert.equal(m.pick(false),7n);}
  },
  {
    id:'if-statement-total-return',
    source:'pub fnc abs(int x):int{if x < 0 then return -x; else return x; fi}',
    check:m=>{assert.equal(m.abs(-42n),42n);assert.equal(m.abs(7n),7n);}
  },
  {
    id:'scalar-match-exhaustiveness',
    source:'pub fnc pick(int n):int{return match n over on 1 -> {42;} on _ -> {7;} end;}',
    check:m=>{assert.equal(m.pick(1n),42n);assert.equal(m.pick(2n),7n);}
  },
  {
    id:'option-portable-intrinsic',
    source:'pub fnc main():int{return Option.unwrap_or(Option.some(42),0);}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'result-portable-intrinsic',
    source:'pub fnc main():int{return Result.unwrap_or(Result.ok(42),0);}',
    check:m=>assert.equal(m.main(),42n)
  },
  {
    id:'symbol-value-equality',
    source:'pub fnc main():bool{return #ready eq #ready;}',
    check:m=>assert.equal(m.main(),true)
  },
  {
    id:'new-class-named-method-call',
    source:'pub define class Box as pub mtd pick(self,int a,int b):int{return a*10+b;} end pub fnc main():int{return new Box().pick(b:2,a:4);}',
    check:m=>{assert.equal(m.main(),42n);assert.equal(new m.Box().pick(4n,2n),42n);}
  },
  {
    id:'generator-callable-boundary',
    source:'pub gen* values(int n):Iterator<int>{yield n;yield n+1;return;}',
    check:m=>{
      assert.throws(()=>m.values(41),/Oreslang signed i64 BigInt required/);
      assert.throws(()=>m.values(1n<<63n),/ORES_I64_OVERFLOW/);
      const it=m.values(41n);
      assert.deepEqual(it.next(),{value:41n,done:false});
      assert.deepEqual(it.next(),{value:42n,done:false});
      assert.deepEqual(it.next(),{value:undefined,done:true});
    }
  },
  {
    id:'prototype-name-does-not-change-module-identity',
    source:'define module m as pub fnc __proto__():int{return 42;} end',
    check:m=>{assert.equal(m.m.__proto__(),42n);assert.equal(Object.getPrototypeOf(m.m),null);}
  },
  {
    id:'checked-intermediate-overflow',
    source:'pub fnc main():int{return (9223372036854775807+1)-1;}',
    check:m=>assert.throws(()=>m.main(),/ORES_I64_OVERFLOW/)
  },
  {
    id:'zero-divisor-explicit-failure',
    source:'pub fnc main():int{return 1%0;}',
    check:m=>assert.throws(()=>m.main(),/ORES_I64_DIVISION_BY_ZERO/)
  },
  {
    id:'host-numeric-conversion-forbidden',
    source:'pub fnc add(int a,int b):int{return a+b;}',
    check:m=>{assert.equal(m.add(40n,2n),42n);
      assert.throws(()=>m.add(40,2n),/signed i64 BigInt required/);}
  }
];

for(const fixture of fixtures){
  test('executed final ESM / '+fixture.id,async()=>{
    const esm=compileProgramV2(fixture.source);
    // The independently revalidated JSON-safe IR must produce the exact
    // same emitted bytes as source compilation. No JS syntax patching.
    const ir=JSON.parse(JSON.stringify(compileToProgramIRV2(fixture.source)));
    assert.equal(compileProgramIRV2(ir),esm);
    const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
      input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
    });
    assert.equal(syntax.status,0,fixture.id+': '+syntax.stderr);
    assert.equal(syntax.error,undefined,fixture.id+': Node syntax-check error');
    const module=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(esm)+'#'+fixture.id);
    fixture.check(module);
  });
}

test('rejected source has no final JS artifact to execute',()=>{
  for(const source of [
    'pub fnc main():int{return process.exit(0);}',
    'pub fnc main():int{return 1/0;}',
    'define actor Worker as end',
    'pub define class Box as end pub fnc main():int{return Box();}',
    'pub fnc main():int{return 9223372036854775808;}',
    'pub fnc main():bool{return 1 and true;}',
    'pub fnc main():int{return missing();}'
  ]) assert.throws(()=>compileProgramV2(source),/error:/,source);
});
