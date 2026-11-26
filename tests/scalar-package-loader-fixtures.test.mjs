import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HOST_ABI} from '../src/host-bridge.mjs';
import {scalarInterface} from '../src/scalar-package-interface.mjs';
import {readVerifiedPackage} from '../src/package-admission.mjs';
import {loadTrustedNodePackage} from '../src/load-trusted-package.node.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const signature={name:'main',params:[],resultType:'int'};
async function fixture(fn,{code='export function main(){return 42n;}',version=2,entries=[signature]}={}){
 const directory=await mkdtemp(join(tmpdir(),'atto-abi-admission-'));
 try {
  const abi=scalarInterface(entries,'edge-js');
  const m={schemaVersion:version,backend:'javascript',target:'edge-js',hostABI:HOST_ABI,module:'module.mjs',declaredCompilerSha:'a'.repeat(40),sourceSha256:'b'.repeat(64),moduleSha256:hash(code),publicEntrypoints:entries.map(e=>e.name),declaredCapabilities:[],provenanceNote:'Test-owned fixture, not compiler output'};
  if(version===2){m.publicInterface=abi.entries;m.interfaceSha256=abi.sha256;}
  const mf=join(directory,'manifest.json'),mod=join(directory,'module.mjs');
  await writeFile(mod,code);await writeFile(mf,JSON.stringify(m));
  const expect={directory,target:'edge-js',expectedManifestSha256:hash(await readFile(mf)),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:m.declaredCompilerSha};
  if(version===2)expect.expectedInterfaceSha256=abi.sha256;
  await fn({expect,m,mf,mod,directory});
 } finally { await rm(directory,{recursive:true,force:true}); }
}
test('valid v2 module actually executes',()=>fixture(async({expect})=>{const l=await loadTrustedNodePackage(expect);assert.deepEqual(l.invoke('main',[]),{type:'int64',value:'42'});}));
test('body-only replacement admits new version and old handle stays usable',()=>fixture(async({expect:a})=>fixture(async({expect:b})=>{assert.equal(a.expectedInterfaceSha256,b.expectedInterfaceSha256);const old=await loadTrustedNodePackage(a),next=await loadTrustedNodePackage({...b,expectedInterfaceSha256:a.expectedInterfaceSha256});assert.equal(old.invoke('main',[]).value,'42');assert.equal(next.invoke('main',[]).value,'43');assert.equal(old.invoke('main',[]).value,'42');},{code:'export function main(){return 43n;}'})));
test('wrong interface and missing interface denied',()=>fixture(async({expect})=>{await assert.rejects(loadTrustedNodePackage({...expect,expectedInterfaceSha256:'0'.repeat(64)}),/interface incompatible/);await assert.rejects(loadTrustedNodePackage({...expect,expectedInterfaceSha256:undefined}),/interface digest/);}));
test('legacy v1 cannot satisfy v2 pin but remains usable',()=>fixture(async({expect})=>{await assert.rejects(loadTrustedNodePackage({...expect,expectedInterfaceSha256:'0'.repeat(64)}),/legacy package/);assert.equal((await loadTrustedNodePackage(expect)).invoke('main',[]).value,'42');},{version:1}));
test('module tampering denied',()=>fixture(async({expect,mod})=>{await writeFile(mod,'export function main(){return 99n;}');await assert.rejects(loadTrustedNodePackage(expect),/module digest mismatch/);}));
test('rehashed inconsistent signature denied',()=>fixture(async({expect,m,mf})=>{const forged=JSON.parse(JSON.stringify(m));forged.publicInterface[0].params=['x'];const raw=JSON.stringify(forged);await writeFile(mf,raw);await assert.rejects(loadTrustedNodePackage({...expect,expectedManifestSha256:hash(raw)}),/invalid scalar package interface/);}));
test('arity mismatch denied',()=>fixture(async({expect})=>{await assert.rejects(loadTrustedNodePackage(expect),/arity differs/);},{code:'export function main(x){return x;}'}));
test('duplicate JSON field denied even with updated trust hash',()=>fixture(async({expect,m,mf})=>{const raw=JSON.stringify(m).replace('{','{"target":"browser",');await writeFile(mf,raw);await assert.rejects(loadTrustedNodePackage({...expect,expectedManifestSha256:hash(raw)}),/invalid package JSON/);}));
test('snapshot cannot be altered through signature references',()=>fixture(async({expect})=>{const {manifest}=await readVerifiedPackage(expect);assert.ok(Object.isFrozen(manifest.publicInterface));assert.ok(Object.isFrozen(manifest.publicInterface[0]));assert.ok(Object.isFrozen(manifest.publicInterface[0].params));}));
test('unexpected export then must not be invoked by loader even for pinned mismatched fixture',()=>fixture(async({expect})=>{globalThis.__attoLinkageThenCalls=0;try{await assert.rejects(loadTrustedNodePackage(expect),/exports do not match/);assert.equal(globalThis.__attoLinkageThenCalls,0);}finally{delete globalThis.__attoLinkageThenCalls;}},{code:'export function main(){return 42n;} export function then(resolve){globalThis.__attoLinkageThenCalls++; resolve({main});}'}));
