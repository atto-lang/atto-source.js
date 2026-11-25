import test from 'node:test';
import assert from 'node:assert/strict';
import {compileAttoScalarV1,compileProgramV2} from '../src/program-v2.mjs';

let serial=0;
async function run(source, compile=compileAttoScalarV1) {
  const esm=compile(source);
  const guest=await import('data:text/javascript;base64,'+Buffer.from(esm).toString('base64')+'#'+(++serial));
  return guest.main();
}
const scalar=expr=>'pub fnc main(): int { return '+expr+'; }';

test('checked quotient is signed integer, truncates toward zero and associates left', async()=>{
  for (const compile of [compileAttoScalarV1,compileProgramV2]) {
    for (const [expr,expected] of [
      ['-7 / 3',-2n],['7 / -3',-2n],['-7 / -3',2n],
      ['7 / 3 * 21',42n],['84 / 2 / 2',21n],['1 + 82 / 2',42n],
      ['9223372036854775807 / 1',9223372036854775807n],
      ['-9223372036854775808 / 1',-9223372036854775808n],
      ['9007199254740993 / 1',9007199254740993n]
    ]) assert.equal(await run(scalar(expr),compile),expected,expr);
  }
});
test('named remainder and modulus are distinct; raw percent remains rejected',async()=>{
  for(const [expr,expected] of [
    ['Integer.rem(-7,3)',-1n],['Integer.rem(7,-3)',1n],
    ['Integer.rem(-9223372036854775808,-1)',0n],['Integer.mod(-7,3)',2n],
    ['Integer.mod(-7,-3)',2n]
  ]) assert.equal(await run(scalar(expr)),expected,expr);
  assert.throws(()=>compileAttoScalarV1(scalar('7 % 3')), /reserved/);
});
test('checked dynamic division failures are distinct provisional root errors',async()=>{
  const source=(expr,arg)=>'pub fnc checked(int d): int { return '+expr+'; } pub fnc main(): int { return checked('+arg+'); }';
  await assert.rejects(run(source('7 / d','0')),e=>e instanceof RangeError&&e.message==='ORES_I64_DIVISION_BY_ZERO: checked signed 64-bit division by zero');
  await assert.rejects(run(source('-9223372036854775808 / d','-1')),e=>e instanceof RangeError&&e.message==='ORES_I64_OVERFLOW: checked signed 64-bit overflow');
  await assert.rejects(run(source('Integer.rem(7,d)','0')),e=>e instanceof RangeError&&e.message==='ORES_I64_DIVISION_BY_ZERO: checked signed 64-bit remainder by zero');
});
test('division does not admit noninteger operands',()=>{
  assert.throws(()=>compileProgramV2(scalar('true / 1')));
  assert.throws(()=>compileProgramV2(scalar('1 / false')));
});
