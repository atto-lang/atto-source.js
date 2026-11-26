import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {HOST_ABI} from '../src/host-bridge.mjs';
import {scalarInterface} from '../src/scalar-package-interface.mjs';
import {linkTrustedScalarConsumer} from '../src/link-trusted-scalar-consumer.node.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sig={name:'answer',params:['x'],resultType:'int'};
const main={name:'main',params:['x'],resultType:'int'};
const abi=scalarInterface([sig],'edge-js');
const consumer=scalarInterface([main],'edge-js');
async function provider(dir,name,code,entries=[sig]){
 const directory=join(dir,name);await mkdir(directory);
 const i=scalarInterface(entries,'edge-js');
 const manifest={schemaVersion:2,backend:'javascript',target:'edge-js',hostABI:HOST_ABI,module:'module.mjs',declaredCompilerSha:'a'.repeat(40),sourceSha256:'b'.repeat(64),moduleSha256:hash(code),publicEntrypoints:i.entries.map(e=>e.name),declaredCapabilities:[],provenanceNote:'Synthetic ESM fixture; not compiler output',publicInterface:i.entries,interfaceSha256:i.sha256};
 const raw=JSON.stringify(manifest);
 await writeFile(join(directory,'manifest.json'),raw);await writeFile(join(directory,'module.mjs'),code);
 return {directory,target:'edge-js',expectedManifestSha256:hash(raw),expectedModuleSha256:manifest.moduleSha256,expectedSourceSha256:manifest.sourceSha256,expectedCompilerSha:manifest.declaredCompilerSha,expectedInterfaceSha256:i.sha256};
}
const factory=`export const providerInterfaceSha256=${JSON.stringify(abi.sha256)};
export function bindProvider(b){const answer=b[0];const api=Object.create(null);api.main=x=>answer(x);return Object.freeze(api);}`;
function pin(providerOptions,moduleSource=factory,edit=m=>m){
 const m=edit({schemaVersion:1,target:'edge-js',sourceSha256:'c'.repeat(64),moduleSha256:hash(moduleSource),providerInterfaceSha256:abi.sha256,publicInterface:consumer.entries,interfaceSha256:consumer.sha256});
 const manifestJson=JSON.stringify(m);
 return {artifact:{moduleSource,manifestJson},expectedManifestSha256:hash(manifestJson),expectedModuleSha256:hash(moduleSource),expectedProviderInterfaceSha256:abi.sha256,providerOptions};
}
async function scratch(fn){const d=await mkdtemp(join(tmpdir(),'atto-consumer-runtime-'));try{await fn(d);}finally{await rm(d,{recursive:true,force:true});}}
test('same precompiled consumer binds two compatible provider versions independently',()=>scratch(async d=>{
 const a=await provider(d,'a','export function answer(x){return x+2n;}');
 const b=await provider(d,'b','export function answer(x){return x+3n;}');
 const old=await linkTrustedScalarConsumer(pin(a));const next=await linkTrustedScalarConsumer(pin(b));
 assert.equal(old.main(40n),42n);assert.equal(next.main(40n),43n);assert.equal(old.main(40n),42n);
 assert.ok(Object.isFrozen(old));assert.equal(Object.getPrototypeOf(old),null);
 assert.throws(()=>old.main(40),/signed int64 BigInt/);
}));
test('consumer digest tampering rejected before nonexistent provider access',async()=>{
 const p=pin({directory:'/does-not-exist'});
 await assert.rejects(linkTrustedScalarConsumer({...p,artifact:{...p.artifact,moduleSource:factory+'//tamper'}}),/consumer digest mismatch/);
 await assert.rejects(linkTrustedScalarConsumer({...p,artifact:{...p.artifact,manifestJson:p.artifact.manifestJson+' '}}),/consumer digest mismatch/);
});
test('provider ABI incompatibility denied before consumer code executes',()=>scratch(async d=>{
 const p=await provider(d,'p','export function answer(){return 42n;}',[{...sig,params:[]}]);
 globalThis.__attoConsumerRan=0;
 try {const candidate='globalThis.__attoConsumerRan++;\n'+factory;
  await assert.rejects(linkTrustedScalarConsumer(pin(p,candidate)),/provider interface pin mismatch/);
  await assert.rejects(linkTrustedScalarConsumer(pin({...p,expectedInterfaceSha256:abi.sha256},candidate)),/interface incompatible/);
  assert.equal(globalThis.__attoConsumerRan,0);
 }finally{delete globalThis.__attoConsumerRan;}
}));
test('consumer with rehashed wrong public interface rejected',async()=>{
 await assert.rejects(linkTrustedScalarConsumer(pin({},factory,m=>({...m,publicInterface:[{...main,params:[]}]}))),/invalid consumer interface/);
});
test('provider bytes tampered after review denied',()=>scratch(async d=>{
 const p=await provider(d,'p','export function answer(x){return x+2n;}');
 await writeFile(join(p.directory,'module.mjs'),'export function answer(x){return 99n;}');
 await assert.rejects(linkTrustedScalarConsumer(pin(p)),/module digest mismatch/);
}));
test('factory with unexpected then export rejected without assimilation',()=>scratch(async d=>{
 const p=await provider(d,'p','export function answer(x){return x+2n;}');
 globalThis.__attoConsumerThen=0;
 try {await assert.rejects(linkTrustedScalarConsumer(pin(p,factory+'\nexport function then(r){globalThis.__attoConsumerThen++;r({bindProvider});}')),/consumer module interface mismatch/);
  assert.equal(globalThis.__attoConsumerThen,0);
 }finally{delete globalThis.__attoConsumerThen;}
}));
test('factory output missing required export is denied',()=>scratch(async d=>{
 const p=await provider(d,'p','export function answer(x){return x+2n;}');
 const bad=`export const providerInterfaceSha256=${JSON.stringify(abi.sha256)};export function bindProvider(){return Object.freeze(Object.create(null));}`;
 await assert.rejects(linkTrustedScalarConsumer(pin(p,bad)),/bound consumer exports mismatch/);
}));
