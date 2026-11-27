import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToCheckedU64IRV1 as lower,compileCheckedU64IRV1 as emit,compileCheckedU64ScalarV1 as compile} from '../src/checked-u64-scalar-v1.mjs';
const MAX=(1n<<64n)-1n;
const guest=e=>`pub fnc main():uint{return ${e};}`;
const load=async s=>(await import('data:text/javascript,'+encodeURIComponent(compile(s)))).main;
const fail=(code,message)=>e=>e instanceof RangeError&&e.code===code&&e.message===message;
const zero=fail('division_by_zero','E_U64_DIVISION_BY_ZERO');
const overflow=fail('integer_overflow','E_U64_OVERFLOW');
test('unsigned division precedence, associativity and exact literal bits',async()=>{
  for(const [e,v] of [['7/3',2n],['1+8/3*2',5n],['20/3/2',3n],['20/(3/2)',20n],['18446744073709551615/1',MAX],['18446744073709551615/2',MAX/2n],['9223372036854775808/9223372036854775809',0n],['0/18446744073709551615',0n]])assert.equal((await load(guest(e)))(),v,e);
});
test('fault order and unused argument evaluation',async()=>{
  for(const e of ['1/0','0/0','0*(1/0)','(1/0)+(18446744073709551615+1)','first(42,1/0)'])assert.throws(await load(guest(e)+' fnc first(u64 a,u64 b):u64{return a;}'),zero,e);
  for(const e of ['(18446744073709551615+1)/0','1/(0-1)','(0-1)+(1/0)'])assert.throws(await load(guest(e)),overflow,e);
});
test('division survives serialized typed IR and does not widen admission',async()=>{
  const s=guest('d(18446744073709551615,2)')+' fnc d(uint a,u64 b):u64{return a/b;}';
  const ir=JSON.parse(JSON.stringify(lower(s)));assert.equal(ir.functions[1].body.op,'/');assert.equal(emit(ir),compile(s));
  assert.equal((await import('data:text/javascript,'+encodeURIComponent(emit(ir)))).main(),MAX/2n);
  for(const op of ['%','//','mod','ashr']){const bad=structuredClone(ir);bad.functions[1].body.op=op;assert.throws(()=>emit(bad),/E_U64_PROFILE/);}
  for(const e of ['1//2','1/*x*/2','1%2','1/-2','1/18446744073709551616'])assert.throws(()=>compile(guest(e)),/E_U64_PROFILE/);
  assert.ok(!compile(guest('2*3')).includes('function div('));
});
test('256 independently compiled division guests with deterministic reference',async()=>{
  let state=0x9e3779b97f4a7c15n,values=0,faults=0;
  const next=()=>{state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;};
  for(let i=0;i<256;i++){
    const a=next(),r=next();const b=i%8===0?0n:i%8===1?1n:i%8===2?MAX:i%8===3?2n:i%8===4?r&0xffffffffn:r;
    const s=guest(`quotient(${a},${b})`)+' fnc quotient(u64 a,uint b):u64{return a/b;}';
    const main=await load(s);assert.equal(compile(s),emit(JSON.parse(JSON.stringify(lower(s)))));
    if(b===0n){assert.throws(main,zero);faults++;}else{assert.equal(main(),a/b);values++;}
  }
  assert.equal(values,224);assert.equal(faults,32);
});
