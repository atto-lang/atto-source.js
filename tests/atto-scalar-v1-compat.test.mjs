import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compileProgramV2} from '../src/program-v2.mjs';
import {PROGRAM_IR_INT_MODEL} from '../src/program-ir-v2.mjs';
import {
  AttoScalarCompileError,compileToAttoScalarIRV1,
  compileAttoScalarV1,checkAttoScalarV1
} from '../src/atto-scalar-v1.mjs';

// These are authored JS guest parity candidates using the seven identical
// Java/LLVM/JS portable-i64 v1 expressions (git blob
// bbc319c19ecd007109d33592e210091eb267e5a2). They are NOT attestations
// of current Java/GraalVM or LLVM compiler + guest execution.
const PORTABLE = [
  ['precedence','2+3*4','14'],
  ['grouping','(2+3)*4','20'],
  ['signed-multiplication','(8-3)*5+2','27'],
  ['subtraction','100-(3+2)-19','76'],
  ['negative-result','3*4-2*5-7','-5'],
  ['max-minus-one','9223372036854775807-1','9223372036854775806'],
  ['signed-minimum','-9223372036854775808','-9223372036854775808']
];
const guestSource = expression =>
  'pub fnc main(): int { return ' + expression + '; }\n';
const load = source => import('data:text/javascript;charset=utf-8,' +
  encodeURIComponent(compileAttoScalarV1(source)));

test('Atto scalar: seven common Java/LLVM expressions produce executable BigInt ESM',async t=>{
  for (const [id,expr,expected] of PORTABLE) {
    await t.test(id,async()=>{
      const source=guestSource(expr);
      assert.equal(checkAttoScalarV1(source),true);
      const ir=compileToAttoScalarIRV1(source);
      assert.equal(ir.integerModel,PROGRAM_IR_INT_MODEL);
      assert.equal(compileAttoScalarV1(source),compileProgramV2(source),
        'valid portable source keeps deterministic program-v2 lowering');
      const module=await load(source);
      assert.equal(module.main(),BigInt(expected));
    });
  }
});

test('Atto scalar: pure calls and type-first parameters preserve exact result',async()=>{
  const source=[
    'fnc add(int a,int b):int{return a+b;}',
    'pub fnc main():int{return add(40,2);}'
  ].join('\n');
  assert.equal((await load(source)).main(),42n);
  const typed='pub fnc identity(int number):int{return number;}';
  const m=await load(typed);
  assert.equal(m.identity(42n),42n);
  assert.throws(()=>m.identity(42),/BigInt/);
});

test('Atto scalar: removed operators reject before any codegen; legacy Oreslang retains %',async()=>{
  const cases=[['%', '7 % 3'],['^','7 ^ 3'],['^^','7 ^^ 3']];
  for(const [operator,expression] of cases) {
    const source=guestSource(expression);
    assert.throws(()=>compileAttoScalarV1(source),error=>
      error instanceof AttoScalarCompileError &&
      error.code==='ATTO_SCALAR_REMOVED_OPERATOR' &&
      error.message.includes(operator));
  }
  const legacy=await import('data:text/javascript,'+
    encodeURIComponent(compileProgramV2(guestSource('7 % 3'))));
  assert.equal(legacy.main(),1n,'existing Oreslang program-v2 ABI remains unchanged');
});

test('Atto scalar: comment operators are not rejected as executable source',async()=>{
  const source=[
    '// deprecated % ^ ^^ are not tokens here',
    '/* outer % /* nested ^^ */ trailing ^ */',
    guestSource('40 + 2')
  ].join('\n');
  assert.equal((await load(source)).main(),42n);
});

test('Atto scalar: overflow is a runtime checked-i64 guest error, never wrap',async t=>{
  const rows=[
    ['add','9223372036854775807+1'],
    ['sub','-9223372036854775808-1'],
    ['mul','3037000500*3037000500']
  ];
  for(const [name,expr] of rows)await t.test(name,async()=>{
    const m=await load(guestSource(expr));
    assert.throws(()=>m.main(),error=>
      error instanceof RangeError &&
      error.message.startsWith('ORES_I64_OVERFLOW:'));
  });
});

test('Atto scalar: unimplemented declaration and actor lowering refuse source',()=>{
  // In particular, rejecting these is NOT a verified immutable-binding,
  // eager-evaluation, or actor-execution implementation.
  for(const source of [
    'pub fnc main():int{const int x=42;return x;}',
    'pub fnc main():int{int x=42;return x;}',
    'define actor Worker as end'
  ]) assert.throws(()=>compileAttoScalarV1(source),/error: program v2:/);
  assert.throws(()=>compileAttoScalarV1(null),/bounded string/);
});

test('Atto scalar CLI: explicit mode compiles .atto, checks, and refuses removed operators',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-js-scalar-'));
  try {
    const cli=resolve('bin/oreslang-jsc.mjs');
    const input=join(dir,'positive.atto'),output=join(dir,'positive.mjs');
    const bad=join(dir,'removed.atto'),badOutput=join(dir,'rejected.mjs');
    await writeFile(input,guestSource('40+2'),'utf8');
    await writeFile(bad,guestSource('7%3'),'utf8');
    const run=(...args)=>spawnSync(process.execPath,[cli,'--atto-scalar-v1',...args],{encoding:'utf8'});
    const check=run('--check',input);
    assert.equal(check.status,0,check.stderr);
    assert.equal(check.stdout,'OK\n');
    const build=run(input,'--out='+output);
    assert.equal(build.status,0,build.stderr);
    const generated=await readFile(output,'utf8');
    assert.equal(generated,compileAttoScalarV1(guestSource('40+2')));
    const module=await import(pathToFileURL(output).href);
    assert.equal(module.main(),42n);
    const rejected=run(bad,'--out='+badOutput);
    assert.notEqual(rejected.status,0);
    assert.match(rejected.stderr,/ATTO_SCALAR_REMOVED_OPERATOR/);
    await assert.rejects(stat(badOutput),{code:'ENOENT'});
  } finally {await rm(dir,{recursive:true,force:true});}
});
