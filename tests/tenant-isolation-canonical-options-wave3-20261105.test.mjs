import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation as admit} from '../src/tenant-isolation-policy.mjs';

test('default and explicitly trusted worker mode allow inert canonical records',()=>{
  assert.doesNotThrow(()=>admit());
  assert.doesNotThrow(()=>admit({isolation:'trusted-worker',untrusted:false}));
  const nullRecord=Object.create(null);
  nullRecord.isolation='trusted-worker';
  assert.doesNotThrow(()=>admit(Object.freeze(nullRecord)));
});

test('untrusted and unavailable isolation modes never silently become Worker trust',()=>{
  for(const isolation of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted'])
    assert.throws(()=>admit({isolation}),/not implemented by JS Workers/,isolation);
  assert.throws(()=>admit({isolation:'trusted-worker',untrusted:true}),/separately verified OS sandbox/);
  assert.throws(()=>admit({isolation:'trusted-worker',untrusted:'false'}),/must be a boolean/);
});

test('inherited authority, symbol keys and accessors cannot forge accepted options',()=>{
  const inherited=Object.create({untrusted:false});
  assert.throws(()=>admit(inherited),/plain data/);
  assert.throws(()=>admit({[Symbol('isolation')]:'trusted-worker'}),/unknown tenant isolation option/);
  let getterCalls=0;
  const options={};
  Object.defineProperty(options,'untrusted',{enumerable:true,get(){getterCalls++;throw Error('unexpected getter');}});
  assert.throws(()=>admit(options),/must be own data/);
  assert.equal(getterCalls,0);
});
