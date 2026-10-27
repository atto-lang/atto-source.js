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
    new URL('file://fileserver.example/share/actor.mjs'),
    // WHATWG normalization differs across Node 22 patch releases: these
    // variants may become authorities, leading/repeated slashes, or otherwise
    // noncanonical file paths. All must be denied before Worker creation.
    String.raw`file:\\fileserver.example\share\actor.mjs`,
    String.raw`file:/\fileserver.example\share\actor.mjs`,
    new URL(String.raw`file:/\fileserver.example\share\actor.mjs`),
    String.raw`file:///tmp\actor.mjs`,
    'file:///tmp//actor.mjs',
    'file:////./UNC/fileserver.example/share/actor.mjs',
    'file:////?/UNC/fileserver.example/share/actor.mjs',
    'file:///%2e%2e/%2e%2e/..//fileserver.example/share/actor.mjs',
    'file://%66ileserver.example/share/actor.mjs',
    'file://fileserver.example./share/actor.mjs',
    'file://localhost./share/actor.mjs',
    'file://2130706433/share/actor.mjs',
    'file://0x7f000001/share/actor.mjs',
    'file:////./C$/Windows/System32/actor.mjs',
    'file:///C:/%5C%5Cfileserver.example%5Cshare%5Cactor.mjs',
    'file:///%5C%3F%5CUNC%5Cfileserver.example%5Cshare%5Cactor.mjs',
    'file:///tmp/%00actor.mjs',
    'file:///tmp/a%00b.mjs',
    new URL('file:///tmp/a%00b.mjs'),
    // Node otherwise normalizes ambiguous file: shorthand into an absolute
    // URL; malformed percent escapes fail only later during path decoding.
    'file:actor.mjs',
    'file:./actor.mjs',
    'file:/tmp/actor.mjs',
    'file://localhost',
    'file:///tmp/%',
    'file:///tmp/%GG',
    'file:///tmp/%0',
    'file:///tmp/actor.mjs%',
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

test('Node actor treats normalized localhost authorities as local', async () => {
  for (const authority of ['localhost','LOCALHOST']) {
    const localhost = new URL(local.href.replace(/^file:\/\//, `file://${authority}`));
    assert.equal(localhost.host, '');
    const actor = spawnNodeActor({moduleUrl:localhost.href});
    try {
      await actor.ready;
      assert.equal(await actor.request({type:'add',x:1n,y:2n}),3n);
    } finally {
      await actor.close();
    }
  }
});
