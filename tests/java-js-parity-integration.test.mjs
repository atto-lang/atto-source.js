import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_CASES, JAVA_FIXTURE_REVISION, JAVA_SEMANTIC_SUITE_SHA256,
  JAVA_GRAAL_MANIFEST, executeJsReferenceFixtures,
  compareJavaAndJsReports, compareJavaAndJsJsonReports
} from '../src/java-js-parity-v1.mjs';

// This integrates the adversarial acceptance obligations from PR #21 with
// #22's stronger bounded, parsed-JSON ingress. Synthetic reports only test
// the comparator. They NEVER constitute Java or CI execution evidence.
function fakeJavaReport(js) {
  const byId=new Map(js.results.map(x=>[x.id,x]));
  return {
    schema_version:'1.1.0', backend:'graal',
    source_revision:JAVA_FIXTURE_REVISION,
    suite_sha256:JAVA_SEMANTIC_SUITE_SHA256,
    results:JAVA_GRAAL_MANIFEST.map(({id,expected})=>{
      const ref=byId.get(id);
      return {id,status:'pass',
        ...(ref?.kind==='value'||typeof expected==='number'
          ?{observed_exit:Number(ref?.observed_int64??expected)}
          :{diagnostic_class:expected}),
        detail:''};
    })
  };
}
test('PR #21 contradictory-success cases remain excluded through #22 JSON ingress',async()=>{
  const js=await executeJsReferenceFixtures(),java=fakeJavaReport(js);
  const compare=(a,b)=>compareJavaAndJsJsonReports(JSON.stringify(a),JSON.stringify(b));
  assert.equal(compare(js,java).cases_compared.length,REFERENCE_CASES.length);
  const mutateJava=(id,fn)=>{const x=structuredClone(java);fn(x.results.find(c=>c.id===id));return x;};
  const mutateJs=(id,fn)=>{const x=structuredClone(js);fn(x.results.find(c=>c.id===id));return x;};
  const invalid=[
    [js,mutateJava('native.add',x=>{x.diagnostic_class='unknown_name';})],
    [js,mutateJava('diagnostic.unknown',x=>{x.observed_exit=42;})],
    [js,mutateJava('native.defer-lifo-cfg',x=>{x.detail='timeout';})],
    [js,mutateJava('diagnostic.arity',x=>{x.detail='host exception';})],
    [mutateJs('native.add',x=>{x.diagnostic_class='unknown_name';}),java],
    [mutateJs('diagnostic.comment',x=>{x.observed_int64='42';}),java],
    [mutateJs('native.add',x=>{delete x.observed_int64;}),java],
    [js,mutateJava('native.add',x=>{delete x.observed_exit;})],
  ];
  for(const [j,g] of invalid)assert.throws(()=>compare(j,g),/contradictory|successful case/);
});
test('the consolidated ingress stays size-bounded and never certifies external runtime provenance',async()=>{
  const js=await executeJsReferenceFixtures(),java=fakeJavaReport(js);
  const ok=compareJavaAndJsJsonReports(JSON.stringify(js),JSON.stringify(java));
  assert.equal(ok.structural_result,'MATCHING_FIXTURE_RESULTS_ONLY');
  assert.equal(ok.java_runner_authenticated,false);
  assert.equal(ok.source_to_binary_authenticated,false);
  assert.equal(ok.full_java_js_parity_certified,false);
  assert.throws(()=>compareJavaAndJsJsonReports(' '.repeat(65537),JSON.stringify(java)),/oversized/);
  assert.throws(()=>compareJavaAndJsJsonReports(JSON.stringify(js),' '.repeat(262145)),/oversized/);
  assert.throws(()=>compareJavaAndJsReports({...js,checkout_commit_sha:'a'.repeat(40)},java),
    /incomplete JS checkout identity/);
  let traps=0;
  const proxy=new Proxy({}, {get(){traps++;throw Error('getter invoked');},
    ownKeys(){traps++;throw Error('enumeration invoked');}});
  assert.throws(()=>compareJavaAndJsJsonReports(proxy,JSON.stringify(java)),/missing or oversized/);
  assert.equal(traps,0);
});
