import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('trusted worker defaults admit only plain own-data records',()=>{
 for(const options of [undefined,{},Object.create(null),{isolation:'trusted-worker',untrusted:false}])
  assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation(options));
});

test('exotic prototypes, unknown fields and unsupported isolation cannot masquerade as trusted workers',()=>{
 for(const options of [
  [1],new Date(),{untrusted:true},{isolation:'wasmtime-store'},
  {untrusted:0},{bad:1},Object.create({untrusted:false})
 ])assert.throws(()=>requireSupportedTenantWorkerIsolation(options));
});

test('required option accessors fail closed without executing caller code',()=>{
 for(const key of ['untrusted','isolation']){
  let invocations=0;
  const options={};
  Object.defineProperty(options,key,{
   enumerable:true,
   get(){invocations++;throw Error('untrusted accessor executed');}
  });
  assert.throws(()=>requireSupportedTenantWorkerIsolation(options),/tenant isolation options must be own data/);
  assert.equal(invocations,0,key);
 }
});
