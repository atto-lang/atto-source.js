import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileOwnedCoreMath,compileOwnedCoreCellPolicy,compileFreestandingCore} from '../src/freestanding-core.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';
const SHA={
  "math": "845379a28b68e4674aed7d94489a18725ca16144",
  "hash": "1f836230d8d976ab0a70c918c6fa48b8731bbc13",
  "cell": "ef1e84dbab1bb476d6ac55bf1802331660879732"
};
const gitBlob=bytes=>createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
const load=name=>readFile(new URL('../library/atto.core/'+name+'.atto',import.meta.url));
test('backend-owned Atto source bytes are SHA-pinned and free of host imports',async()=>{
 for(const [name,want] of Object.entries(SHA)){
   const file=new URL('../library/atto.core/'+name+'.atto',import.meta.url);
   const stat=await lstat(file);
   assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=1048576);
   const bytes=await load(name);
   assert.equal(gitBlob(bytes),want,name);
   const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   assert.ok(!source.includes('\0')&&!source.startsWith('\uFEFF'));
   if(name==='math') {
     assert.match(source,/^use namespace atto\.core\.math;$/m);
     assert.doesNotMatch(source,/define\s+(?:pub\s+)?module\s+math\b/);
   } else {
     assert.match(source,new RegExp('define module '+name+' as'));
   }
   assert.doesNotMatch(source,/java:|dotnet:|import module/);
 }
});
test('actual pure math .atto transpiles into checked ES module and executes',async()=>{
 const source=await load('math');
 const esm=compileOwnedCoreMath(source.toString('utf8'));
 assert.doesNotMatch(esm,/\b(?:process|require|fetch|eval|Worker|window|document)\b/);
 const {math}=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(Object.isFrozen(math),true);
 for(const [a,b,lo,hi] of [
   [2n,5n,2n,5n],[-9n,-4n,-9n,-4n],
   [-(1n<<63n),(1n<<63n)-1n,-(1n<<63n),(1n<<63n)-1n]
 ]) {
   assert.equal(math.min_int(a,b),lo);
   assert.equal(math.max_int(a,b),hi);
 }
 assert.equal(math.signum_int(-17n),-1n);
 assert.equal(math.signum_int(0n),0n);
 assert.equal(math.signum_int(17n),1n);
 assert.equal(math.signum_int(-(1n<<63n)),-1n);
 assert.equal(math.signum_int((1n<<63n)-1n),1n);
 assert.equal(math.contains_closed_int(5n,1n,5n),true);
 assert.equal(math.contains_closed_int(6n,1n,5n),false);
 assert.equal(math.contains_closed_int(5n,8n,4n),false);
 assert.throws(()=>math.min_int(1n,2),/BigInt/);
 assert.throws(()=>math.max_int(1n<<63n,1n),/OVERFLOW/);
});
test('new math compilation gate does not widen core or admit hash/host modules',async()=>{
 const math=(await load('math')).toString('utf8');
 for(const source of [
  math.replace('use namespace atto.core.math;','use namespace atto.core.hash;'),
  'import module fs from "std/fs"; '+math,
  'define module math as pub fnc x(): int { return process.exit(0); } end'
 ]) assert.throws(()=>compileOwnedCoreMath(source),/error:/);
 assert.throws(()=>compileFreestandingCore(math),/requires one core module/);
 assert.throws(()=>compileOwnedCoreMath(
   math.replace('use namespace atto.core.math;',
                'use namespace atto.core.hash;')),/math requires only public top-level/);
 assert.throws(()=>compileOwnedCoreMath(
   math.replace('use namespace atto.core.math;',
                'use namespace atto.core.math; use namespace atto.core.math;')),/error:/);
 assert.throws(()=>compileOwnedCoreMath(
   math.replace('use namespace atto.core.math;',
                'use default namespace;')),/error:/);
 assert.throws(()=>compileOwnedCoreMath(
   'pub fnc value(): int { return 42; } '+math),/error:/);
 assert.throws(()=>compileOwnedCoreMath(
   math.replace('use namespace atto.core.math;',
                'import * as math from pkg "atto.core.math";')),/error:/);
});
test('namespace metadata survives parsing but creates no import authority',()=>{
 const source='use namespace atto.core.math; pub fnc one():int{return 1;}';
 const ir=compileToProgramIRV2(source);
 assert.equal(ir.sourceNamespace,'atto.core.math');
 assert.deepEqual(ir.modules,[]);
 assert.equal(ir.functions[0].module,null);
 assert.equal(ir.functions[0].pub,true);
 for(const bad of [
  'use namespace __proto__.core.math; pub fnc main():int{return 1;}',
  'use namespace atto.core.math; use namespace atto.core.math; pub fnc main():int{return 1;}',
  'pub fnc main():int{return 1;} use namespace atto.core.math;',
  'use namespace a.b.c.d.e.f.g.h.i; pub fnc main():int{return 1;}',
  'use namespace atto.core.math; import module other from "./other.atto"; pub fnc main():int{return 1;}'
 ]) assert.throws(()=>compileToProgramIRV2(bad),/error:/);
});
test('namespace exports public calls and retains local private helpers',async()=>{
 const source='use namespace atto.core.math; '+
  'fnc twice(int x):int{return x+x;} '+
  'pub fnc answer():int{return twice(21);}';
 const generated=compileOwnedCoreMath(source);
 const {math}=await import('data:text/javascript,'+encodeURIComponent(generated));
 assert.equal(math.answer(),42n);
 assert.equal(math.twice,undefined);
 assert.equal(Object.isFrozen(math),true);
});
test('source-free hash and borrow-policy golden reference are not guest execution',()=>{
 const step=(s,b)=>{
  if(s<0||s>=1000000007||b<0||b>255)return -1;
  let n=s*31+b;
  for(let i=0;i<31;i++)if(n>=1000000007)n-=1000000007;
  return n;
 };
 for(const s of [0,1,17,569,1000000006])
  for(const b of [0,1,42,127,255])
   assert.equal(step(s,b),(s*31+b)%1000000007);
 assert.equal(step(step(17,42),7),17646);
 assert.equal(step(17,256),-1);
});


test('borrow-aware core Cell owner predicates are source-only, never guest authority', async () => {
  const cell=(await readFile(new URL('../library/atto.core/cell.atto',import.meta.url))).toString('utf8');
  for(const name of ['valid_loan_state','can_owner_read','can_owner_write',
                     'can_move_owner','can_suspend_unpinned']){
    assert.ok(cell.includes('pub fnc '+name+'('),name);
  }
  const vectors=[
    [0,false,true,true], [1,false,true,false],
    [65535,false,true,false], [65536,false,false,false],
    [-1,false,false,false], [0,true,true,false], [1,true,false,false]
  ];
  for(const [readers,writer,valid,write] of vectors){
    assert.equal(readers>=0&&readers<=65535&&(!writer||readers===0),valid);
    assert.equal(readers===0&&!writer,write);
  }
  assert.ok(!cell.includes('pub fnc issue_loan('));
  // This is only a source/policy reference check, NOT a compiled guest test.
});


test('real JS compiler denies unproven Cell<T> borrowing or module promotion',async()=>{
  const cell=(await load('cell')).toString('utf8');
  // Both code paths invoke production compileToProgramIRV2, not a regex
  // pretending to be a compiler. No owned mutable-cell ESM may be emitted.
  assert.throws(()=>compileOwnedCoreMath(cell),/error:/);
  assert.throws(()=>compileFreestandingCore(cell),/error:/);
  const illegal='use namespace atto.core.cell; '+
    'import module x from "std/thread"; pub fnc main():int{return 42;}';
  assert.throws(()=>compileToProgramIRV2(illegal),/error:/);
});

test('core/cell saturated read admission rejects overflow but retains owner read', async () => {
  const source=(await readFile(new URL('../library/atto.core/cell.atto',import.meta.url))).toString('utf8');
  // Source-only policy shape. This MUST NOT be promoted to a compiler loan.
  assert.match(source,/pub fnc can_borrow_read\(/);
  assert.match(source,/pub fnc can_owner_read\(/);
  assert.match(source,/if readers >= 65535;/);
  const canAcquire=(n,w)=>n>=0 && n<65535 && !w;
  const ownerRead=(n,w)=>n>=0 && n<=65535 && !w;
  for(const [n,w,acquire,read] of [
    [0,false,true,true],[65534,false,true,true],[65535,false,false,true],
    [65536,false,false,false],[-1,false,false,false],[0,true,false,false]
  ]) {
    assert.equal(canAcquire(n,w),acquire);
    assert.equal(ownerRead(n,w),read);
  }
  assert.ok(!source.includes('pub fnc issue_loan('));
});


test('production typed compiler executes compiler-owned Atto Cell policy as pure frozen ESM',async()=>{
 const source=(await load('cell')).toString('utf8');
 const esm=compileOwnedCoreCellPolicy(source);
 assert.doesNotMatch(esm,/\\b(?:process|require|fetch|eval|Worker|window|document)\\b/);
 const {cell}=await import('data:text/javascript,'+encodeURIComponent(esm));
 assert.equal(Object.isFrozen(cell),true);
 const cases=[
  // readers, writer, can-acquire-read, owner-read, write/move/suspend, valid
  [0n,false,true,true,true,true],
  [1n,false,true,true,false,true],
  [65534n,false,true,true,false,true],
  [65535n,false,false,true,false,true],
  [65536n,false,false,false,false,false],
  [-1n,false,false,false,false,false],
  [0n,true,false,false,false,true],
  [1n,true,false,false,false,false]
 ];
 for(const [readers,writer,acquire,read,write,valid] of cases){
   assert.equal(cell.can_borrow_read(readers,writer),acquire);
   assert.equal(cell.can_owner_read(readers,writer),read);
   assert.equal(cell.can_owner_write(readers,writer),write);
   assert.equal(cell.can_move_owner(readers,writer),write);
   assert.equal(cell.can_suspend_unpinned(readers,writer),write);
   assert.equal(cell.valid_loan_state(readers,writer),valid);
 }
 assert.equal(cell.readers_after_acquire(65534n,false),65535n);
 assert.equal(cell.readers_after_acquire(65535n,false),-1n);
 assert.equal(cell.readers_after_release(65535n,false),65534n);
 assert.equal(cell.readers_after_release(0n,false),-1n);
 assert.equal(cell.readers_after_release(1n,true),-1n);
 assert.throws(()=>cell.can_owner_read(1,false),/BigInt/);
 assert.throws(()=>cell.can_owner_write(1n,0),/bool/);
 assert.equal(cell.issue_loan,undefined);
 // The module is a policy library, NOT live Cell<T>/RefCell<T> borrowing.
});

test('compiled Cell policy export cannot be confused with untrusted incomplete modules',async()=>{
 const source=(await load('cell')).toString('utf8');
 for(const mutation of [
  source.replace('define module cell as','define module other as'),
  source.replace('pub fnc can_borrow_read','fnc can_borrow_read'),
  source.replace('pub fnc can_borrow_read','pub fnc issue_loan'),
  source.replace('can_borrow_read(int readers, bool writer_active): bool',
                 'can_borrow_read(int readers, int writer_active): bool'),
  source.replace('can_move_owner(int readers, bool writer_active): bool',
                 'can_move_owner(int readers, bool writer_active): int'),
  source+'pub fnc hidden():int{return 42;}',
  'import module os from "std/env"; '+source,
  'use namespace atto.core.cell; '+source
 ]) {
  assert.notEqual(mutation,source);
  assert.throws(()=>compileOwnedCoreCellPolicy(mutation),/error:/);
 }
 assert.throws(()=>compileOwnedCoreMath(source),/error:/);
 assert.throws(()=>compileFreestandingCore(source),/error:/);
});
