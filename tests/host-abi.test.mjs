import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compile} from '../src/compiler.mjs';
import {HOST_ABI_VERSION, encodeI64, decodeI64, invokeTrustedScalar} from '../src/host-abi.mjs';

test('v1 wire format round trips signed i64 without Number rounding',()=>{
  assert.equal(HOST_ABI_VERSION,1);
  for (const n of [0n,1n,-1n,9007199254740993n,(1n<<63n)-1n,-(1n<<63n)]) {
    assert.deepEqual(encodeI64(n),{version:1,type:'i64',value:n.toString()});
    assert.equal(decodeI64(JSON.parse(JSON.stringify(encodeI64(n)))),n);
  }
});
test('i64 wire format rejects numbers, unsafe or noncanonical values',()=>{
  for(const v of [null,{},[],{version:1,type:'i64',value:42},
    {version:0,type:'i64',value:'2'},{version:1,type:'float',value:'2'},
    {version:1,type:'i64',value:'01'},{version:1,type:'i64',value:'-0'},
    {version:1,type:'i64',value:'1.0'},{version:1,type:'i64',value:'1e3'},
    {version:1,type:'i64',value:' 1'},{version:1,type:'i64',value:'9223372036854775808'},
    {version:1,type:'i64',value:'-9223372036854775809'},
    {version:1,type:'i64',value:'2',extra:true}]){
    assert.throws(()=>decodeI64(v),TypeError);
  }
  assert.throws(()=>decodeI64(Object.defineProperties({}, {
    version:{value:1,enumerable:true},
    type:{value:'i64',enumerable:true},
    value:{get(){throw Error('untrusted accessor executed')},enumerable:true}
  })),/accessors/);
  assert.throws(()=>encodeI64(2),TypeError);
  assert.throws(()=>encodeI64(1n<<63n),TypeError);
});
test('v1 adapter invokes only exported trusted scalar function with arity checking',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ores-host-abi-'));
  try{
    const file=join(dir,'guest.mjs');
    await writeFile(file,compile(
      'pub fnc add(int a, int b): int { return a + b; } fnc hidden(): int { return 9; }'
    ));
    const mod=await import(pathToFileURL(file).href);
    assert.deepEqual(invokeTrustedScalar(mod,'add',[encodeI64(9007199254740993n),encodeI64(2n)]),
      encodeI64(9007199254740995n));
    assert.throws(()=>invokeTrustedScalar(mod,'hidden',[]),/unavailable/);
    assert.throws(()=>invokeTrustedScalar(mod,'add',[encodeI64(1n)]),/arity mismatch/);
    assert.throws(()=>invokeTrustedScalar(mod,'toString',[]),/unavailable/);
    assert.throws(()=>invokeTrustedScalar(mod,'add',[{version:1,type:'i64',value:'1.5'},encodeI64(1n)]),TypeError);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('no async return accepted by scalar ABI',()=>{
  const mod=Object.create(null);
  Object.defineProperty(mod,'fn',{value:()=>Promise.resolve(4n)});
  assert.throws(()=>invokeTrustedScalar(mod,'fn',[]),TypeError);
});
