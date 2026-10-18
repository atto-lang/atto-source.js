import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';
import {
  REFERENCE_CASES, JAVA_FIXTURE_REVISION, FIXTURE_AUTHORITY,
  gitBlobSha1, fixtureSuiteSha256, executeJsReferenceFixtures,
  compareJavaAndJsReports
} from '../src/java-js-parity-v1.mjs';

test('ten independent Java fixture bytes are pinned and executed using real JS guest modules',async()=>{
  assert.equal(JAVA_FIXTURE_REVISION.length,40);
  assert.equal(FIXTURE_AUTHORITY,'ores-truffle-oreslang/oreslang-source.java');
  const sha=fixtureSuiteSha256();
  assert.match(sha,/^[a-f0-9]{64}$/);
  for(const c of REFERENCE_CASES) assert.equal(gitBlobSha1(c.source),c.blob,c.id);
  const actual=await executeJsReferenceFixtures();
  assert.equal(actual.fixture_suite_sha256,sha);
  assert.equal(actual.results.length,10);
  assert.equal(actual.results.filter(x=>x.status==='pass').length,10);
  assert.equal(actual.provenance_authenticated,false);
  assert.equal(actual.java_execution_verified,false);
  assert.equal(actual.integer_model,'signed-i64-checked-provisional');
  assert.deepEqual(actual.results.filter(x=>x.kind==='value').map(x=>x.observed_int64),
    ['42','40','42','42','42']);
});

function syntheticGraal(js){
  return {
    schema_version:'1.1.0',
    backend:'graal',
    source_revision:'a'.repeat(40),
    suite_sha256:'b'.repeat(64),
    results:js.results.map(r=>({
      id:r.id,status:'pass',
      ...(r.kind==='value'?{observed_exit:Number(r.observed_int64)}:
        {diagnostic_class:r.diagnostic_class})
    }))
  };
}
test('external Graal comparison is structural only, never authentication or full parity',async()=>{
  const js=await executeJsReferenceFixtures();
  const fake=syntheticGraal(js);
  const verdict=compareJavaAndJsReports(js,fake);
  assert.equal(verdict.cases_compared.length,10);
  assert.equal(verdict.structural_result,'MATCHING_FIXTURE_RESULTS_ONLY');
  assert.equal(verdict.java_runner_authenticated,false);
  assert.equal(verdict.source_to_binary_authenticated,false);
  assert.equal(verdict.full_java_js_parity_certified,false);
});

test('report comparison fails closed on mismatched, missing, pending and counterfeit results',async()=>{
  const js=await executeJsReferenceFixtures();
  const graal=syntheticGraal(js);
  function clone(){return structuredClone(graal);}
  let invalid=clone();invalid.results[0].observed_exit=41;
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/backend value divergence/);
  invalid=clone();invalid.results[0].status='pending';
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/missing\/pending\/failed/);
  invalid=clone();invalid.results.pop();
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/missing\/pending\/failed/);
  invalid=clone();invalid.results[6].diagnostic_class='integer_overflow';
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/diagnostic-class divergence/);
  invalid=clone();invalid.results.push(invalid.results[0]);
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/duplicate\/bad Java result/);
  invalid=clone();invalid.source_revision='unknown';
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/unverified Java report shape/);
  invalid=clone();invalid.suite_sha256='not a sha';
  assert.throws(()=>compareJavaAndJsReports(js,invalid),/unverified Java report shape/);
  assert.throws(()=>compareJavaAndJsReports({...js,results:js.results.slice(1)},graal),
    /invalid or incomplete JS fixture report/);
  invalid=structuredClone(js);invalid.results[0].fixture_git_blob='0'.repeat(40);
  assert.throws(()=>compareJavaAndJsReports(invalid,graal),/missing\/pending\/failed/);
});

test('checked JS runtime overflow is visibly distinct from Java long wrapping model',async()=>{
  // This is a Java-source-inspection witness, not a Java runtime invocation.
  // Java OresEvalRootNode.numeric uses long x+y (unchecked Java long arithmetic).
  const source='pub fnc main(): int {return 9223372036854775807 + 1;}';
  const ns=await import('data:text/javascript,'+encodeURIComponent(compileProgramV2(source)));
  assert.throws(()=>ns.main(),/signed i64 BigInt required/);
  assert.equal(BigInt.asIntN(64,9223372036854775807n+1n),-9223372036854775808n);
});

test('JS parity report cannot spoof authority, execution metadata, duplicate IDs or result kinds',async()=>{
  const original=await executeJsReferenceFixtures();
  const graal=syntheticGraal(original);
  const copy=()=>structuredClone(original);
  for(const mutate of [
    x=>{x.fixture_authority='attacker/repo';},
    x=>{x.fixture_authority_revision='0'.repeat(40);},
    x=>{x.integer_model='signed-i64-wrap-provisional';},
    x=>{x.execution='synthetic';},
    x=>{x.provenance_authenticated=true;},
    x=>{x.java_execution_verified=true;},
    x=>{x.results[0].kind='diagnostic';},
    x=>{x.results[0].status='pending';},
    x=>{x.results[0].observed_int64=42;},
    x=>{x.results[0].observed_int64='042';},
    x=>{x.results[1].id=x.results[0].id;},
    x=>{x.results[0].id='unlisted.case';},
    x=>{x.results[5].kind='value';}
  ]){
    const altered=copy();
    mutate(altered);
    assert.throws(()=>compareJavaAndJsReports(altered,graal));
  }
  assert.equal(compareJavaAndJsReports(original,graal).cases_compared.length,10);
});
