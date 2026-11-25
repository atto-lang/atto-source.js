import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileAttoScalarV1,compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const fixtures=[
  {
    "source": "// Candidate guest source: integer truncation and dividend-signed remainder.\n// Target main return 42. Not yet compiler/AOT executed.\npub fnc divide(int lhs, int rhs): int {\n  return lhs / rhs;\n}\npub fnc remainder(int lhs, int rhs): int {\n  return Integer.rem(lhs, rhs);\n}\npub fnc main(): int {\n  val int a = -7;\n  val int b = 3;\n  return divide(a, b) * -21 + (remainder(a, b) + 1);\n}\n",
    "blob": "d7b61afd0fe074395b092aa4abaa08de4961602e"
  },
  {
    "source": "// Candidate guest source: MIN / -1 must be checked overflow, never MIN.\npub fnc checked(int divisor): int {\n  val int minimum = -9223372036854775808;\n  return minimum / divisor;\n}\npub fnc main(): int {\n  return checked(-1);\n}\n",
    "blob": "aff2c8170924a3866c8e4f8ec095560148f8b9b5"
  }
];
let serial=0;
async function execute(source,compile) {
  const esm=compile(source);
  const guest=await import('data:text/javascript;base64,'+Buffer.from(esm).toString('base64')+'#'+(++serial));
  return guest.main();
}
test('exact shared quotient and MIN overflow source blobs',async()=>{
  for(const f of fixtures){
    const bytes=Buffer.from(f.source);
    assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),f.blob);
  }
  for(const compile of [compileAttoScalarV1,compileProgramV2]){
    assert.equal(await execute(fixtures[0].source,compile),42n);
    await assert.rejects(execute(fixtures[1].source,compile),/ORES_I64_OVERFLOW/);
  }
});
test('immutable typed locals evaluate once and in order',async()=>{
  for(const compile of [compileAttoScalarV1,compileProgramV2]){
    assert.equal(await execute('pub fnc main(): int { val int x = 20; val int y = x + 2; return x + y; }',compile),42n);
    await assert.rejects(execute('pub fnc main(): int { val int x = 7 / 0; return 42; }',compile),/ORES_I64_DIVISION_BY_ZERO/);
  }
});
test('locals reject self-reference, shadowing, reassignment, type mismatch and unsupported branch scope',()=>{
  for(const source of [
    'pub fnc main(): int { val int x = x; return x; }',
    'pub fnc main(): int { val int x = true; return 42; }',
    'pub fnc main(): int { val int x = 1; val int x = 2; return x; }',
    'pub fnc main(int x): int { val int x = 1; return x; }',
    'pub fnc main(): int { val int x = 1; x = 2; return x; }',
    'pub fnc main(): int { if true then val int x = 1; return x; else return 42; fi }'
  ]) for(const compile of [compileAttoScalarV1,compileProgramV2]) assert.throws(()=>compile(source),source);
});
test('forged local IR cannot reference its own slot or use noninteger initialization',()=>{
  const src='pub fnc main(): int { val int x = 42; return x; }';
  for(const init of [{kind:'capture',slot:0},{kind:'bool',value:true}]){
    const ir=compileToProgramIRV2(src);
    ir.functions[0].body.init=init;
    assert.throws(()=>compileProgramIRV2(ir));
  }
});
