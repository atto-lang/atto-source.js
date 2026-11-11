// Host-only Symbol wire tests, not compiled Symbol identity on guest targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SymbolWireV1Error,validateSymbolWireV1,
  symbolWireEqualV1,stringifySymbolWireV1,parseSymbolWireJsonV1}
  from '../src/symbol-wire-v1.mjs';

const wire=(kind,name)=>({'$symbol':kind,name});

test('lowercase stable UUID is canonical, distinct from process-name identity',()=>{
  const uuid='550e8400-e29b-41d4-a716-446655440000';
  const stable=validateSymbolWireV1(wire('stable',uuid));
  const process=validateSymbolWireV1(wire('process',uuid));
  assert.equal(symbolWireEqualV1(stable,process),false);
  assert.equal(symbolWireEqualV1(stable,parseSymbolWireJsonV1(stringifySymbolWireV1(stable))),true);
  for(const invalid of [uuid.toUpperCase(),uuid.replace(/-/g,''),uuid+'a'])
    assert.throws(()=>validateSymbolWireV1(wire('stable',invalid)),SymbolWireV1Error);
});

test('UTF-8 byte ceiling is inclusive even for astral names',()=>{
  assert.equal(validateSymbolWireV1(wire('process','x'.repeat(256))).name.length,256);
  assert.throws(()=>validateSymbolWireV1(wire('process','x'.repeat(257))),/256 UTF-8 bytes/);
  assert.equal(validateSymbolWireV1(wire('process','😀'.repeat(64))).name.length,128);
  assert.throws(()=>validateSymbolWireV1(wire('process','😀'.repeat(65))),/256 UTF-8 bytes/);
});

test('untrusted core symbols cannot be promoted into stable identities',()=>{
  const opts={policy:'untrusted-core'};
  assert.equal(validateSymbolWireV1(wire('process','ready'),opts).name,'ready');
  assert.throws(()=>validateSymbolWireV1(
    wire('stable','550e8400-e29b-41d4-a716-446655440000'),opts
  ),/denied/);
  assert.throws(()=>validateSymbolWireV1(wire('process','user.ready'),opts),/denied/);
});
