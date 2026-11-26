import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToCheckedU64IRV1 as lower,validateCheckedU64IRV1 as validate,compileCheckedU64IRV1 as emit,compileCheckedU64ScalarV1 as compile,CHECKED_U64_IR_MODEL} from '../src/checked-u64-scalar-v1.mjs';
const g=e=>`pub fnc main():uint{return ${e};}`;
const run=async ir=>(await import('data:text/javascript,'+encodeURIComponent(emit(ir)))).main();
const source=g('next(18446744073709551614)')+'fnc next(u64 a):uint{return a+1;}';
const baseline=()=>lower(source);
test('normalized typed IR retains full unsigned width and resolved call slots',async()=>{
  const ir=baseline();assert.equal(ir.integerModel,CHECKED_U64_IR_MODEL);
  assert.deepEqual(ir.functions[0].body,{kind:'call',target:1,args:[{kind:'u64',value:'18446744073709551614'}]});
  assert.deepEqual(ir.functions[1].paramTypes,['u64']);assert.equal(ir.functions[1].returnType,'u64');
  assert.deepEqual(ir.functions[1].body,{kind:'u64Binary',op:'+',left:{kind:'param',index:0},right:{kind:'u64',value:'1'}});
  assert.equal(await run(JSON.parse(JSON.stringify(ir))),18446744073709551615n);
});
test('existing source API and typed IR emit byte-identical ESM',()=>{
  for(const s of [source,g('0-1+1'),g('4+5*6'),g('9-(3-2)'),g('18446744073709551615'),g('first(42,18446744073709551615+1)')+'fnc first(u64 a,u64 b):u64{return a;}']){
    assert.equal(compile(s),emit(lower(s)));
  }
});
test('typed IR admission copies data without retaining mutable references',()=>{
  const raw=baseline(),copy=validate(raw);raw.functions[0].body.args[0].value='0';raw.functions[1].paramTypes[0]='int';
  assert.equal(copy.functions[0].body.args[0].value,'18446744073709551614');assert.deepEqual(copy.functions[1].paramTypes,['u64']);
});
test('typed IR keeps intermediate and unused-argument faults observable',async()=>{
  for(const s of [g('18446744073709551615+1-1'),g('0*(0-1)'),g('first(42,18446744073709551615+1)')+'fnc first(u64 a,u64 b):u64{return a;}']){
    await assert.rejects(run(lower(s)),e=>e instanceof RangeError&&e.code==='integer_overflow');
  }
});
for(const [name,mutate] of [
  ['signed model',p=>p.integerModel='signed-i64-checked-provisional'],['mixed signature',p=>p.functions[1].paramTypes[0]='int'],
  ['signed literal',p=>p.functions[0].body.args[0].kind='int'],['negative literal',p=>p.functions[0].body.args[0].value='-1'],
  ['overflow literal',p=>p.functions[0].body.args[0].value='18446744073709551616'],['noncanonical literal',p=>p.functions[0].body.args[0].value='01'],
  ['number literal',p=>p.functions[0].body.args[0].value=42],['wrong arity',p=>p.functions[0].body.args=[]],
  ['unknown call',p=>p.functions[0].body.target=32],['negative zero target',p=>p.functions[0].body.target=-0],
  ['unknown parameter',p=>p.functions[1].body.left.index=1],['unknown operator',p=>p.functions[1].body.op='/'],
  ['recursive graph',p=>p.functions[1].body={kind:'call',target:1,args:[{kind:'param',index:0}]}],['extra property',p=>p.functions[0].body.extra=true],
  ['sparse array',p=>delete p.functions[0].body.args[0]],['module',p=>p.modules=['m']],['invalid main visibility',p=>p.functions[0].pub=false]
])test('reject '+name,()=>{const p=baseline();mutate(p);assert.throws(()=>emit(p),/E_U64_PROFILE/);});
test('accessors are rejected without reading them',()=>{
  const p=baseline();let read=false;Object.defineProperty(p.functions[0].body.args[0],'value',{get(){read=true;return '1';}});
  assert.throws(()=>emit(p),/E_U64_PROFILE/);assert.equal(read,false);
});
test('direct IR expanded work is bounded independently of parser',()=>{
  const p=baseline();p.functions=[{...p.functions[0],body:{kind:'call',target:15,args:[]}}];
  for(let i=1;i<=15;i++)p.functions.push({module:null,name:'f'+i,kind:'fnc',pub:false,params:[],paramTypes:[],returnType:'u64',body:i===1?{kind:'u64',value:'1'}:{kind:'u64Binary',op:'+',left:{kind:'call',target:i-1,args:[]},right:{kind:'call',target:i-1,args:[]}}});
  assert.throws(()=>emit(p),/expanded work budget/);
});
