import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile,compileToIR,compileIR,IncrementalSession} from '../src/compiler.mjs';

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
  ['Pair.of("a",missing).second','unresolved identifier missing'],
  ['Pair.of("a",true).second','unresolved identifier true'],
  ['Entry.of(1,missing).key','unresolved identifier missing'],
  ['Entry.of(missing,1).value','unresolved identifier missing'],
  ['Entry.of(1,true).key','unresolved identifier true'],
  ['Entry.of(1,2).second','E_PRODUCT_PROJECTION_UNSUPPORTED'],
  ['Pair.of("a",9223372036854775808).second','positive int outside signed i64'],
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

test('dynamic Entry projection evaluates both scalar operands in source order',async()=>{
  const source='fnc first(int x): int { return x+1; } fnc second(int x): int { return x*2; } pub fnc main(int n): int { return Entry.of<int,int>(first(n),second(n)).value; }';
  const ir=compileToIR(source);
  assert.deepEqual(ir.functions[2].body,{kind:'entryProjection',field:'value',
    first:{kind:'call',target:0,args:[{kind:'param',index:0}]},
    second:{kind:'call',target:1,args:[{kind:'param',index:0}]}});
  const js=compileIR(JSON.parse(JSON.stringify(ir)));
  assert.equal(js,compile(source));
  assert.ok(js.includes('return ((a,b)=>b)(_f0(_p0),_f1(_p0));'));
  const m=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  assert.equal(m.main(21n),42n);
  const key=compile(source.replace('.value;','.key;'));
  const k=await import('data:text/javascript;base64,'+Buffer.from(key).toString('base64'));
  assert.equal(k.main(41n),42n);
  const cache=new IncrementalSession();
  assert.equal(cache.build(source).code,js);
  assert.equal(cache.build(source).reused,3);
  const edited=source.replace('x*2','x*3');
  const built=cache.build(edited);
  assert.equal(built.code,compile(edited));
  assert.equal(built.emitted,1);
});
test('discarded Entry operands cannot drop runtime traps or unresolved calls',async()=>{
  for(const expr of ['Entry.of(42,Integer.mod(1,0)).key',
    'Entry.of(Integer.mod(1,0),42).value','Entry.of(Integer.mod(1,0),Integer.mod(2,0)).value']){
    const m=await import('data:text/javascript;base64,'+Buffer.from(compile(program(expr))).toString('base64'));
    assert.throws(()=>m.main(),/DIVISION_BY_ZERO/);
  }
  assert.throws(()=>compile('pub fnc main(): int { return Entry.of(42,main()).key; }'),/recursive call cycle/);
});
test('entry projection IR rejects forged fields and validates both operands',()=>{
  const ir=compileToIR(program('Entry.of(20+22,3).key'));
  const body=ir.functions[0].body;
  const replace=expr=>({...ir,functions:[{...ir.functions[0],body:expr}]});
  for(const expr of [{...body,field:'constructor'},{...body,extra:true},
    {...body,second:{kind:'call',target:999,args:[]}},{...body,first:{kind:'eval',source:'x'}}])
    assert.throws(()=>compileIR(replace(expr)),/scalar IR/);
  let accessed=0;
  const forged={...body};
  Object.defineProperty(forged,'second',{enumerable:true,get(){accessed++;return body.second;}});
  assert.throws(()=>compileIR(replace(forged)),/accessor/);
  assert.equal(accessed,0);
});

test('nested Entry projections and distinguishable first faults retain source order',async()=>{
  const load=async expr=>import('data:text/javascript;base64,'+Buffer.from(compile(program(expr))).toString('base64'));
  const nested=await load('Entry.of(Entry.of(20,21).value,Entry.of(21,22).key).key+21');
  assert.equal(nested.main(),42n);
  // scalar-v1 has provisional wrapping arithmetic, so distinguish the native
  // division fault from the explicit remainder diagnostic, not overflow.
  const fault=async expr=>{
    const m=await load(expr);
    let thrown;
    try { m.main(); } catch(error) { thrown=error; }
    assert.ok(thrown instanceof RangeError,expr);
    return thrown.message;
  };
  const a='1/0', b='Integer.mod(1,0)';
  const first=await fault(a), second=await fault(b);
  assert.notEqual(first,second,'fault witnesses must be distinguishable');
  for(const field of ['key','value']){
    assert.equal(await fault('Entry.of('+a+','+b+').'+field),first);
    assert.equal(await fault('Entry.of('+b+','+a+').'+field),second);
  }
});
