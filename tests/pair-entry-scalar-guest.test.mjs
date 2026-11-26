import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile,compileToIR} from '../src/compiler.mjs';

const program=e=>'pub fnc main(): int { return '+e+'; }';
const positives=[
  ['Pair.of("count",42).second',42n],
  ['Pair.of("a",1+2).second',3n],
  ['Pair.of<int>("a",(10+11)*2).second',42n],
  ['Pair.of<int>("count",42).second',42n],
  ['Pair.of<string,int>("count",42).second',42n],
  ['Pair.of("first-name",42).second',42n],
  ['Pair.of("",42).second',42n],
  ['Entry.of(42,5).key',42n],
  ['Entry.of<int,int>(5,42).value',42n],
  ['Pair.of("count",-9223372036854775808).second',-(1n<<63n)],
  ['(Pair.of("count",20).second + Entry.of(1,1).value)*2',42n],
];
for(const [expr,expected] of positives)test('compiled guest '+expr,async()=>{
  const js=compile(program(expr));
  const module=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  assert.equal(module.main(),expected);
});

const negatives=[
  ['Pair.of(42,5).second','E_PAIR_KEY_TYPE'],
  ['Pair.of(true,5).second','E_PAIR_KEY_TYPE'],
  ['Pair.of<int,int>(42,5).second','E_PAIR_KEY_TYPE'],
  ['Pair.of("a",5)','E_PRODUCT_ESCAPE_UNSUPPORTED'],
  ['Pair.of("a",5).first','E_PRODUCT_PROJECTION_UNSUPPORTED'],
  ['Pair.of("a",5).value','E_PRODUCT_PROJECTION_UNSUPPORTED'],
  ['Pair.of("a",missing).second','unknown'],
  ['Pair.of("a",true).second','unknown'],
  ['Entry.of(1,1+2).value','expected )'],
  ['Entry.of(1,2).second','E_PRODUCT_PROJECTION_UNSUPPORTED'],
  ['Pair.of("a",9223372036854775808).second','integer outside signed i64'],
  ['Pair.of("a",5,6).second','expected )'],
  ['Pair.of("a").second','expected ,'],
  ['Pair.of().second','E_PAIR_KEY_TYPE'],
  ['Pair.of(`a`,5).second','E_PAIR_KEY_TYPE'],
];
for(const [expr,diagnostic] of negatives)test('no IR or JS '+expr,()=>{
  for(const fn of [compileToIR,compile])assert.throws(()=>fn(program(expr)),e=>e.message.includes(diagnostic));
});

test('lexical shadowing cannot obtain intrinsic lowering; ordinary names still work',()=>{
  for(const source of [
    'pub fnc main(int Pair): int { return Pair.of("a",5).second; }',
    program('Pair.of("a",5).second')+' fnc Pair(): int { return 1; }',
    'define module Pair as '+program('Pair.of("a",5).second')+' end'
  ])assert.throws(()=>compile(source),/E_PRODUCT_SCOPE_UNSUPPORTED/);
  assert.doesNotThrow(()=>compile('pub fnc main(int Pair): int { return Pair; }'));
  assert.doesNotThrow(()=>compile(program('Pair.of("a",42).second')+' // Pair Entry import'));
});

test('CLI rejects invalid Pair without publishing JS',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-pair-guest-'));
  try{
    const source=join(dir,'invalid.atto'),output=join(dir,'invalid.mjs');
    await writeFile(source,program('Pair.of(42,5).second'));
    const result=spawnSync(process.execPath,[resolve('bin/oreslang-jsc.mjs'),source,'--out='+output],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/E_PAIR_KEY_TYPE/);
    await assert.rejects(readFile(output),{code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Pair second preserves dynamic checked scalar calls and parameters',async()=>{
  const src='fnc twice(int x): int { return x*2; } pub fnc main(int n): int { return Pair.of("key",twice(n)).second; }';
  const js=compile(src);
  const module=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  assert.equal(module.main(21n),42n);
  assert.equal(module.main(-3n),-6n);
});

test('Pair second preserves trapping scalar expression instead of dropping it',async()=>{
  const src=program('Pair.of("key",Integer.mod(1,0)).second');
  const js=compile(src);
  const module=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  assert.throws(()=>module.main(),/DIVISION_BY_ZERO/);
});
