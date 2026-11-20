import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';

test('inert own-data defaults remain valid with frozen or null-prototype options', () => {
  for (const options of [undefined, {}, Object.freeze({isolation:'trusted-worker',untrusted:false}),
                        Object.assign(Object.create(null), {untrusted:false})])
    assert.doesNotThrow(() => requireSupportedTenantWorkerIsolation(options));
});

test('inherited or unknown option names never become ambient tenant authority', () => {
  let invoked = 0;
  const inherited = Object.create({get isolation(){invoked++;throw Error('inherited getter executed')}});
  for (const options of [inherited, {untrusted:false,extra:true},
                         {[Symbol.toStringTag]:'trusted-worker'}, new Date(), []]) {
    assert.throws(() => requireSupportedTenantWorkerIsolation(options));
  }
  assert.equal(invoked,0);
});

test('accessor-bearing required or unknown fields cannot execute during admission', () => {
  for (const key of ['isolation','untrusted','unknown']) {
    let invoked=0;
    const options={};
    Object.defineProperty(options,key,{enumerable:true,
      get(){invoked++;throw Error('untrusted getter invoked')}});
    assert.throws(() => requireSupportedTenantWorkerIsolation(options));
    assert.equal(invoked,0,key);
  }
});

test('nonenumerable data and unsupported isolation modes are rejected', () => {
  assert.throws(() => requireSupportedTenantWorkerIsolation(
    Object.defineProperty({},'isolation',{value:'trusted-worker',enumerable:false})));
  for(const options of [
    {untrusted:true},{untrusted:0},{untrusted:'false'},
    {isolation:'wasmtime-store'},{isolation:'vm-isolate'},
    {isolation:'sandboxed-process'},{isolation:'untrusted'},
    {isolation:'trusted-worker',untrusted:true}
  ]) assert.throws(() => requireSupportedTenantWorkerIsolation(options));
});
