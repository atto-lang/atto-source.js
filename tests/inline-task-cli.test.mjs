import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compileAttoScalarV1,compileToProgramIRV2} from '../src/program-v2.mjs';
const load=source=>import('data:text/javascript,'+encodeURIComponent(compileAttoScalarV1(source)));
test('CLI scalar IR executes scoped inline tasks without scheduling',async()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{return 40+2;};}',
    'pub fnc main():int{return sync task{val int x=40;return sync task<int>{return x+2;};};}',
    'pub fnc main():int{val int base=40;return sync task<int>{val int x=base+1;return x+1;};}',
  ]){
    const m=await load(source);
    assert.equal(m.main(),42n);
  }
});
test('CLI scalar inline task checks an unused initializer',async()=>{
  const m=await load('pub fnc main():int{return sync task<int>{val int x=9223372036854775807+1;return 42;};}');
  assert.throws(()=>m.main(),/overflow/i);
});
test('CLI scalar inline tasks reject escaping or unsupported effects',()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{return true;};}',
    'pub fnc main():int{return sync task<int>{val int x=1;x=42;return x;};}',
    'pub fnc main():int{return sync task<int>{return await 42;};}',
    'pub fnc main():int{return sync task<int>{return task<int>{return 42;};};}',
    'pub fnc main():int{val int z=sync task<int>{val int x=42;return x;};return x;}',
    'pub fnc main():int{return sync task<int>{return helper();};} fnc helper():int{return 42;}',
    'pub fnc main():int{return sync task<void>{return 42;};}',
    'pub fnc main():int{return task { return 42; };}',
    'pub fnc main():int{return sync gpu task { return 42; };}',
    'pub fnc main():int{return sync task { return await 42; };}',
  ])assert.throws(()=>compileToProgramIRV2(source),undefined,source);
});

test('actual scalar CLI checks, publishes and executes task ESM; rejected input publishes nothing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atto-inline-cli-'));
  const cli=fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url));
  const run=(...args)=>spawnSync(process.execPath,[cli,'--atto-scalar-v1',...args],{encoding:'utf8',timeout:10000});
  try{
    const good=join(dir,'good.atto'),out=join(dir,'good.mjs');
    await writeFile(good,'pub fnc main():int{return sync task {val int x=40;return x+2;};}');
    const check=run('--check',good);
    assert.equal(check.status,0,check.stderr);assert.equal(check.stdout,'OK\n');
    const compiled=run(good,'--out='+out);
    assert.equal(compiled.status,0,compiled.stderr);
    const guest=await import(pathToFileURL(out).href);
    assert.equal(guest.main(),42n);
    const bad=join(dir,'bad.atto'),denied=join(dir,'denied.mjs');
    await writeFile(bad,'pub fnc main():int{return sync task<int>{return await 42;};}');
    for(const args of [['--check',bad],[bad,'--out='+denied]]){
      const rejected=run(...args);
      assert.equal(rejected.status,1,rejected.stderr);
      assert.match(rejected.stderr,/E_TASK_UNSUPPORTED/);
      assert.equal(rejected.stdout,'');
    }
    assert.deepEqual((await readdir(dir)).sort(),['bad.atto','good.atto','good.mjs']);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('task-local mutable int versions preserve lexical evaluation and snapshots',async()=>{
  for(const source of [
    'pub fnc main():int{return sync task<int>{let int x=1;x=40; x=x+2;return x;};}',
    'pub fnc main():int{return sync task{let int x=20;val int before=x;x=22;return before+x;};}',
    'pub fnc main():int{return sync task{let int x=40;x=sync task{let int y=x;y=y+1;return y;};return x+1;};}',
    'pub fnc main():int{return sync task{let int x=20;x=x+1;return x;}+sync task{let int x=22;x=x-1;return x;};}',
  ])assert.equal((await load(source)).main(),42n,source);
  const m=await load('pub fnc main():int{return sync task{let int x=0;x=9223372036854775807+1;x=42;return x;};}');
  assert.throws(()=>m.main(),/overflow/i);
});
test('mutable task writes cannot mutate immutable, outer or undeclared names',()=>{
  for(const source of [
    'pub fnc main():int{return sync task{val int x=1;x=42;return x;};}',
    'pub fnc main():int{val int x=1;return sync task{x=42;return x;};}',
    'pub fnc main():int{return sync task{let int x=1;return sync task{x=42;return x;};};}',
    'pub fnc main():int{return sync task{x=42;return x;};}',
    'pub fnc main():int{return sync task{let int x=0;x=true;return x;};}',
    'pub fnc main():int{return sync task{let int x=0;let int x=42;return x;};}',
  ])assert.throws(()=>compileAttoScalarV1(source),undefined,source);
});
