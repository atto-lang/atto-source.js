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
test('optional mtd marker and arrow/end bodies preserve receiver-erased arity',async()=>{
  const source=`pub define class X as
    pub mtd zero(self) -> void ::
    end
    pub mtd read(self, int value) -> int ::
      return value;
    end
    pub legacy(int value) -> int {
      return value;
    }
  end`;
  assert.equal(checkClassMethodsV1(source),true);
  const ns=await load(source);
  const x=new ns.X();
  assert.equal(x.zero(),undefined);
  assert.equal(x.read(9n),9n);
  assert.equal(x.legacy(7n),7n);
  assert.throws(()=>x.zero(1n),/method arity mismatch/);
  assert.throws(()=>x.read(),/method arity mismatch/);
});
test('exact formatter-style mtd arrow syntax accepts nested method/class end tokens',()=>{
  assert.equal(checkClassMethodsV1(`define class X as
    mtd foo() -> void ::
    end
  end`),true);
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
  assert.equal(Object.isFrozen(ns.X1.prototype),true);
  assert.equal(Object.isFrozen(ns.X2.prototype),true);
  assert.equal(Object.isFrozen(ns.X1),true);
  assert.equal(Object.isExtensible(new ns.X1()),false);
  assert.throws(()=>Object.defineProperty(new ns.X1(),'foo',{value:()=>42}),TypeError);
  assert.throws(()=>{ns.X1.prototype.foo=()=>42;},TypeError);
  assert.throws(()=>new (class Sub extends ns.X1 {})(),/unsupported class derivation/);
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
test('signed i64 method literals admit exact bounds and reject overflow',async()=>{
  const ns=await load(`pub define class Limits as
    pub min() -> int :: return -9223372036854775808; end
    pub max() -> int :: return +9223372036854775807; end
    pub neg() -> int :: return -42; end
  end`);
  const x=new ns.Limits();
  assert.equal(x.min(),-(1n<<63n));
  assert.equal(x.max(),(1n<<63n)-1n);
  assert.equal(x.neg(),-42n);
  for(const source of [
    'define class X as f() -> int :: return 9223372036854775808; end end',
    'define class X as f() -> int :: return -9223372036854775809; end end',
    'define class X as f() -> int :: return 999999999999999999999999999999999999999999; end end',
    'define class X as f(int x) -> int :: return -x; end end',
    'define class X as f(int x) -> int :: return +x; end end'
  ]) assert.throws(()=>compileClassMethodsV1(source),/error: class methods v1:/,source);
});
test('same-selector implicit and explicit self declarations conflict in either order',()=>{
  for(const pair of [
    'foo():void {} foo(self):void {}',
    'foo(self):void {} foo():void {}',
    'foo(int x):int{return x;} foo(self,int x):int{return x;}',
    'foo(self,int x):int{return x;} foo(int x):int{return x;}',
    'mtd foo():void {} foo(self):void {}',
    'foo(self):void {} mtd foo():void {}'
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
    'define class X as foo(self):void {} end junk',
    'define class X as mtd mtd foo():void {} end',
    'define class X as mtd foo():void :: end end',
    'define class X as mtd foo() -> int :: end end',
    'define class X as mtd foo() -> int return 42; end end',
    'define class X as mtd foo() -> int as return 42; end end',
    'define class X as mtd foo() -> void end end',
    'define class X as mtd foo() -> void :: end',
    'define class mtd as foo():void {} end',
    'define class X as foo(int mtd):int{return mtd;} end',
    'define class X as foo(int self):int{return self;} end'
  ]) assert.throws(()=>compileClassMethodsV1(source),/error: class methods v1:/,source);
});
test('keywords and NUL cannot be smuggled into source identifiers or comments',()=>{
  const bad=[
    'define class self as foo():void {} end',
    'define class actor as foo():void {} end',
    'define class X as mtd return(self):void {} end',
    'define class X as foo(int mut):void {} end',
    'define class X as foo(int await):void {} end',
    'define class X as foo(int fnc):void {} end',
    'define class X as foo(self):void {} end // '+String.fromCharCode(0),
    'define class X as foo(self):void {} end /* '+String.fromCharCode(0)+' */'
  ];
  for(const source of bad)assert.throws(()=>compileClassMethodsV1(source),
    /error: class methods v1:/,source);
});

test('compiler rejects malformed UTF-16 even inside ignorable comments',()=>{
  const src='pub define class X as pub f(self):void {} end';
  for(const bad of [
    src+' // '+String.fromCharCode(0xd800),
    src+' /* '+String.fromCharCode(0xdc00)+' */',
    src+' // '+String.fromCharCode(0xdbff)+'x',
    String.fromCharCode(0xdc00)+src
  ]) assert.throws(()=>compileClassMethodsV1(bad),/invalid UTF-16 source/);
  const valid=src+' // '+String.fromCodePoint(0x1f642);
  assert.equal(checkClassMethodsV1(valid),true);
});

test('private members do not escape ESM class exports',async()=>{
  const ns=await load('pub define class X as privateMethod(self):int{return 5;} pub visible():int{return 42;} end');
  const x=new ns.X();
  assert.equal(x.visible(),42n);
  assert.equal(Object.hasOwn(ns.X.prototype,'privateMethod'),false);
  assert.equal(x.privateMethod,undefined);
  assert.equal(Object.isFrozen(ns.X.prototype),true);
});

test('CLI --class-methods-v1 --check and ESM output run from saved .ores',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ores-self-methods-'));
  try{
    const input=join(dir,'classes.ores'), output=join(dir,'classes.mjs');
    await writeFile(input,'pub define class X as pub mtd foo(self) -> int :: return 42; end end');
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
