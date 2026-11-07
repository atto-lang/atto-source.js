import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {
  compileProgramV2, compileToProgramIRV2, compileProgramIRV2
} from '../src/program-v2.mjs';

// The canonical source/observation proposal is reusable by Java and LLVM.
// No attached backend observation is accepted as native execution evidence.
const manifest=JSON.parse(readFileSync(
  new URL('../contracts/v1/final-esm-parity/cases.json',import.meta.url),'utf8'
));
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const WIDTH=16;
const allowedOps=new Set([
  'add','subtract','multiply','remainder','left-associative'
]);
const pinnedRepo='ores-truffle-oreslang/oreslang-source.llvm';

function blobSha(source) {
  const data=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
}
function independentOracle(fixture) {
  const {operation,lhs,rhs}=fixture.oracle;
  assert.ok(allowedOps.has(operation),'unknown oracle operation');
  const a=BigInt(lhs),b=BigInt(rhs);
  assert.ok(a>=MIN&&a<=MAX&&b>=MIN&&b<=MAX,'oracle inputs outside i64');
  const operators={
    add:['+',a+b],
    subtract:['-',a-b],
    multiply:['*',a*b],
    remainder:['%',b===0n?null:a%b],
    'left-associative':['-',a-b-1n]
  };
  const [op,n]=operators[operation];
  const expression=operation==='left-associative'
    ? '(('+lhs+' - '+rhs+') - 1)'
    : '('+lhs+' '+op+' '+rhs+')';
  assert.equal(fixture.source,'pub fnc main():int{return '+expression+';}',
    'source text does not match oracle inputs and operation');
  if(operation==='remainder'&&n===null)
    return {kind:'trap',code:'ORES_I64_DIVISION_BY_ZERO'};
  // Arithmetic checks are per-node: a final in-range result cannot conceal
  // an overflowing intermediate, e.g. (MAX - -1) - 1.
  if(operation==='left-associative'&&(a-b<MIN||a-b>MAX))
    return {kind:'trap',code:'ORES_I64_OVERFLOW'};
  if(n<MIN||n>MAX)return {kind:'trap',code:'ORES_I64_OVERFLOW'};
  return {kind:'value',value:String(n)};
}
async function execute(esm,id) {
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(syntax.error,undefined,'syntax checker failed to spawn');
  assert.equal(syntax.status,0,id+': emitted ESM syntax: '+syntax.stderr);
  return import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(esm)+'#'+encodeURIComponent(id));
}

test('portable corpus identity and source-only evidence classification',()=>{
  assert.equal(manifest.schema_version,'atto-js-final-esm-parity/v1');
  assert.equal(manifest.integer_model,'signed-i64-checked-provisional');
  assert.equal(manifest.reference.repository,pinnedRepo);
  assert.match(manifest.reference.head_sha,/^[a-f0-9]{40}$/);
  assert.match(manifest.reference.tree_sha,/^[a-f0-9]{40}$/);
  assert.equal(manifest.evidence.js_node22,'not-executed-on-exact-head');
  assert.equal(manifest.evidence.java_graal_guest,'not-verified');
  assert.equal(manifest.evidence.llvm_guest,'not-verified');
  assert.equal(manifest.cases.length,97);
  const ids=new Set();
  let pinned=0,generated=0;
  const distinctOperations=new Map();
  for(const c of manifest.cases) {
    assert.match(c.id,/^(llvm|generated)\.[a-z0-9.-]+$/);
    assert.ok(!ids.has(c.id),'duplicate case '+c.id);
    ids.add(c.id);
    assert.equal(typeof c.source,'string');
    assert.ok(c.source.length>0);
    if(c.kind==='llvm-canonical-source') {
      pinned++;
      assert.equal(c.origin.repo,pinnedRepo);
      assert.match(c.origin.path,/^contracts\/v1\/semantics\/fixtures\/oresllm-[a-z0-9-]+\.ores$/);
      assert.match(c.origin.blob_sha1,/^[a-f0-9]{40}$/);
      assert.equal(blobSha(c.source),c.origin.blob_sha1,'changed LLVM source '+c.id);
      assert.deepEqual(c.expected,{kind:'value',value:'42'});
    } else {
      assert.equal(c.kind,'generated-checked-i64-source');
      generated++;
      assert.deepEqual(c.expected,independentOracle(c),'bad oracle '+c.id);
      const op=c.oracle.operation;
      distinctOperations.set(op,(distinctOperations.get(op)||0)+1);
    }
  }
  assert.equal(pinned,17);
  assert.equal(generated,80);
  for(const op of allowedOps)assert.equal(distinctOperations.get(op),WIDTH);
});

for(const fixture of manifest.cases) {
  test('source-to-emitted-ESM / '+fixture.id,async()=>{
    const esm=compileProgramV2(fixture.source);
    const roundtrip=JSON.parse(JSON.stringify(
      compileToProgramIRV2(fixture.source)
    ));
    assert.equal(compileProgramIRV2(roundtrip),esm,'IR byte identity');
    const guest=await execute(esm,fixture.id);
    if(fixture.expected.kind==='trap') {
      assert.match(fixture.expected.code,/^ORES_I64_(OVERFLOW|DIVISION_BY_ZERO)$/);
      assert.throws(()=>guest.main(),
        e=>e instanceof RangeError&&e.message.startsWith(fixture.expected.code+':'),
        'expected portable categorized checked-i64 trap');
    } else {
      assert.equal(fixture.expected.kind,'value');
      assert.match(fixture.expected.value,/^(?:0|-?[1-9][0-9]*)$/);
      assert.equal(guest.main(),BigInt(fixture.expected.value));
    }
  });
}
