import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('canonical CLI requires exact compiler digest and emits executed actor ESM',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'canonical-js-'));
  try{
    const source=join(dir,'main.atto');await writeFile(source,'define actor A as let int n = 0; receive(ActorMail<int> mail): void { self.n = self.n + mail.value; stdio.println(self.n); return; } end pub fnc main(): int { val a = spawn A(); a.send(42); return 0; }');
    const receipt=JSON.parse(await readFile(new URL('../test-support/canonical-compiler.receipt.json',import.meta.url)));
    const cli=fileURLToPath(new URL('../bin/oreslang-jsc.mjs',import.meta.url)),compiler=fileURLToPath(new URL('../test-support/canonical-compiler.wasm',import.meta.url));
    const run=digest=>spawnSync(process.execPath,[cli,'--canonical-browser','--compiler='+compiler,'--compiler-sha256='+digest,source],{encoding:'utf8',timeout:10000});
    const good=run(receipt.compiler_sha256);assert.equal(good.status,0,good.stderr);
    const ns=await import('data:text/javascript,'+encodeURIComponent(good.stdout));
    const {runCanonicalGuest}=await import('../src/canonical-actor-runtime.mjs');assert.equal(runCanonicalGuest(ns).stdout,'42\n');
    const bad=run('0'.repeat(64));assert.notEqual(bad.status,0);assert.equal(bad.stdout,'');
  }finally{await rm(dir,{recursive:true,force:true});}
});
