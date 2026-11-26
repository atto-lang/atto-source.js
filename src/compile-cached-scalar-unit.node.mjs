// Trusted immutable installation and host-selected source-unit identity.
// Closed scalar frontend only: no namespace/import resolver, and no arbitrary
// cache records accepted from guests. Caller supplies reviewed closure digest.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compile} from './compiler.mjs';
import {encodeCacheKey,admitLedgerRecord} from './compiler-cache-envelope.node.mjs';
import {TrustedArtifactStore} from './compiler-artifact-store.node.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=Object.freeze(['compiler.mjs','bang-keyword-separator.mjs','compile-error.mjs','scalar-emitter.mjs','scalar-ir.mjs','execution-domain-admission.mjs',
 'http-actor-admission.mjs','string-literal-syntax.mjs','core-future-ownership.mjs',
 'compiler-cache-envelope.node.mjs','compiler-artifact-store.node.mjs','compile-cached-scalar-unit.node.mjs'].sort());
// The list is deliberately explicit; CI must audit new compiler imports.
// A mutable installation is outside this API's trust model.
export function scalarCompilerClosureSha256(){
 const entries=files.map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))]);
 return hash(JSON.stringify(['atto-js-scalar-install-v1',entries]));
}
export function compileCachedScalarUnit({root,source,owner,unit,expectedCompilerSha256,
 scope,ledgerRecord,ledgerPin,master,cold=false}={}){
 if(typeof source!=='string'||source.length>262144||!source.isWellFormed()||Buffer.byteLength(source)>262144)
   throw Error('E_CACHE_INPUT: invalid source');
 // Admit even on cold or non-retained oversized output.
 const admitted=admitLedgerRecord(scope,ledgerRecord,ledgerPin,master);admitted.fill(0);
 const compiler=scalarCompilerClosureSha256();
 if(compiler!==expectedCompilerSha256)throw Error('E_CACHE_COMPILER: installation digest mismatch');
 const key=encodeCacheKey({stage:'scalar-esm',owner,unitKind:'source-unit',unit,compiler,
   toolchain:hash(JSON.stringify([process.versions,process.platform,process.arch])),
   target:hash('node-esm'),configuration:hash('closed-scalar-i64-wrap-v1'),
   sources:hash(source),bindings:hash('no-imports'),generated:null,dependencies:[]});
 const store=new TrustedArtifactStore(root),auth=[scope,ledgerRecord,ledgerPin,master];
 if(!cold){
   const hit=store.load(key,...auth);
   if(hit!==null)return {key,code:new TextDecoder('utf-8',{fatal:true}).decode(hit),emitted:0,reused:1,retained:true};
 }
 // Only output of the actual compiler reaches the publisher; no arbitrary
 // caller-supplied executable payload. Invalid source leaves cache unchanged.
 const code=compile(source),bytes=Buffer.from(code,'utf8');
 let retained=false;
 if(bytes.length<=4*1024*1024){
   try{store.publish(key,bytes,...auth);retained=true;}
   catch(e){if(!String(e.message).startsWith('E_CACHE_BUSY:'))throw e;}
 }
 return {key,code,emitted:1,reused:0,retained};
}
