import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation as admit} from '../src/tenant-isolation-policy.mjs';

test('null-prototype option records remain supported without a prototype inheritance dependency',()=>{
  const options=Object.create(null);
  options.isolation='trusted-worker';
  options.untrusted=false;
  assert.doesNotThrow(()=>admit(options));
  assert.doesNotThrow(()=>admit(Object.create(null)));
});

test('untrusted identity is denied even when isolation says trusted-worker',()=>{
  const options=Object.create(null);
  options.isolation='trusted-worker';
  options.untrusted=true;
  assert.throws(()=>admit(options),/separately verified OS sandbox/);
});

test('null-prototype records must not bypass unknown-option checks',()=>{
  const options=Object.create(null);
  options.isolation='trusted-worker';
  options.extra='not an approved option';
  assert.throws(()=>admit(options),/unknown tenant isolation option/);
});
