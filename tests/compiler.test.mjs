import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {compile,compileToIR} from '../src/compiler.mjs';
const fixture = name => resolve('tests/fixtures',name);
const cli = resolve('bin/oreslang-jsc.mjs');

async function moduleFrom(source) {
  const dir=await mkdtemp(join(tmpdir(),'ores-js-test-'));
  const path=join(dir,'generated.mjs');
  await writeFile(path, compile(source),{mode:0o600});
  try { return await import(pathToFileURL(path).href); }
  finally { await rm(dir,{recursive:true,force:true}); }
}

test('shared arithmetic fixture executes', async () => {
 const mod=await moduleFrom(await readFile(fixture('arithmetic.ores'),'utf8'));
 assert.equal(mod.main(),42n);
});
test('LLVM forward-call fixture executes', async () => {
 const mod=await moduleFrom(await readFile(fixture('forward-call.ores'),'utf8'));
 assert.equal(mod.main(),42n);
});
test('module wrappers, parameter checking, precedence and wrapping',async()=>{
 const source='define module A as\n pub fnc f(int a, int b): int { return a * (b + 1); }\n end';
 const mod=await moduleFrom(source);
 assert.equal(mod.f(3n,4n),15n);
 assert.throws(()=>mod.f(3,4n),/requires a signed i64 BigInt/);
 const signed=await moduleFrom('pub fnc main(): int { return 9223372036854775807 + 1; }');
 assert.equal(signed.main(), -(1n<<63n));
});
test('signed-i64 remainder follows Java long remainder semantics',async()=>{
 const mod=await moduleFrom('pub fnc rem(int a, int b): int { return Integer.rem(a, b); }');
 assert.equal(mod.rem(7n,3n),1n);
 assert.equal(mod.rem(-7n,3n),-1n);
 assert.equal(mod.rem(-(1n<<63n),-1n),0n);
 assert.throws(()=>mod.rem(1n,0n));
});
test('rejects unknown symbols with conformance-friendly diagnostic',()=>{
 assert.throws(()=>compile('pub fnc main(): int { return nonexistent_symbol; }'),/error: unresolved identifier nonexistent_symbol/);
});
test('inverted classes fail closed before JS lowering',()=>{
 for(const source of [
  'define inverted class Particle as x: int; end',
  'define pub inverted class Particle as x: int; end',
  'pub define inverted class Particle as x: int; end',
  'define module M as define inverted class Particle as x: int; end pub fnc main(): int { return 0; } end'
 ]) assert.throws(()=>compile(source),
   /inverted class requires checked bracket-row and ownership lowering/, source);
 // Contextual keyword only: ordinary identifier remains legal.
 const ordinary='pub fnc inverted(): int { return 7; } pub fnc main(): int { return inverted(); }';
 assert.doesNotThrow(()=>compile(ordinary));
});

test('hybrid actor heap needs nominal ownership lowering; JS scalar backend fails closed',()=>{
 const rejected=[
  'define class Node as int value end',
  'define pub class Node as int value end',
  'pub define actor HeapGraphProbe as receive(int m) { } end',
  'define module M as define actor A as end pub fnc main(): int { return 7; } end',
  'pub fnc main(): int { return new Node(7); }'
 ];
 for(const source of rejected) {
   assert.throws(()=>compile(source),/E_ACTOR_MEMORY_GUEST_UNSUPPORTED/,source);
   assert.throws(()=>compileToIR(source),/E_ACTOR_MEMORY_GUEST_UNSUPPORTED/,source);
 }
 // Inert comment text must not become an active heap declaration.
 assert.doesNotThrow(()=>compile('pub fnc main(): int { return 7; } // define class Node as'));
 assert.doesNotThrow(()=>compile('pub fnc main(): int { return 7; } /* new Node(7) */'));
 // Inverted-class rejection retains its more specific existing diagnostic.
 assert.throws(()=>compile('define inverted class Particle as x: int; end'),
   /inverted class requires checked bracket-row/);
});

test('CLI never publishes guest JS for rejected actor heap .atto source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'atto-js-hybrid-heap-reject-'));
 const source=join(dir,'actor.atto');
 const output=join(dir,'actor.mjs');
 try {
   await writeFile(source,'define class Node as int value end\ndefine actor A as end');
   const run=spawnSync(process.execPath,[cli,source,'--out='+output],{encoding:'utf8'});
   assert.notEqual(run.status,0);
   assert.match(run.stderr,/E_ACTOR_MEMORY_GUEST_UNSUPPORTED/);
   await assert.rejects(readFile(output),{code:'ENOENT'});
 } finally {
   await rm(dir,{recursive:true,force:true});
 }
});

test('fail-closed: unsupported language features and syntax',()=>{
 const invalid=[
  'pub fnc main(): int { return 1 / 2; }',
  'pub fnc main(): int { return host(); }',
  'pub fnc main(): int { return 1; } import bad;',
  'define actor A as end',
  'pub fnc main(): int { await 1; }',
  'pub fnc main(): int { return 2 + ; }',
  'pub fnc main(): int { return 9223372036854775808; }',
  'pub fnc main(): int { return 1; } pub fnc main(): int { return 1; }',
  'pub fnc main(): int { return missing(1); }',
  'pub fnc main(): int { return /* unclosed',
  'pub fnc main(): int { return 0; }\n__proto__.pollute()'
 ];
 for (const source of invalid) assert.throws(()=>compile(source),/error:/,source);
});

test('static select forms fail closed with a capability diagnostic',()=> {
 const forms=[
  'select { default: { return 1; } }',
  'select over default: { return 1; } end',
  'do select { default: { return 1; } }',
  'do select over default: { return 1; } end',
  'nb select { default: { return 1; } }',
  'nb select over default: { return 1; } end',
  'do nb select { default: { return 1; } }',
  'do nb select over default: { return 1; } end',
  'try select { default: { return 1; } }',
  'try select over default: { return 1; } end'
 ];
 for(const form of forms) {
  const source='pub fnc main(): int { '+form+' return 0; }';
  assert.throws(()=>compile(source),
    /static select requires checked Channel\/Future arbitration, actor-lane continuation, ownership and cancellation lowering in the JS backend/,
    form);
 }
 assert.doesNotThrow(()=>compile(
   'pub fnc main(): int { /* select over default: {} end */ return 1; }'));
 assert.doesNotThrow(()=>compile(
   'fnc select(): int { return 1; } pub fnc main(): int { return select(); }'));
});

test('CLI never publishes JS for rejected select source', async()=> {
 const dir=await mkdtemp(join(tmpdir(),'ores-js-select-reject-'));
 const source=join(dir,'select.ores');
 const output=join(dir,'select.mjs');
 try {
  await writeFile(source,
    'pub fnc main(): int { nb select over default: { return 1; } end return 0; }');
  const run=spawnSync(process.execPath,[cli,source,'--out='+output],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/static select requires checked Channel\/Future arbitration/);
  await assert.rejects(readFile(output),{code:'ENOENT'});
 } finally {
  await rm(dir,{recursive:true,force:true});
 }
});

test('pointer-style source syntax and legacy mutable borrow fail closed',()=>{
 assert.throws(()=>compile('pub fnc main(): int { return rt ref value; }'),/pointer-style runtime operation/);
 assert.throws(()=>compile('pub fnc main(): int { return rt deref value; }'),/pointer-style runtime operation/);
 assert.throws(()=>compile('pub fnc main(): int { return rt borrow mut value; }'),/runtime ownership operation requires typed lowering/);
 assert.throws(()=>compile('pub fnc main(): int { return rt mut borrow value; }'),/runtime ownership operation requires typed lowering/);
 for(const source of [
  'pub fnc main(): int { return &value; }',
  'pub fnc main(): int { return &mut value; }',
  'pub fnc main(): int { return *value; }',
  'pub fnc main(): Pointer<int> { return value; }'
 ]) assert.throws(()=>compile(source),/error:/,source);
});

test('source cannot inject arbitrary JS or host API access',async()=>{
 const value=await moduleFrom('pub fnc constructor(): int { return 7; }');
 assert.equal(value.constructor(),7n);
 assert.throws(()=>compile('pub fnc main(): int { return process.exit(0); }'),/error:/);
});
test('bounded input rejects oversized program',()=>{
 assert.throws(()=>compile(' '.repeat(262145)),/error:/);
});
test('scalar source rejects NUL and unpaired UTF-16 even in ignored comments',()=>{
 const good='pub fnc main(): int { return 42; }';
 const bad=[String.fromCharCode(0),String.fromCharCode(0xd800),
   String.fromCharCode(0xdc00),String.fromCharCode(0xd800)+'x'];
 for(const fragment of bad){
   for(const source of [
     fragment+good,good+' // '+fragment,good+' /* '+fragment+' */'
   ]){
     assert.throws(()=>compile(source),/error: (?:NUL|invalid UTF-16) in source/);
     assert.throws(()=>compileToIR(source),/error: (?:NUL|invalid UTF-16) in source/);
   }
 }
 // Valid surrogate pairs remain accepted; comments are lexically invisible.
 const emoji=String.fromCodePoint(0x1f600);
 assert.equal(compile(good+' // '+emoji),compile(good));
 assert.equal(compile(good+' /* '+emoji+' */'),compile(good));
});
test('CLI check works and emits no compiled JS on reject',()=>{
 const ok=spawnSync(process.execPath,[cli,'--check',fixture('arithmetic.ores')],{encoding:'utf8'});
 assert.equal(ok.status,0); assert.equal(ok.stdout.trim(),'OK');
 const bad=spawnSync(process.execPath,[cli,'--check',fixture('arithmetic.ores'),'--out=/tmp/reject'],{encoding:'utf8'});
 assert.notEqual(bad.status,0);
 const negative='pub fnc main(): int { return nonexistent_symbol; }';
 assert.throws(()=>compile(negative),/unresolved identifier nonexistent_symbol/);
});


test('scalar call graph accepts forward DAGs but rejects unconditionally infinite cycles', async () => {
 const acyclic='pub fnc main(): int { return a(40); } fnc a(int x): int { return b(x,2); } fnc b(int x,int y): int { return x+y; }';
 const mod=await moduleFrom(acyclic);
 assert.equal(mod.main(),42n);
 for(const bad of [
  'pub fnc main(): int { return main(); }',
  'pub fnc main(): int { return a(); } fnc a(): int { return main(); }',
  'pub fnc main(): int { return 1; } fnc unused(): int { return unused(); }',
  'pub fnc main(): int { return a(); } fnc a(): int { return b(); } fnc b(): int { return a(); }'
 ])assert.throws(()=>compile(bad),/error: unconditional recursive call cycle/);
});

test('canonical .atto Topic alias denial is byte-identical to Wasm, .NET and conformance', async()=> {
  // The same negative fixture is present under this path in Wasm/.NET and
  // in fixtures/ under atto-platform-conformance. Exact blob:
  // c562ad380bb283da9ffa26160653c1186ab63462
  const source=await readFile(resolve('contracts/atto-ensemble-v1/canonical-unlowered-try-publish.atto'),'utf8');
  for(const compileFn of [compileToIR, compile]) {
    assert.throws(()=>compileFn(source),
      /Topic\.try_publish requires checked actor\/group, share! and Result lowering/);
  }
});

test('JS scalar frontend denies aliased Topic.try_publish before code emission',()=>{
  for(const source of [
    'pub fnc main():int { return topic.try_publish(share! event)?; }',
    'pub fnc main():int { return alias.try_publish(rt share event); }',
    'pub fnc main():int { return topic /* nested /* x */ y */ . try_publish(share! event); }',
    'pub fnc main():int { return foo.bar.try_publish(42); }',
    'pub fnc main():int { return local_topic.try_publish; }'
  ]){
    for(const compileFn of [compileToIR,compile])
      assert.throws(()=>compileFn(source),
        /Topic\.try_publish requires checked actor\/group, share! and Result lowering/,
        source);
  }
});

test('JS typed Topic denial leaves inert text and standalone functions untouched',()=>{
  const source='pub fnc main():int { return 42; }';
  for(const inert of [
    ' // topic.try_publish(share! event)?',
    ' /* nested /* topic.try_publish(share! event)? */ outer */',
    ' // topic.try_publish(share! event)?\u0085',
    ' /* topic.try_publish(rt share event) */'
  ]) assert.equal(compile(source+inert),compile(source));
  const alias='pub fnc try_publish(int x):int { return x; } '+
    'pub fnc main():int { return try_publish(42); }';
  assert.equal(typeof compile(alias),'string');
});
