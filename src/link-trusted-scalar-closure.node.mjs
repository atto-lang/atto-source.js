// Runtime-only transitive linker. Trusted precompiled scalar ESM only.
// All supplied bytes and the exact release lock are admitted before evaluation.
// This is not a sandbox, signature verifier, hot upgrade or unload mechanism.
import {canonicalDependencyPlan,hashText} from './scalar-dependency-plan.mjs';
import {resolveScalarClosure} from './scalar-transitive-plan.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';
import {readVerifiedPackage} from './package-admission.mjs';
import {encodeInt64,decodeInt64} from './host-bridge.mjs';
import {parseStrictJsonReport} from './parity-json-strict.mjs';
const SHA=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('E_SCALAR_CLOSURE_LINK: '+m);};
const pin=v=>typeof v==='string'&&SHA.test(v);
const KEYS='dependencies,dependencySha256,interfaceSha256,moduleSha256,publicInterface,schemaVersion,sourceSha256,target';
async function importNamespace(base64){
  const spec='data:text/javascript;base64,'+base64;
  const wrapper='export * as ns from '+JSON.stringify(spec)+';';
  return (await import('data:text/javascript;base64,'+Buffer.from(wrapper).toString('base64'))).ns;
}
function admitConsumer(p){
  const {manifestJson,moduleSource}=p.artifact??{};
  if(typeof manifestJson!=='string'||manifestJson.length>65536||Buffer.byteLength(manifestJson)>65536||
     typeof moduleSource!=='string'||moduleSource.length>4194304||Buffer.byteLength(moduleSource)>4194304||
     hashText(manifestJson)!==p.expectedManifestSha256||hashText(moduleSource)!==p.expectedModuleSha256)fail('consumer digest or size mismatch');
  const m=parseStrictJsonReport(manifestJson,65536,'closure consumer');
  if(!m||Object.keys(m).sort().join(',')!==KEYS||m.schemaVersion!==2||m.target!=='edge-js'||
     m.moduleSha256!==p.expectedModuleSha256||!pin(m.sourceSha256)||m.dependencySha256!==p.expectedDependencySha256)fail('consumer manifest mismatch');
  const plan=canonicalDependencyPlan(m.dependencies),abi=scalarInterface(m.publicInterface,'edge-js');
  if(plan.sha256!==m.dependencySha256||JSON.stringify(plan.dependencies)!==JSON.stringify(m.dependencies)||
     abi.sha256!==m.interfaceSha256||JSON.stringify(abi.entries)!==JSON.stringify(m.publicInterface))fail('noncanonical consumer manifest');
  return {dependencies:plan.dependencies,publicInterface:abi.entries,dependencySha256:plan.sha256,base64:Buffer.from(moduleSource).toString('base64')};
}
export async function linkTrustedScalarClosure({root,packages,expectedLockSha256}={}){
  if(!pin(expectedLockSha256)||!Array.isArray(packages)||packages.length<1||packages.length>64)fail('invalid release inventory or lock pin');
  // Snapshot plain caller-owned release records before the first await.
  const records=packages.map(p=>({...p,options:p?.options?{...p.options}:undefined,artifact:p?.artifact?{...p.artifact}:undefined}));
  const admitted=new Map(),inventory=[];
  let bytes=0;
  for(const p of records){
    if(typeof p.packageId!=='string'||admitted.has(p.packageId))fail('duplicate or invalid package identity');
    let v,manifestSha256,moduleSha256;
    if(p.kind==='leaf'){
      const o=p.options;
      if(!o||o.target!=='edge-js'||!pin(o.expectedInterfaceSha256))fail('invalid leaf pins');
      const a=await readVerifiedPackage(o);
      if(a.manifest.schemaVersion!==2)fail('legacy leaf forbidden');
      v={dependencies:[],publicInterface:a.manifest.publicInterface,base64:a.moduleBase64};
      manifestSha256=o.expectedManifestSha256;moduleSha256=o.expectedModuleSha256;
    }else if(p.kind==='consumer'){
      v=admitConsumer(p);manifestSha256=p.expectedManifestSha256;moduleSha256=p.expectedModuleSha256;
    }else fail('invalid package kind');
    bytes+=v.base64.length;
    if(bytes>33554432)fail('closure snapshot budget exceeded');
    admitted.set(p.packageId,{...v,kind:p.kind});
    inventory.push({packageId:p.packageId,manifestSha256,moduleSha256,publicInterface:v.publicInterface,dependencies:v.dependencies});
  }
  const closure=resolveScalarClosure(root,inventory);
  if(closure.lockSha256!==expectedLockSha256)fail('release lock mismatch');
  const bound=new Map();
  for(const id of closure.order){
    const v=admitted.get(id),ns=await importNamespace(v.base64);
    let api=ns;
    if(v.kind==='consumer'){
      if(Object.getOwnPropertyNames(ns).sort().join(',')!=='bindProvider,dependencySha256'||
         typeof ns.bindProvider!=='function'||ns.dependencySha256!==v.dependencySha256)fail('consumer exports mismatch');
      const bindings=v.dependencies.flatMap(d=>d.imports.map(i=>bound.get(d.packageId)[i.exportName]));
      api=ns.bindProvider(Object.freeze(bindings));
      if(!api||Object.getPrototypeOf(api)!==null||!Object.isFrozen(api)||Reflect.ownKeys(api).length!==v.publicInterface.length)fail('bound exports mismatch');
    }else if(Object.getOwnPropertyNames(ns).length!==v.publicInterface.length)fail('leaf exports mismatch');
    const checked=Object.create(null);
    for(const e of v.publicInterface){
      const d=Object.getOwnPropertyDescriptor(api,e.name);
      if(!d||typeof d.value!=='function'||d.value.length!==e.params.length)fail('public signature mismatch');
      const fn=d.value;
      checked[e.name]=(...args)=>{
        if(args.length!==e.params.length)fail('invocation arity mismatch');
        return decodeInt64(encodeInt64(fn(...args.map(x=>decodeInt64(encodeInt64(x))))));
      };
    }
    bound.set(id,Object.freeze(checked));
  }
  return bound.get(root);
}
