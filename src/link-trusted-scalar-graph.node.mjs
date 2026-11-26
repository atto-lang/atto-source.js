// Runtime-only direct dependency linkage. Independently reviewed ESM only;
// no untrusted sandbox, transitive package initialization or unloading.
import {canonicalDependencyPlan,verifyDependencyInterface,hashText} from './scalar-dependency-plan.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';
import {readVerifiedPackage} from './package-admission.mjs';
import {invokeTrustedModule,encodeInt64,decodeInt64} from './host-bridge.mjs';
import {parseStrictJsonReport} from './parity-json-strict.mjs';
const SHA=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('E_SCALAR_GRAPH: '+m);};
const KEYS='dependencies,dependencySha256,interfaceSha256,moduleSha256,publicInterface,schemaVersion,sourceSha256,target';
async function importNamespace(base64){
  const specifier='data:text/javascript;base64,'+base64;
  const wrapper='export * as ns from '+JSON.stringify(specifier)+';';
  return (await import('data:text/javascript;base64,'+Buffer.from(wrapper,'utf8').toString('base64'))).ns;
}
export async function linkTrustedScalarGraph({artifact,expectedManifestSha256,expectedModuleSha256,expectedDependencySha256,providers}={}){
  for(const pin of [expectedManifestSha256,expectedModuleSha256,expectedDependencySha256])
    if(typeof pin!=='string'||!SHA.test(pin))fail('missing trusted digest');
  const {manifestJson,moduleSource}=artifact??{};
  if(typeof manifestJson!=='string'||manifestJson.length>65536||Buffer.byteLength(manifestJson)>65536||
     typeof moduleSource!=='string'||moduleSource.length>4194304||Buffer.byteLength(moduleSource)>4194304||
     hashText(manifestJson)!==expectedManifestSha256||hashText(moduleSource)!==expectedModuleSha256)fail('consumer digest or size mismatch');
  const m=parseStrictJsonReport(manifestJson,65536,'graph manifest');
  if(!m||Object.keys(m).sort().join(',')!==KEYS||m.schemaVersion!==2||m.target!=='edge-js'||
     m.moduleSha256!==expectedModuleSha256||m.dependencySha256!==expectedDependencySha256||
     typeof m.sourceSha256!=='string'||!SHA.test(m.sourceSha256))fail('consumer manifest mismatch');
  const plan=canonicalDependencyPlan(m.dependencies),abi=scalarInterface(m.publicInterface,'edge-js');
  if(plan.sha256!==expectedDependencySha256||JSON.stringify(plan.dependencies)!==JSON.stringify(m.dependencies)||
     abi.sha256!==m.interfaceSha256||JSON.stringify(abi.entries)!==JSON.stringify(m.publicInterface))fail('noncanonical consumer manifest');
  if(!Array.isArray(providers)||providers.length!==plan.dependencies.length)fail('provider inventory mismatch');
  const options=new Map();
  for(const p of providers){
    if(!p||Object.keys(p).sort().join(',')!=='options,packageId'||options.has(p.packageId)||!p.options)fail('duplicate or invalid provider');
    options.set(p.packageId,{...p.options});
  }
  // Snapshot and verify EVERY provider before importing any of them.
  const admitted=[];
  for(const d of plan.dependencies){
    const p=options.get(d.packageId);
    if(!p||p.target!=='edge-js'||p.expectedInterfaceSha256!==d.interfaceSha256)fail('provider identity or ABI pin mismatch');
    const v=await readVerifiedPackage(p);
    if(v.manifest.schemaVersion!==2)fail('legacy provider forbidden');
    verifyDependencyInterface(d,v.manifest.publicInterface);
    admitted.push({d,v});
  }
  const bindings=[];
  for(const {d,v} of admitted){
    const ns=await importNamespace(v.moduleBase64);
    const names=v.manifest.publicEntrypoints;
    if(JSON.stringify(Object.getOwnPropertyNames(ns).sort())!==JSON.stringify([...names].sort())||
       v.manifest.publicInterface.some(e=>typeof ns[e.name]!=='function'||ns[e.name].length!==e.params.length))fail('provider exports mismatch');
    for(const i of d.imports)bindings.push((...args)=>decodeInt64(invokeTrustedModule(ns,{entry:i.exportName,allowlist:names,args:args.map(encodeInt64)})));
  }
  const ns=await importNamespace(Buffer.from(moduleSource,'utf8').toString('base64'));
  if(Object.getOwnPropertyNames(ns).sort().join(',')!=='bindProvider,dependencySha256'||
     typeof ns.bindProvider!=='function'||ns.dependencySha256!==expectedDependencySha256)fail('consumer exports mismatch');
  const api=ns.bindProvider(Object.freeze(bindings));
  if(!api||Object.getPrototypeOf(api)!==null||!Object.isFrozen(api)||Reflect.ownKeys(api).length!==abi.entries.length||
     abi.entries.some(e=>{const v=Object.getOwnPropertyDescriptor(api,e.name);return !v||typeof v.value!=='function'||v.value.length!==e.params.length;}))fail('bound exports mismatch');
  return api;
}
