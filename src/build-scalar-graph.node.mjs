// Compile-time only. Explicit aliases map scalar calls to provider slots.
// No provider bodies or runtime compiler dependency are emitted.
import {compileScalarConsumer} from './compiler.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';
import {canonicalDependencyPlan,verifyDependencyInterface,hashText} from './scalar-dependency-plan.mjs';
export function buildScalarGraph({source,providers}={}){
  if(typeof source!=='string'||source.length>262144||Buffer.byteLength(source)>262144||
     !Array.isArray(providers)||!providers.length||providers.length>32)throw Error('invalid graph build input');
  const entries=providers.map(p=>{
    const abi=scalarInterface(p.publicInterface,'edge-js');
    return {packageId:p.packageId,interfaceSha256:abi.sha256,imports:p.imports.map(i=>{
      const e=abi.entries.find(e=>e.name===i.exportName);
      if(!e)throw Error('unknown provider export');
      return {alias:i.alias,exportName:i.exportName,params:e.params};
    })};
  });
  const plan=canonicalDependencyPlan(entries);
  for(const d of plan.dependencies)verifyDependencyInterface(d,providers.find(p=>p.packageId===d.packageId).publicInterface);
  const external=plan.dependencies.flatMap(d=>d.imports.map(i=>({name:i.alias,params:i.params,resultType:'int'})));
  const compiled=compileScalarConsumer(source,external),abi=scalarInterface(compiled.publicInterface,'edge-js');
  const moduleSource='export const dependencySha256='+JSON.stringify(plan.sha256)+';\n'+compiled.moduleSource;
  const manifestJson=JSON.stringify({schemaVersion:2,target:'edge-js',sourceSha256:hashText(source),moduleSha256:hashText(moduleSource),
    dependencies:plan.dependencies,dependencySha256:plan.sha256,publicInterface:abi.entries,interfaceSha256:abi.sha256});
  if(Buffer.byteLength(moduleSource)>4194304||Buffer.byteLength(manifestJson)>65536)throw Error('graph artifact exceeds limit');
  return Object.freeze({manifestJson,moduleSource});
}
