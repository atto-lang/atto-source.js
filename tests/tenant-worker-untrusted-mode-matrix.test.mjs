import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('only explicitly trusted Node/Browser worker admission is implemented',()=>{
  assert.equal(requireSupportedTenantWorkerIsolation(),undefined);
  assert.equal(requireSupportedTenantWorkerIsolation(
    {isolation:'trusted-worker',untrusted:false}),undefined);
  assert.equal(requireSupportedTenantWorkerIsolation(Object.create(null)),undefined);
  for(const isolation of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted'])
    assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),
      /is not implemented|not implemented by JS Workers/);
  assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted:true}),
    /separately verified OS sandbox/);
  assert.throws(()=>requireSupportedTenantWorkerIsolation(
    {isolation:'trusted-worker',untrusted:true}),/separately verified OS sandbox/);
});

test('unknown or spoofed isolation option keys cannot silently expand privileges',()=>{
  for(const options of [
    {allowNetwork:false},{unknown:false},
    {'isolation':'trusted-worker',[Symbol('grant')]:true}
  ])assert.throws(()=>requireSupportedTenantWorkerIsolation(options),
    /unknown tenant isolation option/);
  for(const options of [[],null,Date, new Date(),Object.create({untrusted:true})])
    assert.throws(()=>requireSupportedTenantWorkerIsolation(options),
      /plain object|plain data/);
});

test('the admission gate refuses accessors before invoking caller-controlled code',()=>{
  let reads=0;
  for(const key of ['untrusted','isolation']){
    const options={isolation:'trusted-worker',untrusted:false};
    Object.defineProperty(options,key,{enumerable:true,get(){
      reads++;throw Error('hostile option getter');
    }});
    assert.throws(()=>requireSupportedTenantWorkerIsolation(options),
      /must be own data/);
  }
  assert.equal(reads,0);
});

test('truthy non-boolean flags and near-miss mode spellings cannot authorize a worker',()=>{
  for(const untrusted of [1,0,'false',null])
    assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted}),
      /untrusted must be a boolean/);
  for(const isolation of ['Trusted-worker','trusted-worker ','',0])
    assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),
      /unknown tenant isolation mode|tenant isolation mode must be a string/);
});
