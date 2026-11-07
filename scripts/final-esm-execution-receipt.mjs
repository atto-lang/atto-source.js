#!/usr/bin/env node
// Exact-head JS final-ESM observation receipt. An authentic receipt requires
// source-org GitHub Actions to execute this under a real allocated runner.
// It DOES NOT attest Java, LLVM or browser guest-execution parity.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {compileProgramV2,compileProgramIRV2,compileToProgramIRV2} from '../src/program-v2.mjs';

const ROOT=new URL('../',import.meta.url);
const sha256=data=>createHash('sha256').update(data).digest('hex');
const bytes=p=>readFileSync(new URL(p,ROOT));
const git=(...args)=>execFileSync('git',args,{
  cwd:new URL('.',ROOT),encoding:'utf8',timeout:10000
}).trim();

const head=git('rev-parse','HEAD');
const tree=git('rev-parse','HEAD^{tree}');
assert.match(head,/^[a-f0-9]{40}$/);
assert.match(tree,/^[a-f0-9]{40}$/);
assert.equal(git('status','--porcelain','--untracked-files=all'),'',
  'dirty checkout cannot emit exact-head receipt');
const expectedHead=process.env.EXPECTED_SOURCE_SHA;
if(expectedHead)assert.equal(head,expectedHead,'unexpected checked-out source revision');
if(process.env.CI==='true'){
  assert.match(expectedHead??'',/^[a-f0-9]{40}$/);
  for(const field of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB'])
    assert.ok(process.env[field],field+' missing from hosted evidence');
}
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Node >=22 required');

const compilerStart=sha256(bytes('src/program-v2.mjs'));
const irValidatorStart=sha256(bytes('src/program-ir-v2.mjs'));
const corpusData=bytes('contracts/v1/final-esm-parity/cases.json');
const manifest=JSON.parse(corpusData.toString('utf8'));
assert.equal(manifest.schema_version,'atto-js-final-esm-parity/v1');
assert.equal(manifest.cases.length,97);
assert.equal(manifest.evidence.llvm_guest,'not-verified');
assert.equal(manifest.evidence.java_graal_guest,'not-verified');

const observations=[];
for(const c of manifest.cases){
  // The source must equal the pinned LLVM source Git blob where applicable.
  if(c.kind==='llvm-canonical-source'){
    const sourceBytes=Buffer.from(c.source,'utf8');
    const blob=createHash('sha1').update('blob '+sourceBytes.length+'\0')
      .update(sourceBytes).digest('hex');
    assert.equal(blob,c.origin.blob_sha1,c.id+' Git blob mismatch');
  }
  const esm=compileProgramV2(c.source);
  const rebuilt=compileProgramIRV2(JSON.parse(
    JSON.stringify(compileToProgramIRV2(c.source))
  ));
  assert.equal(esm,rebuilt,c.id+' source-to-IR byte mismatch');
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(syntax.error,undefined,c.id+' cannot launch syntax checker');
  assert.equal(syntax.status,0,c.id+' invalid final ESM: '+syntax.stderr);
  const ns=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(esm)+'#receipt-'+encodeURIComponent(c.id));
  let observed;
  try {
    const value=ns.main();
    assert.equal(typeof value,'bigint',c.id+' non-integer return');
    observed={kind:'value',value:value.toString()};
  } catch(error) {
    const kind=error instanceof RangeError &&
      /^ORES_I64_(?:OVERFLOW|DIVISION_BY_ZERO):/.test(error.message)
      ? error.message.split(':',1)[0]
      : null;
    if(kind===null)throw new Error(c.id+' unclassified guest error',{cause:error});
    observed={kind:'trap',code:kind};
  }
  assert.deepEqual(observed,c.expected,c.id+' semantic divergence');
  observations.push({
    id:c.id,
    source_sha256:sha256(Buffer.from(c.source,'utf8')),
    final_esm_sha256:sha256(Buffer.from(esm,'utf8')),
    observed
  });
}
assert.equal(observations.length,97);
assert.equal(sha256(bytes('src/program-v2.mjs')),compilerStart,
  'compiler changed while collecting evidence');
assert.equal(sha256(bytes('src/program-ir-v2.mjs')),irValidatorStart,
  'typed IR validator changed while collecting evidence');
assert.equal(git('rev-parse','HEAD'),head,'revision changed during test');
assert.equal(git('rev-parse','HEAD^{tree}'),tree,'source tree changed');
assert.equal(git('status','--porcelain','--untracked-files=all'),'',
  'checkout changed during evidence collection');

const receipt={
  schema_version:'atto-js-final-esm-execution-receipt/v1',
  evidence_class:process.env.CI==='true'
    ? 'github-actions-node22-executed-emitted-esm'
    : 'local-node22-executed-emitted-esm-unattested',
  verification:'observed-js-only',
  source_commit:head,
  source_tree:tree,
  compiler_sha256:compilerStart,
  typed_ir_validator_sha256:irValidatorStart,
  corpus_sha256:sha256(corpusData),
  node_version:process.version,
  github:process.env.CI==='true'?{
    repository:process.env.GITHUB_REPOSITORY,
    run_id:process.env.GITHUB_RUN_ID,
    run_attempt:process.env.GITHUB_RUN_ATTEMPT,
    job:process.env.GITHUB_JOB
  }:null,
  summary:{
    checked_source_cases:observations.length,
    emitted_esm_syntax_checks:observations.length,
    emitted_esm_guest_invocations:observations.length,
    exact_typed_ir_bytes_checks:observations.length,
    java_graal_guest:'NOT_EXECUTED',
    llvm_guest:'NOT_EXECUTED'
  },
  observations
};
process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
