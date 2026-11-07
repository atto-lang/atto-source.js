// Independent source-only acceptance guard for the provisional final-ESM
// cross-backend candidate corpus. This does not execute any compiler and
// MUST NOT be presented as Java/LLVM/native runtime verification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const PINNED_LLVM_HEAD='15bdd5cc48cf64387aee7e19f2926c253eb10e08';
const PINNED_LLVM_TREE='3754a4d0da917a4862b5f3fee2fa9228e9427e44';
const LLVM_REPO='ores-truffle-oreslang/oreslang-source.llvm';
const LLVM_PREFIX='contracts/v1/semantics/fixtures/';

// These blob identities were independently fetched from LLVM's specific
// canonical source tree. Do NOT derive them from the candidate JSON manifest.
const LLVM_BLOBS=Object.freeze({
  'oresllm-precedence':'116c261c259f5d8753c3c827595243403f22045f',
  'oresllm-scalar-gradient':'fbd4877db8dc2edf8a02fb76ee738d24cb69f922',
  'oresllm-signed-product':'901337ede5e2a7652837ed3f513073c63edb887e',
  'oresllm-grouped-negative':'22e8926b292cc53effe40fe506c0216b89677af9',
  'oresllm-nested-precedence':'f3fda2718ea88e734b30df4d6c1012191cc3b77a',
  'oresllm-max-minus-one':'cc3d33b3f9c8643fe335001d1c6f6a777276d314',
  'oresllm-zero-product':'233b6e5f21ad016ea1c2e206a753f48340217824',
  'oresllm-nested-arithmetic':'cae0cd83d51f65d137aa500aa7b7040313e3de66',
  'oresllm-subtract-self':'d1b46d5ea8bedf5af1954bdfdff84d30ffdd7d6b',
  'oresllm-zero-add':'08b5752db0e4b40d81d0e3ba247ff11d0594be67',
  'oresllm-signed-subtract':'7797ff45062a684f0af0533beed3952d4899564b',
  'oresllm-left-associative':'0a65516453f36a8e26fd53a0ec7b179821717ceb',
  'oresllm-zero-times-max':'f0b1eafaefc2b58d64d2c70bc42accdf37e6c715',
  'oresllm-over-2pow53':'3fef943aa0adef685f888fcaa1506adbc03701f6',
  'oresllm-min-max-cancel':'452a4b56d1a13fe8be82b48f31a95cd564de1eab',
  'oresllm-near-square':'f49e393c7b0d6e2b324f8315294964936de9f265',
  'oresllm-over53-cancel':'919c6d0aee262ea506388c9ef636330334cb568c'
});
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const INPUT=/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
const PROBES=Object.freeze([
  'add','subtract','multiply','remainder','left-associative'
]);
const PAIRS=Object.freeze([
  ['0','0'],['1','2'],['42','0'],['-1','1'],['-7','3'],
  ['7','-3'],['-7','-3'],[String(MIN),'-1'],[String(MAX),'1'],
  [String(MAX),'-1'],[String(MIN),'1'],['3037000500','3037000499'],
  [String(MIN),String(MAX)],['9007199254740993','1'],
  [String(MIN),'0'],['0',String(MAX)]
].map(p=>Object.freeze(p)));
const i64=x=>{
  assert.equal(typeof x,'string','oracle operand must be text');
  assert.match(x,INPUT,'oracle operand is not canonical signed integer');
  const result=BigInt(x);
  assert.ok(result>=MIN&&result<=MAX,'oracle operand outside signed i64');
  return result;
};
const blob=x=>{
  assert.equal(typeof x,'string','source must be UTF-8 text');
  const data=Buffer.from(x,'utf8');
  return createHash('sha1')
    .update('blob '+data.length+'\0').update(data).digest('hex');
};
function oracle(probe,left,right){
  const a=i64(left),b=i64(right);
  let result,sourceExpr;
  switch(probe){
    case 'add':result=a+b;sourceExpr='('+left+' + '+right+')';break;
    case 'subtract':result=a-b;sourceExpr='('+left+' - '+right+')';break;
    case 'multiply':result=a*b;sourceExpr='('+left+' * '+right+')';break;
    case 'remainder':
      sourceExpr='('+left+' % '+right+')';
      if(b===0n)return {sourceExpr,expected:{kind:'trap',code:'ORES_I64_DIVISION_BY_ZERO'}};
      result=a%b;break;
    case 'left-associative':
      sourceExpr='(('+left+' - '+right+') - 1)';
      const intermediate=a-b;
      if(intermediate<MIN||intermediate>MAX)
        return {sourceExpr,expected:{kind:'trap',code:'ORES_I64_OVERFLOW'}};
      result=intermediate-1n;break;
    default:assert.fail('unknown arithmetic operation: '+probe);
  }
  const expected=result<MIN||result>MAX
    ? {kind:'trap',code:'ORES_I64_OVERFLOW'}
    : {kind:'value',value:String(result)};
  return {sourceExpr,expected};
}

// The manifest is a source-only input, never a claim to executed CI evidence.
// Reject stray success/receipt fields rather than silently ignoring them.
// Own data keys only: reject accessors and unexpected metadata at every level.
function exactRecord(value,fields,label){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),
    label+': expected plain object');
  assert.equal(Object.getPrototypeOf(value),Object.prototype,
    label+': invalid prototype');
  const own=Reflect.ownKeys(value);
  assert.deepEqual([...own].sort(),[...fields].sort(),
    label+': unexpected/missing fields');
  for(const key of own){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value'),
      label+': accessor forbidden');
  }
}
export function verifyFinalEsmCorpus(manifest){
  exactRecord(manifest,
    ['schema_version','integer_model','reference','evidence','cases'],
    'corpus');
  assert.equal(manifest.schema_version,'atto-js-final-esm-parity/v1');
  assert.equal(manifest.integer_model,'signed-i64-checked-provisional');
  exactRecord(manifest.reference,
    ['repository','head_sha','tree_sha','manifest_path'],'LLVM reference');
  exactRecord(manifest.evidence,
    ['js_node22','java_graal_guest','llvm_guest'],'evidence classification');
  assert.deepEqual(manifest.reference,{
    repository:LLVM_REPO,
    head_sha:PINNED_LLVM_HEAD,
    tree_sha:PINNED_LLVM_TREE,
    manifest_path:'contracts/v1/semantics/cases.json'
  });
  assert.deepEqual(manifest.evidence,{
    js_node22:'not-executed-on-exact-head',
    java_graal_guest:'not-verified',
    llvm_guest:'not-verified'
  });
  assert.ok(Array.isArray(manifest.cases));
  assert.equal(manifest.cases.length,97);
  const ids=new Set(),seenBlobs=new Set(),seenProbes=new Set();
  let native=0,generated=0,traps=0;
  for(const c of manifest.cases){
    exactRecord(c,c.kind==='llvm-canonical-source'
      ? ['id','kind','source','origin','expected']
      : ['id','kind','source','oracle','expected'],'corpus case');
    assert.equal(typeof c.id,'string');
    assert.ok(!ids.has(c.id),'duplicate source case '+c.id);
    ids.add(c.id);
    assert.equal(typeof c.source,'string','case source missing '+c.id);
    if(c.kind==='llvm-canonical-source'){
      exactRecord(c.origin,['repo','path','blob_sha1'],'LLVM source origin');
      exactRecord(c.expected,['kind','value'],'LLVM expected scalar');
      native++;
      const name=c.id.slice('llvm.'.length);
      assert.equal(c.id,'llvm.'+name);
      assert.ok(Object.hasOwn(LLVM_BLOBS,name),'unrecognized pinned LLVM case '+c.id);
      assert.deepEqual(c.origin,{
        repo:LLVM_REPO,path:LLVM_PREFIX+name+'.ores',blob_sha1:LLVM_BLOBS[name]
      });
      assert.equal(blob(c.source),LLVM_BLOBS[name],'LLVM source bytes differ '+c.id);
      assert.deepEqual(c.expected,{kind:'value',value:'42'});
      seenBlobs.add(name);
    } else {
      exactRecord(c.oracle,['operation','lhs','rhs'],'generated oracle');
      exactRecord(c.expected,c.expected?.kind==='trap'
        ? ['kind','code']:['kind','value'],'generated expected outcome');
      assert.equal(c.kind,'generated-checked-i64-source',
        'unrecognized corpus case kind '+c.id);
      generated++;
      const [prefix,op,index]=c.id.split('.');
      assert.equal(prefix,'generated','unknown generated-case prefix');
      assert.ok(PROBES.includes(op),'unknown operator family '+c.id);
      assert.match(index??'',/^(?:0[0-9]|1[0-5])$/,'bad generated-case index');
      const probeId=op+'.'+index;
      assert.ok(!seenProbes.has(probeId),'duplicate arithmetic oracle '+probeId);
      seenProbes.add(probeId);
      const [lhs,rhs]=PAIRS[Number(index)];
      assert.deepEqual(c.oracle,{operation:op,lhs,rhs},
        'generated operand/oracle mapping changed '+c.id);
      const {sourceExpr,expected}=oracle(op,lhs,rhs);
      assert.equal(c.source,'pub fnc main():int{return '+sourceExpr+';}',
        'generated source text changed '+c.id);
      assert.deepEqual(c.expected,expected,
        'corpus expected value/trap differs from independent oracle '+c.id);
      if(expected.kind==='trap')traps++;
    }
  }
  assert.equal(native,Object.keys(LLVM_BLOBS).length);
  assert.equal(generated,PROBES.length*PAIRS.length);
  assert.equal(seenBlobs.size,native);
  assert.equal(seenProbes.size,generated);
  return Object.freeze({native,generated,total:native+generated,traps});
}
