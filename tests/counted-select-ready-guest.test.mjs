import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileCountedReadyV1} from '../src/counted-select-ready-compiler.mjs';
import {compile} from '../src/compiler.mjs';
const fixtures=[{"name":"counted-mixed-future-alias","sha":"8f57de03c9fb44eb5594c99a7095f34b702a266a"},{"name":"counted-multi-channel-fair","sha":"4b9b79b9b8670f5b282d33e63b7a4b5691c2979a"},{"name":"counted-mixed-zero","sha":"458323db6019da434b97e5b966ee646411310acf"},{"name":"counted-three","sha":"6531efa0689f2a5728b40a6412651e8143e45865"},{"name":"counted-zero","sha":"42e49fc1eea64b31e86ec722e1457c1ab706a7e1"},{"name":"counted-one","sha":"910062ebf96613d15a16ddb080abd89375d7709c"},{"name":"counted-alias","sha":"324837078af3e7eeb9b619d0fb07142f0a0d6291"},{"name":"counted-dynamic","sha":"7c9ea9270d766612de0d502147e0df31b0dc3454"},{"name":"counted-dynamic-zero","sha":"4707b13d3daebe05ced967418ba120cf801e2d8c"}];
test('actual CLI emits ESM and nine exact closed-world guest sources execute to 42',async()=>{
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
