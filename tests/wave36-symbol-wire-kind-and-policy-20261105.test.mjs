// Host Symbol wire authority tests only; no compiler or guest parity claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSymbolWireV1, symbolWireEqualV1, stringifySymbolWireV1,
  SymbolWireV1Error} from '../src/symbol-wire-v1.mjs';

const uuid='12345678-1234-1234-1234-123456789abc';

test('wire equality is based on validated kind and name, not member order or object identity',()=>{
  const a={'$symbol':'stable',name:uuid};
  const b={name:uuid,'$symbol':'stable'};
  assert.equal(symbolWireEqualV1(a,b),true);
  assert.equal(symbolWireEqualV1(a,{'$symbol':'process',name:uuid}),false);
  assert.equal(stringifySymbolWireV1(b),JSON.stringify({'$symbol':'stable',name:uuid}));
  const snap=validateSymbolWireV1(a);
  a.name='changed';
  assert.equal(snap.name,uuid);
  assert.equal(Object.isFrozen(snap),true);
  assert.equal(Object.getPrototypeOf(snap),null);
});

test('untrusted-core policy admits only the defined process symbols',()=>{
  for(const name of ['ready','error','Symbol.iterator']){
    const snap=validateSymbolWireV1({'$symbol':'process',name},{policy:'untrusted-core'});
    assert.equal(snap.name,name);
  }
  for(const record of [
    {'$symbol':'stable',name:uuid},
    {'$symbol':'process',name:'supervisor_private'}
  ]) assert.throws(()=>validateSymbolWireV1(record,{policy:'untrusted-core'}),SymbolWireV1Error);
});

test('stable UUID spelling must be lowercase and canonical',()=>{
  for(const name of [uuid.toUpperCase(),uuid.slice(0,-1),uuid+'0'])
    assert.throws(()=>validateSymbolWireV1({'$symbol':'stable',name}),SymbolWireV1Error);
});