import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPackage} from '../src/build-package.mjs';
import {buildScalarGraph} from '../src/build-scalar-graph.node.mjs';
import {linkTrustedScalarClosure} from '../src/link-trusted-scalar-closure.node.mjs';
import {resolveScalarClosure} from '../src/scalar-transitive-plan.mjs';
import {hashText} from '../src/scalar-dependency-plan.mjs';
const compiler='a'.repeat(40);
async function leaf(root,name,value){
 const sourceFile=join(root,name+'.atto'),directory=join(root,name);
 await writeFile(sourceFile,'pub fnc value(): int { return '+value+'; }');
 const m=await buildPackage({sourceFile,outputDir:directory,declaredCompilerSha:compiler,schemaVersion:2});
 const raw=await readFile(join(directory,'manifest.json'),'utf8');
 const options={directory,target:'edge-js',expectedManifestSha256:hashText(raw),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:compiler,expectedInterfaceSha256:m.interfaceSha256};
 return {record:{packageId:'shared',kind:'leaf',options},meta:{packageId:'shared',manifestSha256:hashText(raw),moduleSha256:m.moduleSha256,publicInterface:m.publicInterface,dependencies:[]}};
}
function build(packageId,source,providers){
 const artifact=buildScalarGraph({source,providers:providers.map(([p,alias])=>({packageId:p.meta.packageId,publicInterface:p.meta.publicInterface,imports:[{alias,exportName:'value'}]}))});
 const m=JSON.parse(artifact.manifestJson);
 return {record:{packageId,kind:'consumer',artifact,expectedManifestSha256:hashText(artifact.manifestJson),expectedModuleSha256:m.moduleSha256,expectedDependencySha256:m.dependencySha256},meta:{packageId,manifestSha256:hashText(artifact.manifestJson),moduleSha256:m.moduleSha256,publicInterface:m.publicInterface,dependencies:m.dependencies}};
}
function graph(shared){
 const left=build('left','pub fnc value(): int { return shared_value() + 1; }',[[shared,'shared_value']]);
 const right=build('right','pub fnc value(): int { return shared_value() + 1; }',[[shared,'shared_value']]);
 const app=build('app','pub fnc value(): int { return left_value() + right_value(); }',[[left,'left_value'],[right,'right_value']]);
 return [app,left,right,shared];
}
function release(nodes){
 const plan=resolveScalarClosure('app',nodes.map(n=>n.meta));
 assert.deepEqual(plan.order,['shared','left','right','app']);
 return {root:'app',packages:nodes.map(n=>n.record),expectedLockSha256:plan.lockSha256};
}
test('real Atto compiler independently emits four diamond packages; compatible leaf update reuses intermediate artifacts',async()=>{
 const d=await mkdtemp(join(tmpdir(),'atto-compiled-closure-'));
 try{
  const a=await leaf(d,'a',20),b=await leaf(d,'b',21);
  const oldGraph=graph(a),nextGraph=graph(b);
  assert.deepEqual(oldGraph.slice(0,3),nextGraph.slice(0,3));
  const oldRelease=release(oldGraph),nextRelease=release(nextGraph);
  assert.notEqual(oldRelease.expectedLockSha256,nextRelease.expectedLockSha256);
  const old=await linkTrustedScalarClosure(oldRelease);
  const next=await linkTrustedScalarClosure(nextRelease);
  assert.equal(old.value(),42n);assert.equal(next.value(),44n);assert.equal(old.value(),42n);
  await assert.rejects(linkTrustedScalarClosure({...nextRelease,expectedLockSha256:oldRelease.expectedLockSha256}),/release lock mismatch/);
 }finally{await rm(d,{recursive:true,force:true});}
});
