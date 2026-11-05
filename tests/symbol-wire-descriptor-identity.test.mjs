// Host wire authority tests; not a compiler/runtime Symbol branding claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSymbolWireV1, symbolWireEqualV1, SymbolWireV1Error} from '../src/symbol-wire-v1.mjs';

const wire = (name='ready') => ({$symbol:'process',name});

test('validated symbol is an immutable independent snapshot of input data', () => {
  const input = wire();
  const snapshot = validateSymbolWireV1(input);
  input.name = 'error';
  assert.equal(snapshot.name, 'ready');
  assert.equal(Object.getPrototypeOf(snapshot), null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(Object.keys(snapshot), ['$symbol','name']);
  assert.equal(symbolWireEqualV1(snapshot, wire()), true);
  assert.equal(symbolWireEqualV1(snapshot, wire('error')), false);
});

test('accessor and non-enumerable field authority is rejected without getter execution', () => {
  let reads = 0;
  const source = wire();
  Object.defineProperty(source, 'name', {enumerable:true,get(){reads++;throw Error('getter ran');}});
  const hidden = wire();
  Object.defineProperty(hidden,'name',{value:'ready',enumerable:false});
  const extra = wire();
  Object.defineProperty(extra,'hidden',{value:'admin',enumerable:false});
  for (const input of [source, hidden, extra, Object.create(wire())]) {
    assert.throws(() => validateSymbolWireV1(input), SymbolWireV1Error);
  }
  assert.equal(reads, 0);
});

test('untrusted-core policy is restricted to exact process core symbols', () => {
  assert.equal(validateSymbolWireV1(wire('ready'), {policy:'untrusted-core'}).name, 'ready');
  for (const input of [wire('custom'),
    {$symbol:'stable',name:'12345678-1234-1234-1234-123456789abc'}]) {
    assert.throws(() => validateSymbolWireV1(input,{policy:'untrusted-core'}), SymbolWireV1Error);
  }
  let reads = 0;
  const opts = {};
  Object.defineProperty(opts, 'policy', {enumerable:true,get(){reads++;return 'trusted';}});
  assert.throws(() => validateSymbolWireV1(wire(),opts), SymbolWireV1Error);
  assert.equal(reads, 0);
});
