import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPackage} from '../src/build-package.mjs';
import {compile,compileScalarConsumer} from '../src/compiler.mjs';
import {buildScalarConsumer,linkTrustedScalarConsumer} from '../src/scalar-consumer-link.node.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const source='pub fnc main(): int { return answer(40); }';
const compiler='a'.repeat(40);
async function scratch(fn){
 const dir=await mkdtemp(join(tmpdir(),'atto-separate-consumer-'));
 try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
async function provider(dir,name,source){
 const sourceFile=join(dir,name+'.atto'),directory=join(dir,name);
 await writeFile(sourceFile,source);
 const manifest=await buildPackage({sourceFile,outputDir:directory,declaredCompilerSha:compiler,schemaVersion:2});
 const options={directory,target:'edge-js',expectedManifestSha256:hash(await readFile(join(directory,'manifest.json'))),
   expectedModuleSha256:manifest.moduleSha256,expectedSourceSha256:manifest.sourceSha256,expectedCompilerSha:compiler,
   expectedInterfaceSha256:manifest.interfaceSha256};
 return {manifest,options};
}
function pin(artifact,providerOptions){
 const m=JSON.parse(artifact.manifestJson);
 return {artifact,expectedManifestSha256:hash(artifact.manifestJson),expectedModuleSha256:m.moduleSha256,
   expectedProviderInterfaceSha256:m.providerInterfaceSha256,providerOptions};
}
const v1='pub fnc answer(int x): int { return x + 2; }';
const v2='pub fnc answer(int x): int { return x + 3; }';
test('actual independent .atto provider and consumer compile; body-only replacement needs no consumer rebuild',()=>scratch(async dir=>{
 const a=await provider(dir,'a',v1),b=await provider(dir,'b',v2);
 assert.notEqual(a.manifest.moduleSha256,b.manifest.moduleSha256);
 assert.equal(a.manifest.interfaceSha256,b.manifest.interfaceSha256);
 const consumer=buildScalarConsumer({source,providerInterface:a.manifest.publicInterface});
 assert.deepEqual(consumer,buildScalarConsumer({source,providerInterface:b.manifest.publicInterface}));
 const before=hash(consumer.moduleSource);
 const old=await linkTrustedScalarConsumer(pin(consumer,a.options));
 const next=await linkTrustedScalarConsumer(pin(consumer,b.options));
 assert.equal(old.main(),42n);
 assert.equal(next.main(),43n);
 assert.equal(old.main(),42n);
 assert.equal(hash(consumer.moduleSource),before);
 assert.ok(Object.isFrozen(old));
 assert.equal(Object.getPrototypeOf(old),null);
}));
test('provider ABI change rejected before consumer binding',()=>scratch(async dir=>{
 const a=await provider(dir,'a',v1),b=await provider(dir,'b','pub fnc answer(): int { return 42; }');
 const consumer=buildScalarConsumer({source,providerInterface:a.manifest.publicInterface});
 await assert.rejects(linkTrustedScalarConsumer(pin(consumer,b.options)),/provider interface pin mismatch/);
 await assert.rejects(linkTrustedScalarConsumer(pin(consumer,{...b.options,expectedInterfaceSha256:a.manifest.interfaceSha256})),/interface incompatible/);
}));
test('wrong arity, unknown symbols and collisions rejected by real frontend/IR',()=>{
 const abi=[{name:'answer',params:['x'],resultType:'int'}];
 for(const invalid of [
  'pub fnc main(): int { return answer(); }',
  'pub fnc main(): int { return missing(40); }',
  'fnc answer(int x): int { return x; } pub fnc main(): int { return answer(40); }'
 ])assert.throws(()=>buildScalarConsumer({source:invalid,providerInterface:abi}),/arity mismatch|unresolved identifier|duplicate function/);
 assert.throws(()=>compile(source),/unresolved identifier/);
 assert.throws(()=>compileScalarConsumer(source,[]),/invalid scalar provider interface/);
});
test('tampered consumer bytes and metadata denied before provider access',()=>{
 const abi=[{name:'answer',params:['x'],resultType:'int'}];
 const a=buildScalarConsumer({source,providerInterface:abi});
 const pinned=pin(a,{directory:'/does-not-exist',target:'edge-js',expectedInterfaceSha256:JSON.parse(a.manifestJson).providerInterfaceSha256});
 return Promise.all([
   assert.rejects(linkTrustedScalarConsumer({...pinned,artifact:{...a,moduleSource:a.moduleSource+'\n// mutation'}}),/consumer digest mismatch/),
   assert.rejects(linkTrustedScalarConsumer({...pinned,artifact:{...a,manifestJson:a.manifestJson+' '}}),/consumer digest mismatch/)
 ]);
});
test('provider tampering rejected; consumer external arguments checked',()=>scratch(async dir=>{
 const a=await provider(dir,'a',v1);
 const artifact=buildScalarConsumer({source:'pub fnc main(int x): int { return answer(x); }',providerInterface:a.manifest.publicInterface});
 const bound=await linkTrustedScalarConsumer(pin(artifact,a.options));
 assert.equal(bound.main(40n),42n);
 assert.throws(()=>bound.main(40),/signed i64 BigInt/);
 assert.throws(()=>bound.main(1n<<63n),/signed i64 BigInt/);
 await writeFile(join(a.options.directory,'module.mjs'),'export function answer(x){return 999n;}');
 await assert.rejects(linkTrustedScalarConsumer(pin(artifact,a.options)),/module digest mismatch/);
}));
test('provider signature order is canonical, renamed parameters invalidate',()=>{
 const a={name:'answer',params:['x'],resultType:'int'},b={name:'tax',params:[],resultType:'int'};
 const one=buildScalarConsumer({source,providerInterface:[a,b]});
 assert.deepEqual(one,buildScalarConsumer({source,providerInterface:[b,a]}));
 const changed=buildScalarConsumer({source,providerInterface:[{...a,params:['y']},b]});
 assert.notEqual(one.moduleSource,changed.moduleSource);
});
