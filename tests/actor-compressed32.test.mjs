import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMPRESSED32_OFFSET,MAX_COMPRESSED32_SPAN,
  ACTOR_REF32_STORAGE_ABI_V1,requireActorRef32StorageAbiV1,
  encodeCompressed32,decodeCompressed32,decodeStoredCompressed32,
  dereferenceCompressed32
} from "../src/actor-compressed32.mjs";

test("JS Ref32 ABI rejects incompatible .NET generation-slot reference words",()=>{
  assert.equal(ACTOR_REF32_STORAGE_ABI_V1,"offset8_plus_one");
  assert.doesNotThrow(()=>requireActorRef32StorageAbiV1("offset8_plus_one"));
  for(const wrong of ["generation16_slot16","handle32_table_versioned","handle64_versioned","",null,undefined])
    assert.throws(()=>requireActorRef32StorageAbiV1(wrong),/E_ACTOR_MEMORY_ABI/);
});

test("JS compressed32 matches cross-backend unsigned actor-offset representation",()=>{
  assert.equal(MAX_COMPRESSED32_OFFSET,34359738352n);
  assert.equal(MAX_COMPRESSED32_SPAN,34359738360n);
  assert.equal(encodeCompressed32(0n),1);
  assert.equal(decodeCompressed32(0),null);
  assert.equal(decodeCompressed32(1),0n);
  assert.equal(encodeCompressed32(MAX_COMPRESSED32_OFFSET),0xffff_ffff);
  assert.equal(decodeCompressed32(0xffff_ffff),MAX_COMPRESSED32_OFFSET);
  assert.equal(decodeCompressed32(0x8000_0000),0x7fff_ffffn*8n);
  assert.throws(()=>encodeCompressed32(3n),/cannot be encoded/);
  assert.throws(()=>decodeStoredCompressed32(0x1_0000_0000n),/high bits/);
  assert.throws(()=>dereferenceCompressed32(0n,MAX_COMPRESSED32_SPAN,8n),/null/);
  assert.throws(()=>dereferenceCompressed32(
    0xffff_ffffn,MAX_COMPRESSED32_OFFSET,8n),/outside/);
  assert.equal(dereferenceCompressed32(1n,8n,8n),0n);
});

test("compressed32 dereference rejects spans beyond the storage ABI ceiling",()=>{
  const cap=MAX_COMPRESSED32_SPAN;
  assert.equal(dereferenceCompressed32(0xffff_ffffn,cap,8n),MAX_COMPRESSED32_OFFSET);
  for(const oversized of [cap+1n,cap+8n,1n<<64n]){
    assert.throws(()=>dereferenceCompressed32(1n,oversized,1n),/outside logical actor span/);
    assert.throws(()=>dereferenceCompressed32(0xffff_ffffn,oversized,9n),/outside logical actor span/);
  }
  assert.throws(()=>dereferenceCompressed32(0xffff_ffffn,cap,9n),/outside logical actor span/);
  assert.throws(()=>dereferenceCompressed32(1n,0n,1n),/outside logical actor span/);
});

test("deterministic u32 offset corpus preserves roundtrip and fails closed on spans",()=>{
  let word=0x8a729c15n;
  for(let i=0;i<10000;i++){
    word=(1664525n*word+1013904223n)&0xffff_ffffn;
    const w=word===0n?1n:word;
    const offset=(w-1n)*8n;
    assert.equal(encodeCompressed32(offset),Number(w));
    assert.equal(decodeCompressed32(Number(w)),offset);
    assert.equal(dereferenceCompressed32(w,offset+8n,8n),offset);
    assert.throws(()=>dereferenceCompressed32(w,offset+7n,8n),RangeError);
    assert.throws(()=>dereferenceCompressed32(w,MAX_COMPRESSED32_SPAN+1n,1n),RangeError);
  }
});
