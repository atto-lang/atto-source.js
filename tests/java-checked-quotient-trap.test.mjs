import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2,compileAttoScalarV1} from '../src/program-v2.mjs';
const fixtures=[
  {
    "id": "checked-i64-quotient",
    "blob": "d7b61afd0fe074395b092aa4abaa08de4961602e",
    "source": "// Candidate guest source: integer truncation and dividend-signed remainder.\n// Target main return 42. Not yet compiler/AOT executed.\npub fnc divide(int lhs, int rhs): int {\n  return lhs / rhs;\n}\npub fnc remainder(int lhs, int rhs): int {\n  return Integer.rem(lhs, rhs);\n}\npub fnc main(): int {\n  val int a = -7;\n  val int b = 3;\n  return divide(a, b) * -21 + (remainder(a, b) + 1);\n}\n",
    "expected": {
      "kind": "value",
      "value": "42"
    }
  },
  {
    "id": "reject-i64-zero-divisor",
    "blob": "6736c0fb356074a753406efe8277aaed724892a3",
    "source": "// Candidate guest source: must fail with division_by_zero (not host exception).\n// Backend may issue a statically proved diagnostic or a typed guest runtime fault.\npub fnc checked(int divisor): int {\n  return 7 / divisor;\n}\npub fnc main(): int {\n  return checked(0);\n}\n",
    "expected": {
      "kind": "error",
      "code": "division_by_zero"
    }
  },
  {
    "id": "reject-i64-min-overflow",
    "blob": "aff2c8170924a3866c8e4f8ec095560148f8b9b5",
    "source": "// Candidate guest source: MIN / -1 must be checked overflow, never MIN.\npub fnc checked(int divisor): int {\n  val int minimum = -9223372036854775808;\n  return minimum / divisor;\n}\npub fnc main(): int {\n  return checked(-1);\n}\n",
    "expected": {
      "kind": "error",
      "code": "integer_overflow"
    }
  },
  {
    "id": "reject-i64-zero-remainder",
    "blob": "a0325c64972b42825f6a82f5c2c941c67dcec7d1",
    "source": "// Candidate guest source: integer remainder by zero is division_by_zero.\npub fnc checked(int divisor): int {\n  return Integer.rem(7, divisor);\n}\npub fnc main(): int {\n  return checked(0);\n}\n",
    "expected": {
      "kind": "error",
      "code": "division_by_zero"
    }
  },
  {
    "id": "trap-division-by-zero",
    "blob": "5eee4119bb0849be397ce0bc38eac66cb8e7b020",
    "source": "// Guest candidate: ordinary DivisionByZeroError must become Result.Err.\n// Expects main() = 42. Not executed on any compiler.\npub fnc checked(int divisor): int {\n  return 7 / divisor;\n}\npub fnc main(): int {\n  val result = trap checked(0);\n  return result.is_err() ? 42 : 1;\n}\n",
    "expected": {
      "kind": "value",
      "value": "42"
    }
  },
  {
    "id": "trap-integer-overflow",
    "blob": "44d0975d36915f7fea115c7ea3cd1bbfa8c62747",
    "source": "// Guest candidate: ordinary ArithmeticOverflowError must become Result.Err.\n// Expects main() = 42. Not executed on any compiler.\npub fnc checked(int increment): int {\n  return 9223372036854775807 + increment;\n}\npub fnc main(): int {\n  val result = trap checked(1);\n  return result.is_err() ? 42 : 1;\n}\n",
    "expected": {
      "kind": "value",
      "value": "42"
    }
  },
  {
    "id": "trap-result-no-doublewrap",
    "blob": "d7e536f97c703621f61959240e4e44f43d7be3fd",
    "source": "// Guest candidate: trap of an existing Result does NOT produce Result<Result<...>,Error>.\n// Expects main() = 42. Not executed on any compiler.\npub fnc main(): int {\n  val result = trap Ok(42);\n  return result.is_ok() ? result.unwrap() : 1;\n}\n",
    "expected": {
      "kind": "value",
      "value": "42"
    }
  }
];
async function guest(source){
  const ir=compileToProgramIRV2(source),esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
}
for(const f of fixtures)test('Java numeric/trap shared fixture: '+f.id,async()=>{
  const bytes=Buffer.from(f.source);
  assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),f.blob);
  const g=await guest(f.source);
  if(f.expected.kind==='value')assert.equal(g.main(),BigInt(f.expected.value));
  else{const overflow=f.expected.code==='integer_overflow';assert.throws(()=>g.main(),e=>e instanceof RangeError&&e.code===f.expected.code&&e.abiCode===(overflow?65537:65538)&&e.name===(overflow?'ArithmeticOverflowError':'DivisionByZeroError')&&Object.isFrozen(e));}
});
test('immutable locals, guard, checked quotient and Result identity',async()=>{
  for(const [s,v] of [["pub fnc main():int{val int n=40;val int x=n+2;^x;}","42"],["pub fnc main():int{val int x=0;guard x eq 1 else return 42;end return 0;}","42"],["pub fnc main():int{^ Integer.rem(-7,3);}","-1"],["pub fnc main():int{^ Integer.mod(-7,3);}","2"],["pub fnc main():int{^ Integer.rem(-9223372036854775808,-1);}","0"],["pub fnc main():int{^ -7/3;}","-2"],["pub fnc main():int{^ 12 ^^ 10;}","6"],["pub fnc main():int{^ (1 <<< 63) >>> 63;}","1"],["pub fnc main():int{val x=trap! Ok(42);^x.unwrap();}","42"],["pub fnc main():int{val x=trap Err(7);^x.is_err()?42:0;}","42"],["pub fnc main():int{val x=trap! (7/0);^x.is_err()?42:0;}","42"],["pub fnc main():int{val x=trap Ok(42);val y=trap x;^y.unwrap();}","42"],["pub fnc main():int{val x=trap 42;^x.unwrap();}","42"],["pub fnc main():int{val x=trap Err(7);val y=trap x;^y.is_err()?42:0;}","42"]])assert.equal((await guest(s)).main(),BigInt(v),s);
  const s='pub fnc main():int{val int n=84;^ n/2;}';
  assert.equal(compileAttoScalarV1(s),compileProgramV2(s));
});
test('unsupported effects/types and invalid binding lifetimes fail before publication',()=>{
  for(const s of ["pub fnc main():int{return trap 42;}","pub fnc main():int{val x=trap true;return 42;}","pub fnc main():int{val x=trap Some(42);return 42;}","pub fnc main():int{val x=trap Ok(42);return x;}","pub fnc main():int{val x=trap Ok(42);return x.is_ok(1)?42:0;}","pub fnc main():int{val x=trap Ok(42);return x.is_ok()+1;}","pub fnc main():int{val int x=true;return 42;}","pub fnc main(int x):int{val int x=42;return x;}","pub fnc main():int{val int x=x;return x;}","pub fnc main():int{val int x=1;val int x=2;return x;}","pub fnc main():int{if true then val int x=42;return x;else return 0;fi}","pub fnc main():int{val int x=42;return throw! x;}"])assert.throws(()=>compileProgramV2(s),undefined,s);
});
test('trap preserves exceptional panic and host argument type failures',async()=>{
  const g=await guest("fnc bad():int{val x=trap (7/0);return x.unwrap();} pub fnc main():int{val y=trap bad();return y.is_err()?42:0;}");
  assert.throws(()=>g.main(),e=>e.name==='ResultUnwrapPanic'&&e.cause.abiCode===65538);
  const h=await guest('pub fnc main(int n):int{val x=trap n;return x.unwrap();}');
  assert.throws(()=>h.main({code:'division_by_zero'}),TypeError);
});
test('typed trap IR rejects fabricated slot and operand type',()=>{
  for(const mutate of [
    x=>x.functions[0].body.init.operandType='float',
    x=>x.functions[0].body.init.inner={kind:'trapCapture',slot:0},
    x=>x.functions[0].body.body.receiver={kind:'capture',slot:0},
    x=>x.functions[0].body.body.receiver={kind:'trapCapture',slot:99}
  ]){
    const x=compileToProgramIRV2('pub fnc main():int{val x=trap Ok(42);return x.unwrap();}');
    mutate(x);assert.throws(()=>compileProgramIRV2(x),/error: program IR:/);
  }
});
