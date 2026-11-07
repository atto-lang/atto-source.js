import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyFinalEsmCorpus} from '../scripts/final-esm-corpus-guard.mjs';

// Trust anchor belongs to the verifier source, not the JSON being verified.
// All deliberately falsified data lives in memory; the canonical manifest
// is never modified or overwritten by a negative mutation test.
const canonical=JSON.parse(readFileSync(
  new URL('../contracts/v1/final-esm-parity/cases.json',import.meta.url),'utf8'
));
const clone=()=>JSON.parse(JSON.stringify(canonical));
const reseal=source=>{
  const data=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+data.length+'\0')
    .update(data).digest('hex');
};
test('source-only 97-case oracle guard accepts the pinned manifest shape',()=>{
  assert.deepEqual(verifyFinalEsmCorpus(canonical),{
    native:17,generated:80,total:97,traps:14
  });
});
const bad=[
  {id:'LLVM source changed while retaining original digest',
    mutate:m=>{m.cases[0].source+=' ';}},
  {id:'LLVM source changed and manifest digest fraudulently re-sealed',
    mutate:m=>{m.cases[0].source+=' ';m.cases[0].origin.blob_sha1=reseal(m.cases[0].source);}},
  {id:'LLVM source replaced by another valid pinned source',
    mutate:m=>{m.cases[0].source=m.cases[1].source;}},
  {id:'LLVM expected result modified',
    mutate:m=>{m.cases[0].expected.value='43';}},
  {id:'LLVM reference head changed',
    mutate:m=>{m.reference.head_sha='0'.repeat(40);}},
  {id:'LLVM reference tree changed',
    mutate:m=>{m.reference.tree_sha='0'.repeat(40);}},
  {id:'LLVM source owner changed',
    mutate:m=>{m.cases[0].origin.repo='an-untrusted-fork/source';}},
  {id:'generated expected value changed',
    mutate:m=>{m.cases[17].expected.value='1';}},
  {id:'generated trap incorrectly treated as successful value',
    mutate:m=>{const c=m.cases.find(x=>x.expected.kind==='trap');
      c.expected={kind:'value',value:'0'};}},
  {id:'generated source changed while preserving oracle metadata',
    mutate:m=>{m.cases[17].source='pub fnc main():int{return 0;}';}},
  {id:'generated pair changed with source but expected retained',
    mutate:m=>{const c=m.cases[17];c.oracle.rhs='1';
      c.source='pub fnc main():int{return (0 + 1);}';}},
  {id:'generated operator shifted with new source and expected',
    mutate:m=>{const c=m.cases[17];c.oracle.operation='subtract';
      c.source='pub fnc main():int{return (0 - 0);}';
      c.id='generated.subtract.00';}},
  {id:'duplicate source ID',
    mutate:m=>{m.cases[1].id=m.cases[0].id;}},
  {id:'duplicate generated index',
    mutate:m=>{m.cases[18].id=m.cases[17].id;}},
  {id:'missing source case',
    mutate:m=>{m.cases.pop();}},
  {id:'extra source case',
    mutate:m=>{m.cases.push(clone().cases[0]);}},
  {id:'truncated generated argument shape',
    mutate:m=>{delete m.cases[17].oracle.rhs;}},
  {id:'noncanonical decimal operand',
    mutate:m=>{m.cases[17].oracle.lhs='00';}},
  {id:'foreign arithmetic family',
    mutate:m=>{m.cases[17].oracle.operation='power';}},
  {id:'unexpected corpus execution assertion',
    mutate:m=>{m.evidence.llvm_guest='verified';}},
  {id:'corpus model silently flipped to wrapping',
    mutate:m=>{m.integer_model='signed-i64-wrapping';}},
  {id:'corpus reference manifest moved',
    mutate:m=>{m.reference.manifest_path='different/manifest.json';}},
  {id:'unexpected JSON sibling is rejected by schema equality',
    mutate:m=>{m.evidence.rogue_backend='green';}},
  {id:'forged top-level validation claim',
    mutate:m=>{m.status='PASS';}},
  {id:'forged case execution claim',
    mutate:m=>{m.cases[0].execution_status='verified';}},
  {id:'forged LLVM origin workflow run',
    mutate:m=>{m.cases[0].origin.run_id='123';}},
  {id:'forged generated oracle attestation',
    mutate:m=>{m.cases[17].oracle.attested=true;}},
  {id:'forged generated expected status',
    mutate:m=>{m.cases[17].expected.status='PASS';}},
  {id:'forged LLVM expected execution flag',
    mutate:m=>{m.cases[0].expected.executed=true;}},
  {id:'untrusted case object prototype',
    mutate:m=>{Object.setPrototypeOf(m.cases[0],null);}},
  {id:'accessor-backed source case identifier',
    mutate:m=>{Object.defineProperty(m.cases[0],'id',{
      get(){return 'llvm.forged';},enumerable:true,configurable:true
    });}}
];
for(const c of bad)test('manifest tampering must be detected / '+c.id,()=>{
  const changed=clone();
  c.mutate(changed);
  assert.notDeepEqual(changed,canonical,'mutation did not change input');
  assert.throws(()=>verifyFinalEsmCorpus(changed),{name:'AssertionError'});
});
test('31 deliberately invalid corpus variants have unique names',()=>{
  assert.equal(bad.length,31);
  assert.equal(new Set(bad.map(c=>c.id)).size,bad.length);
});
