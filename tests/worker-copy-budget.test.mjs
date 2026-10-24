import test from 'node:test';
import assert from 'node:assert/strict';
import {copyOwnedValue} from '../src/worker-actor-copy.mjs';

const MiB=1024*1024;

test('binary payload at byte-budget boundary is copied without aliases',()=>{
  const source=new Uint8Array(8*MiB-14); // 14 UTF-16 bytes for the "payload" key
  source[0]=42;
  const clone=copyOwnedValue({payload:source});
  source[0]=99;
  assert.equal(clone.payload[0],42);
  assert.notEqual(clone.payload.buffer,source.buffer);
});

test('oversized typed arrays and backing ArrayBuffers are rejected before clone',()=>{
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(new Uint8Array(8*MiB+1)),/byte budget exceeded/);
    assert.throws(()=>copyOwnedValue(new ArrayBuffer(8*MiB+1)),/byte budget exceeded/);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('nested Blob, oversized UTF-16 strings and repeated graph ownership are bounded',()=>{
  if(typeof Blob==='function')
    assert.throws(()=>copyOwnedValue({binary:new Blob([new Uint8Array(8*MiB+1)])}),/byte budget exceeded/);
  assert.throws(()=>copyOwnedValue('x'.repeat(4*MiB+1)),/byte budget exceeded/);
  const backing=new ArrayBuffer(5*MiB);
  const value={left:new Uint8Array(backing),right:new DataView(backing)};
  const cloned=copyOwnedValue(value);
  assert.equal(cloned.left.buffer,cloned.right.buffer);
  assert.notEqual(cloned.left.buffer,backing);
});

test('reject accessors without executing them or invoking structuredClone',()=>{
  let getterCalls=0;
  const hostile=Object.defineProperty({},'payload',{
    enumerable:true,get(){getterCalls++;return new ArrayBuffer(16*MiB);}
  });
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(hostile),/accessors forbidden/);
    assert.equal(getterCalls,0);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('reject nested shared memory before clone and preserve cyclic owned graphs',()=>{
  if(typeof SharedArrayBuffer==='function'){
    const original=globalThis.structuredClone;
    let cloneCalls=0;
    globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
    try{
      assert.throws(
        ()=>copyOwnedValue({m:new Map([['bad',new Uint8Array(new SharedArrayBuffer(8))]])}),
        /shared-memory/);
      assert.equal(cloneCalls,0);
    }finally{globalThis.structuredClone=original;}
  }
  const original={answer:42};
  original.self=original;
  const cloned=copyOwnedValue(original);
  assert.notEqual(cloned,original);
  assert.equal(cloned.self,cloned);
});

test('complex graphs are rejected before clone',()=>{
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(Array.from({length:8200},()=>({ok:true}))),/complexity exceeded/);
    const top={},root=top;let p=top;
    for(let i=0;i<67;i++){p.child={};p=p.child;}
    assert.throws(()=>copyOwnedValue(root),/complexity exceeded/);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});
