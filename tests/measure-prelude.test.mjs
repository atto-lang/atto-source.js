import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MEASURE_SOURCE} from '../src/measure-prelude.mjs';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
test('exact canonical source and actual implicit ESM guest',async()=>{
 assert.equal(Buffer.byteLength(MEASURE_SOURCE),3072);
 assert.equal(createHash('sha256').update(MEASURE_SOURCE).digest('hex'),'a411966eb3188104cd13cc2201b4d1d0de1e12404378aba313b396ae726a3376');
 const source='pub fnc main() -> int { val a=4200<Centimeter>.to_unit<Meter>(); val PositiveInt b=a/1<Meter>; return b; }';
 const implicit=compileProgramV2(source);
 assert.equal(implicit,compileProgramV2(MEASURE_SOURCE+'\n'+source));
 const guest=await import('data:text/javascript;base64,'+Buffer.from(implicit).toString('base64'));
 assert.equal(guest.main(),42n);
});
test('implicit checks fail closed with original locations',()=>{
 assert.throws(()=>compileToProgramIRV2('pub fnc main() -> int { val PositiveInt n=0; return n; }'),/E_REFINEMENT_BINDING/);
 assert.throws(()=>compileToProgramIRV2('pub fnc main() -> int {\n return 1<Centimeter>.to_unit<Meter>()/1<Meter>; }'),/E_UNIT_INEXACT.* at 2:/);
 assert.throws(()=>compileToProgramIRV2('pub fnc main() -> int { return 42<Second>; }'),/E_UNIT_ERASURE/);
 assert.doesNotThrow(()=>compileProgramV2('pub fnc main() -> int { /* 42<Meter> */ return 42; }'));
});
