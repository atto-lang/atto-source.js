import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileProgramV2,compileProgramIRV2,compileToProgramIRV2} from '../src/program-v2.mjs';

// LLVM source contract reference (NOT observed LLVM guest execution).
// Matches sources + expected exits declared in LLVM's
// contracts/v1/semantics/cases.json on the pinned reference tree.
// No assumptions about Java/GraalVM native runtime receipts.
const nativeReference=[
  {
    "id": "oresllm-precedence",
    "git_blob_sha1": "116c261c259f5d8753c3c827595243403f22045f",
    "source": "pub fnc main(): int { return 42 + ((2 + 3 * 4) - 14); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-scalar-gradient",
    "git_blob_sha1": "fbd4877db8dc2edf8a02fb76ee738d24cb69f922",
    "source": "pub fnc main(): int { return 2 * ((5 * 3 + 1) - 9) * 3; }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-signed-product",
    "git_blob_sha1": "901337ede5e2a7652837ed3f513073c63edb887e",
    "source": "pub fnc main(): int { return 42 + ((-7 * -6) - 42); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-grouped-negative",
    "git_blob_sha1": "22e8926b292cc53effe40fe506c0216b89677af9",
    "source": "pub fnc main(): int { return 42 + ((-5 * (3 + 4)) + 35); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-nested-precedence",
    "git_blob_sha1": "f3fda2718ea88e734b30df4d6c1012191cc3b77a",
    "source": "pub fnc main(): int { return 42 + ((1 + (2 * (3 + 4))) - 15); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-max-minus-one",
    "git_blob_sha1": "cc3d33b3f9c8643fe335001d1c6f6a777276d314",
    "source": "pub fnc main(): int { return 43 + ((9223372036854775807 - 1) - 9223372036854775807); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-zero-product",
    "git_blob_sha1": "233b6e5f21ad016ea1c2e206a753f48340217824",
    "source": "pub fnc main(): int { return 42 + ((-7 * 0) - 0); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-nested-arithmetic",
    "git_blob_sha1": "cae0cd83d51f65d137aa500aa7b7040313e3de66",
    "source": "pub fnc main(): int { return 42 + (((2 + 3) * (10 - 2)) - 40); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-subtract-self",
    "git_blob_sha1": "d1b46d5ea8bedf5af1954bdfdff84d30ffdd7d6b",
    "source": "pub fnc main(): int { return 42 + ((9223372036854775807 - 9223372036854775807) - 0); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-zero-add",
    "git_blob_sha1": "08b5752db0e4b40d81d0e3ba247ff11d0594be67",
    "source": "pub fnc main(): int { return 42 + (0 + 0); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-signed-subtract",
    "git_blob_sha1": "7797ff45062a684f0af0533beed3952d4899564b",
    "source": "pub fnc main(): int { return 42 + ((1 - 9) + 8); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-left-associative",
    "git_blob_sha1": "0a65516453f36a8e26fd53a0ec7b179821717ceb",
    "source": "pub fnc main(): int { return 42 + (((17 - 2) * 3) - 45); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-zero-times-max",
    "git_blob_sha1": "f0b1eafaefc2b58d64d2c70bc42accdf37e6c715",
    "source": "pub fnc main(): int { return 42 + ((0 * 9223372036854775807) - 0); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-over-2pow53",
    "git_blob_sha1": "3fef943aa0adef685f888fcaa1506adbc03701f6",
    "source": "pub fnc main(): int { return 42 + ((9007199254740993 + 1) - 9007199254740994); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-min-max-cancel",
    "git_blob_sha1": "452a4b56d1a13fe8be82b48f31a95cd564de1eab",
    "source": "pub fnc main(): int { return 42 + ((-9223372036854775808 + 9223372036854775807) + 1); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-near-square",
    "git_blob_sha1": "f49e393c7b0d6e2b324f8315294964936de9f265",
    "source": "pub fnc main(): int { return 42 + ((3037000499 * 3037000499) - 9223372030926249001); }\n",
    "expected": "42"
  },
  {
    "id": "oresllm-over53-cancel",
    "git_blob_sha1": "919c6d0aee262ea506388c9ef636330334cb568c",
    "source": "pub fnc main(): int { return 42 + ((9007199254740993 - 9007199254740992) - 1); }\n",
    "expected": "42"
  }
];
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
function blobSha(source) {
  const data=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
}
function syntaxChecked(esm,id) {
  const parsed=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:esm,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(parsed.error,undefined,id+' syntax invocation');
  assert.equal(parsed.status,0,id+': '+parsed.stderr);
}
async function execute(source,id) {
  const esm=compileProgramV2(source);
  const ir=JSON.parse(JSON.stringify(compileToProgramIRV2(source)));
  assert.equal(compileProgramIRV2(ir),esm,id+' IR/source deterministic output');
  syntaxChecked(esm,id);
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(esm)+'#'+encodeURIComponent(id));
}
const ids=new Set();
for(const fixture of nativeReference) {
  test('LLVM shared-source fixture / '+fixture.id,async()=>{
    assert.equal(ids.has(fixture.id),false,'duplicate fixture ID');
    ids.add(fixture.id);
    assert.equal(blobSha(fixture.source),fixture.git_blob_sha1,'source bytes changed');
    const ns=await execute(fixture.source,fixture.id);
    assert.equal(ns.main(),BigInt(fixture.expected));
  });
}

// Independent BigInt oracle on real signed-64 operands and final emitted ESM.
// 16 * 5 = 80 distinct generated AttoLang source units + runtime invocations.
// This verifies JS only. Java/LLVM must consume the same sources on their
// actual compiler/runtime and publish authenticated observations separately.
const pairs=[
  ['0','0'],['1','2'],['42','0'],['-1','1'],
  ['-7','3'],['7','-3'],['-7','-3'],[String(MIN),'-1'],
  [String(MAX),'1'],[String(MAX),'-1'],[String(MIN),'1'],
  ['3037000500','3037000499'],[String(MIN),String(MAX)],
  ['9007199254740993','1'],[String(MIN),'0'],['0',String(MAX)]
];
const operations=[
  ['add','+', (a,b)=>a+b],
  ['subtract','-', (a,b)=>a-b],
  ['multiply','*', (a,b)=>a*b],
  ['remainder','%', (a,b)=>b===0n?null:a%b],
  ['left-associative','-', (a,b)=>a-b-1n]
];
for(const [name,operator,oracle] of operations){
  pairs.forEach(([left,right],index)=>{
    const id='generated-'+name+'-'+String(index).padStart(2,'0');
    test('checked-i64 source-to-final-ESM / '+id,async()=>{
      const a=BigInt(left),b=BigInt(right),expected=oracle(a,b);
      // For the fifth family test associativity and intermediate checks:
      // (a - b) - 1, not a - (b - 1).
      const expr=name==='left-associative'
        ? '(('+left+' - '+right+') - 1)'
        : '('+left+' '+operator+' '+right+')';
      const source='pub fnc main():int{return '+expr+';}';
      const ns=await execute(source,id);
      if(name==='remainder'&&expected===null) {
        assert.throws(()=>ns.main(),/ORES_I64_DIVISION_BY_ZERO/,id);
      } else if(expected<MIN||expected>MAX) {
        assert.throws(()=>ns.main(),/ORES_I64_OVERFLOW/,id);
      } else {
        // Every arithmetic node must stay inside i64, not only final result.
        const first=name==='left-associative'?a-b:null;
        if(first!==null&&(first<MIN||first>MAX))
          assert.throws(()=>ns.main(),/ORES_I64_OVERFLOW/,id+' intermediate');
        else assert.equal(ns.main(),expected,id);
      }
    });
  });
}
test('cross-backend candidate corpus is exactly 17 pinned native + 80 generated',()=>{
  assert.equal(nativeReference.length,17);
  assert.equal(pairs.length*operations.length,80);
  assert.equal(new Set(nativeReference.map(c=>c.git_blob_sha1)).size,17);
});
