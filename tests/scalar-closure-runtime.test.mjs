import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HOST_ABI} from '../src/host-bridge.mjs';
import {scalarInterface} from '../src/scalar-package-interface.mjs';
import {canonicalDependencyPlan,hashText} from '../src/scalar-dependency-plan.mjs';
import {resolveScalarClosure} from '../src/scalar-transitive-plan.mjs';
import {linkTrustedScalarClosure} from '../src/link-trusted-scalar-closure.node.mjs';
const abi=scalarInterface([{name:'value',params:[],resultType:'int'}],'edge-js');
const dep=(packageId,alias='value')=>({packageId,interfaceSha256:abi.sha256,imports:[{alias,exportName:'value',params:[]}]});
async function leaf(dir,name,code){
 const directory=join(dir,name);await mkdir(directory);
 const m={schemaVersion:2,backend:'javascript',target:'edge-js',hostABI:HOST_ABI,module:'module.mjs',declaredCompilerSha:'a'.repeat(40),sourceSha256:'b'.repeat(64),moduleSha256:hashText(code),publicEntrypoints:['value'],declaredCapabilities:[],provenanceNote:'synthetic fixture',publicInterface:abi.entries,interfaceSha256:abi.sha256};
 const raw=JSON.stringify(m);await writeFile(join(directory,'manifest.json'),raw);await writeFile(join(directory,'module.mjs'),code);
 const options={directory,target:'edge-js',expectedManifestSha256:hashText(raw),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:m.declaredCompilerSha,expectedInterfaceSha256:abi.sha256};
 return {record:{packageId:'shared',kind:'leaf',options},meta:{packageId:'shared',manifestSha256:hashText(raw),moduleSha256:m.moduleSha256,publicInterface:abi.entries,dependencies:[]}};
}
function consumer(packageId,deps,expr){
 const p=canonicalDependencyPlan(deps);
 const moduleSource=`export const dependencySha256=${JSON.stringify(p.sha256)};export function bindProvider(b){const a=Object.create(null);a.value=()=>${expr};return Object.freeze(a);}`;
 const m={schemaVersion:2,target:'edge-js',sourceSha256:'c'.repeat(64),moduleSha256:hashText(moduleSource),dependencies:p.dependencies,dependencySha256:p.sha256,publicInterface:abi.entries,interfaceSha256:abi.sha256};
 const manifestJson=JSON.stringify(m);
 return {record:{packageId,kind:'consumer',artifact:{manifestJson,moduleSource},expectedManifestSha256:hashText(manifestJson),expectedModuleSha256:m.moduleSha256,expectedDependencySha256:p.sha256},meta:{packageId,manifestSha256:hashText(manifestJson),moduleSha256:m.moduleSha256,publicInterface:abi.entries,dependencies:p.dependencies}};
}
function graph(shared){return [consumer('app',[dep('left','left'),dep('right','right')],'b[0]()+b[1]()'),consumer('left',[dep('shared')],'b[0]()+1n'),consumer('right',[dep('shared')],'b[0]()+1n'),shared];}
function pins(nodes){return {root:'app',packages:nodes.map(n=>n.record),expectedLockSha256:resolveScalarClosure('app',nodes.map(n=>n.meta)).lockSha256};}
async function scratch(fn){const d=await mkdtemp(join(tmpdir(),'atto-closure-'));try{await fn(d);}finally{await rm(d,{recursive:true,force:true});}}
test('transitive diamond binds shared leaf once and compatible update keeps old binding',()=>scratch(async d=>{
 const a=await leaf(d,'old','export function value(){return 20n;}'),b=await leaf(d,'new','export function value(){return 21n;}');
 const p=pins(graph(a)),q=pins(graph(b));
 assert.notEqual(p.expectedLockSha256,q.expectedLockSha256);assert.deepEqual(p.packages.slice(0,3),q.packages.slice(0,3));
 const old=await linkTrustedScalarClosure(p),next=await linkTrustedScalarClosure({...q,packages:[...q.packages].reverse()});
 assert.equal(old.value(),42n);assert.equal(next.value(),44n);assert.equal(old.value(),42n);
 assert.throws(()=>old.value(1n),/arity/);
}));
test('tampered transitive leaf and wrong release lock denied before any evaluation',()=>scratch(async d=>{
 globalThis.closureEvaluations=0;
 try{const a=await leaf(d,'a','globalThis.closureEvaluations++;export function value(){return 20n;}');const p=pins(graph(a));
 await assert.rejects(linkTrustedScalarClosure({...p,expectedLockSha256:'f'.repeat(64)}),/lock mismatch/);assert.equal(globalThis.closureEvaluations,0);
 await writeFile(join(a.record.options.directory,'module.mjs'),'export function value(){return 99n;}');
 await assert.rejects(linkTrustedScalarClosure(p),/module digest mismatch/);assert.equal(globalThis.closureEvaluations,0);
 }finally{delete globalThis.closureEvaluations;}
}));
test('cycles, missing nodes and unreachable nodes rejected before evaluation',async()=>{
 const a=consumer('app',[dep('app')],'b[0]()');
 await assert.rejects(linkTrustedScalarClosure({root:'app',packages:[a.record],expectedLockSha256:'f'.repeat(64)}),/cycle/);
 const b=consumer('app',[dep('missing')],'b[0]()');
 await assert.rejects(linkTrustedScalarClosure({root:'app',packages:[b.record],expectedLockSha256:'f'.repeat(64)}),/missing dependency/);
});
test('duplicate nodes and altered consumer bytes rejected',()=>scratch(async d=>{
 const a=await leaf(d,'a','export function value(){return 20n;}');const p=pins(graph(a));
 await assert.rejects(linkTrustedScalarClosure({...p,packages:[...p.packages,p.packages[0]]}),/duplicate/);
 const c=p.packages[0];await assert.rejects(linkTrustedScalarClosure({...p,packages:[{...c,artifact:{...c.artifact,moduleSource:c.artifact.moduleSource+'//tamper'}},...p.packages.slice(1)]}),/digest or size mismatch/);
}));
