import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const program=x=>'pub fnc main():int { return '+x+'; }';
const loop=(condition,init='42')=>'loop (val a:int='+init+') { if '+condition+' { break a; } recur(a+1); }';
const mk=n=>'loop ('+Array.from({length:n},(_,i)=>'val s'+i+':int='+(i?'s'+(i-1)+'+1':'0')).join(',')+') { if s0 >= 1 { break s'+(n-1)+'; } recur('+Array.from({length:n},(_,i)=>i?'s'+i:'s0+1').join(',')+'); }';
async function guest(body){
  const source=program(body),ir=compileToProgramIRV2(source),esm=compileProgramV2(source);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
  return import('data:text/javascript,'+encodeURIComponent(esm));
}
test('closed loops accept normalized Boolean equality and inequality',async()=>{
  for(const [cond,want] of [['true eq true',42n],['true neq false',42n],['(a >= 42) eq true',42n],['(a >= 43) eq true',43n]])
    assert.equal((await guest(loop(cond))).main(),want);
});
test('closed state capacity, initialization and independent loop slots',async()=>{
  assert.equal((await guest(mk(32))).main(),31n);
  assert.equal((await guest(loop('true','40')+' + '+loop('true','2'))).main(),42n);
  for(const body of [mk(33),'loop (val a:int=b,val b:int=42) { if true { break a; } recur(a,b); }','loop (val a:int=1,val a:int=42) { if true { break a; } recur(a,a); }'])
    assert.throws(()=>compileProgramV2(program(body)),/error:/);
});
test('closed loop i64 bounds and skipped arithmetic',async()=>{
  assert.equal((await guest(loop('true','-9223372036854775808'))).main(),-9223372036854775808n);
  assert.equal((await guest('loop (val a:int=42) { if true { break a; } recur(a/0); }')).main(),42n);
  for(const body of [loop('false','9223372036854775807'),loop('true','9223372036854775807+1')]){
    const g=await guest(body);assert.throws(()=>g.main(),/ORES_I64_OVERFLOW/);
  }
});
test('Boolean closed loop retains operand typing and closed scope',()=>{
  for(const cond of ['true eq a','outside eq true','true < false'])
    assert.throws(()=>compileProgramV2(program(loop(cond))),/error:/);
  const ir=compileToProgramIRV2(program(loop('true eq true')));
  assert.equal(ir.functions[0].body.condition.kind,'boolCompare');
  for(const mutate of [d=>d.condition.op='<',d=>d.condition.left={kind:'int',value:'1'},d=>d.condition.left={kind:'param',index:0},d=>d.condition.left={kind:'capture',slot:99999}]){
    const copy=JSON.parse(JSON.stringify(ir));mutate(copy.functions[0].body);
    assert.throws(()=>compileProgramIRV2(copy),/error:/);
  }
});
