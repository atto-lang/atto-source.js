import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSymbolWireV1,parseSymbolWireJsonV1,stringifySymbolWireV1
} from '../src/symbol-wire-v1.mjs';

const wire=name=>({'$symbol':'process',name});

test('UTF-8 byte budget accepts exactly 256 bytes and denies the first byte overage',()=>{
  for(const name of ['中'.repeat(85),'🌍'.repeat(64)]) {
    const validated=validateSymbolWireV1(wire(name));
    assert.equal(validated.name,name);
    assert.deepEqual({...parseSymbolWireJsonV1(stringifySymbolWireV1(wire(name)))},wire(name));
  }
  for(const name of ['中'.repeat(86),'🌍'.repeat(65)])
    assert.throws(()=>validateSymbolWireV1(wire(name)),/1..256 UTF-8 bytes/);
});

test('UTF-16 surrogate errors are denied before normalization or wire publication',()=>{
  for(const name of ['\ud800','\udc00','ok\ud800bad'])
    assert.throws(()=>validateSymbolWireV1(wire(name)),/unpaired UTF-16 surrogate/);
  assert.equal(validateSymbolWireV1(wire('🌍')).name,'🌍');
});

test('escaped JSON member aliases cannot make a second name authoritative',()=>{
  for(const source of [
    '{"$symbol":"process","name":"ready","\\u006eame":"other"}',
    '{"$symbol":"process","\\u006eame":"ready","name":"other"}'
  ])assert.throws(()=>parseSymbolWireJsonV1(source),/duplicate JSON member/);
  assert.equal(parseSymbolWireJsonV1('{"name":"ready","$symbol":"process"}').name,'ready');
});

test('untrusted-core cannot obtain stable or userland Symbol identity',()=>{
  assert.equal(validateSymbolWireV1(wire('ready'),{policy:'untrusted-core'}).name,'ready');
  assert.throws(()=>validateSymbolWireV1(wire('tenant/ready'),{policy:'untrusted-core'}),/denied/);
  assert.throws(()=>validateSymbolWireV1(
    {'$symbol':'stable',name:'550e8400-e29b-41d4-a716-446655440000'},
    {policy:'untrusted-core'}),/denied/);
});
