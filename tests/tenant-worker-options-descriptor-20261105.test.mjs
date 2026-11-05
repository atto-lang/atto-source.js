import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('trusted Worker admission has no ambient OS isolation capability',()=>{
 assert.equal(requireSupportedTenantWorkerIsolation(),undefined);
 assert.equal(requireSupportedTenantWorkerIsolation(
  Object.assign(Object.create(null),{isolation:'trusted-worker',untrusted:false})),undefined);
 assert.equal(requireSupportedTenantWorkerIsolation({untrusted:false}),undefined);
});

test('hidden and accessor-backed own options fail before caller getters execute',()=>{
 let calls=0;
 for(const key of ['isolation','untrusted']){
  const hidden={isolation:'trusted-worker',untrusted:false};
  Object.defineProperty(hidden,key,{enumerable:false,value:key==='isolation'?'trusted-worker':false});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(hidden),/own data/);
  const getter={isolation:'trusted-worker',untrusted:false};
  Object.defineProperty(getter,key,{enumerable:true,get(){calls++;throw Error('hostile');}});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(getter),/own data/);
 }
 assert.equal(calls,0);
});

test('symbolic, inherited and unexpected options cannot grant authority',()=>{
 assert.throws(()=>requireSupportedTenantWorkerIsolation(
  {isolation:'trusted-worker',[Symbol('trusted')]:true}),/unknown tenant isolation option/);
 assert.throws(()=>requireSupportedTenantWorkerIsolation(Object.create({untrusted:false})),/plain data/);
 assert.throws(()=>requireSupportedTenantWorkerIsolation({sandbox:true}),/unknown tenant isolation option/);
});

test('unsupported sandbox modes and untrusted actors fail closed',()=>{
 assert.throws(()=>requireSupportedTenantWorkerIsolation(
  {isolation:'trusted-worker',untrusted:true}),/separately verified OS sandbox/);
 for(const isolation of ['vm-isolate','wasmtime-store','sandboxed-process','untrusted'])
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation}),/not implemented/);
});
