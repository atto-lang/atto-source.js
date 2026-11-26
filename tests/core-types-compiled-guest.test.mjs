// True generated-JavaScript guest test: compile unchanged backend-owned
// core/types.atto with the production program-v2 parser/codegen and execute
// the ESM exports. This is not JVM, Wasm, NativeAOT or actor runtime evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileToProgramIRV2,compileProgramV2} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const source = await readFile(new URL('../core/types.atto',import.meta.url),'utf8');
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const ranges={
  fits_i8:[-128n,127n],fits_i16:[-32768n,32767n],
  fits_i32:[-2147483648n,2147483647n],fits_i64:[MIN,MAX],
  fits_u8:[0n,255n],fits_u16:[0n,65535n],
  fits_u32:[0n,4294967295n],fits_u64:[0n,MAX]
};
const exportNames=[
 'int_value_bits','bool_value_bits','byte_value_bits','int_min_value','int_max_value',
 ...Object.keys(ranges)
];
async function guest(src) {
  const esm=compileProgramV2(src);
  assert.doesNotMatch(esm,/\b(?:fetch|eval|require|process|Worker|document)\b/,
    'compiled freestanding library may not access host capabilities');
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
}
test('the exact .atto library compiles into executable ESM with one source namespace',async()=>{
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.sourceNamespace,'types');
  assert.deepEqual(ir.modules,[]);
  assert.equal(ir.functions.length,13);
  const mod=await guest(source);
  assert.deepEqual(Object.keys(mod).sort(),exportNames.sort());
  assert.equal(mod.int_value_bits(),64n);
  assert.equal(mod.bool_value_bits(),1n);
  assert.equal(mod.byte_value_bits(),8n);
  assert.equal(mod.int_min_value(),MIN);
  assert.equal(mod.int_max_value(),MAX);
});
test('every compiled predicate handles signed-i64 boundaries, no JS Number rounding',async()=>{
  const mod=await guest(source);
  const samples=[
    MIN,MIN+1n,-9007199254740993n,-4294967296n,-2147483649n,
    -32769n,-129n,-128n,-1n,0n,1n,127n,128n,255n,256n,
    32767n,32768n,65535n,65536n,2147483647n,2147483648n,
    4294967295n,4294967296n,9007199254740993n,MAX-1n,MAX
  ];
  let checks=0;
  for(const [name,[lo,hi]] of Object.entries(ranges)) {
    for(const x of new Set([...samples,lo,hi,lo>MIN?lo-1n:lo,hi<MAX?hi+1n:hi])) {
      assert.equal(mod[name](x),x>=lo && x<=hi,name+'('+x+')');
      checks++;
    }
  }
  assert.ok(checks>=208);
});
test('the generated executable rejects invalid host-number and i64 inputs',async()=>{
  const mod=await guest(source);
  for(const arg of [1,0.1,NaN,Infinity,'1',null,undefined,MIN-1n,MAX+1n]) {
    assert.throws(()=>mod.fits_i8(arg),/(?:BigInt|i64|OVERFLOW|RangeError|integer|required)/i);
  }
});
test('namespace placement, duplicate namespace and malformed boolean operators fail closed',()=>{
  const examples=[
    source.replace('use namespace types;','use namespace wrong; use namespace types;'),
    source.replace('use namespace types;','pub fnc before() -> int { return 1; } use namespace types;'),
    source.replace('use namespace types;','import * as types from "../types.atto"; use namespace types;'),
    source.replace('value >= -128 && value <= 127','value >= -128 & value <= 127'),
    source.replace('value >= -128 && value <= 127','value >= -128 | value <= 127')
  ];
  for(const bad of examples)assert.throws(()=>compileProgramV2(bad),/error:/);
});

test('shared Boolean call composition executes generated ESM',async()=>{
  const fixture=await readFile(new URL('./fixtures/core-types-v1/bool-call-composition-positive.atto',import.meta.url),'utf8');
  const mod=await guest(fixture);
  assert.equal(typeof mod.main,'function');
  assert.equal(mod.main(),0n,'shared Boolean call composition guest failed');
});

test('Boolean helper equality is strict, typed and evaluated through generated ESM',async()=>{
  const mod=await guest('fnc leaf(int x) -> bool { return x eq 0; } pub fnc main() -> int { return (leaf(0) eq true) && (leaf(1) neq true) && (leaf(0) neq leaf(1)) ? 42 : 7; }');
  assert.equal(mod.main(),42n);
  for(const comparison of ['leaf(0) eq 1','0 neq leaf(1)','leaf(0) < false']){
    const bad='fnc leaf(int x) -> bool { return x eq 0; } pub fnc main() -> int { return ('+comparison+') ? 42 : 7; }';
    assert.throws(()=>compileProgramV2(bad),/Boolean comparison requires bool/);
  }
});
test('the helper actually overflows when selected, rather than silently wrapping',async()=>{
  const mod=await guest('fnc risky(int x) -> bool { return 9223372036854775807+x eq 0; } pub fnc main() -> int { return risky(1) ? 1 : 0; }');
  assert.throws(()=>mod.main(),/ORES_I64_OVERFLOW/);
});

test('untrusted IR cannot bypass Boolean operand or result typing',()=>{
  const ir=compileToProgramIRV2('fnc leaf(int x) -> bool { return x eq 0; } fnc middle(int x) -> bool { return leaf(x) eq false; } pub fnc main() -> int { return middle(0) ? 1 : 0; }');
  const middle=ir.functions.findIndex(fn=>fn.name==='middle');
  assert.ok(middle>=0);
  assert.equal(ir.functions[middle].body.kind,'boolCompare');
  for(const [mutate,diagnostic] of [
    [fn=>{fn.body.right={kind:'int',value:'1'};},/boolean expression required/],
    [fn=>{fn.body.op='<';},/unsupported Boolean comparison/],
    [fn=>{delete fn.paramTypes;delete fn.returnType;},/boolean value cannot be used as non-bool/]
  ]){
    const forged=JSON.parse(JSON.stringify(ir));
    mutate(forged.functions[middle]);
    assert.throws(()=>validateProgramIRV2(forged),diagnostic);
  }
});
