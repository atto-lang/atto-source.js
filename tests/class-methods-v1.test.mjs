import test from 'node:test';
import assert from 'node:assert/strict';
import {compileClassMethodsV1,checkClassMethodsV1} from '../src/class-methods-v1.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const load=source=>import('data:text/javascript;charset=utf-8,'+
  encodeURIComponent(compileClassMethodsV1(source)));

test('exact X1/X2 private declarations parse and normalize to zero-arity methods',()=>{
  const source=`define class X1 as

   foo():void {}

end

define class X2 as

   foo(self):void {}

end
`;
  assert.equal(checkClassMethodsV1(source),true);
  const output=compileClassMethodsV1(source);
  assert.match(output,/class \$OresClass0/);
  assert.match(output,/class \$OresClass1/);
  assert.doesNotMatch(output,/export \{/);
});
test('pub instance methods compile to executable ESM with implicit or explicit self',async()=>{
  const ns=await load(`pub define class X1 as pub foo():void {} end
     pub define class X2 as pub foo(self):void {} end`);
  assert.deepEqual(Object.keys(ns).sort(),['X1','X2']);
  assert.equal(new ns.X1().foo(),undefined);
  assert.equal(new ns.X2().foo(),undefined);
  assert.throws(()=>new ns.X1(42n),/constructor arity mismatch/);
  assert.throws(()=>new ns.X2(42n),/constructor arity mismatch/);
  assert.throws(()=>ns.X1.prototype.foo.call(new ns.X2()),/invalid Oreslang receiver/);
  assert.throws(()=>new ns.X2().foo(12n),/method arity mismatch/);
  assert.throws(()=>ns.X1.prototype.foo.call({}),TypeError);
  assert.throws(()=>ns.X2.prototype.foo.call(Object.create(ns.X2.prototype)),TypeError);
});
test('overloads dispatch by user args only and reject wrong types and arity',async()=>{
  const ns=await load(`define pub class Box as
     pub read(self):int{return 42;}
     pub read(int value):int{return value;}
     pub read(self,int x,int y):int{return x;}
   end`);
  const box=new ns.Box();
  assert.equal(box.read(),42n);
  assert.equal(box.read(7n),7n);
  assert.equal(box.read(11n,22n),11n);
  assert.throws(()=>box.read(42),/signed i64 BigInt/);
  assert.throws(()=>box.read(1n,2n,3n),/method arity mismatch/);
  assert.throws(()=>box.read(1n<<63n),/signed i64 BigInt/);
  assert.throws(()=>box.read.call({}),/invalid Oreslang receiver/);
});
test('same-selector implicit and explicit self declarations conflict in either order',()=>{
  for(const pair of [
    'foo():void {} foo(self):void {}',
    'foo(self):void {} foo():void {}',
    'foo(int x):int{return x;} foo(self,int x):int{return x;}',
    'foo(self,int x):int{return x;} foo(int x):int{return x;}'
  ]) assert.throws(()=>compileClassMethodsV1('define class X as '+pair+' end'),
    /duplicate method name\/arity/,pair);
});
test('malformed or unsupported source fails closed before generating ESM',()=>{
  for(const source of [
    'define class X as foo(self,):void {} end',
    'define class X as foo(int x,self):void {} end',
    'define class X as foo(mut self):void {} end',
    'define class X as foo(self X):void {} end',
    'define class X as foo(self):void {rt take self;} end',
    'define class X as foo(self):int {} end',
    'define class X as foo(self):int {return missing;} end',
    'define class X as foo(self):int {return 9223372036854775808;} end',
    'define actor X as foo(self):void {} end',
    'define class X as foo(self):void {} foo(self):void {} end',
    'define class X as foo(self):void {} end junk'
  ]) assert.throws(()=>compileClassMethodsV1(source),/error: class methods v1:/,source);
});
test('CLI --class-methods-v1 --check and ESM output run from saved .ores',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ores-self-methods-'));
  try{
    const input=join(dir,'classes.ores'), output=join(dir,'classes.mjs');
    await writeFile(input,'pub define class X as pub foo(self):int{return 42;} end');
    const cli=resolve('bin/oreslang-jsc.mjs');
    let run=spawnSync(process.execPath,[cli,'--class-methods-v1','--check',input],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    run=spawnSync(process.execPath,[cli,'--class-methods-v1',input,'--out='+output],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const code=await readFile(output,'utf8');
    const ns=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
    assert.equal(new ns.X().foo(),42n);
    run=spawnSync(process.execPath,[cli,'--program-v2','--check',input],{encoding:'utf8'});
    assert.notEqual(run.status,0,'legacy program-v2 must stay fail-closed for classes');
  }finally{await rm(dir,{recursive:true,force:true});}
});
