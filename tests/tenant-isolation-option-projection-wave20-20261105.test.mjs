import test from 'node:test';
import assert from 'node:assert/strict';
import {tenantIsolationOptionsOf as project,requireSupportedTenantWorkerIsolation as admit} from '../src/tenant-isolation-policy.mjs';

test('projection drops unrelated spawn options and preserves only allowed values',()=>{
 const options={workerData:{secret:'not policy'},resourceLimits:{maxOldGenerationSizeMb:2},
  isolation:'trusted-worker',untrusted:false};
 const picked=project(options);
 assert.equal(Object.getPrototypeOf(picked),null);
 assert.deepEqual(Reflect.ownKeys(picked),['isolation','untrusted']);
 assert.equal(picked.isolation,'trusted-worker');
 assert.equal(admit(picked),undefined);
 assert.throws(()=>admit(options),/unknown tenant isolation option/);
});

test('projection snapshots an accessor descriptor without evaluating it',()=>{
 let called=0;
 const options={workerData:true};
 Object.defineProperty(options,'isolation',{enumerable:true,get(){called++;return 'trusted-worker';}});
 const picked=project(options);
 assert.equal(called,0);
 assert.throws(()=>admit(picked),/tenant isolation options must be own data/);
 assert.equal(called,0);
});

test('inherited and symbol-bearing spawn options cannot manufacture isolation authority',()=>{
 const options=Object.create({untrusted:true,isolation:'wasmtime-store'});
 options.workerData={};
 const projected=project(options);
 assert.deepEqual(Reflect.ownKeys(projected),[]);
 assert.doesNotThrow(()=>admit(projected));
 const suspicious={untrusted:false,[Symbol('privilege')]:true};
 assert.deepEqual(Reflect.ownKeys(project(suspicious)),['untrusted']);
 assert.throws(()=>admit(suspicious),/unknown tenant isolation option/);
});

test('untrusted tenants and unsupported isolation modes reject before JS Worker admission',()=>{
 for(const value of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted'])
  assert.throws(()=>admit({isolation:value,untrusted:false}),/boundary is not implemented/);
 assert.throws(()=>admit({isolation:'trusted-worker',untrusted:true}),/untrusted tenant requires a verified TenantVM execution boundary/);
 assert.throws(()=>admit({isolation:'trusted-worker',untrusted:'false'}),/must be a boolean/);
});
