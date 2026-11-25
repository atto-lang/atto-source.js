// Node/JS Worker host contract; not a tenant security sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tenantIsolationOptionsOf,requireSupportedTenantWorkerIsolation}
  from '../src/tenant-isolation-policy.mjs';

test('plain null-prototype trusted options are admitted, inherited modes denied', () => {
  const clean = Object.create(null);
  clean.isolation = 'trusted-worker';
  clean.untrusted = false;
  assert.doesNotThrow(() => requireSupportedTenantWorkerIsolation(clean));
  assert.doesNotThrow(() => requireSupportedTenantWorkerIsolation({}));
  const inherited = Object.create({isolation:'trusted-worker'});
  assert.throws(() => requireSupportedTenantWorkerIsolation(inherited), /plain data/);
});

test('projection preserves accessors inertly, without inheriting unrelated keys', () => {
  let reads=0;
  const parent={irrelevant:'spawn detail'};
  Object.defineProperty(parent,'isolation',{enumerable:true,get(){reads++;return 'trusted-worker'}});
  const projected=tenantIsolationOptionsOf(parent);
  assert.equal(Object.hasOwn(projected,'irrelevant'),false);
  assert.equal(Object.hasOwn(projected,'isolation'),true);
  assert.throws(() => requireSupportedTenantWorkerIsolation(projected),/own data/);
  assert.equal(reads,0);
});
