import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {transpile_deferred_stdout_worker,transpile_to_worker} from '../src/transpile-worker.mjs';
const fixture=alias=>'pub fnc main():int{let int count=0;val Option<int> missing=None;val Result<int,Error> failure=trap! sync task<int>{count=count+2;defer '+alias+'.write("D");val int value=missing.unwrap();count=count+100;return value;};guard failure.is_err(),count eq 2{return 1;}return count+40;}';
const opts={allowDeferredStdout:true};
const expected={value:'42',stdout:'D',actors:0};
const data=source=>'data:text/javascript;charset=utf-8,'+encodeURIComponent(source);
test('explicit worker profile is fail closed and tenant-local, with no raw runner export',async()=>{
  const src=fixture('stdio.out');
  assert.throws(()=>transpile_to_worker(src));
  assert.throws(()=>transpile_deferred_stdout_worker(src),/E_PERMISSION/);
  const artifact=transpile_deferred_stdout_worker(src,opts);
  assert.equal(artifact.guest_abi,'atto.js.browser.deferred-stdout.v1');
  const m=await import(data(artifact.module_source));
  assert.deepEqual(Object.keys(m),['create_tenant']);
  let getter=0;
  for(const denied of [{},{allowDeferredStdout:false},Object.create(opts),{get allowDeferredStdout(){getter++;return true;}}]){
    await assert.rejects(m.create_tenant(denied),/E_PERMISSION/);
  }
  assert.equal(getter,0);
  const grant={allowDeferredStdout:true},a=await m.create_tenant(grant),b=await m.create_tenant(opts);
  grant.allowDeferredStdout=false;
  const [x,y]=await Promise.all([a.on_message(),b.on_message()]);
  assert.deepEqual(x,expected);assert.deepEqual(y,expected);
  await assert.rejects(a.on_message(),/E_MAIN_ALREADY_CALLED/);
  await assert.rejects(b.on_message(),/E_MAIN_ALREADY_CALLED/);
  for(const bad of [src+' import("evil")',src+'//\u202e',src+'//\u0000','pub fnc main():int{return 42;}'])
    assert.throws(()=>transpile_deferred_stdout_worker(bad,opts));
});
test('actual isolated Node worker executes both canonical aliases and rejects replay',async()=>{
  for(const alias of ['stdio.out','process.stdout']){
    const artifact=transpile_deferred_stdout_worker(fixture(alias),opts);
    const wrapper='import {parentPort} from "node:worker_threads";import {create_tenant} from '+JSON.stringify(data(artifact.module_source))+';const t=await create_tenant({allowDeferredStdout:true});const result=await t.on_message();let replay=false;try{await t.on_message();}catch(e){replay=/E_MAIN_ALREADY_CALLED/.test(e.message);}parentPort.postMessage({result,replay});';
    const worker=new Worker(new URL(data(wrapper)));
    try{
      const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(Error('worker exit '+code));});});
      assert.deepEqual(result,{result:expected,replay:true});
    }finally{await worker.terminate();}
  }
});
test('CLI compile grant is explicit, atomic publication, actual emitted ESM and Worker',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-deferred-stdout-'));
  const cli=fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url));
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000});
  try{
    const source=join(dir,'main.atto');await writeFile(source,fixture('process.stdout'));
    for(const profile of ['--program-v2','--program-v2-worker']){
      const out=join(dir,profile.slice(2)+'.mjs'),denied=join(dir,'denied.mjs');
      const deny=run(profile,source,'--out='+denied);assert.equal(deny.status,1);assert.match(deny.stderr,/E_PERMISSION/);assert.equal(deny.stdout,'');
      const check=run(profile,'--allow-deferred-stdout','--check',source);assert.equal(check.status,0,check.stderr);assert.equal(check.stdout,'OK\n');
      const emit=run(profile,'--allow-deferred-stdout',source,'--out='+out);assert.equal(emit.status,0,emit.stderr);
      const m=await import(pathToFileURL(out).href);
      if(profile==='--program-v2'){assert.throws(()=>m.main(),/E_PERMISSION/);assert.deepEqual(m.runWithDeferredStdout(true),{value:42n,stdout:'D'});}
      else assert.deepEqual(await (await m.create_tenant(opts)).on_message(),expected);
      assert.equal(run(profile,'--allow-deferred-stdout',source,'--out='+out).status,1);
    }
    assert.equal(run('--atto-scalar-v1','--allow-deferred-stdout',source).status,1);
    assert.deepEqual((await readdir(dir)).sort(),['main.atto','program-v2-worker.mjs','program-v2.mjs']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
