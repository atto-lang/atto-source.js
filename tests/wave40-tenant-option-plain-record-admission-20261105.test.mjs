// Trusted JS Worker option shape only; not an OS tenant sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tenantIsolationOptionsOf,requireSupportedTenantWorkerIsolation}
  from '../src/tenant-isolation-policy.mjs';

test('projection copies only named own isolation slots without elevating spawn keys', () => {
  const original=Object.create(null);
  original.isolation='trusted-worker';original.untrusted=false;
  original.script='worker.js';
  const projected=tenantIsolationOptionsOf(original);
  assert.equal(Object.getPrototypeOf(projected),null);
  assert.deepEqual(Reflect.ownKeys(projected),['isolation','untrusted']);
  assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation(projected));
  assert.throws(()=>requireSupportedTenantWorkerIsolation(original),/unknown tenant isolation option/);
});

test('inherited and getter modes fail closed without calling accessors', () => {
  const inherited=Object.create({isolation:'trusted-worker'});
  assert.throws(()=>requireSupportedTenantWorkerIsolation(inherited),/plain data/);
  let reads=0;
  const hostile={};
  Object.defineProperty(hostile,'untrusted',{enumerable:true,get(){reads++;return false;}});
  const projected=tenantIsolationOptionsOf(hostile);
  assert.throws(()=>requireSupportedTenantWorkerIsolation(projected),/own data/);
  assert.equal(reads,0);
});

test('untrusted mode never silently downgrades to trusted Worker', () => {
  assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted:true}),/untrusted tenant requires a verified TenantVM execution boundary/);
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation:'sandboxed-process'}),/not implemented/);
});
