import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR, compileIR} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';
import {validateScalarIR, stringifyScalarIR} from '../src/scalar-ir.mjs';

// All cases execute the real JavaScript compiler/IR admission path under Node.
// They do not establish Java/Graal, LLVM, Cranelift, Wasm, or .NET guest parity.
const source='pub fnc main(int a,int b): int {return a+b;}';
const good=compileToIR(source);
const copy=v=>JSON.parse(JSON.stringify(v));
const replaceFn=(fn)=>({...copy(good),functions:[fn]});
const replaceBody=(body)=>replaceFn({...copy(good.functions[0]),body});
const int=(value)=>({kind:'int',value});
const arg=(index)=>({kind:'param',index});
const sum=(left,right)=>({kind:'binary',op:'+',left,right});

const badInputs=[
  ['version downgrade',()=>({...copy(good),schemaVersion:0})],
  ['version upgrade',()=>({...copy(good),schemaVersion:3})],
  ['wrong dialect',()=>({...copy(good),dialect:'oreslang.program'})],
  ['wrong signed integer model',()=>({...copy(good),integerModel:'signed-i64-checked-provisional'})],
  ['missing module field',()=>{const v=copy(good);delete v.dialect;return v;}],
  ['unexpected module field',()=>({...copy(good),script:'process.exit(1)'})],
  ['empty functions',()=>({...copy(good),functions:[]})],
  ['object functions',()=>({...copy(good),functions:{0:copy(good.functions[0])}})],
  ['sparse functions',()=>({...copy(good),functions:new Array(1)})],
  ['null function',()=>({...copy(good),functions:[null]})],
  ['extra function property',()=>replaceFn({...copy(good.functions[0]),eval:'evil'})],
  ['missing function body',()=>{const f=copy(good.functions[0]);delete f.body;return replaceFn(f);}],
  ['non-boolean visibility',()=>replaceFn({...copy(good.functions[0]),pub:1})],
  ['void return type',()=>replaceFn({...copy(good.functions[0]),resultType:'void'})],
  ['punctuation in function name',()=>replaceFn({...copy(good.functions[0]),name:'main;evil'})],
  ['oversized function name',()=>replaceFn({...copy(good.functions[0]),name:'a'.repeat(129)})],
  ['duplicate parameter',()=>replaceFn({...copy(good.functions[0]),params:['a','a']})],
  ['invalid parameter name',()=>replaceFn({...copy(good.functions[0]),params:['a','a.b']})],
  ['parameters object',()=>replaceFn({...copy(good.functions[0]),params:{length:2}})],
  ['too many parameters',()=>replaceFn({...copy(good.functions[0]),params:Array.from({length:129},(_,i)=>'p'+i)})],
  ['null expression',()=>replaceBody(null)],
  ['string expression',()=>replaceBody('process.exit(1)')],
  ['unknown expression kind',()=>replaceBody({kind:'eval',source:'process.exit(1)'})],
  ['negative zero literal',()=>replaceBody(int('-0'))],
  ['leading zero literal',()=>replaceBody(int('01'))],
  ['hexadecimal literal',()=>replaceBody(int('0x10'))],
  ['BigInt suffix in IR',()=>replaceBody(int('1n'))],
  ['non-string literal',()=>replaceBody(int(1))],
  ['max+1 literal',()=>replaceBody(int('9223372036854775808'))],
  ['min-1 literal',()=>replaceBody(int('-9223372036854775809'))],
  ['invalid parameter index',()=>replaceBody(arg(2))],
  ['negative zero parameter index',()=>replaceBody(arg(-0))],
  ['negative parameter index',()=>replaceBody(arg(-1))],
  ['invalid function target',()=>replaceBody({kind:'call',target:9,args:[]})],
  ['call arity mismatch',()=>replaceBody({kind:'call',target:0,args:[]})],
  ['division IR opcode',()=>replaceBody({kind:'binary',op:'/',left:arg(0),right:arg(1)})],
  ['host injection as binary operator',()=>replaceBody({kind:'binary',op:';process.exit(1);',left:arg(0),right:arg(1)})],
  ['extra expression property',()=>replaceBody({...sum(arg(0),arg(1)),injectedJs:'process.exit(1)'})],
  ['missing negation operand',()=>replaceBody({kind:'neg'})],
  ['extra negation operand property',()=>replaceBody({kind:'neg',inner:int('1'),eval:'evil'})],
  ['array field on int expression',()=>replaceBody({kind:'int',value:'1',args:[]})]
];

for (const [name,makeInvalid] of badInputs) {
  test('scalar IR fails closed: '+name,()=>{
    assert.throws(()=>compileIR(makeInvalid()),/error: scalar IR:/);
  });
}

test('scalar IR rejects an own Symbol field',()=>{
  const v=copy(good);
  v[Symbol('host')]='ignored?';
  assert.throws(()=>compileIR(v),/error: scalar IR:/);
});

test('scalar IR rejects inherited function metadata',()=>{
  const f=Object.assign(Object.create({ambient:true}),copy(good.functions[0]));
  assert.throws(()=>compileIR(replaceFn(f)),/error: scalar IR:/);
});

test('scalar IR rejects an accessor without executing it',()=>{
  let called=0;
  const v=copy(good);
  Object.defineProperty(v,'functions',{enumerable:true,get(){
    called++;throw Error('getter executed');
  }});
  assert.throws(()=>compileIR(v),/error: scalar IR:.*accessor/);
  assert.equal(called,0);
});

test('scalar IR rejects a sparse arguments array',()=>{
  const body={kind:'call',target:0,args:new Array(2)};
  assert.throws(()=>compileIR(replaceBody(body)),/error: scalar IR:/);
});

test('scalar IR rejects an arguments array with custom properties',()=>{
  const args=[arg(0),arg(1)];
  args.injected='evil';
  const body={kind:'call',target:0,args};
  assert.throws(()=>compileIR(replaceBody(body)),/error: scalar IR:/);
});

test('source to IR to generated ESM is stable and canonical',()=>{
  const code=compile(source);
  assert.equal(code,compileIR(copy(good)));
  assert.deepEqual(validateScalarIR(copy(good)),good);
  assert.equal(stringifyScalarIR(copy(good)),JSON.stringify(good));
  assert.doesNotMatch(code,/process\.exit|eval\(/);
});

test('independent ESM executions use strict BigInt parameters',async()=>{
  const ns=await import('data:text/javascript,'+encodeURIComponent(compile(source)));
  assert.equal(ns.main(20n,22n),42n);
  assert.throws(()=>ns.main(20,22n),/signed i64 BigInt/);
  assert.throws(()=>ns.main(20n,22),/signed i64 BigInt/);
  assert.throws(()=>ns.main(1n<<63n,0n),/signed i64 BigInt/);
});

test('checked i64 overflow cannot be mistaken for legacy wrapping',async()=>{
  const s='// oreslang:checked-i64-v1\npub fnc main(): int {return 9223372036854775807+1;}';
  assert.throws(()=>compile(s),/checked-i64 source requires program-v2/);
  const mod=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(s)));
  assert.throws(()=>mod.main(),/ORES_I64_OVERFLOW/);
  const legacy=await import('data:text/javascript,'+encodeURIComponent(
    compile('pub fnc main(): int {return 9223372036854775807+1;}')));
  assert.equal(legacy.main(),-(1n<<63n));
});
