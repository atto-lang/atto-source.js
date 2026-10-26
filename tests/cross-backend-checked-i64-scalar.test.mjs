import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

// Shared executable scalar boundary with the .NET bootstrap compiler and the
// Wasm guest ABI. A matching result here is NOT cross-backend execution proof:
// .NET CIL and LLVM-produced Wasm must also be run for each row independently.
const header='// oreslang:checked-i64-v1\n';
const cases=[
  ['precedence','2 + 3 * 4',14n],
  ['parentheses','(2 + 3) * 4',20n],
  ['negative','-7 + 3',-4n],
  ['max','9223372036854775807',9223372036854775807n],
  ['min','-9223372036854775808',-9223372036854775808n],
  ['zero','0',0n],
  ['signed multiplication','-7 * -6',42n],
];
for(const [name,expression,expected] of cases){
  test('checked-i64 cross-backend scalar: '+name,async()=>{
    const source=header+'define pub fnc main(): int { return '+expression+'; }';
    const ir=compileToProgramIRV2(source);
    const esm=compileProgramV2(source);
    assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm,
      'direct source and validated IR must emit identical ESM');
    const {main}=await import('data:text/javascript,'+encodeURIComponent(esm));
    assert.equal(main(),expected);
  });
}
for(const [name,expression] of [
  ['add overflow','9223372036854775807 + 1'],
  ['subtract overflow','-9223372036854775808 - 1'],
  ['multiply overflow','9223372036854775807 * 2'],
  ['unary negate minimum','-(-9223372036854775808)'],
]){
  test('checked-i64 cross-backend scalar rejects: '+name,async()=>{
    const source=header+'define pub fnc main(): int { return '+expression+'; }';
    const esm=compileProgramV2(source);
    const {main}=await import('data:text/javascript,'+encodeURIComponent(esm));
    assert.throws(()=>main(),/ORES_I64_OVERFLOW/);
  });
}
test('int / int must not silently become integer division',()=>{
  assert.throws(()=>compileProgramV2(header+'define pub fnc main(): int {return 7 / 2;}'),
    /error: program v2:|error: program IR:/);
});
