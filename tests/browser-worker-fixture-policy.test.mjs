import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  resolveBrowserWorkerFixture,BrowserWorkerFixtureAccessError
} from '../scripts/browser-worker-fixture-path.mjs';

async function withSandbox(callback){
  const root=await mkdtemp(join(tmpdir(),'ores-js-browser-policy-'));
  try{
    await mkdir(join(root,'src'),{recursive:true});
    await mkdir(join(root,'tests','fixtures'),{recursive:true});
    await mkdir(join(root,'.github','workflows'),{recursive:true});
    await writeFile(join(root,'src','compiler.mjs'),'export const answer=42;');
    await writeFile(join(root,'tests','fixtures','worker.ores'),'pub fnc f(): int {return 42;}');
    await writeFile(join(root,'tests','worker.html'),'<!doctype html>');
    await writeFile(join(root,'tests','.hidden.mjs'),'should never be served');
    await writeFile(join(root,'secret.mjs'),'secret content');
    await writeFile(join(root,'.github','workflows','secrets.mjs'),'secret content');
    await writeFile(join(root,'tests','fixtures','wrong.json'),'{"private":true}');
    await symlink(join(root,'secret.mjs'),join(root,'src','escaped.mjs'));
    await symlink(join(root,'tests','.hidden.mjs'),join(root,'src','hidden-alias.mjs'));
    await symlink(join(root,'tests','worker.html'),join(root,'src','allowed.html'));
    await callback(root);
  }finally{await rm(root,{recursive:true,force:true});}
}
const denied=async(root,url)=>{
  await assert.rejects(resolveBrowserWorkerFixture(root,url),
    error=>error instanceof BrowserWorkerFixtureAccessError,
    url);
};

test('loopback browser fixture policy admits only actual src/tests files and MIME types',async()=>{
  await withSandbox(async root=>{
    const src=await resolveBrowserWorkerFixture(root,'/src/compiler.mjs');
    assert.equal(src.path,join(root,'src','compiler.mjs'));
    assert.equal(src.contentType,'text/javascript; charset=utf-8');
    const ores=await resolveBrowserWorkerFixture(root,'/tests/fixtures/worker.ores?cache=off');
    assert.equal(ores.contentType,'text/plain; charset=utf-8');
    const html=await resolveBrowserWorkerFixture(root,'/tests/worker.html');
    assert.equal(html.contentType,'text/html; charset=utf-8');
    const internalLink=await resolveBrowserWorkerFixture(root,'/src/allowed.html');
    assert.equal(internalLink.path,join(root,'tests','worker.html'));
  });
});

test('loopback browser fixture policy denies path traversal, private roots and hidden files',async()=>{
  await withSandbox(async root=>{
    for(const url of [
      '/secret.mjs',
      '/.github/workflows/secrets.mjs',
      '/src/../secret.mjs',
      '/src/../tests/worker.html',
      '/src/%2e%2e/tests/worker.html',
      '//untrusted/src/compiler.mjs',
      '/src/%2e%2e/secret.mjs',
      '/src/../../.github/workflows/secrets.mjs',
      '/tests/.hidden.mjs',
      '/tests/fixtures/wrong.json',
      '/src/escaped.mjs',
      '/src/hidden-alias.mjs',
      '/src/not-there.mjs/../escaped.mjs'
    ]) await denied(root,url);
  });
});

test('loopback browser fixture policy rejects oversized and malformed request paths',async()=>{
  await withSandbox(async root=>{
    await denied(root,'/src/'+'x'.repeat(4100)+'.mjs');
    await assert.rejects(resolveBrowserWorkerFixture(root,'/src/%ZZ.mjs'),
      /URI malformed/);
  });
});
