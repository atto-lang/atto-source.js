// Trusted host only; each source unit/namespace slot has an independent key.
// The scalar frontend accepts explicit provider aliases, not general Atto
// namespace imports. Cache hits depend on reviewed interface digests, not
// compatible provider implementation bytes. Runtime release pins are separate.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildScalarGraph,planScalarGraph} from './build-scalar-graph.node.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';
import {scalarCompilerClosureSha256} from './compile-cached-scalar-unit.node.mjs';
import {encodeCacheKey,admitLedgerRecord} from './compiler-cache-envelope.node.mjs';
import {TrustedArtifactStore} from './compiler-artifact-store.node.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const extras=['build-scalar-graph.node.mjs','build-cached-scalar-graph.node.mjs','scalar-dependency-plan.mjs','scalar-package-interface.mjs','host-bridge.mjs'];
export function scalarGraphCompilerClosureSha256(){
 return hash(JSON.stringify(['atto-js-graph-install-v1',scalarCompilerClosureSha256(),extras.map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))])]));
}
function checkedArtifact(value,source,plan){
 if(!value||Object.keys(value).sort().join(',')!=='manifestJson,moduleSource'||
    typeof value.manifestJson!=='string'||typeof value.moduleSource!=='string')throw Error('E_CACHE_GRAPH: malformed artifact');
 const m=JSON.parse(value.manifestJson);
 if(!m||Object.keys(m).sort().join(',')!=='dependencies,dependencySha256,interfaceSha256,moduleSha256,publicInterface,schemaVersion,sourceSha256,target'||
    m.schemaVersion!==2||m.target!=='edge-js'||m.sourceSha256!==hash(source)||m.moduleSha256!==hash(value.moduleSource)||
    m.dependencySha256!==plan.sha256||JSON.stringify(m.dependencies)!==JSON.stringify(plan.dependencies))throw Error('E_CACHE_GRAPH: artifact does not match key');
 const abi=scalarInterface(m.publicInterface,'edge-js');
 if(abi.sha256!==m.interfaceSha256||JSON.stringify(abi.entries)!==JSON.stringify(m.publicInterface))throw Error('E_CACHE_GRAPH: invalid interface');
 return Object.freeze({manifestJson:value.manifestJson,moduleSource:value.moduleSource});
}
export function buildCachedScalarGraph({root,source,providers,owner,unit,expectedCompilerSha256,
 scope,ledgerRecord,ledgerPin,master,cold=false}={}){
 const plan=planScalarGraph({source,providers});
 const admitted=admitLedgerRecord(scope,ledgerRecord,ledgerPin,master);admitted.fill(0);
 const compiler=scalarGraphCompilerClosureSha256();
 if(compiler!==expectedCompilerSha256)throw Error('E_CACHE_COMPILER: graph installation digest mismatch');
 const key=encodeCacheKey({stage:'scalar-consumer-esm',owner,unitKind:'namespace',unit,compiler,
   toolchain:hash(JSON.stringify([process.versions,process.platform,process.arch])),
   target:hash('edge-js'),configuration:hash('bound-scalar-i64-wrap-v1'),
   sources:hash(source),bindings:plan.sha256,generated:null,
   dependencies:plan.dependencies.map(d=>({identity:d.packageId,digest:d.interfaceSha256}))});
 const store=new TrustedArtifactStore(root),auth=[scope,ledgerRecord,ledgerPin,master];
 if(!cold){
   const hit=store.load(key,...auth);
   if(hit!==null){
     const artifact=checkedArtifact(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(hit)),source,plan);
     return {key,artifact,emitted:0,reused:1,retained:true};
   }
 }
 const artifact=checkedArtifact(buildScalarGraph({source,providers}),source,plan);
 const bytes=Buffer.from(JSON.stringify(artifact),'utf8');
 let retained=false;
 if(bytes.length<=4*1024*1024){
   try{store.publish(key,bytes,...auth);retained=true;}
   catch(e){if(!String(e.message).startsWith('E_CACHE_BUSY:'))throw e;}
 }
 return {key,artifact,emitted:1,reused:0,retained};
}
