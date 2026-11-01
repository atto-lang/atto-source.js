#!/usr/bin/env node
/**
 * Source-local Node ESM execution receipt for the JS program-v2 candidate corpus.
 * This is not a cross-backend, browser, Java, LLVM, Wasm, Cranelift or .NET receipt.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';

const sha256 = input=>createHash('sha256').update(input).digest('hex');
const git = (...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:1024*1024}).trim();

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
  const head=git('rev-parse','--verify','HEAD');
  const tree=git('rev-parse','HEAD^{tree}');
  if(!/^[0-9a-f]{40}$/.test(head)||!/^[0-9a-f]{40}$/.test(tree))
    throw Error('missing exact Git commit/tree');
  if(git('status','--porcelain=v1','--untracked-files=all')!=='')
    throw Error('dirty checkout; exact-head evidence not admissible');
  if(Number(process.versions.node.split('.')[0])<22)
    throw Error('Node 22 or newer required for JS execution receipt');
  const physicalBlobs=Object.create(null);
  // Git status may miss skip-worktree changes or normalized working-tree
  // bytes. Pin the actual physical bytes of every executable input.
  for(const file of [
    'src/program-v2.mjs','src/program-ir-v2.mjs',
    'scripts/transpiler-parity-receipt.mjs',
    'contracts/v1/transpiler-parity-candidates.json',
    'tests/transpiler-admission-audit.test.mjs',
    'tests/transpiler-strict-ir-matrix.test.mjs',
    'tests/transpiler-program-v2-matrix.test.mjs',
    'tests/transpiler-parity-candidates.test.mjs'
  ]){
    const committed=git('rev-parse','HEAD:'+file);
    const physical=git('hash-object','--no-filters',file);
    if(!/^[a-f0-9]{40}$/.test(committed)||physical!==committed)
      throw Error('physical Git blob mismatch: '+file);
    physicalBlobs[file]=committed;
  }

  const bytes=await readFile(new URL(
    '../contracts/v1/transpiler-parity-candidates.json',import.meta.url));
  const manifest=JSON.parse(bytes.toString('utf8'));
  requireCorpus(manifest);
  const results=[];
  for(const item of manifest.cases){
    let observed_kind='compile-error',observed_value=null;
    try{
      const ir=compileToProgramIRV2(item.source);
      if(ir.integerModel!==manifest.integerModel)
        throw Error('unexpected numeric model');
      const emitted=compileProgramIRV2(ir);
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
      observed_kind,observed_value,pass:passed
    });
  }
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
    manifest_sha256:sha256(bytes),
    integer_model:manifest.integerModel,
    expected_cases:50,passed_cases:passed,failed_cases:results.length-passed,
    results
  };
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
  if(passed!==50)process.exitCode=1;
}

await main();
