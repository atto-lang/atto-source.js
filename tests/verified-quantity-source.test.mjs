import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileAttoScalarV1} from '../src/program-v2.mjs';
const pre='define dimension Time; define unit Second: Time; define unit Millis: Time = Second / 1000;';
const source=e=>pre+' pub fnc main() -> int { return '+e+'; }';
const guest=async(e,compile=compileProgramV2)=>(await import('data:text/javascript;base64,'+Buffer.from(compile(source(e))).toString('base64'))).main;
for(const [id,tag] of [['compact',n=>n+'<Second>'],['dot',n=>n+'.<Second>'],['legacy',n=>n+'::<Second>'],['keyword',n=>'('+n+' as Second)']]){
 test(id+' actual ESM result',async()=>assert.equal((await guest(tag('84')+' / '+tag('2')))(),42n));
 test(id+' divide zero',async()=>assert.throws(await guest(tag('1')+' / '+tag('0')),e=>e.code==='division_by_zero'));
 test(id+' signed overflow',async()=>assert.throws(await guest(tag('-9223372036854775808')+' / '+tag('-1')),e=>e.code==='integer_overflow'));
}
for(const [id,e] of [['prefix','(<i64>42).<Second> / 1<Second>'],['postfix','42::<i64>.<Second> / 1<Second>'],['keyword cast','(42 as i64).<Second> / 1<Second>'],['expression','(40 + 2).<Second> / 1<Second>'],['conversion','42000.<Millis>.to_unit<Second>() / 1<Second>']]){
 test(id,async()=>assert.equal((await guest(e))(),42n));
}
for(const [e,code] of [['42<Second>.<Millis>','E_UNIT_ATTACHMENT'],['(1<Second> / 1<Millis>).<Second>','E_UNIT_ATTACHMENT'],['42.<Time>','E_UNIT_NAME'],['42.<Second>.<Second>','E_UNIT_ATTACHMENT'],['42<Second>::<i64>','E_UNIT_ERASURE'],['<i64>(42<Second>)','E_UNIT_ERASURE'],['42<Second> as i64','E_UNIT_ERASURE']]){
 test('reject '+e,()=>assert.throws(()=>compileToProgramIRV2(source(e)),new RegExp(code+':')));
}
test('checked scalar profile routes to validated IR',async()=>assert.equal((await guest('42.<Second> / 1<Second>',compileAttoScalarV1))(),42n));
test('intermediate overflow survives attachment',async()=>assert.throws(await guest('(9223372036854775807 + 1).<Second> / 1<Second>'),e=>e.code==='integer_overflow'));
test('reject unsupported refinement carrier and bare untyped scalar division',()=>{
 assert.throws(()=>compileProgramV2(pre+' type Duration = i32 where self > 2147483647 and units in Second; pub fnc main() -> int { return 42; }'),/E_REFINEMENT_EMPTY/);
 assert.throws(()=>compileProgramV2(pre+' type Duration = float where units in Second; pub fnc main() -> int { return 42; }'),/E_REFINEMENT_BOUND/);
 assert.throws(()=>compileProgramV2(source('84 / 2')),/E_UNIT_SCALAR_DIVISION/);
});


test('contracted delimiter forms execute real equivalent ESM guests',async()=>{
 const head=pre+' type Bounded = int where self >= 1 and self <= 42; fnc f(int x) -> int requires x >= 1 requires x <= 42';
 const tail=' pub fnc main() -> int { return f(2); }';
 for(const body of [' { return 84/x; }','\nbegin return 84/x; end',' :: return 84/x; end','\n:: return 84/x; end']){
   const guest=await import('data:text/javascript;base64,'+Buffer.from(compileProgramV2(head+body+tail)).toString('base64'));
   assert.equal(guest.main(),42n);
 }
 for(const body of [' begin return 84/x; end',' :: return 84/x; }',' :: return 84/x;'])
   assert.throws(()=>compileProgramV2(head+body+tail));
});
