import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const cases=[
  ['ten million iterations preserve full i64 sum',
    'loop (val i:int=0,val sum:int=0) { if i >= 10000000 { break sum; } recur(i+1,sum+i); }',49999995000000n],
  ['odd parallel swaps retain old state values',
    'loop (val i:int=0,val a:int=1,val b:int=42) { if i >= 100001 { break a; } recur(i+1,b,a); }',42n],
  ['initial break skips state updates',
    'loop (val i:int=0,val a:int=42) { if i >= 0 { break a; } recur(i+1,a+1); }',42n],
  ['untaken recur never evaluates overflowing operand',
    'loop (val i:int=9223372036854775807) { if i >= 0 { break 42; } recur(i+1); }',42n],
];
for(const [name,body,expected] of cases)test(name,async()=>{
  const source='pub fnc main():int { return '+body+'; }';
  const ir=compileToProgramIRV2(source);
  const esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
  assert.equal(guest.main(),expected);
});
