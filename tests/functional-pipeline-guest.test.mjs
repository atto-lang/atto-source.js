import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileFunctionalPipelineSource,FunctionalPipelineSourceError} from '../src/functional-pipelines.mjs';
const fixtures=resolve(fileURLToPath(new URL('fixtures/functional-pipelines-v1/',import.meta.url)));
async function isolated(fn) {
  const dir=await mkdtemp(join(tmpdir(),'atto-js-functional-'));
  try {return await fn(dir);}finally {await rm(dir,{recursive:true,force:true});}
}
const positives=[['block-body.atto',83n],['inline-arrow-body.atto',83n],
  ['reverse-associative.atto',42n],['mixed-parenthesized.atto',42n]];
test('canonical .atto source creates deterministic ESM and executes real compiled guest',()=>isolated(async dir=>{
  for (const [file,expected] of positives) {
    const source=await readFile(join(fixtures,file),'utf8');
    const first=compileFunctionalPipelineSource(source);
    assert.equal(first,compileFunctionalPipelineSource(source));
    const output=join(dir,file+'.mjs');await writeFile(output,first);
    assert.doesNotMatch(first,/\bimport\b|\beval\s*\(|\bFunction\s*\(/);
    assert.equal((await import(pathToFileURL(output).href)).main(),expected);
    // A fresh OS process imports/executes compiled guest source and prints
    // only the returned signed 64-bit Atto int; the adapter does not compute.
    const script='import {pathToFileURL} from "node:url";const m=await import(pathToFileURL(process.argv[1]).href);console.log(m.main().toString());';
    const run=spawnSync(process.execPath,['--input-type=module','-e',script,output],
      {encoding:'utf8',timeout:15000});
    assert.equal(run.status,0,run.stderr);
    assert.equal(run.stderr,'');
    assert.equal(run.stdout,expected.toString()+'\n');
  }
}));
test('all four canonical negative fixtures deny the correct language category',async()=>{
  const cases=[['reject-return-type.atto','E_TYPE'],
    ['reject-unterminated-body.atto','E_PARSE'],
    ['reject-ambiguous-mixed-direction.atto','E_MIXED_PIPE'],
    ['reject-reverse-mixed-unparenthesized.atto','E_MIXED_PIPE']];
  for(const [file,code] of cases){
    const source=await readFile(join(fixtures,file),'utf8');
    assert.throws(()=>compileFunctionalPipelineSource(source),e=>e instanceof FunctionalPipelineSourceError&&e.code===code,file);
  }
});
test('negative source never becomes executable guest or published artifact',()=>isolated(async dir=>{
  const invalid=[
    ['arity','fnc double(int x): int -> x*2; pub fnc main(): int -> 20 |> double(1);','E_ARITY'],
    ['unknown','pub fnc main(): int -> 20 |> unknown;','E_SYMBOL'],
    ['recursive','pub fnc main(): int -> main();','E_CYCLE'],
    ['forward-local','pub fnc main(): int { val a=b; val b=1; return a; }','E_SYMBOL'],
    ['duplicate-local','pub fnc main(): int { val a=1; val a=2; return a; }','E_DUP_LOCAL'],
    ['boolean','pub fnc main(): int -> true;','E_TYPE'],
    ['overflow-literal','pub fnc main(): int -> 9223372036854775808;','E_LITERAL'],
    ['division','pub fnc main(): int -> 8/2;','E_UNSUPPORTED'],
    ['no-callee','pub fnc main(): int -> 21 <| 42;','E_CALLEE'],
    ['interleaved','pub fnc main(): int -> 20 |> sum <| 1;','E_MIXED_PIPE'],
    ['unsafe','pub fnc main(): int -> unsafe { return 1; };','E_NAME'],
    ['bidi','pub fnc main(): int -> 1;\u202e','E_SOURCE'],
    ['foreign','pub fnc main(): int -> import("os");','E_LEX'],
  ];
  for(const [name,source,code] of invalid){
    assert.throws(()=>compileFunctionalPipelineSource(source),e=>e instanceof FunctionalPipelineSourceError&&e.code===code,name);
    const output=join(dir,name+'.mjs');
    await assert.rejects(access(output),{code:'ENOENT'});
  }
}));
test('i64 lower bound compiles exactly and overflow aborts execution',async()=>{
  const minSource='pub fnc main(): int -> -9223372036854775808;';
  const minGuest=compileFunctionalPipelineSource(minSource);
  assert.equal((await import('data:text/javascript,'+encodeURIComponent(minGuest))).main(),-(1n<<63n));
  const overflow='pub fnc main(): int -> 9223372036854775807 + 1;';
  const code=compileFunctionalPipelineSource(overflow);
  const guest=await import('data:text/javascript,'+encodeURIComponent(code));
  assert.throws(()=>guest.main(),{name:'RangeError',message:'E_OVERFLOW'});
});

test('supplemental spec edge suite runs real multi-argument and i64 ESM guests',()=>isolated(async dir=>{
  const edge=join(fixtures,'edge');
  const pins=[
    ['two-argument-61.atto','4089c524db1d076593994ad65acb5ca7f90eea32'],
    ['preapplied-grouped-42.atto','9a89ada18865fead0d92a7de75415957fbb5f67f'],
    ['signed-i64-min.atto','bbc22347d7ccb0a5be1a7c2193f11c5f2f4805cc'],
    ['checked-overflow.atto','59bb890b54addc1659065ab55cd565771523bfce'],
    ['reject-i64-positive-overflow.atto','2e584ee01ee74a3a31e282cf0116957f9ff95bd1'],
    ['reject-i64-negative-underflow.atto','8b63b45e406db3e19aa793e0f7a627914623b9e0'],
    ['reject-reserved-unsafe.atto','b159def3fa26ca6023395e1c546b95c1b929fd14']
  ];
  for(const [name,expected] of pins) {
    const bytes=await readFile(join(edge,name));
    const hash=createHash('sha1')
      .update(Buffer.from('blob '+bytes.length+'\0'))
      .update(bytes).digest('hex');
    assert.equal(hash,expected,name+': shared Atto source differs from spec');
  }
  const positives=[
    ['two-argument-61.atto','61'],
    ['preapplied-grouped-42.atto','42'],
    ['signed-i64-min.atto','-9223372036854775808']
  ];
  const observer='import{pathToFileURL}from"node:url";const guest=await import(pathToFileURL(process.argv[1]).href);console.log(guest.main().toString());';
  for(const [name,expected] of positives) {
    const guest=compileFunctionalPipelineSource(await readFile(join(edge,name),'utf8'));
    const output=join(dir,name+'.mjs');await writeFile(output,guest);
    const observed=spawnSync(process.execPath,
      ['--input-type=module','-e',observer,output],
      {encoding:'utf8',timeout:15000});
    assert.equal(observed.status,0,name+': '+observed.stderr);
    assert.equal(observed.stdout,expected+'\n',name);
    assert.equal(observed.stderr,'',name);
  }
  const overflow=compileFunctionalPipelineSource(
    await readFile(join(edge,'checked-overflow.atto'),'utf8'));
  const overflowGuest=await import('data:text/javascript,'+encodeURIComponent(overflow));
  assert.throws(()=>overflowGuest.main(),{name:'RangeError',message:'E_OVERFLOW'});
  for(const [name,code] of [
    ['reject-i64-positive-overflow.atto','E_LITERAL'],
    ['reject-i64-negative-underflow.atto','E_LITERAL'],
    ['reject-reserved-unsafe.atto','E_NAME']
  ]) {
    const source=await readFile(join(edge,name),'utf8');
    assert.throws(()=>compileFunctionalPipelineSource(source),
      e=>e instanceof FunctionalPipelineSourceError&&e.code===code,name);
    await assert.rejects(access(join(dir,name+'.mjs')),{code:'ENOENT'});
  }
}));


test('task/sync/yield cannot be function, parameter or val names in pure pipeline lowering',()=>{
  for(const name of ['sync','task','yield']) {
    const samples=[
      'fnc '+name+'(int x): int -> x; pub fnc main(): int -> 42 |> '+name+';',
      'fnc f(int '+name+'): int -> 42; pub fnc main(): int -> f(1);',
      'pub fnc main(): int { val '+name+' = 42; return '+name+'; }'
    ];
    for(const source of samples)
      assert.throws(()=>compileFunctionalPipelineSource(source),
        e=>e instanceof FunctionalPipelineSourceError&&e.code==='E_NAME',
        name+': pure guest must reject reserved callable/binding');
  }
});
