import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const pre='define dimension Time; define unit Second: Time; define unit Millis: Time = Second / 1000; type Duration = int where units in Second; type Positive = int where self > 0 and units in Second; type Bounded = int where self >= 1 and self <= 42; ';
const main=e=>'pub fnc main() -> int { return '+e+'; }';
const guest=async body=>(await import('data:text/javascript;base64,'+Buffer.from(compileProgramV2(pre+body)).toString('base64'))).main;
for(const [style,cast] of [['prefix',(x,t)=>'<'+t+'>('+x+')'],['postfix',(x,t)=>'('+x+')::<'+t+'>'],['keyword',(x,t)=>'('+x+' as '+t+')']]){
 test(style+' positive quantity',async()=>assert.equal((await guest(main(cast('42.<Second>','Positive')+' / 1<Second>')))(),42n));
 test(style+' negative quantity',async()=>assert.throws(await guest(main(cast('0.<Second>','Positive')+' / 1<Second>')),e=>e.code==='refinement_violation'));
 test(style+' bounded scalar',async()=>assert.equal((await guest(main(cast('42','Bounded'))))(),42n));
 test(style+' upper failure',async()=>assert.throws(await guest(main(cast('43','Bounded'))),e=>e.code==='refinement_violation'));
 test(style+' operand fault',async()=>assert.throws(await guest(main(cast('1<Second> / 0<Second>','Bounded'))),e=>e.code==='division_by_zero'));
 test(style+' incompatible dimension',()=>assert.throws(()=>compileProgramV2(pre+main(cast('42','Positive'))),/E_UNIT_DIMENSION:/));
 test(style+' incompatible scale',()=>assert.throws(()=>compileProgramV2(pre+main(cast('42<Millis>','Positive'))),/E_UNIT_SCALE:/));
 test(style+' runtime parameter',async()=>assert.equal((await guest('fnc narrowed(int x) -> Bounded { return '+cast('x','Bounded')+'; } '+main('narrowed(42)')))(),42n));
 test(style+' runtime parameter fault',async()=>assert.throws(await guest('fnc narrowed(int x) -> Bounded { return '+cast('x','Bounded')+'; } '+main('narrowed(43)')),e=>e.code==='refinement_violation'));
}
for(const [body,code] of [
 ['pub fnc main() -> int { val Bounded n = 43; return n; }','E_REFINEMENT_BINDING'],
 ['fnc f(int x) -> Bounded { return x; } '+main('42'),'E_REFINEMENT_RETURN'],
 ['fnc f(Bounded x) -> int { return x; } '+main('f(43)'),'E_REFINEMENT_PRECONDITION'],
 ['type Impossible = int where self > 0 and self < 1; '+main('42'),'E_REFINEMENT_EMPTY'],
 ['type Min = int where self < -9223372036854775808; '+main('42'),'E_REFINEMENT_EMPTY'],
 ['type Max = int where self > 9223372036854775807; '+main('42'),'E_REFINEMENT_EMPTY'],
 ['fnc tag(Duration n) -> Duration { return n.<Second>; } '+main('42'),'E_UNIT_ATTACHMENT'],
])test('reject '+code+' '+body,()=>assert.throws(()=>compileProgramV2(pre+body),new RegExp(code+':')));
test('proved boundary',async()=>assert.equal((await guest('fnc f(Bounded x) -> int { return x; } '+main('f(40+2)')))(),42n));
test('parameter attachment',async()=>assert.equal((await guest('fnc tag(int n) -> Duration { return n.<Second>; } '+main('tag(42) / 1<Second>')))(),42n));
test('immutable alias binding',async()=>assert.equal((await guest('pub fnc main() -> int { val Bounded n = 42 as Bounded; val result: int = n; return result; }'))(),42n));
test('cast before overflow',async()=>assert.throws(await guest(main('(43 as Bounded) + 9223372036854775807')),e=>e.code==='refinement_violation'));
test('overflow before cast',async()=>assert.throws(await guest(main('(9223372036854775807 + 1) as Bounded')),e=>e.code==='integer_overflow'));
test('forged check range and injection rejected',()=>{
 const ir=compileToProgramIRV2(pre+main('42 as Bounded'));
 for(const [field,value] of [['minimum','43'],['maximum','9223372036854775808'],['minimum','0n;evil()'],['minimum',42]]){
  const bad=structuredClone(ir);bad.functions[0].body[field]=value;
  assert.throws(()=>compileProgramIRV2(bad));
 }
});
