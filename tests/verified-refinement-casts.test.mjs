import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2,compileVerifiedStrict} from '../src/program-v2.mjs';
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

test('inferred positive quantity refinement',async()=>assert.equal((await guest('pub fnc main() -> int { val a = 42.<Second>::<Positive>; return a / 1<Second>; }'))(),42n));
test('inferred refinement failure',async()=>assert.throws(await guest('pub fnc main() -> int { val a = 0.<Second>::<Positive>; return a / 1<Second>; }'),e=>e.code==='refinement_violation'));
test('inferred unit erasure',()=>assert.throws(()=>compileProgramV2(pre+'pub fnc main() -> int { val a = 42.<Second>; return a; }'),/E_UNIT_ERASURE:/));
test('inferred local proves parameter',async()=>assert.equal((await guest('fnc f(Bounded x) -> int { return x; } pub fnc main() -> int { val a = (40 + 2); return f(a); }'))(),42n));
test('inferred local denies parameter',()=>assert.throws(()=>compileProgramV2(pre+'fnc f(Bounded x) -> int { return x; } pub fnc main() -> int { val a = 43; return f(a); }'),/E_REFINEMENT_PRECONDITION:/));

const strictGuest=async body=>(await import('data:text/javascript;base64,'+Buffer.from(compileVerifiedStrict(pre+body)).toString('base64'))).main;
for(const [id,body,want] of [
 ['literal','pub fnc main() -> int { return 40+2; }',42n],
 ['refinement','fnc f(Bounded x) -> int { return x+1; } '+main('f(41)'),42n],
 ['positive-denominator','fnc f(Positive x) -> int { return 42<Second> / x; } '+main('f(1<Second>)'),42n],
 ['bounded-cast',main('42 as Bounded'),42n],
 ['minimum',main('-9223372036854775808'),-9223372036854775808n],
 ['scalar-div',main('84 / 2'),42n],
])test('strict '+id,async()=>assert.equal((await strictGuest(body))(),want));
for(const [id,body] of [
 ['unknown-add','fnc f(int x) -> int { return x+1; } '+main('f(41)')],
 ['unknown-mul','fnc f(int x) -> int { return x*2; } '+main('f(21)')],
 ['unknown-neg','fnc f(int x) -> int { return -x; } '+main('f(-42)')],
 ['zero',main('42 / 0')],
 ['minimum-div',main('-9223372036854775808 / -1')],
 ['unknown-cast','fnc f(int x) -> Bounded { return x as Bounded; } '+main('f(42)')],
 ['eager-unused','pub fnc main() -> int { val int n = 9223372036854775807+1; return 42; }'],
 ['eager-masked',main('(9223372036854775807+1)*0')],
 ['unsafe-unused-helper','fnc f(int x) -> int { return x+1; } '+main('42')],
])test('strict rejects '+id,()=>assert.throws(()=>compileVerifiedStrict(pre+body),/E_VERIFY_UNPROVEN:/));
test('strict ordinary fallback rejected',()=>assert.throws(()=>compileVerifiedStrict(main('42')),/E_VERIFY_UNSUPPORTED:/));
test('strict closed quantity fallback rejected',()=>assert.throws(()=>compileVerifiedStrict('define dimension Time; define unit Second: Time; '+main('42<Second> / 1<Second>')),/E_VERIFY_UNSUPPORTED:/));

for(const [id,body,want] of [
 ['nonzero-true','fnc f(int x) -> int { if x != 0 { return 42/x; } return 0; } '+main('f(1)'),42n],
 ['nonzero-false','fnc f(int x) -> int { if x != 0 { return 42/x; } return 0; } '+main('f(0)'),0n],
 ['lazy-and','fnc f(int x) -> int { if x != 0 && 42/x > 0 { return 1; } return 42; } '+main('f(0)'),42n],
 ['lazy-or','fnc f(int x) -> int { if x == 0 || 42/x > 0 { return 42; } return 0; } '+main('f(0)'),42n],
 ['two-holes','fnc f(int x) -> int { if x != 0 && x != -1 { return -9223372036854775808/x; } return 0; } '+main('f(2)'),-4611686018427387904n],
 ['join-holes','fnc f(int x) -> int { if x < 0 || x > 0 { return 42/x; } return 0; } '+main('f(-1)'),-42n],
 ['not','fnc f(int x) -> int { if !(x == 0) { return 42/x; } else { return 42; } } '+main('f(0)'),42n],
 ['nested','fnc f(int x) -> int { if x != 0 { if x != -1 { return -9223372036854775808/x; } return 0; } return 0; } '+main('f(2)'),-4611686018427387904n],
])test('strict control flow '+id,async()=>assert.equal((await strictGuest(body))(),want));
for(const [id,body] of [
 ['reversed','fnc f(int x) -> int { if 42/x > 0 && x != 0 { return 42; } return 0; } '+main('f(1)')],
 ['min-overflow','fnc f(int x) -> int { if x != 0 { return -9223372036854775808/x; } return 0; } '+main('f(2)')],
 ['bad-or','fnc f(int x) -> int { if x != 0 || 42/x > 0 { return 42; } return 0; } '+main('f(0)')],
 ['wrong-binding','fnc f(int x,int y) -> int { if x != 0 { return 42/y; } return 0; } '+main('f(1,1)')],
 ['lost-fact','fnc f(int x) -> int { if x != 0 || x == 0 { return 42/x; } return 0; } '+main('f(1)')],
])test('strict control flow rejects '+id,()=>assert.throws(()=>compileVerifiedStrict(pre+body),/E_VERIFY_UNPROVEN:/));

for(const [id,body,want] of [
 ['rebind','pub fnc main() -> int { let int x = 1; x = 42; return x; }',42n],
 ['copy-before-rebind','pub fnc main() -> int { let int x = 1; val old = x; x = 0; return 42/old; }',42n],
 ['branch-rebind','fnc f(int x) -> int { let int d = x; if d != 0 { d = 1; return 42/d; } return 0; } '+main('f(2)'),42n],
])test('strict scalar assignment '+id,async()=>assert.equal((await strictGuest(body))(),want));
for(const [id,body,code] of [
 ['stale','pub fnc main() -> int { let int x = 1; x = 0; return 42/x; }','E_VERIFY_UNPROVEN'],
 ['stale-branch','fnc f(int x) -> int { let int d = x; if d != 0 { d = 0; return 42/d; } return 0; } '+main('f(1)'),'E_VERIFY_UNPROVEN'],
 ['bad-invariant','pub fnc main() -> int { let Bounded x = 1; x = 43; return x; }','E_REFINEMENT_BINDING'],
 ['immutable','pub fnc main() -> int { val int x = 1; x = 2; return x; }','E_VERIFY_UNSUPPORTED'],
 ['loop-double-write-refinement','pub fnc main() -> int { let Bounded x = 1; while x < 42 { x = x+1; x = x+1; } return x; }','E_REFINEMENT_BINDING'],
 ['loop-double-write-overflow','pub fnc main() -> int { let int x = 0; while x >= 0 { x = x+1; x = x+1; } return x; }','E_VERIFY_UNPROVEN'],
])test('strict scalar rejects '+id,()=>assert.throws(()=>compileVerifiedStrict(pre+body),new RegExp(code+':')));

for(const [id,body,want] of [
 ['counter','pub fnc main() -> int { let Bounded x = 1; while x < 42 { x = x+1; } return x; }',42n],
 ['ordered-double-write','pub fnc main() -> int { let int x = 1; while x < 42 { x = x+1; x = x+1; } return x; }',43n],
 ['zero-iteration','pub fnc main() -> int { let int x = 42; while x < 42 { x = x+1; } return x; }',42n],
 ['descending','pub fnc main() -> int { let int x = 42; while x > 0 { x = x-1; } return x+42; }',42n],
 ['unchanged','pub fnc main() -> int { let int d = 1; let int x = 0; while x < 42 { x = x+42/d; } return x; }',42n],
 ['snapshot','pub fnc main() -> int { let int x = 1; val old = x; while x < 42 { x = x+1; } return 42/old; }',42n],
 ['successive','pub fnc main() -> int { let int x = 0; while x < 21 { x = x+1; } while x < 42 { x = x+1; } return x; }',42n],
 ['lazy-guard','pub fnc main() -> int { let int x = 42; while x > 0 && 42/x > 0 { x = x-1; } return 42; }',42n],
 ['break','pub fnc main() -> int { let int x = 1; while x < 42 { break; } return x; }',1n],
])test('strict while '+id,async()=>assert.equal((await strictGuest(body))(),want));
for(const [id,body,code] of [
 ['overflow','pub fnc main() -> int { let int x = 0; while x >= 0 { x = x+1; } return x; }','E_VERIFY_UNPROVEN'],
 ['invariant','pub fnc main() -> int { let Bounded x = 1; while x <= 42 { x = x+1; } return x; }','E_REFINEMENT_BINDING'],
 ['stale-entry','pub fnc main() -> int { let int x = 1; while x >= 0 { x = 42/x; } return x; }','E_VERIFY_UNPROVEN'],
 ['stale-exit','pub fnc main() -> int { let int x = 1; while x > 0 { x = x-1; } return 42/x; }','E_VERIFY_UNPROVEN'],
 ['immutable-target','pub fnc main() -> int { val int x = 1; while x < 42 { x = x+1; } return x; }','E_VERIFY_UNSUPPORTED'],
 ['break-unreachable-tail','pub fnc main() -> int { let int x = 1; while x < 42 { break; x = 2; } return x; }','E_VERIFY_UNSUPPORTED'],
])test('strict while rejects '+id,()=>assert.throws(()=>compileVerifiedStrict(pre+body),new RegExp(code+':')));

test('raw IR cannot opt in to strict while through ordinary emitter',()=>{
 const ir=compileToProgramIRV2(main('42'));
 ir.functions[0].body={kind:'scalarWhile',slot:0,init:{kind:'int',value:'0'},
   condition:{kind:'bool',value:false},update:{kind:'int',value:'1'},body:{kind:'capture',slot:0}};
 assert.throws(()=>compileProgramIRV2(ir),/scalar while requires strict source admission/);
});
