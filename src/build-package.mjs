/** Trusted build-time package for browser/edge JS hosts; no guest execution. */
import {readFile, lstat, mkdtemp, writeFile, rename, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, basename, join, resolve} from 'node:path';
import {TextDecoder} from 'node:util';
import {compile} from './compiler.mjs';
import {HOST_ABI} from './host-bridge.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Create a never-overwritten output directory containing module.mjs/manifest.json.
 * Caller must pin and review compiler and source independently; a digest is not authorization.
 */
export async function buildPackage({sourceFile, outputDir, target='edge-js', declaredCompilerSha}={}) {
  if (!['edge-js','browser'].includes(target)) throw Error('unsupported JS host target');
  if (!/^[0-9a-f]{40}$/.test(declaredCompilerSha || '')) throw Error('exact declared compiler SHA required');
  if (typeof sourceFile !== 'string' || typeof outputDir !== 'string') throw Error('source and output paths required');
  const input = resolve(sourceFile), dest = resolve(outputDir);
  const stat = await lstat(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw Error('source must be a bounded regular file');
  const sourceBytes = await readFile(input);
  if (sourceBytes.length > 262144) throw Error('source grew beyond limit');
  const source = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sourceBytes);
  const generated = compile(source);
  const emitted = Buffer.from(generated,'utf8');
  const exports = [...generated.matchAll(/^export \{ _f\d+ as ([A-Za-z_][A-Za-z0-9_]*) \};$/gm)].map(m=>m[1]);
  const manifest = {
    schemaVersion:1, backend:'javascript', target, hostABI:HOST_ABI,
    module:'module.mjs', declaredCompilerSha,
    sourceSha256:digest(sourceBytes), moduleSha256:digest(emitted),
    publicEntrypoints:exports, declaredCapabilities:[],
    provenanceNote:'The compiler SHA is caller-declared, not independently attested. A hash is not an authorization or a sandbox.'
  };
  const parent = dirname(dest);
  const st = await lstat(dest).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  if (st) throw Error('refusing to overwrite an existing package');
  const temp = await mkdtemp(join(parent,'.'+basename(dest)+'.staging-'));
  try {
    await writeFile(join(temp,'module.mjs'),emitted,{flag:'wx',mode:0o600});
    await writeFile(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temp,dest);
  } catch (error) { await rm(temp,{recursive:true,force:true}); throw error; }
  return manifest;
}
