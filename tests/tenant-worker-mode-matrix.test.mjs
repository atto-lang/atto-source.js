import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('only explicitly trusted Worker modes are accepted',()=>{
 for(const options of [{}, {isolation:'trusted-worker'}, {untrusted:false}, {isolation:'trusted-worker',untrusted:false}, Object.assign(Object.create(null),{isolation:'trusted-worker'})])
  assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation(options));
 for(const isolation of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted'])
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),/not implemented by JS Workers/);
 for(const isolation of ['unknown','trusted-Worker','TRUSTED-WORKER'])
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),/unknown tenant isolation mode/);
});

test('untrusted flag cannot be bypassed by ordering or incompatible modes',()=>{
 for(const isolation of ['trusted-worker','wasmtime-store','vm-isolate'])
  assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted:true,isolation}),/untrusted tenant requires a verified TenantVM execution boundary/);
 for(const untrusted of ['false',0,1,null])
  assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted}),/untrusted must be a boolean/);
});

test('foreign, inherited, symbol and accessor-bearing option data fail before getter execution',()=>{
 for(const options of [null,[],42,new Date(),Object.create({isolation:'trusted-worker'}),{mystery:1},{[Symbol('isolation')]:1}])
  assert.throws(()=>requireSupportedTenantWorkerIsolation(options));
 for(const key of ['untrusted','isolation']){
  let hits=0;const options={};
  Object.defineProperty(options,key,{enumerable:true,get(){hits++;throw Error('executed option getter');}});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(options),/tenant isolation options must be own data/);
  assert.equal(hits,0);
 }
});