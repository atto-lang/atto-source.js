/** Read-only exact-digest admission for a reviewed JS package; never imports code. */
import {lstat, open} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import {constants} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {HOST_ABI} from './host-bridge.mjs';
import {scalarInterface,validatePublicNames} from './scalar-package-interface.mjs';
import {parseStrictJsonReport} from './parity-json-strict.mjs';

const SHA256=/^[0-9a-f]{64}$/;
const SHA40=/^[0-9a-f]{40}$/;
const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const KEYS=[
  'schemaVersion','backend','target','hostABI','module','declaredCompilerSha',
  'sourceSha256','moduleSha256','publicEntrypoints','declaredCapabilities','provenanceNote'
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export class PackageAdmissionError extends Error {
  constructor(message) {super(message);this.name='PackageAdmissionError';}
}
function requireSha(value, pattern, label) {
  if(typeof value!=='string'||!pattern.test(value))throw new PackageAdmissionError('missing or invalid trusted '+label);
}
async function readBoundedRegular(path,limit){
  // lstat is also required because O_NOFOLLOW is not available on every host.
  let before;
  try { before=await lstat(path); }
  catch { throw new PackageAdmissionError('package file inaccessible'); }
  if(!before.isFile() || before.isSymbolicLink() || before.size>limit)
    throw new PackageAdmissionError('package file must be bounded regular non-symlink file');
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  let file;
  try { file=await open(path,flags); }
  catch { throw new PackageAdmissionError('package file inaccessible'); }
  try {
    const st=await file.stat();
    if(!st.isFile() || st.size>limit || before.dev!==st.dev || before.ino!==st.ino)
      throw new PackageAdmissionError('package file changed or is not a bounded regular file');
    const chunks=[];
    let total=0;
    while(total<=limit){
      const chunk=Buffer.allocUnsafe(Math.min(65536,limit+1-total));
      const {bytesRead}=await file.read(chunk,0,chunk.length,null);
      if(bytesRead===0)break;
      total+=bytesRead;
      if(total>limit)throw new PackageAdmissionError('package file exceeded size limit');
      chunks.push(chunk.subarray(0,bytesRead));
    }
    return Buffer.concat(chunks,total);
  }finally{await file.close();}
}
function validateManifest(m){
  const keys=m?.schemaVersion===2?[...KEYS,'publicInterface','interfaceSha256']:KEYS;
  if(!m||typeof m!=='object'||Array.isArray(m)||
     Reflect.ownKeys(m).length!==keys.length||
     keys.some(k=>!Object.hasOwn(m,k))||
     ![1,2].includes(m.schemaVersion)||m.backend!=='javascript'||
     !['browser','edge-js'].includes(m.target)||m.hostABI!==HOST_ABI||
     m.module!=='module.mjs'||typeof m.declaredCompilerSha!=='string'||!SHA40.test(m.declaredCompilerSha)||
     typeof m.sourceSha256!=='string'||!SHA256.test(m.sourceSha256)||typeof m.moduleSha256!=='string'||!SHA256.test(m.moduleSha256)||
     !Array.isArray(m.declaredCapabilities)||m.declaredCapabilities.length!==0||
     typeof m.provenanceNote!=='string'||m.provenanceNote.length>1024||
     !Array.isArray(m.publicEntrypoints)||m.publicEntrypoints.length>128||
     m.publicEntrypoints.some(v=>typeof v!=='string'||!NAME.test(v))||
     // No once-only initialization contract is encoded by this signed
     // artifact schema. Treating init as an ordinary entrypoint would
     // bypass lifecycle isolation on the trusted Node loader.
     m.publicEntrypoints.includes('init')||m.publicEntrypoints.includes('then')||
     new Set(m.publicEntrypoints).size!==m.publicEntrypoints.length)
    throw new PackageAdmissionError('invalid or unsupported package manifest');
  if(m.schemaVersion===2){
    try {
      validatePublicNames(m.publicEntrypoints);
      const abi=scalarInterface(m.publicInterface,m.target);
      if(typeof m.interfaceSha256!=='string'||abi.sha256!==m.interfaceSha256||
         JSON.stringify(abi.entries)!==JSON.stringify(m.publicInterface)||
         JSON.stringify(abi.entries.map(e=>e.name))!==JSON.stringify([...m.publicEntrypoints].sort()))
        throw Error('interface mismatch');
    } catch {throw new PackageAdmissionError('invalid scalar package interface');}
  }
}

/**
 * Caller MUST provide manifest/module/source hashes from an independently
 * reviewed trusted release record; self-reported manifest hashes are insufficient.
 * This only verifies bytes at read time, not future file immutability, provenance,
 * safety of executing JS, nor compiler-revision attestation.
 */
export async function readVerifiedPackage({
  directory,expectedManifestSha256,expectedModuleSha256,
  expectedSourceSha256,expectedCompilerSha,target,expectedInterfaceSha256
}={}){
  for(const [v,label] of [[expectedManifestSha256,'manifest digest'],[expectedModuleSha256,'module digest'],[expectedSourceSha256,'source digest']])
    requireSha(v,SHA256,label);
  requireSha(expectedCompilerSha,SHA40,'compiler revision');
  if(!['edge-js','browser'].includes(target))throw new PackageAdmissionError('unsupported requested target');
  if(typeof directory!=='string'||!directory)throw new PackageAdmissionError('package directory required');
  const dir=resolve(directory);
  let st;
  try{st=await lstat(dir);}catch{throw new PackageAdmissionError('package directory inaccessible');}
  if(!st.isDirectory()||st.isSymbolicLink())throw new PackageAdmissionError('package directory must not be a symlink');
  const rawManifest=await readBoundedRegular(join(dir,'manifest.json'),65536);
  if(hash(rawManifest)!==expectedManifestSha256)throw new PackageAdmissionError('manifest digest mismatch');
  let manifest;
  try{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(rawManifest);
    // An independently pinned digest authenticates exact bytes, but JSON.parse
    // silently uses last-wins for duplicate keys (even escaped key aliases).
    // Reuse the bounded, duplicate-rejecting parser before materialization.
    manifest=parseStrictJsonReport(text,65536,'package manifest');
  }catch{throw new PackageAdmissionError('invalid package JSON or UTF-8');}
  validateManifest(manifest);
  if(manifest.target!==target||manifest.moduleSha256!==expectedModuleSha256||
     manifest.sourceSha256!==expectedSourceSha256||manifest.declaredCompilerSha!==expectedCompilerSha)
    throw new PackageAdmissionError('package does not match trusted expectations');
  if(manifest.schemaVersion===2){
    requireSha(expectedInterfaceSha256,SHA256,'interface digest');
    if(manifest.interfaceSha256!==expectedInterfaceSha256)
      throw new PackageAdmissionError('package interface incompatible with trusted expectation');
  } else if(expectedInterfaceSha256!==undefined){
    throw new PackageAdmissionError('legacy package has no verified interface digest');
  }
  const rawModule=await readBoundedRegular(join(dir,'module.mjs'),4194304);
  if(hash(rawModule)!==expectedModuleSha256)throw new PackageAdmissionError('module digest mismatch');
  // A matching byte digest does not authorize a lossy UTF-8 decode by ESM.
  try { new TextDecoder('utf-8',{fatal:true}).decode(rawModule); }
  catch { throw new PackageAdmissionError('invalid package module UTF-8'); }
  const approved=Object.freeze({...manifest,
    publicEntrypoints:Object.freeze([...manifest.publicEntrypoints]),
    declaredCapabilities:Object.freeze([]),
    ...(manifest.schemaVersion===2?{publicInterface:Object.freeze(manifest.publicInterface.map(e=>Object.freeze({...e,params:Object.freeze([...e.params])})))}:{})
  });
  // Exact verified bytes are snapshotted as an immutable base64 string.
  // Hosts must import THIS content, not reopen the original filesystem path.
  return Object.freeze({manifest:approved,moduleBase64:rawModule.toString('base64')});
}

/** Legacy metadata-only admission, retained for callers that do not load code. */
export async function admitPackage(options){
  const verified=await readVerifiedPackage(options);
  return verified.manifest;
}
