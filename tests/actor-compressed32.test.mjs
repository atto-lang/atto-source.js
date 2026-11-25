import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMPRESSED32_OFFSET,MAX_COMPRESSED32_SPAN,
  encodeCompressed32,decodeCompressed32,decodeStoredCompressed32,
  dereferenceCompressed32
} from "../src/actor-compressed32.mjs";

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
