import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HOST_ABI} from '../src/host-bridge.mjs';
import {scalarInterface} from '../src/scalar-package-interface.mjs';
import {canonicalDependencyPlan,hashText} from '../src/scalar-dependency-plan.mjs';
import {linkTrustedScalarGraph} from '../src/link-trusted-scalar-graph.node.mjs';
const sig={name:'value',params:[],resultType:'int'};
const iface=scalarInterface([sig],'edge-js');
const dep=(packageId,alias)=>({packageId,interfaceSha256:iface.sha256,imports:[{alias,exportName:'value',params:[]}]});
const deps=[dep('cart@1','cart'),dep('tax@1','tax')];
const abi=scalarInterface([{name:'main',params:[],resultType:'int'}],'edge-js');
function artifact(ds=deps){
 const plan=canonicalDependencyPlan(ds);
 const moduleSource=`export const dependencySha256=${JSON.stringify(plan.sha256)};export function bindProvider(b){const a=Object.create(null);a.main=()=>b[0]()+b[1]();return Object.freeze(a);}`;
 const manifestJson=JSON.stringify({schemaVersion:2,target:'edge-js',sourceSha256:'c'.repeat(64),moduleSha256:hashText(moduleSource),dependencies:plan.dependencies,dependencySha256:plan.sha256,publicInterface:abi.entries,interfaceSha256:abi.sha256});
 return {artifact:{moduleSource,manifestJson},expectedManifestSha256:hashText(manifestJson),expectedModuleSha256:hashText(moduleSource),expectedDependencySha256:plan.sha256};
}
async function provider(d,name,id,code){
 const directory=join(d,name);await mkdir(directory);
 const m={schemaVersion:2,backend:'javascript',target:'edge-js',hostABI:HOST_ABI,module:'module.mjs',declaredCompilerSha:'a'.repeat(40),sourceSha256:'b'.repeat(64),moduleSha256:hashText(code),publicEntrypoints:['value'],declaredCapabilities:[],provenanceNote:'Synthetic fixture',publicInterface:iface.entries,interfaceSha256:iface.sha256};
 const raw=JSON.stringify(m);await writeFile(join(directory,'manifest.json'),raw);await writeFile(join(directory,'module.mjs'),code);
 return {packageId:id,options:{directory,target:'edge-js',expectedManifestSha256:hashText(raw),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:m.declaredCompilerSha,expectedInterfaceSha256:iface.sha256}};
}
async function scratch(fn){const d=await mkdtemp(join(tmpdir(),'atto-graph-'));try{await fn(d);}finally{await rm(d,{recursive:true,force:true});}}
test('two same-named exports from distinct providers, stable consumer across updates',()=>scratch(async d=>{
 const a=await provider(d,'a','cart@1','export function value(){return 40n;}');
 const b=await provider(d,'b','tax@1','export function value(){return 2n;}');
 const a2=await provider(d,'a2','cart@1','export function value(){return 41n;}');
 const p=artifact();const old=await linkTrustedScalarGraph({...p,providers:[b,a]});const next=await linkTrustedScalarGraph({...p,providers:[a2,b]});
 assert.equal(old.main(),42n);assert.equal(next.main(),43n);assert.equal(old.main(),42n);
}));
test('dependency ordering canonical; identities and aliases keyed',()=>{
 assert.deepEqual(artifact(),artifact([...deps].reverse()));
 assert.notEqual(artifact().expectedDependencySha256,artifact([dep('cart@2','cart'),deps[1]]).expectedDependencySha256);
 assert.throws(()=>canonicalDependencyPlan([deps[0],deps[0]]),/duplicate/);
 assert.throws(()=>canonicalDependencyPlan([deps[0],dep('other','cart')]),/ambiguous/);
 assert.throws(()=>canonicalDependencyPlan([dep('a/../b','x')]),/invalid/);
});
test('missing, duplicate, extra and unknown provider slot denied',async()=>{
 const p=artifact();const a={packageId:'cart@1',options:{}};
 for(const providers of [[],[a],[a,a],[a,{packageId:'bad',options:{}}],[a,a,a]])await assert.rejects(linkTrustedScalarGraph({...p,providers}),/inventory|duplicate|identity/);
});
test('later tampered provider rejected before earlier provider evaluation',()=>scratch(async d=>{
 globalThis.graphEvaluations=0;
 try{const a=await provider(d,'a','cart@1','globalThis.graphEvaluations++;export function value(){return 40n;}');const b=await provider(d,'b','tax@1','export function value(){return 2n;}');await writeFile(join(b.options.directory,'module.mjs'),'export function value(){return 999n;}');await assert.rejects(linkTrustedScalarGraph({...artifact(),providers:[a,b]}),/module digest mismatch/);assert.equal(globalThis.graphEvaluations,0);}finally{delete globalThis.graphEvaluations;}
}));
test('wrong import signature denied even with rehashed dependency manifest',()=>scratch(async d=>{
 const a=await provider(d,'a','cart@1','export function value(){return 40n;}');const b=await provider(d,'b','tax@1','export function value(){return 2n;}');const wrong={...deps[0],imports:[{alias:'cart',exportName:'value',params:['x']}]};await assert.rejects(linkTrustedScalarGraph({...artifact([wrong,deps[1]]),providers:[a,b]}),/import signature mismatch/);
}));
test('consumer tampering rejected before providers accessed',async()=>{const p=artifact();await assert.rejects(linkTrustedScalarGraph({...p,artifact:{...p.artifact,moduleSource:p.artifact.moduleSource+'//tamper'},providers:[]}),/digest or size mismatch/);});
