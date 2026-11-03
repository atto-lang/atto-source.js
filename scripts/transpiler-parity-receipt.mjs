#!/usr/bin/env node
/**
 * Source-local Node ESM execution receipt for the JS program-v2 candidate corpus.
 * This is not a cross-backend, browser, Java, LLVM, Wasm, Cranelift or .NET receipt.
 */
import {lstat, open, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';

const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const INPUTS=Object.freeze([
  'src/program-v2.mjs','src/program-ir-v2.mjs',
  'src/parity-json-strict.mjs',
  'scripts/transpiler-parity-receipt.mjs',
  'contracts/v1/transpiler-parity-candidates.json',
  'tests/transpiler-admission-audit.test.mjs',
  'tests/transpiler-strict-ir-matrix.test.mjs',
  'tests/transpiler-program-v2-matrix.test.mjs',
  'tests/transpiler-parity-candidates.test.mjs'
]);
const sha256 = input=>createHash('sha256').update(input).digest('hex');
// Do not trust PATH-provided Git binaries, inherited Git directories,
// unreviewed global/system config, or an executable fsmonitor hook.
const git = (...args)=>execFileSync('/usr/bin/git',
  ['-C',ROOT,'-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{
    encoding:'utf8',maxBuffer:1024*1024,
    env:{PATH:'/usr/bin:/bin',LANG:'C',GIT_CONFIG_NOSYSTEM:'1',
         GIT_CONFIG_GLOBAL:'/dev/null'}
  }).trim();

async function verifyPhysicalBlob(file) {
  if(!/^(?:src|scripts|tests|contracts)\/[A-Za-z0-9_./-]+$/.test(file) ||
     file.includes('..'))throw Error('invalid receipt input path');
  const committed=git('rev-parse','HEAD:'+file);
  if(!/^[0-9a-f]{40}$/.test(committed))throw Error('missing HEAD blob '+file);
  if(git('ls-tree','HEAD','--',file)!=='100644 blob '+committed+'\t'+file)
    throw Error('non-regular Git-tree entry '+file);
  if(git('ls-files','--stage','--',file)!=='100644 '+committed+' 0\t'+file)
    throw Error('index differs from HEAD '+file);
  let current=ROOT;
  const segments=file.split('/');
  for(let i=0;i<segments.length;i++){
    current=join(current,segments[i]);
    const st=await lstat(current);
    if(st.isSymbolicLink()||(i===segments.length-1?!st.isFile():!st.isDirectory()))
      throw Error('symlink or nonregular receipt input path '+file);
  }
  if(!constants.O_NOFOLLOW)throw Error('O_NOFOLLOW is required for receipts');
  const handle=await open(current,constants.O_RDONLY|constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>262144)
      throw Error('unbounded or nonregular receipt input '+file);
    bytes=await handle.readFile();
    if(bytes.length!==stat.size)throw Error('changing receipt input '+file);
  } finally {await handle.close();}
  // Git SHA-1 object identity hashes exact bytes; unlike hash-object --path,
  // this is not normalized by clean filters and cannot follow final symlinks.
  const physical=createHash('sha1')
    .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(physical!==committed)throw Error('physical Git blob mismatch '+file);
  return {sha:committed,bytes};
}

function requireCorpus(manifest) {
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
     manifest.schemaVersion!==1||
     manifest.integerModel!=='signed-i64-checked-provisional'||
     !Array.isArray(manifest.cases)||manifest.cases.length!==50)
    throw Error('invalid JS parity candidate manifest header');
  const ids=new Set();
  let values=0,overflows=0;
  for(const item of manifest.cases){
    if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).sort().join(',')!=='expected,id,source'||
       typeof item.id!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(item.id)||
       ids.has(item.id)||typeof item.source!=='string'||
       !/^\/\/ oreslang:checked-i64-v1\npub fnc main\(\): int \{return [0-9()+* -]+;\}\n$/.test(item.source)||
       !item.expected||typeof item.expected!=='object'||
       !['checked-overflow','value'].includes(item.expected.kind))
      throw Error('invalid parity candidate entry');
    if(item.expected.kind==='value'){
      if(Object.keys(item.expected).sort().join(',')!=='kind,value'||
         typeof item.expected.value!=='string'||
         !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(item.expected.value))
        throw Error('invalid expected value');
      values++;
    }else{
      if(Object.keys(item.expected).join(',')!=='kind')
        throw Error('unexpected checked-overflow metadata');
      overflows++;
    }
    ids.add(item.id);
  }
  if(values!==37||overflows!==13)throw Error('unexpected candidate outcome inventory');
}

async function main(){
  // The receipt binds to a clean source-local checkout, not a branch name.
  if(process.platform!=='linux'&&process.platform!=='darwin')
    throw Error('receipt currently requires a POSIX runner with /usr/bin/git');
  if(resolve(process.cwd())!==ROOT ||
     resolve(await realpath(ROOT))!==ROOT ||
     resolve(git('rev-parse','--show-toplevel'))!==ROOT)
    throw Error('receipt must execute from its own canonical Git checkout root');
  const head=git('rev-parse','--verify','HEAD');
  const tree=git('rev-parse','HEAD^{tree}');
  if(!/^[0-9a-f]{40}$/.test(head)||!/^[0-9a-f]{40}$/.test(tree))
    throw Error('missing exact Git commit/tree');
  if(git('status','--porcelain=v1','--untracked-files=all')!=='')
    throw Error('dirty checkout; exact-head evidence not admissible');
  if(Number(process.versions.node.split('.')[0])<22)
    throw Error('Node 22 or newer required for JS execution receipt');
  const physicalBlobs=Object.create(null);
  let manifestBytes;
  // Verify before importing ANY repository-owned module.
  for(const file of INPUTS){
    const {sha,bytes}=await verifyPhysicalBlob(file);
    physicalBlobs[file]=sha;
    if(file==='contracts/v1/transpiler-parity-candidates.json')
      manifestBytes=bytes;
  }
  if(manifestBytes[0]===0xef&&manifestBytes[1]===0xbb&&manifestBytes[2]===0xbf)
    throw Error('BOM-bearing candidate JSON is forbidden');
  const json=new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes);
  const {parseStrictJsonReport}=await import('../src/parity-json-strict.mjs');
  const manifest=parseStrictJsonReport(json,65536,'JS transpiler candidates');
  requireCorpus(manifest);
  const {compileToProgramIRV2,compileProgramIRV2}
    =await import('../src/program-v2.mjs');
  const results=[];
  for(const item of manifest.cases){
    let observed_kind='compile-error',observed_value=null,emitted_sha256=null;
    try{
      const ir=compileToProgramIRV2(item.source);
      if(ir.integerModel!==manifest.integerModel)
        throw Error('unexpected numeric model');
      const emitted=compileProgramIRV2(ir);
      emitted_sha256=sha256(Buffer.from(emitted,'utf8'));
      observed_kind='esm-import-error';
      const ns=await import('data:text/javascript;charset=utf-8,'+
        encodeURIComponent(emitted));
      if(typeof ns.main!=='function')throw Error('missing public main');
      observed_kind='guest-error';
      try{
        const value=ns.main();
        if(typeof value!=='bigint')throw Error('non-BigInt guest result');
        observed_kind='value';
        observed_value=value.toString();
      }catch(error){
        if(error instanceof RangeError&&
           /ORES_I64_OVERFLOW/.test(error.message))
          observed_kind='checked-overflow';
      }
    }catch{
      // Preserve the stage classification without promoting host failures.
    }
    const passed=observed_kind===item.expected.kind&&
      (observed_kind!=='value'||observed_value===item.expected.value);
    results.push({
      id:item.id,source_sha256:sha256(Buffer.from(item.source,'utf8')),
      expected_kind:item.expected.kind,
      expected_value:item.expected.value??null,
      observed_kind,observed_value,emitted_sha256,pass:passed
    });
  }
  // Read-back catches post-check mutation; this is still not an OS sandbox.
  for(const file of INPUTS){
    const again=await verifyPhysicalBlob(file);
    if(again.sha!==physicalBlobs[file])
      throw Error('receipt input changed after execution: '+file);
  }
  if(git('status','--porcelain=v1','--untracked-files=all')!=='')
    throw Error('checkout changed during guest execution');
  const passed=results.filter(r=>r.pass).length;
  const receipt={
    format:'oreslang-js-program-v2-node-execution-v1',
    scope:'source-local-node-esm-only',
    cross_backend_parity_verified:false,
    java_graal_execution_verified:false,
    llvm_execution_verified:false,
    cranelift_execution_verified:false,
    wasm_execution_verified:false,
    dotnet_execution_verified:false,
    git_head:head,git_tree:tree,
    physically_verified_git_blobs:physicalBlobs,
    node_version:process.version,
    manifest_sha256:sha256(manifestBytes),
    integer_model:manifest.integerModel,
    expected_cases:50,passed_cases:passed,failed_cases:results.length-passed,
    results
  };
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
  if(passed!==50)process.exitCode=1;
}

await main();
