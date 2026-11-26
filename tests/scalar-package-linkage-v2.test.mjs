import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildPackage} from '../src/build-package.mjs';
import {readVerifiedPackage} from '../src/package-admission.mjs';
import {loadTrustedNodePackage} from '../src/load-trusted-package.node.mjs';
const SHA='a'.repeat(40);
const hash=b=>createHash('sha256').update(b).digest('hex');
async function scratch(fn){
  const dir=await mkdtemp(join(tmpdir(),'atto-linkage-'));
  try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
async function build(dir,name,code,schemaVersion=2){
  const sourceFile=join(dir,name+'.atto'),outputDir=join(dir,name);
  await writeFile(sourceFile,code);
  const m=await buildPackage({sourceFile,outputDir,declaredCompilerSha:SHA,schemaVersion});
  const expect={directory:outputDir,target:'edge-js',expectedManifestSha256:hash(await readFile(join(outputDir,'manifest.json'))),
    expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:SHA};
  if(schemaVersion===2)expect.expectedInterfaceSha256=m.interfaceSha256;
  return {m,expect};
}
test('actual compiler produces distinct compatible ESM packages, both execute',()=>scratch(async dir=>{
  const a=await build(dir,'a','pub fnc main(): int { return 42; }');
  const b=await build(dir,'b','pub fnc main(): int { return 43; }');
  assert.equal(a.m.interfaceSha256,b.m.interfaceSha256);
  assert.notEqual(a.m.moduleSha256,b.m.moduleSha256);
  const old=await loadTrustedNodePackage(a.expect);
  const next=await loadTrustedNodePackage({...b.expect,expectedInterfaceSha256:a.m.interfaceSha256});
  assert.deepEqual(old.invoke('main',[]),{type:'int64',value:'42'});
  assert.deepEqual(next.invoke('main',[]),{type:'int64',value:'43'});
  assert.deepEqual(old.invoke('main',[]),{type:'int64',value:'42'});
}));
test('public arity and named parameter changes invalidate, declaration reorder does not',()=>scratch(async dir=>{
  const a=await build(dir,'a','pub fnc f(int x): int { return x; } pub fnc g(): int { return 42; }');
  const b=await build(dir,'b','pub fnc g(): int { return 42; } pub fnc f(int x): int { return x; }');
  const c=await build(dir,'c','pub fnc f(int y): int { return y; } pub fnc g(): int { return 42; }');
  const d=await build(dir,'d','pub fnc f(): int { return 42; } pub fnc g(): int { return 42; }');
  assert.equal(a.m.interfaceSha256,b.m.interfaceSha256);
  for(const changed of [c,d]){
    assert.notEqual(a.m.interfaceSha256,changed.m.interfaceSha256);
    await assert.rejects(loadTrustedNodePackage({...changed.expect,expectedInterfaceSha256:a.m.interfaceSha256}),/interface incompatible/);
  }
}));
test('v2 digest required, v1 cannot satisfy v2 expectation',()=>scratch(async dir=>{
  const a=await build(dir,'a','pub fnc main(): int { return 42; }');
  const b=await build(dir,'b','pub fnc main(): int { return 42; }',1);
  await assert.rejects(readVerifiedPackage({...a.expect,expectedInterfaceSha256:undefined}),/interface digest/);
  await assert.rejects(readVerifiedPackage({...b.expect,expectedInterfaceSha256:a.m.interfaceSha256}),/legacy package/);
  assert.deepEqual((await loadTrustedNodePackage(b.expect)).invoke('main',[]),{type:'int64',value:'42'});
}));
test('loader-sensitive then and init exports rejected before package publication',()=>scratch(async dir=>{
  for(const name of ['then','init']){
    const sourceFile=join(dir,name+'.atto'),outputDir=join(dir,name);
    await writeFile(sourceFile,'pub fnc '+name+'(): int { return 42; }');
    await assert.rejects(buildPackage({sourceFile,outputDir,declaredCompilerSha:SHA,schemaVersion:2}));
    await assert.rejects(lstat(outputDir),{code:'ENOENT'});
  }
}));
test('forged rehashed interface metadata cannot override trusted expectation',()=>scratch(async dir=>{
  const a=await build(dir,'a','pub fnc f(int x): int { return x; }');
  const path=join(a.expect.directory,'manifest.json');
  const m=JSON.parse(await readFile(path,'utf8'));
  m.publicInterface[0].params=['different'];
  await writeFile(path,JSON.stringify(m));
  await assert.rejects(readVerifiedPackage({...a.expect,expectedManifestSha256:hash(await readFile(path))}),/invalid scalar package interface/);
}));
test('verified signature arrays are immutable',()=>scratch(async dir=>{
  const a=await build(dir,'a','pub fnc f(int x): int { return x; }');
  const {manifest}=await readVerifiedPackage(a.expect);
  assert.ok(Object.isFrozen(manifest.publicInterface));
  assert.ok(Object.isFrozen(manifest.publicInterface[0]));
  assert.ok(Object.isFrozen(manifest.publicInterface[0].params));
}));
