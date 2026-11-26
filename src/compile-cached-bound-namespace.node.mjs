// Trusted host, immutable compiler installation, independently current pins.
// The host MUST externally serialize epoch rotation with this synchronous
// operation. The existing JS store has no durable authority lease itself.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareBoundNamespaceEsm} from './pinned-scalar-namespace-esm.node.mjs';
import {scalarCompilerClosureSha256} from './compile-cached-scalar-unit.node.mjs';
import {encodeCacheKey,admitLedgerRecord} from './compiler-cache-envelope.node.mjs';
import {TrustedArtifactStore} from './compiler-artifact-store.node.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function boundNamespaceCompilerClosureSha256(){
 const extra=['pinned-scalar-namespace-esm.node.mjs','compile-cached-bound-namespace.node.mjs'];
 return hash(JSON.stringify(['atto-js-bound-namespace-install-v1',scalarCompilerClosureSha256(),
   extra.map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))])]));
}
export function compileCachedBoundNamespace({root,owner,unit,consumer,consumerManifest,providerManifest,sources,
 expectedConsumerSha256,expectedConsumerManifestSha256,expectedCompilerSha256,
 scope,ledgerRecord,ledgerPin,master,cold=false}={}){
 if(typeof consumer!=='string'||typeof consumerManifest!=='string'||consumer.length>65536||consumerManifest.length>65536||
    !consumer.isWellFormed()||!consumerManifest.isWellFormed()||
    hash(consumer)!==expectedConsumerSha256||hash(consumerManifest)!==expectedConsumerManifestSha256)
   throw Error('E_CACHE_INPUT: independently pinned consumer required');
 const secret=admitLedgerRecord(scope,ledgerRecord,ledgerPin,master);secret.fill(0);
 const compiler=boundNamespaceCompilerClosureSha256();
 if(compiler!==expectedCompilerSha256)throw Error('E_CACHE_COMPILER: installation digest mismatch');
 const plan=prepareBoundNamespaceEsm({consumer,consumerManifest,providerManifest,sources});
 // The consumer manifest contains the changing provider source-set pin.
 // Its current pin is authenticated above, not used as the reusable identity.
 // Retain exact remaining manifest bytes, including alias/package locator.
 const manifestDomain=hash(consumerManifest.replace(/sources_sha256 = "[a-f0-9]{64}"\n$/,'sources_sha256 = "<authenticated>"\n'));
 const key=encodeCacheKey({stage:'namespace-esm-bound-input-v2',owner,unitKind:'source-unit',unit,compiler,
   toolchain:hash(JSON.stringify([process.versions,process.platform,process.arch])),
   target:hash('node-esm'),configuration:hash('pinned-scalar-namespace-esm-bound-input-v1'),
   sources:hash(JSON.stringify([expectedConsumerSha256,manifestDomain])),
   bindings:plan.bindingDigest,generated:null,
   dependencies:[{identity:'pinned-provider-manifest',digest:hash(providerManifest)}]});
 const store=new TrustedArtifactStore(root),auth=[scope,ledgerRecord,ledgerPin,master];
 if(!cold){
   const hit=store.load(key,...auth);
   if(hit!==null)return {key,code:new TextDecoder('utf-8',{fatal:true}).decode(hit),classified:plan.classified,compiled:0,argumentCompiled:0,emitted:0,reused:1,retained:true};
 }
 const result=plan.emit(),bytes=Buffer.from(result.code,'utf8');
 let retained=false;
 if(bytes.length<=4*1024*1024){
   try{store.publish(key,bytes,...auth);retained=true;}
   catch(e){if(!String(e.message).startsWith('E_CACHE_BUSY:'))throw e;}
 }
 return {key,...result,classified:plan.classified,emitted:1,reused:0,retained};
}
