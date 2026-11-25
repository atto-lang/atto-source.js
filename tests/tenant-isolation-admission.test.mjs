import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSupportedTenantWorkerIsolation} from '../src/tenant-isolation-policy.mjs';
import {spawnNodeActor} from '../src/actor-host.node.mjs';
import {spawnBrowserActor} from '../src/actor-host.browser.mjs';

test('ordinary trusted Workers remain explicitly in-process',()=>{
  assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation({}));
  assert.doesNotThrow(()=>requireSupportedTenantWorkerIsolation({isolation:'trusted-worker'}));
});

test('hostile tenant mode always fails closed',()=>{
  for(const isolation of ['trusted-worker','wasmtime-store','vm-isolate','sandboxed-process','untrusted']){
    assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation,untrusted:true}),/OS sandbox/);
  }
});

test('unsupported physical-tenant mode cannot instantiate Node or browser Workers',()=>{
  for(const isolation of ['wasmtime-store','vm-isolate','sandboxed-process','untrusted']){
    assert.throws(()=>spawnNodeActor({isolation,moduleUrl:'file:///trusted.js'}),/not implemented/);
    let called=0;
    assert.throws(()=>spawnBrowserActor({isolation,moduleUrl:'https://example.org/trusted.js',
      WorkerCtor:class {constructor(){called++;}}}),/not implemented/);
    assert.equal(called,0,'browser Worker must not be constructed after denial');
  }
});

test('malformed tenant security settings fail before Worker startup',()=>{
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation:4}),TypeError);
  assert.throws(()=>requireSupportedTenantWorkerIsolation({untrusted:'false'}),TypeError);
  assert.throws(()=>requireSupportedTenantWorkerIsolation({isolation:'typo'}),TypeError);
});
