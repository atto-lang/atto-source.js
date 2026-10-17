/** Read-only exact-digest admission for a reviewed JS package; never imports code. */
import {lstat, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {HOST_ABI} from './host-bridge.mjs';

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
  let st;
  try{st=await lstat(path);}catch{throw new PackageAdmissionError('package file inaccessible');}
  if(!st.isFile()||st.isSymbolicLink()||st.size>limit)throw new PackageAdmissionError('package file must be bounded regular file');
  const bytes=await readFile(path);
  if(bytes.length>limit)throw new PackageAdmissionError('package file exceeded size limit');
  return bytes;
}
function validateManifest(m){
  if(!m||typeof m!=='object'||Array.isArray(m)||
     Reflect.ownKeys(m).length!==KEYS.length||
     KEYS.some(k=>!Object.hasOwn(m,k))||
     m.schemaVersion!==1||m.backend!=='javascript'||
     !['browser','edge-js'].includes(m.target)||m.hostABI!==HOST_ABI||
     m.module!=='module.mjs'||!SHA40.test(m.declaredCompilerSha)||
     !SHA256.test(m.sourceSha256)||!SHA256.test(m.moduleSha256)||
     !Array.isArray(m.declaredCapabilities)||m.declaredCapabilities.length!==0||
     typeof m.provenanceNote!=='string'||m.provenanceNote.length>1024||
     !Array.isArray(m.publicEntrypoints)||m.publicEntrypoints.length>128||
     m.publicEntrypoints.some(v=>typeof v!=='string'||!NAME.test(v))||
     new Set(m.publicEntrypoints).size!==m.publicEntrypoints.length)
    throw new PackageAdmissionError('invalid or unsupported package manifest');
}

/**
 * Caller MUST provide manifest/module/source hashes from an independently
 * reviewed trusted release record; self-reported manifest hashes are insufficient.
 * This only verifies bytes at read time, not future file immutability, provenance,
 * safety of executing JS, nor compiler-revision attestation.
 */
export async function admitPackage({
  directory,expectedManifestSha256,expectedModuleSha256,
  expectedSourceSha256,expectedCompilerSha,target
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
  try{manifest=JSON.parse(rawManifest.toString('utf8'));}catch{throw new PackageAdmissionError('invalid package JSON');}
  validateManifest(manifest);
  if(manifest.target!==target||manifest.moduleSha256!==expectedModuleSha256||
     manifest.sourceSha256!==expectedSourceSha256||manifest.declaredCompilerSha!==expectedCompilerSha)
    throw new PackageAdmissionError('package does not match trusted expectations');
  const rawModule=await readBoundedRegular(join(dir,'module.mjs'),4194304);
  if(hash(rawModule)!==expectedModuleSha256)throw new PackageAdmissionError('module digest mismatch');
  // The imported path must remain immutable after this check. This function
  // deliberately does not import/evaluate JS or claim provenance attestation.
  return Object.freeze({...manifest,
    publicEntrypoints:Object.freeze([...manifest.publicEntrypoints]),
    declaredCapabilities:Object.freeze([])
  });
}
