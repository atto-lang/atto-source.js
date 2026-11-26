import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPackage} from '../src/build-package.mjs';
import {buildScalarGraph} from '../src/build-scalar-graph.node.mjs';
import {buildCachedScalarGraph,scalarGraphCompilerClosureSha256} from '../src/build-cached-scalar-graph.node.mjs';
import {linkTrustedScalarGraph} from '../src/link-trusted-scalar-graph.node.mjs';
import {makeLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
import {hashText} from '../src/scalar-dependency-plan.mjs';
const master=Buffer.alloc(32,7),scope='tenant/graph',ledgerRecord=makeLedgerRecord(scope,1n,master),ledgerPin=createHash('sha256').update(ledgerRecord).digest();
const source='pub fnc main(): int { return cart(40); }';
async function provider(root,name,parameter,body){
 const sourceFile=join(root,name+'.atto'),directory=join(root,name),declaredCompilerSha='a'.repeat(40);
 await writeFile(sourceFile,'pub fnc value(int '+parameter+'): int { return '+body+'; }');
 const m=await buildPackage({sourceFile,outputDir:directory,declaredCompilerSha,schemaVersion:2});
 const raw=await readFile(join(directory,'manifest.json'),'utf8');
 return {build:{packageId:'cart@1',publicInterface:m.publicInterface,imports:[{alias:'cart',exportName:'value'}]},runtime:{packageId:'cart@1',options:{directory,target:'edge-js',expectedManifestSha256:hashText(raw),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:declaredCompilerSha,expectedInterfaceSha256:m.interfaceSha256}}};
}
async function link(artifact,p){
 const m=JSON.parse(artifact.manifestJson);
 return linkTrustedScalarGraph({artifact,expectedManifestSha256:hashText(artifact.manifestJson),expectedModuleSha256:m.moduleSha256,expectedDependencySha256:m.dependencySha256,providers:[p.runtime]});
}
test('actual compiler persistent consumer artifact survives compatible provider replacement but not ABI drift',async()=>{
 const d=await mkdtemp(join(tmpdir(),'atto-cached-graph-'));
 try{
  const root=join(d,'cache');await mkdir(root,{mode:0o700});
  const a=await provider(d,'a','x','x + 2'),b=await provider(d,'b','x','x + 3'),c=await provider(d,'c','y','y + 4');
  const opts={root,source,owner:'shop@1',unit:'shop.main',scope,master,ledgerRecord,ledgerPin,expectedCompilerSha256:scalarGraphCompilerClosureSha256()};
  const first=buildCachedScalarGraph({...opts,providers:[a.build]});
  assert.deepEqual([first.emitted,first.reused,first.retained],[1,0,true]);
  assert.deepEqual(first.artifact,buildScalarGraph({source,providers:[a.build]}));
  const warm=buildCachedScalarGraph({...opts,providers:[b.build]});
  assert.deepEqual([warm.emitted,warm.reused],[0,1]);assert.equal(warm.key,first.key);assert.deepEqual(warm.artifact,first.artifact);
  const old=await link(first.artifact,a),next=await link(warm.artifact,b);
  assert.equal(old.main(),42n);assert.equal(next.main(),43n);assert.equal(old.main(),42n);
  const changed=buildCachedScalarGraph({...opts,providers:[c.build]});
  assert.notEqual(changed.key,first.key);assert.equal(changed.emitted,1);assert.equal((await link(changed.artifact,c)).main(),44n);
  const file=join(root,'slot-'+changed.key[0]),before=await readFile(file);
  assert.throws(()=>buildCachedScalarGraph({...opts,source:source.replace('cart(40)','cart()'),providers:[c.build]}),/arity mismatch/);
  assert.deepEqual(await readFile(file),before);
  assert.throws(()=>buildCachedScalarGraph({...opts,providers:[c.build],expectedCompilerSha256:'0'.repeat(64)}),/E_CACHE_COMPILER/);
 }finally{await rm(d,{recursive:true,force:true});}
});
