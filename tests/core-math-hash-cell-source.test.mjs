import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileOwnedCoreMath,compileFreestandingCore} from '../src/freestanding-core.mjs';
const SHA={
  "math": "aec5ab486e1103be07872886de0a6df7b7897d8c",
  "hash": "1f836230d8d976ab0a70c918c6fa48b8731bbc13",
  "cell": "793677194d81a0aa1347ad6737b78ac507b078af"
};
const gitBlob=bytes=>createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\\0'))
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
   assert.ok(!source.includes('\\0')&&!source.startsWith('\\uFEFF'));
   assert.match(source,new RegExp('define module '+name+' as'));
   assert.doesNotMatch(source,/java:|dotnet:|import module/);
 }
});
test('actual pure math .atto transpiles into checked ES module and executes',async()=>{
 const source=await load('math');
 const esm=compileOwnedCoreMath(source.toString('utf8'));
 assert.doesNotMatch(esm,/\\b(?:process|require|fetch|eval|Worker|window|document)\\b/);
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
 assert.equal(math.contains_closed_int(5n,1n,5n),true);
 assert.equal(math.contains_closed_int(6n,1n,5n),false);
 assert.equal(math.contains_closed_int(5n,8n,4n),false);
 assert.throws(()=>math.min_int(1n,2),/BigInt/);
 assert.throws(()=>math.max_int(1n<<63n,1n),/OVERFLOW/);
});
test('new math compilation gate does not widen core or admit hash/host modules',async()=>{
 const math=(await load('math')).toString('utf8');
 for(const source of [
  math.replace('define module math','define module hash'),
  'import module fs from "std/fs"; '+math,
  'define module math as pub fnc x(): int { return process.exit(0); } end'
 ]) assert.throws(()=>compileOwnedCoreMath(source),/error:/);
 assert.throws(()=>compileFreestandingCore(math),/requires one core module/);
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
