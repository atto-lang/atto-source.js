import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  compileToProgramIRV2, compileProgramIRV2, compileProgramV2,
  compileAttoScalarV1, checkAttoScalarV1
} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

// Exact source bytes and Git blob SHA-1 from Java
// contracts/atto-scalar-v1/cases.json at c39100b400c4dc1475dd25f5946b136b7032d5f6.
// The canonical-add source also exists byte-for-byte in LLVM
// contracts/atto-parity-v1/add.atto at 15bdd5cc48cf64387aee7e19f2926c253eb10e08.
// These tests EXECUTE the transpiled JS guest on Node. They do NOT execute
// Java/GraalVM or LLVM guests and cannot certify backend-wide parity.
const fixtures=[
  {id:'canonical-add',sha:'015f8b0f79aafa796a148d2adeff1574e8d6c491',
    source:'pub fnc main(): int { return 40 + 2; }\n',value:'42'},
  {id:'precedence',sha:'50414e5e95c8007f066696f55aa75309555b83e2',
    source:'pub fnc main(): int { return 2 + 3 * 4; }\n',value:'14'},
  {id:'parentheses',sha:'9f508169c741486d5cec7510ac84fb761f342def',
    source:'pub fnc main(): int { return (2 + 3) * 4; }\n',value:'20'},
  {id:'signed-minimum',sha:'450ebee951733d3f0b567413e70724155d26ce13',
    source:'pub fnc main(): int { return -9223372036854775808; }\n',
    value:'-9223372036854775808'},
  {id:'signed-max-minus-one',sha:'c400f440fde2fbc10514ab7cfd2ffe3d19729ee1',
    source:'pub fnc main(): int { return 9223372036854775807 - 1; }\n',
    value:'9223372036854775806'},
  {id:'pure-call',sha:'e5ab32f7d8f684d655a83a3df989f16c52090c05',
    source:'pub fnc inc(x: int): int { return x + 1; }\npub fnc main(): int { return inc(41); }\n',
    value:'42'},
  {id:'type-first-parameter',sha:'3d6c16ed04aa86f954461885ec77c8f10b47fb5c',
    source:'pub fnc inc(int x): int { return x + 1; }\npub fnc main(): int { return inc(41); }\n',
    value:'42'},
  {id:'checked-add-overflow',sha:'eed3113842125b1d2a295a11e3cc01a5c1e3da00',
    source:'pub fnc main(): int { return 9223372036854775807 + 1; }\n',trap:'ORES_I64_OVERFLOW'},
  {id:'checked-sub-overflow',sha:'3f80e2eff35147984b040eb0a0215b439d20d09b',
    source:'pub fnc main(): int { return -9223372036854775808 - 1; }\n',trap:'ORES_I64_OVERFLOW'},
  {id:'checked-mul-overflow',sha:'e608942c7e84fddb6ad7ca119a4a11d88aa9434b',
    source:'pub fnc main(): int { return 3037000500 * 3037000500; }\n',trap:'ORES_I64_OVERFLOW'}
];

for(const fixture of fixtures){
  test('canonical Java source -> validated JS IR -> executed ESM: '+fixture.id,async()=>{
    const bytes=Buffer.from(fixture.source,'utf8');
    const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert.equal(blob,fixture.sha,'upstream source must match the pinned Git blob');
    const ir=compileToProgramIRV2(fixture.source);
    assert.equal(ir.integerModel,'signed-i64-checked-provisional');
    const canonical=JSON.parse(JSON.stringify(ir));
    assert.deepEqual(validateProgramIRV2(canonical),ir);
    const esm=compileProgramIRV2(canonical);
    assert.equal(esm,compileProgramV2(fixture.source));
    assert.equal(esm,compileAttoScalarV1(fixture.source));
    assert.equal(checkAttoScalarV1(fixture.source),true);
    const ns=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
    if(fixture.value!==undefined)assert.equal(ns.main(),BigInt(fixture.value));
    else assert.throws(()=>ns.main(),new RegExp(fixture.trap));
    if(fixture.id==='pure-call'||fixture.id==='type-first-parameter'){
      assert.equal(ns.inc(41n),42n);
      assert.throws(()=>ns.inc(41),/BigInt/);
    }
  });
}

test('mixed declaration spellings preserve formal order, named ABI binding and typed checks',async()=>{
  const source=[
    'pub fnc choose(enabled: bool,int yes,no: int):int{return enabled ? yes : no;}',
    'pub fnc run():int{return choose(no:9,yes:42,enabled:true);}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.deepEqual(ir.functions[0].params,['enabled','yes','no']);
  assert.deepEqual(ir.functions[0].paramTypes,['bool','int','int']);
  assert.deepEqual(ir.functions[1].body.paramOrder,[2,1,0]);
  const ns=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(ns.choose(true,42n,9n),42n);
  assert.equal(ns.choose(false,42n,9n),9n);
  assert.equal(ns.run(),42n);
  assert.throws(()=>ns.choose(1n,42n,9n),/bool required/);
  assert.throws(()=>ns.choose(true,42,9n),/BigInt/);
});

test('fieldless method name-first parameter lowers to typed executable ESM',async()=>{
  const source=[
    'pub define class Gate as',
    ' pub pick(self,enabled:bool,int yes,no:int):int{return enabled ? yes : no;}',
    'end',
    'pub fnc main():int{return new Gate().pick(no:7,enabled:true,yes:42);}'
  ].join('\n');
  const ir=compileToProgramIRV2(source);
  assert.deepEqual(ir.classes[0].methods[0].params,['enabled','yes','no']);
  assert.deepEqual(ir.classes[0].methods[0].paramTypes,['bool','int','int']);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(source));
  const ns=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(ns.main(),42n);
  assert.equal(new ns.Gate().pick(false,42n,7n),7n);
});

test('name-first synchronous generator parameter produces typed, executable iterator',async()=>{
  const source='pub gen* values(seed: int): Iterator<int> {yield seed;yield seed+1;return;}';
  const ir=compileToProgramIRV2(source);
  assert.equal(ir.generators.length,1);
  assert.deepEqual(ir.generators[0].params,['seed']);
  assert.deepEqual(ir.generators[0].paramTypes,['int']);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),compileProgramV2(source));
  const ns=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  const cursor=ns.values(41n);
  assert.deepEqual(cursor.next(),{value:41n,done:false});
  assert.deepEqual(cursor.next(),{value:42n,done:false});
  assert.deepEqual(cursor.next(),{value:undefined,done:true});
  assert.throws(()=>ns.values(41).next(),/BigInt required/);
});

test('name-first declarations fail closed on ambiguous types, duplicate bindings and malformed labels',()=>{
  for(const source of [
    'pub fnc bad(x: float):int{return 42;}',
    'pub fnc bad(x: int,int x):int{return x;}',
    'pub fnc bad(x: int,x: bool):int{return 42;}',
    'pub fnc bad(x:):int{return 42;}',
    'pub fnc bad(int: int):int{return 42;}',
    'pub fnc bad(x int):int{return 42;}',
    'pub fnc bad(x: int,):int{return 42;}'
  ]) assert.throws(()=>compileProgramV2(source),/error: program v2:|error: program IR:/,source);
});

test('unsupported canonical Java .atto cases remain explicit gaps, not false parity passes',()=>{
  // Java canonical scalar v1 has three immutable-local positive fixtures.
  // Program-v2 still lacks source local-declaration lowering; the standalone
  // lexical-const IR prototype does not make these programs executable.
  for(const source of [
    'pub fnc main(): int { int x = 7; return x * 6; }\n',
    'pub fnc main(): int { const int x = 7; return x * 6; }\n',
    'pub fnc main(): int { const x = 7; return x * 6; }\n'
  ]) assert.throws(()=>compileProgramV2(source),/error: program v2:/);
});

test('AttoLang scalar profile rejects removed operators instead of emitting wrong semantics',()=>{
  // Java strict #72 supersedes the old removed-XOR fixture. Raw percent
  // and infix single caret remain invalid.
  const removed=[
    ['9 % 2','45d5794870e93074d9b11b90833a849e96aaa4c1','pub fnc main(): int { return 9 % 2; }\n'],
    ['2 ^ 3','6889c7e83c8d94b906fbfe78723caee9580da6aa','pub fnc main(): int { return 2 ^ 3; }\n']
  ];
  for(const [description,sha,source] of removed){
    const raw=Buffer.from(source,'utf8');
    const blob=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
    assert.equal(blob,sha,'exact canonical source for '+description);
    assert.throws(()=>compileAttoScalarV1(source),/error: program v2:|error: program IR:/,description);
  }
  // program-v2 no longer admits % either; the named form compiles to the checked helper.
  assert.throws(()=>compileProgramV2('pub fnc main():int{return 9%2;}'),/'%' is reserved/);
  assert.match(compileProgramV2('pub fnc main():int{return Integer.rem(9, 2);}'),/_rem/);
});

test('canonical scalar profile refuses JS-only language constructs rather than certifying parity',()=>{
  for(const source of [
    'pub fnc main():bool{return true;}',
    'pub fnc main():int{return true ? 1 : 2;}',
    'pub fnc main():int{return match 1 over on 1 -> {42;} on _ -> {0;} end;}',
    'define module m as pub fnc f():int{return 42;} end',
    'pub define class Foo as pub mtd f(self):int{return 42;} end'
  ])assert.throws(()=>compileAttoScalarV1(source),/error: program v2:|error: program IR:/,source);
});

test('CLI --atto-scalar-v1 checks exact .atto source and emits executable ESM',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-scalar-js-'));
  try {
    const valid=join(dir,'canonical.atto'),removed=join(dir,'removed.atto');
    const output=join(dir,'canonical.mjs'),failedOutput=join(dir,'removed.mjs');
    const cli=fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url));
    await writeFile(valid,fixtures.find(f=>f.id==='pure-call').source);
    await writeFile(removed,'pub fnc main(): int { return 9 % 2; }\n');
    const run=(...args)=>spawnSync(process.execPath,[cli,'--atto-scalar-v1',...args],{encoding:'utf8'});
    const check=run('--check',valid);
    assert.equal(check.status,0,check.stderr);
    assert.equal(check.stdout,'OK\n');
    const build=run(valid,'--out='+output);
    assert.equal(build.status,0,build.stderr);
    const ns=await import(pathToFileURL(output).href);
    assert.equal(ns.main(),42n);
    const denied=run('--check',removed);
    assert.notEqual(denied.status,0,'removed operator must reject at CLI admission');
    assert.match(denied.stderr,/'%' is reserved/);
    const deniedBuild=run(removed,'--out='+failedOutput);
    assert.notEqual(deniedBuild.status,0);
    await assert.rejects(access(failedOutput),/ENOENT/);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});

// Java strict #72 / shared operator contract: checked scalar source and IR.
test('canonical caret, bitwise and triple shifts execute checked ESM',async()=>{
  for(const [expression,expected] of [["2 ^^ 3","1"],["12 ^^ 10","6"],["-1 ^^ 1","-2"],["1 | 2 ^^ 3 & 2","1"],["12 & 10 | 2 ^^ 6","12"],["1 + 2 ^^ 3","0"],["1 ^^ 2 ^^ 3","0"],["-9223372036854775808 ^^ -1","9223372036854775807"],["8 <<< 2","32"],["-1 >>> 1","9223372036854775807"],["1 <<< 63","-9223372036854775808"],["(1 <<< 63) >>> 63","1"],["1 + 2 <<< 3","24"],["1 <<< 2 + 3","32"],["8 >>> 2 ^^ 1","3"]]){
    for(const form of ['return','^']){
      const source='pub fnc main():int{'+form+' '+expression+';}';
      const ir=compileToProgramIRV2(source);
      const esm=compileProgramV2(source);
      assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),esm);
      assert.equal(compileAttoScalarV1(source),esm);
      const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm));
      assert.equal(guest.main(),BigInt(expected),source);
    }
  }
});
test('invalid operators and constant shifts fail before artifact publication',()=>{
  for(const expression of ["7 ^ 3","7 ^ ^ 3","7 ^^^ 3","true ^^ false","1 ^^ true","1.5 ^^ 2","7 % 3","8 << 2","8 >> 2","1 <<< 64","1 >>> -1","1 < < < 3"]){
    assert.throws(()=>compileProgramV2('pub fnc main():int{return '+expression+';}'),/error: program (v2|IR):/,expression);
  }
});
test('computed invalid shifts do not mask the count',async()=>{
  const source='pub fnc main(int n):int{^ 1 <<< n;}';
  const guest=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(compileProgramV2(source)));
  assert.equal(guest.main(63n),-9223372036854775808n);
  for(const count of [-1n,64n,65n])assert.throws(()=>guest.main(count),/E_GUEST_SHIFT_DISTANCE/);
});
