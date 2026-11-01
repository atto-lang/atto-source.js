import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileToProgramIRV2,compileProgramIRV2,compileProgramV2
} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

// Program-v2 tests use the real frontend and generated ESM under Node 22.
// Never report these tests as executed Java, LLVM, Cranelift, .NET or Wasm.
const source='pub fnc main(int a,int b):int{return a+b;}';
const original=compileToProgramIRV2(source);
const copy=v=>JSON.parse(JSON.stringify(v));
const alter=edit=>{const ir=copy(original);edit(ir);return ir;};
const expr=edit=>alter(ir=>edit(ir.functions[0].body,ir));
const replacement=body=>alter(ir=>{ir.functions[0].body=body;});
const int=value=>({kind:'int',value});
const arg=index=>({kind:'param',index});
const binary=op=>({kind:'binary',op,left:arg(0),right:arg(1)});

const invalid=[
 ['wrong version',()=>alter(ir=>{ir.schemaVersion=1;})],
 ['wrong dialect',()=>alter(ir=>{ir.dialect='oreslang.scalar';})],
 ['wrong integer model',()=>alter(ir=>{ir.integerModel='signed-i64-wrap-provisional';})],
 ['missing modules field',()=>alter(ir=>{delete ir.modules;})],
 ['extra program property',()=>alter(ir=>{ir.execute='process.exit(1)';})],
 ['namespace dotted path',()=>alter(ir=>{ir.sourceNamespace='x.y';})],
 ['namespace invalid separator',()=>alter(ir=>{ir.sourceNamespace='x/y';})],
 ['duplicate modules',()=>alter(ir=>{ir.modules=['a','a'];})],
 ['invalid module identifier',()=>alter(ir=>{ir.modules=['a-b'];})],
 ['modules not array',()=>alter(ir=>{ir.modules={};})],
 ['functions not array',()=>alter(ir=>{ir.functions={};})],
 ['sparse function table',()=>alter(ir=>{ir.functions=new Array(1);})],
 ['null function',()=>alter(ir=>{ir.functions=[null];})],
 ['bad visibility',()=>alter(ir=>{ir.functions[0].pub='yes';})],
 ['extra function metadata',()=>alter(ir=>{ir.functions[0].hostImpl='eval';})],
 ['noncanonical integer leading zero',()=>replacement(int('01'))],
 ['negative zero integer',()=>replacement(int('-0'))],
 ['i64 positive overflow literal',()=>replacement(int('9223372036854775808'))],
 ['i64 negative overflow literal',()=>replacement(int('-9223372036854775809'))],
 ['nondecimal literal',()=>replacement(int('0x1'))],
 ['bare boolean in integer result',()=>replacement({kind:'bool',value:true})],
 ['boolean guard as integer result',()=>replacement({kind:'not',inner:{kind:'bool',value:true}})],
 ['out of range param',()=>replacement(arg(999))],
 ['negative param index',()=>replacement(arg(-1))],
 ['negative zero param index',()=>replacement(arg(-0))],
 ['unknown arithmetic opcode',()=>replacement(binary('/'))],
 ['unknown exponent opcode',()=>replacement(binary('**'))],
 ['host injection opcode',()=>replacement(binary('+process.exit(1)+'))],
 ['extra arithmetic metadata',()=>replacement({...binary('+'),eval:'evil'})],
 ['invalid call target',()=>replacement({kind:'call',target:99,args:[]})],
 ['invalid call arity',()=>replacement({kind:'call',target:0,args:[]})],
 ['unsupported intrinsic',()=>replacement({kind:'intrinsic',name:'process.exit',args:[]})],
 ['unsupported host expression',()=>replacement({kind:'host',value:'process'})],
 ['missing binary operand',()=>replacement({kind:'binary',op:'+',left:arg(0)})],
 ['extra parameter reference field',()=>replacement({kind:'param',index:0,host:true})]
];

for(const [name,build] of invalid){
  test('program-v2 IR fails closed: '+name,()=>{
    assert.throws(()=>compileProgramIRV2(build()),/error: program IR:/);
  });
}

test('program-v2 rejects an accessor before reading it',()=>{
  const v=copy(original);
  let calls=0;
  Object.defineProperty(v,'functions',{enumerable:true,get(){
    calls++;throw Error('unexpected getter execution');
  }});
  assert.throws(()=>compileProgramIRV2(v),/error: program IR:.*accessor/);
  assert.equal(calls,0);
});

test('program-v2 rejects additional Symbol keys',()=>{
  const v=copy(original);
  v[Symbol('host')]='host';
  assert.throws(()=>compileProgramIRV2(v),/error: program IR:/);
});

test('program-v2 rejects hostile prototype in IR',()=>{
  const v=Object.assign(Object.create({ambient:true}),copy(original));
  assert.throws(()=>compileProgramIRV2(v),/error: program IR:.*non-plain/);
});

test('program-v2 rejects accessor-backed expression kind',()=>{
  const v=copy(original);
  let calls=0;
  const body={};
  Object.defineProperty(body,'kind',{enumerable:true,get(){
    calls++;throw Error('unexpected kind getter');
  }});
  v.functions[0].body=body;
  assert.throws(()=>compileProgramIRV2(v),/error: program IR:/);
  assert.equal(calls,0);
});

test('program-v2 source, IR and ESM are byte-deterministic',()=>{
  const esm=compileProgramV2(source);
  const ir=compileToProgramIRV2(source);
  assert.equal(compileProgramIRV2(copy(ir)),esm);
  assert.deepEqual(validateProgramIRV2(copy(ir)),ir);
  assert.equal(compileProgramV2(source),esm);
});

test('program-v2 compiled ESM checks input types and signed bounds',async()=>{
  const m=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(m.main(20n,22n),42n);
  for(const args of [
    [20,22n],[20n,22],[1n<<63n,0n],[-(1n<<63n)-1n,0n]
  ]) assert.throws(()=>m.main(...args),/signed i64 BigInt|ORES_I64_OVERFLOW/);
});

test('program-v2 arithmetic agrees with BigInt on 128 bounded pairs',async()=>{
  const m=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  for(let i=0;i<128;i++){
    const a=BigInt(i*101-7000),b=BigInt(3000-i*17);
    assert.equal(m.main(a,b),a+b);
  }
});

test('program-v2 traps overflow rather than wrapping',async()=>{
  const s='pub fnc main(int a,int b):int{return a+b;}';
  const m=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(s)));
  assert.throws(()=>m.main(9223372036854775807n,1n),/ORES_I64_OVERFLOW/);
  assert.throws(()=>m.main(-9223372036854775808n,-1n),/ORES_I64_OVERFLOW/);
});
