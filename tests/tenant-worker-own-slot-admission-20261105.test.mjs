import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('plain and null-prototype trusted option records remain valid',()=>{
 for(const options of [
  {},Object.freeze({isolation:'trusted-worker',untrusted:false}),
  Object.assign(Object.create(null),{isolation:'trusted-worker'}),
  Object.freeze({untrusted:false})
 ])assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation(options));
});

test('non-enumerable and accessor own slots never grant Worker isolation',()=>{
 let invoked=0;
 for(const field of ['isolation','untrusted']){
  const options={};
  Object.defineProperty(options,field,{enumerable:false,value:field==='untrusted'?false:'trusted-worker'});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(options),/own data/);
  const getter={};
  Object.defineProperty(getter,field,{enumerable:true,get(){invoked++;throw Error('getter executed');}});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(getter),/own data/);
 }
 assert.equal(invoked,0);
});

test('unsupported sandbox claims and shadow privilege names remain forbidden',()=>{
 for(const isolation of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted']){
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),/not implemented by JS Workers/);
 }
 for(const options of [
  {isolation:'trusted-worker',untrusted:true},
  {untrusted:'false'}, {maxWorkers:4096},
  Object.create({isolation:'trusted-worker'}),{[Symbol('authority')]:true}
 ])assert.throws(()=>requireSupportedTenantWorkerIsolation(options));
});