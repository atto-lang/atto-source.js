import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileCoreNamespace,CoreNamespaceError} from '../src/core-namespace.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';

const source = stem => readFile(new URL('../core/namespace/'+stem+'.atto',import.meta.url),'utf8');
const execute = async (stem,src) => {
  const esm=compileCoreNamespace({source:src,expectedNamespace:stem});
  const guest=await import('data:text/javascript,'+encodeURIComponent(esm));
  return {guest,esm};
};

test('three namespace-owned .atto cores compile deterministically to callable ESM',async()=>{
  for(const stem of ['slice','iter','cmp']){
    const src=await source(stem);
    const ir=compileToProgramIRV2(src);
    assert.equal(ir.sourceNamespace,stem);
    assert.deepEqual(ir.modules,[]);
    assert.equal(ir.functions.every(f=>f.module===null && f.kind==='fnc'),true);
    const a=compileCoreNamespace({source:src,expectedNamespace:stem});
    assert.equal(a,compileCoreNamespace({source:src,expectedNamespace:stem}));
    const {guest}=await execute(stem,src);
    assert.ok(Object.keys(guest).length>=3);
  }
});

test('slice namespace checks boundaries and forbids overflowing span arithmetic',async()=>{
  const {guest}=await execute('slice',await source('slice'));
  assert.equal(guest.valid_range(0n,3n,3n),true);
  assert.equal(guest.valid_range(3n,0n,3n),true);
  assert.equal(guest.valid_range(3n,1n,3n),false);
  assert.equal(guest.valid_range(-1n,1n,3n),false);
  assert.equal(guest.valid_range((1n<<63n)-1n,1n,3n),false);
  assert.equal(guest.valid_index(2n,3n),true);
  assert.equal(guest.valid_index(3n,3n),false);
  assert.equal(guest.can_split_at(3n,3n),true);
});

test('iter namespace has bounded forward/backward cursors and exhaustion',async()=>{
  const {guest}=await execute('iter',await source('iter'));
  assert.equal(guest.next_index_or_negative_one(1n,2n,0n,3n),1n);
  assert.equal(guest.next_back_index_or_negative_one(1n,2n,0n,3n),2n);
  assert.equal(guest.next_index_or_negative_one(1n,2n,2n,3n),-1n);
  assert.equal(guest.next_index_or_negative_one((1n<<63n)-1n,2n,3n,3n),-1n);
});

test('cmp namespace is total for signed-i64 boundaries without subtraction',async()=>{
  const {guest}=await execute('cmp',await source('cmp'));
  const max=(1n<<63n)-1n,min=-(1n<<63n);
  assert.equal(guest.compare_int(min,max),-1n);
  assert.equal(guest.compare_int(max,min),1n);
  assert.equal(guest.compare_int(max,max),0n);
  assert.equal(guest.compare_bool(false,true),-1n);
  assert.equal(guest.min_int(max,min),min);
  assert.equal(guest.max_int(min,max),max);
  assert.throws(()=>guest.min_int(1,2n),/BigInt/);
});

test('no ambient lookup, substituted namespace, hosted code or module wrapper',async()=>{
  const src=await source('cmp');
  for(const forged of [
    src.replace('use namespace cmp;', 'use namespace slice;'),
    src.replace('use namespace cmp;', 'namespace cmp; import module fs from "std/fs";'),
    'use namespace cmp; define module cmp as pub fnc x():int{return 1;} end',
    'use namespace cmp; fnc secret():int{return 42;}',
    'use namespace cmp; pub fnc hidden():int{return process.exit(0);}'
  ]) assert.throws(()=>compileCoreNamespace({source:forged,expectedNamespace:'cmp'}));
  assert.throws(()=>compileCoreNamespace({source:src,expectedNamespace:'missing'}),CoreNamespaceError);
  assert.throws(()=>compileCoreNamespace({source:src,expectedNamespace:'slice'}),CoreNamespaceError);
});
