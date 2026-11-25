import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedBytesV1} from '../src/owned-bytes-v1.mjs';

// HOST JS primitive only. This does NOT compile std.buffer from .atto.
test('u8/u16/u32 are unsigned and little/big endian exact', () => {
  const owner = Object.freeze({});
  for(const endian of ['le','be']) {
    const b = new OwnedBytesV1(owner, 8, 8);
    b.writeUint(owner, 0, 4, 0x12345678, endian);
    assert.equal(b.readUint(owner, 0, 4, endian), 0x12345678);
    assert.equal(b.readUint(owner, 4, 4, endian), 0);
    b.writeUint(owner, 4, 4, 4294967295, endian);
    assert.equal(b.readUint(owner, 4, 4, endian), 4294967295);
    b.retire(owner);
    assert.throws(() => b.readUint(owner, 0, 1, endian), /retired/);
  }
});

test('unsigned endian primitive checks offsets/width/range atomically', () => {
  const owner = Object.freeze({}), b = new OwnedBytesV1(owner, 8, 8);
  b.writeUint(owner, 1, 4, 0x12345678, 'le');
  for(const offset of [-1,5,Number.MAX_SAFE_INTEGER,Number.MAX_VALUE,NaN,0.5]) {
    assert.throws(() => b.readUint(owner,offset,4,'le'), RangeError);
    assert.throws(() => b.writeUint(owner,offset,4,42,'le'), RangeError);
    assert.equal(b.readUint(owner,1,4,'le'), 0x12345678);
  }
  for(const v of [-1,4294967296,Infinity,NaN,0.5,'42']) {
    assert.throws(() => b.writeUint(owner,1,4,v,'le'), RangeError);
    assert.equal(b.readUint(owner,1,4,'le'), 0x12345678);
  }
  for(const width of [0,3,8]) {
    assert.throws(() => b.writeUint(owner,0,width,42,'le'), RangeError);
  }
  for(const endian of [null,undefined,'native','BE']) {
    assert.throws(() => b.writeUint(owner,0,4,42,endian), TypeError);
  }
});

test('opaque identity and quota enforce local owner and generation boundaries', () => {
  const a = Object.freeze({}), b = Object.freeze({});
  const bytes = new OwnedBytesV1(a,4,4);
  assert.throws(() => bytes.readUint(b,0,1,'le'), /foreign/);
  assert.throws(() => bytes.writeUint(b,0,1,42,'le'), /foreign/);
  assert.throws(() => new OwnedBytesV1(a,-1,4), RangeError);
  assert.throws(() => new OwnedBytesV1(a,5,4), RangeError);
  assert.throws(() => new OwnedBytesV1(a,1024*1024+1,1024*1024+1), RangeError);
  const zero = new OwnedBytesV1(a,0,0);
  assert.equal(zero.getLength(a),0);
  assert.throws(() => zero.readUint(a,0,1,'le'),RangeError);
  bytes.retire(a);
  assert.throws(() => bytes.retire(a),/retired/);
});

test('100k native JS host round trips keep full 32-bit unsigned values', () => {
  const owner = Object.freeze({});
  const b = new OwnedBytesV1(owner,10,10);
  let state = 0x12345678;
  for(let i=0;i<100_000;i++) {
    state = (Math.imul(state,1664525)+1013904223)>>>0;
    const endian = i%2?'be':'le';
    b.writeUint(owner,3,4,state,endian);
    assert.equal(b.readUint(owner,3,4,endian),state);
  }
  b.retire(owner);
});
