// Runtime-only admission and linkage of precompiled scalar consumer artifacts. Trusted Node code only.
import {createHash} from 'node:crypto';
import {scalarInterface} from './scalar-package-interface.mjs';
import {loadTrustedNodePackage} from './load-trusted-package.node.mjs';
import {encodeInt64,decodeInt64} from './host-bridge.mjs';
import {parseStrictJsonReport} from './parity-json-strict.mjs';

const SHA=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
function requireHash(value,label){
  if(typeof value!=='string'||!SHA.test(value))throw Error('invalid trusted '+label);
}
const KEYS=['schemaVersion','target','sourceSha256','moduleSha256','providerInterfaceSha256','publicInterface','interfaceSha256'];
const fail=message=>{throw Error('E_SCALAR_LINK: '+message);};

// All digest pins are supplied by a trusted release record, not inferred
// from the candidate. Only separately reviewed compiler outputs may run.
// A consumer factory captures an immutable provider generation; replacement
// creates a new binding, never mutates existing handles. No unload guarantee.
export async function linkTrustedScalarConsumer({artifact,expectedManifestSha256,expectedModuleSha256,
  expectedProviderInterfaceSha256,providerOptions}={}){
  requireHash(expectedManifestSha256,'consumer manifest digest');
  requireHash(expectedModuleSha256,'consumer module digest');
  requireHash(expectedProviderInterfaceSha256,'provider interface digest');
  const {manifestJson,moduleSource}=artifact??{};
  if(typeof manifestJson!=='string'||Buffer.byteLength(manifestJson,'utf8')>65536||
     typeof moduleSource!=='string'||Buffer.byteLength(moduleSource,'utf8')>4194304)
    fail('invalid consumer artifact');
  if(hash(manifestJson)!==expectedManifestSha256||hash(moduleSource)!==expectedModuleSha256)
    fail('consumer digest mismatch');
  const m=parseStrictJsonReport(manifestJson,65536,'consumer manifest');
  if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==KEYS.length||
     KEYS.some(k=>!Object.hasOwn(m,k))||m.schemaVersion!==1||m.target!=='edge-js'||
     m.moduleSha256!==expectedModuleSha256||m.providerInterfaceSha256!==expectedProviderInterfaceSha256)
    fail('consumer manifest mismatch');
  requireHash(m.sourceSha256,'declared consumer source digest');
  const abi=scalarInterface(m.publicInterface,'edge-js');
  if(abi.sha256!==m.interfaceSha256||JSON.stringify(abi.entries)!==JSON.stringify(m.publicInterface))
    fail('invalid consumer interface');
  // Snapshot caller-owned trusted pins before the asynchronous provider load.
  const options={...providerOptions};
  if(options.target!=='edge-js'||options.expectedInterfaceSha256!==expectedProviderInterfaceSha256)
    fail('provider interface pin mismatch');
  const provider=await loadTrustedNodePackage(options);
  if(provider.manifest.schemaVersion!==2||provider.manifest.interfaceSha256!==expectedProviderInterfaceSha256)
    fail('provider incompatible');
  // The provider has passed exact-byte admission before the consumer factory
  // executes. Both modules are trusted, not a security sandbox.
  const specifier='data:text/javascript;base64,'+Buffer.from(moduleSource,'utf8').toString('base64');
  const wrapper='export * as packageNamespace from '+JSON.stringify(specifier)+';';
  const {packageNamespace:ns}=await import('data:text/javascript;base64,'+Buffer.from(wrapper,'utf8').toString('base64'));
  if(Object.getOwnPropertyNames(ns).sort().join(',')!=='bindProvider,providerInterfaceSha256'||
     typeof ns.bindProvider!=='function'||ns.providerInterfaceSha256!==expectedProviderInterfaceSha256)
    fail('consumer module interface mismatch');
  const bindings=Object.freeze(provider.manifest.publicInterface.map(e=>(...args)=>
    decodeInt64(provider.invoke(e.name,args.map(encodeInt64)))));
  const api=ns.bindProvider(bindings);
  if(!api||Object.getPrototypeOf(api)!==null||!Object.isFrozen(api)||
     Reflect.ownKeys(api).length!==abi.entries.length||
     abi.entries.some(e=>{const d=Object.getOwnPropertyDescriptor(api,e.name);
       return !d||typeof d.value!=='function'||d.value.length!==e.params.length;}))
    fail('bound consumer exports mismatch');
  return api;
}
