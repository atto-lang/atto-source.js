import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation as admit} from '../src/tenant-isolation-policy.mjs';

test('own isolation getter is refused without executing user code',()=>{
  let calls=0;
  const options={};
  Object.defineProperty(options,'isolation',{enumerable:true,get(){calls++;throw Error('getter executed')}});
  assert.throws(()=>admit(options),/own data/);
  assert.equal(calls,0);
});

test('nonenumerable and symbol option authorities fail closed',()=>{
  const hidden={};
  Object.defineProperty(hidden,'isolation',{value:'trusted-worker'});
  assert.throws(()=>admit(hidden),/own data/);
  assert.throws(()=>admit({[Symbol('untrusted')]:false}),/unknown tenant isolation option/);
});

test('incorrect option types and unsupported modes remain distinct denials',()=>{
  assert.throws(()=>admit({untrusted:0}),/untrusted must be a boolean/);
  assert.throws(()=>admit({isolation:42}),/mode must be a string/);
  assert.throws(()=>admit({isolation:'wasmtime-store'}),/not implemented by JS Workers/);
  assert.throws(()=>admit({isolation:'workr'}),/unknown tenant isolation mode/);
});
