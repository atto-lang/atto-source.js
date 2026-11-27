import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileCountedReadyV1} from '../src/counted-select-ready-compiler.mjs';
import {compile} from '../src/compiler.mjs';
const fixtures=[{"name":"counted-distinct-alias-projection","sha":"5baca9bb9eb4b98500cab770888a45fb60bbf10d"},{"name":"counted-mixed-future-alias","sha":"8f57de03c9fb44eb5594c99a7095f34b702a266a"},{"name":"counted-multi-channel-fair","sha":"4b9b79b9b8670f5b282d33e63b7a4b5691c2979a"},{"name":"counted-mixed-zero","sha":"458323db6019da434b97e5b966ee646411310acf"},{"name":"counted-three","sha":"6531efa0689f2a5728b40a6412651e8143e45865"},{"name":"counted-zero","sha":"42e49fc1eea64b31e86ec722e1457c1ab706a7e1"},{"name":"counted-one","sha":"910062ebf96613d15a16ddb080abd89375d7709c"},{"name":"counted-alias","sha":"324837078af3e7eeb9b619d0fb07142f0a0d6291"},{"name":"counted-dynamic","sha":"7c9ea9270d766612de0d502147e0df31b0dc3454"},{"name":"counted-dynamic-zero","sha":"4707b13d3daebe05ced967418ba120cf801e2d8c"}];
test('actual CLI emits ESM and ten exact closed-world guest sources execute to 42',async()=>{
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try{
    for(const f of fixtures){
      const input=new URL('./fixtures/select-source-v2/'+f.name+'.atto',import.meta.url);
      const raw=await readFile(input);
      assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),f.sha);
      assert.throws(()=>compile(raw.toString('utf8'))); // old scalar gate intact
      const path=join(dir,f.name+'.mjs');
      const child=spawnSync(process.execPath,['bin/oreslang-jsc.mjs','--counted-ready-v1',input.pathname,'--out='+path],{encoding:'utf8'});
      assert.equal(child.status,0,child.stderr);
      const emitted=await import(pathToFileURL(path));
      assert.equal(await emitted.main(),42n,f.name);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('unsupported types, effects, projection captures, escaped futures and negative counts never emit',()=>{
  const prefix='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); writech a, 42; ';
  const base='val Array[int] values = await select<int>(1) { when readch a: int n -> { return n; } }; return values[0]; }';
  for(const text of [base.replace('(1)','(-1)'),base.replace('(1)','(true)'),base.replace('return n;','return n + a;'),base.replace('readch a','readch missing'),base.replace('Array[int]','int'),base.replace('when readch a: int n','default:'),base.replace('await select','select'),base+' return 0;'])assert.throws(()=>compileCountedReadyV1(prefix+text),/E_COUNTED_READY_PROFILE/);
  assert.throws(()=>compileCountedReadyV1('pub fnc main(): int { return 42; }'),/E_COUNTED_READY_PROFILE/);
});
test('runtime rejects would-suspend instead of hanging or pretending full scheduler support',async()=>{
  const source='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); val Array[int] values = await select<int>(1) { when readch a: int n -> { return n; } }; return values[0]; }';
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try{const path=join(dir,'guest.mjs');await writeFile(path,compileCountedReadyV1(source));const guest=await import(pathToFileURL(path));await assert.rejects(guest.main(),/E_READY_ONLY/);}
  finally{await rm(dir,{recursive:true,force:true});}
});

test('seven exact negative fixtures fail closed in the explicit profile',async()=>{
  const bad=[{"name":"reject-counted-negative","sha":"e2ff6fdb406b8807b74fa15beaee10a7f9438e22"},{"name":"reject-counted-bool","sha":"4a52c22442bc8a9fe55eb95b23722595db32c97e"},{"name":"reject-counted-scalar","sha":"a2a2dd184237f17b5e8d455f498719ef1ed01d97"},{"name":"reject-counted-default","sha":"0c67c1fc8eaf55df6abb2b0fe7d2ce80f169bc69"},{"name":"reject-counted-write","sha":"63fa3c9add56f3793e6d755f006cd3568acf1f04"},{"name":"reject-counted-dynamic-bool","sha":"36cd372a5385e34f2e3bd8dd936e4e0491052633"},{"name":"reject-counted-dynamic-unknown","sha":"0e61da7a98987ed5a182148538b35b8a890abf26"}];
  for(const f of bad){
    const raw=await readFile(new URL('./fixtures/select-source-v2/'+f.name+'.atto',import.meta.url));
    assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),f.sha);
    assert.throws(()=>compileCountedReadyV1(raw.toString('utf8')),/E_COUNTED_READY_PROFILE/,f.name);
  }
});
test('pending batch escape, competing channel access and token spoofing fail closed',()=>{
  const p='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(2); writech a, 42; ';
  const f='val Future<Array<int>> pending = select<int>(1) { when readch a: int n -> { return n; } }; ';
  for(const body of ['return 42; }','writech a, 5; return 42; }','return readch a; }','val Array[int] b = await select<int>(1) { when readch a: int n -> { return n; } }; return b[0]; }'])
    assert.throws(()=>compileCountedReadyV1(p+f+body),/E_COUNTED_READY_PROFILE/);
  assert.throws(()=>compileCountedReadyV1(p+'val Array[int] b = await select<int>(1) { when readch a: int n -> { return n "+" 1; } }; return b[0]; }'),/E_COUNTED_READY_PROFILE/);
});
test('dynamic invalid count fails before registration, and an empty direct read is never fabricated as zero',async()=>{
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try{
    const source='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); val int count = 17; val Array[int] b = await select<int>(count) { when readch a: int n -> { return n; } }; return b[0]; }';
    const path=join(dir,'bad-count.mjs');await writeFile(path,compileCountedReadyV1(source));await assert.rejects((await import(pathToFileURL(path))).main(),/SelectCountInvalid/);
    const empty='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); val Array[int] b = await select<int>(0) { when readch a: int n -> { return n; } }; return readch a; }';
    const p=join(dir,'empty-read.mjs');await writeFile(p,compileCountedReadyV1(empty));await assert.rejects((await import(pathToFileURL(p))).main(),/E_READY_ONLY/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('exceptional guest exit cancels the owned pending batch before its first pump',async()=>{
  const {CountedSelectI64Batch:Batch}=await import('../src/counted-select-i64-batch.mjs');
  const pump=Batch.prototype.pump,cancel=Batch.prototype.cancel;
  let pumps=0,cancels=0;
  Batch.prototype.pump=function(){pumps++;return pump.call(this);};
  Batch.prototype.cancel=function(){cancels++;return cancel.call(this);};
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try {
    const source='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); writech a, 42; val Future<Array<int>> pending = select<int>(1) { when readch a: int n -> { return n; } }; val int overflow = 9223372036854775807 + 1; val Array[int] b = await pending; return b[0]; }';
    const path=join(dir,'retire.mjs');await writeFile(path,compileCountedReadyV1(source));await assert.rejects((await import(pathToFileURL(path))).main(),/E_I64_OVERFLOW/);
    assert.equal(pumps,0);assert.equal(cancels,1);
  }finally{Batch.prototype.pump=pump;Batch.prototype.cancel=cancel;await rm(dir,{recursive:true,force:true});}
});

test('short-circuit conditions cannot conditionally consume Future or channel capabilities',()=>{
  const start='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(2); writech a, 42; val Future<int> f = select<int> { default: -> { return 20; } }; val Array[int] b = await select<int>(0) { when readch a: int n -> { return n; } }; ';
  for(const c of ['(1 == 2) && ((await f) == 20)','(1 == 1) || ((readch a) == 42)'])assert.throws(()=>compileCountedReadyV1(start+'if '+c+' then return 1; fi return 42; }'),/effect in condition/);
});

test('canonical const Future is non-awaited until explicit await; immutable bindings cannot be reassigned',async()=>{
  const prefix='suspends fnc main(): int { const Channel<int> a = Channel.new<int>(1); writech a, 42; ';
  const select='const Future<Array<int>> pending = select<int>(1) { when readch a: int n -> { return n; } }; ';
  const source=prefix+select+'const Array[int] b = await pending; return b[0]; }';
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try {
    const path=join(dir,'const-future.mjs');await writeFile(path,compileCountedReadyV1(source));
    assert.equal(await (await import(pathToFileURL(path))).main(),42n);
    const direct=prefix+'const Array[int] b = await select<int>(1) { when readch a: int n -> { return n; } }; return b[0]; }';
    const directPath=join(dir,'const-direct.mjs');await writeFile(directPath,compileCountedReadyV1(direct));
    assert.equal(await (await import(pathToFileURL(directPath))).main(),42n);
    for(const body of ['return 42; }','const Array[int] b = await pending; const Array[int] c = await pending; return b[0]; }'])
      assert.throws(()=>compileCountedReadyV1(prefix+select+body),/E_COUNTED_READY_PROFILE/);
    assert.throws(()=>compileCountedReadyV1(prefix+'const int k = 1; k = 2; const Array[int] b = await select<int>(1) { when readch a: int n -> { return n; } }; return b[0]; }'),/immutable binding/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('raw Future select binds concrete scalar or counted type without erasing capability checks',async()=>{
  const prefix='suspends fnc main(): int { const Channel<int> a = Channel.new<int>(1); writech a, 20; ';
  const source=prefix+'const Future f = select { default: -> { return 20; } }; const Future batch = select(1) { when readch a: int n -> { return n; } }; const Array[int] values = await batch; const int extra = await select<int> { default: -> { return 2; } }; return (await f) + values[0] + extra; }';
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try {
    const path=join(dir,'raw-future.mjs');await writeFile(path,compileCountedReadyV1(source));
    assert.equal(await (await import(pathToFileURL(path))).main(),42n);
    const pending='const Future batch = nb select<int>(1) { when readch a: int n -> { return n; } }; ';
    for(const body of ['return 42; }','const int b = await batch; return b; }','const Array[int] b = await batch; const Array[int] c = await batch; return b[0]; }'])
      assert.throws(()=>compileCountedReadyV1(prefix+pending+body),/E_COUNTED_READY_PROFILE/);
    for(const body of ['const Future f = 42; return 42; }','const Future<int> f = select(1) { when readch a: int n -> { return n; } }; return 42; }','const Future f = select { default: -> { return a; } }; return 42; }'])
      assert.throws(()=>compileCountedReadyV1(prefix+body),/E_COUNTED_READY_PROFILE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('direct closed callable await invokes integer lambda without allocating a Future',async()=>{
  const prefix='suspends fnc main(): int { const Channel<int> a = Channel.new<int>(1); const Array[int] b = await select(0) { when readch a: int n -> { return n; } }; ';
  const dir=await mkdtemp(join(process.cwd(),'.counted-ready-'));
  try {
    const path=join(dir,'direct-callable.mjs');
    await writeFile(path,compileCountedReadyV1(prefix+'const int x = await || -> 33; const int y = await (|| -> 3 * 3); return x+y; }'));
    assert.equal(await (await import(pathToFileURL(path))).main(),42n);
    const overflow=join(dir,'overflow.mjs');
    await writeFile(overflow,compileCountedReadyV1(prefix+'return await || -> 9223372036854775807 + 1; }'));
    await assert.rejects((await import(pathToFileURL(overflow))).main(),/E_I64_OVERFLOW/);
    for(const body of [
      'return await or -> 42; }',
      'return await |int x| -> x; }',
      'return await || -> true; }',
      'const int capture = 42; return await || -> capture; }',
      'return await || -> { return 42; }; }',
      'return await || -> 40 < 42; }',
      'if (await || -> 42) == 42 then return 42; fi return 0; }'
    ])assert.throws(()=>compileCountedReadyV1(prefix+body),/E_COUNTED_READY_PROFILE/,body);
  }finally{await rm(dir,{recursive:true,force:true});}
});
