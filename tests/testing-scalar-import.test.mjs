import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProgramV2,compileToProgramIRV2} from '../src/program-v2.mjs';
import {TESTING_SCALAR_SOURCE,TESTING_SCALAR_EXPORTS} from '../src/compiler-owned-testing-scalar.mjs';

// No runtime filesystem lookup is made by the browser/compiler itself.
test('browser-safe compiler owned source matches compiler-local .atto exactly',()=>{
  assert.equal(TESTING_SCALAR_SOURCE,
    readFileSync(new URL('../stdlib/testing_scalar.atto', import.meta.url),'utf8'));
  assert.equal(TESTING_SCALAR_EXPORTS.length,6);
  assert.equal(new Set(TESTING_SCALAR_EXPORTS).size,6);
});

const vectors=[
  ['eq','equal_int(42,42)','equal_int',0n],
  ['eq-fail','equal_int(41,42)','equal_int',1n],
  ['ne','not_equal_int(42,41)','not_equal_int',0n],
  ['ne-fail','not_equal_int(42,42)','not_equal_int',1n],
  ['gt','greater_than_int(42,41)','greater_than_int',0n],
  ['gt-equal','greater_than_int(42,42)','greater_than_int',1n],
  ['lt','less_than_int(41,42)','less_than_int',0n],
  ['lt-equal','less_than_int(42,42)','less_than_int',1n],
  ['lower','in_range_int(40,40,42)','in_range_int',0n],
  ['upper','in_range_int(42,40,42)','in_range_int',0n],
  ['outside','in_range_int(43,40,42)','in_range_int',1n],
  ['inverted','in_range_int(41,42,40)','in_range_int',1n],
  ['min','in_range_int(-9223372036854775808,-9223372036854775808,9223372036854775807)','in_range_int',0n],
  ['max','in_range_int(9223372036854775807,-9223372036854775808,9223372036854775807)','in_range_int',0n],
  ['combine-ok','combine_status(0,0)','combine_status',0n],
  ['combine-fail','combine_status(0,1)','combine_status',1n],
];
for(const [id,call,fn,expected] of vectors){
  test('compiler-imported .atto JS guest '+id,async()=>{
    const source='import fnc '+fn+' from "std/testing_scalar";\n'+
      'pub fnc main(): int { return '+call+'; }\n';
    const ir=compileToProgramIRV2(source);
    assert.equal(ir.functions.length,2,'only the requested compiler helper is linked');
    const generated=compileProgramV2(source);
    const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
    assert.equal(guest.main(),expected);
    assert.equal(Object.hasOwn(guest,fn),false,'private imported helper leaked into ESM exports');
  });
}

test('canonical .atto suffix, disambiguation and alias import',async()=>{
  const source='import fnc in_range_int as bounded from "atto.std/testing_scalar.atto";\n'+
    'import fnc equal_int from "std/testing_scalar.atto";\n'+
    'pub fnc main(): int { return bounded(41,40,42) + equal_int(42,42); }\n';
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(guest.main(),0n);
});
test('deny unapproved and traversal import paths',()=>{
  for(const path of [
    'std/testing_scalar.ores','./std/testing_scalar',
    'std/../testing_scalar','std//testing_scalar',
    'std/testing_scalar%2eatto','https://example.org/testing_scalar',
    'ores.std/testing_scalar','std/testing_scalar\\u0000',
  ]){
    const source='import fnc equal_int from "'+path+'"; pub fnc main():int{return equal_int(42,42);}';
    assert.throws(()=>compileProgramV2(source),undefined,path);
  }
});
test('deny forged, duplicated or unimported compiler symbols',()=>{
  for(const source of [
    'import fnc equal_int, equal_int from "std/testing_scalar"; pub fnc main():int{return 0;}',
    'import fnc equal_int as bounded, in_range_int as bounded from "std/testing_scalar"; pub fnc main():int{return 0;}',
    'import fnc equal_int as __atto_fake from "std/testing_scalar"; pub fnc main():int{return 0;}',
    'import fnc surprise from "std/testing_scalar"; pub fnc main():int{return 0;}',
    'import fnc equal_int from "std/testing_scalar"; pub fnc equal_int(int a,int b):int{return 1;} pub fnc main():int{return 0;}',
    'import fnc equal_int from "std/testing_scalar"; import fnc equal_int from "std/testing_scalar"; pub fnc main():int{return 0;}',
    'import fnc equal_int from "std/testing_scalar"; pub fnc main():int{return not_equal_int(42,42);}',
    'pub fnc main():int{return 0;} import fnc equal_int from "std/testing_scalar";',
    'import module M from "std/testing_scalar"; pub fnc main():int{return 0;}',
  ])assert.throws(()=>compileProgramV2(source),undefined,source);
});
