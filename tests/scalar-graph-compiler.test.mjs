import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPackage} from '../src/build-package.mjs';
import {buildScalarGraph} from '../src/build-scalar-graph.node.mjs';
import {linkTrustedScalarGraph} from '../src/link-trusted-scalar-graph.node.mjs';
import {hashText} from '../src/scalar-dependency-plan.mjs';
const source='pub fnc main(): int { return cart() + tax(); }';
const compiler='a'.repeat(40);
async function provider(root,name,id,alias,value){
 const sourceFile=join(root,name+'.atto'),directory=join(root,name);
 await writeFile(sourceFile,'pub fnc value(): int { return '+value+'; }');
 const m=await buildPackage({sourceFile,outputDir:directory,declaredCompilerSha:compiler,schemaVersion:2});
 const opts={directory,target:'edge-js',expectedManifestSha256:hashText(await readFile(join(directory,'manifest.json'),'utf8')),expectedModuleSha256:m.moduleSha256,expectedSourceSha256:m.sourceSha256,expectedCompilerSha:compiler,expectedInterfaceSha256:m.interfaceSha256};
 return {build:{packageId:id,publicInterface:m.publicInterface,imports:[{alias,exportName:'value'}]},runtime:{packageId:id,options:opts}};
}
function pins(a,providers){const m=JSON.parse(a.manifestJson);return {artifact:a,expectedManifestSha256:hashText(a.manifestJson),expectedModuleSha256:m.moduleSha256,expectedDependencySha256:m.dependencySha256,providers};}
test('real Atto provider and consumer compilation; two independent providers, alias resolution, compatible edit',async()=>{
 const d=await mkdtemp(join(tmpdir(),'atto-compiled-graph-'));
 try{
   const a=await provider(d,'a','cart@1','cart',40),b=await provider(d,'b','tax@1','tax',2),a2=await provider(d,'a2','cart@1','cart',41);
   const artifact=buildScalarGraph({source,providers:[a.build,b.build]});
   assert.deepEqual(artifact,buildScalarGraph({source,providers:[b.build,a2.build]}));
   const old=await linkTrustedScalarGraph(pins(artifact,[a.runtime,b.runtime]));
   const next=await linkTrustedScalarGraph(pins(artifact,[b.runtime,a2.runtime]));
   assert.equal(old.main(),42n);assert.equal(next.main(),43n);assert.equal(old.main(),42n);
   assert.notEqual(a.runtime.options.expectedModuleSha256,a2.runtime.options.expectedModuleSha256);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('real frontend rejects unknown or ambiguous imports and wrong argument arity',()=>{
 const p={packageId:'cart@1',publicInterface:[{name:'value',params:[],resultType:'int'}],imports:[{alias:'cart',exportName:'value'}]};
 assert.throws(()=>buildScalarGraph({source:'pub fnc main(): int { return cart(1); }',providers:[p]}),/arity mismatch/);
 assert.throws(()=>buildScalarGraph({source,providers:[p]}),/unresolved identifier/);
 assert.throws(()=>buildScalarGraph({source,providers:[p,{...p,packageId:'tax@1'}]}),/ambiguous/);
 assert.throws(()=>buildScalarGraph({source,providers:[{...p,imports:[{alias:'cart',exportName:'missing'}]}]}),/unknown provider export/);
});
