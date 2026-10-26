import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnNodeActor} from '../src/actor-host.node.mjs';

const local = new URL('./fixtures/worker-handler.mjs', import.meta.url);

test('Node actor denies remote file authorities and UNC-equivalent paths before spawning', () => {
  for (const moduleUrl of [
    'file://fileserver.example/share/actor.mjs',
    'file://127.0.0.1/share/actor.mjs',
    'file://[::1]/share/actor.mjs',
    'file:////fileserver.example/share/actor.mjs',
    'file:////127.0.0.1/share/actor.mjs',
    'file:///%5C%5Cfileserver.example%5Cshare%5Cactor.mjs',
    'file:///%2Ffileserver.example/share/actor.mjs',
    new URL('file://fileserver.example/share/actor.mjs')
  ]) {
    assert.throws(
      () => spawnNodeActor({moduleUrl}),
      /trusted file: URL without remote authority or UNC path/,
      String(moduleUrl)
    );
  }
});

test('Node actor continues to accept trusted local file URLs', async () => {
  const actor = spawnNodeActor({moduleUrl:local});
  try {
    await actor.ready;
    assert.equal(await actor.request({type:'add',x:40n,y:2n}),42n);
  } finally {
    await actor.close();
  }
});

test('Node actor treats file://localhost as local, not a remote UNC authority', async () => {
  const localhost = new URL(local.href.replace(/^file:\/\//, 'file://localhost'));
  assert.equal(localhost.host, '');
  const actor = spawnNodeActor({moduleUrl:localhost.href});
  try {
    await actor.ready;
    assert.equal(await actor.request({type:'add',x:1n,y:2n}),3n);
  } finally {
    await actor.close();
  }
});
