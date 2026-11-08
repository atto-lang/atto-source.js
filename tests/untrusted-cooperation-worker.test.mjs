import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {compileUntrusted} from '../src/compiler.mjs';
import {spawnNodeActor} from '../src/actor-host.node.mjs';

const CLI=resolve('bin/oreslang-jsc.mjs');

test('actual CLI emits metered scalar ESM only with explicit entry-metered opt-in', async () => {
  const dir=await mkdtemp(join(tmpdir(),'atto-js-meter-cli-'));
  const source=join(dir,'main.ores'),output=join(dir,'main.mjs');
  try {
    await writeFile(source,'pub fnc main(): int { return 42; }',{mode:0o600});
    const run=spawnSync(process.execPath,[CLI,'--entry-metered-scalar',source,
      '--out='+output],{encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr);
    assert.match(await readFile(output,'utf8'),/ATTO_GUEST_FUEL_EXHAUSTED/);
    const normal=spawnSync(process.execPath,[CLI,'--check',source],
      {encoding:'utf8',timeout:20000});
    assert.equal(normal.status,0,normal.stderr);
    const bad=spawnSync(process.execPath,[CLI,'--entry-metered-scalar',
      '--program-v2',source],{encoding:'utf8',timeout:20000});
    assert.notEqual(bad.status,0,'must not silently compile a different dialect');
    assert.equal((await stat(output)).isFile(),true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('compiled guest hard-fuel exhaustion retires only the offending Node Worker', async () => {
  const dir=await mkdtemp(join(tmpdir(),'atto-js-meter-actor-'));
  const path=join(dir,'guest.mjs');
  // Acyclic pure helper graph: 1+2+4+...+2048 = 4095 helper
  // entries; the exported spin() is the 4096th entry. The real compiler
  // must emit all 4096 entry checkpoints, not silently bypass helper calls.
  const declarations=['fnc f0(): int { return 1; }'];
  for(let i=1;i<=11;i++)
    declarations.push(`fnc f${i}(): int { return f${i-1}() + f${i-1}(); }`);
  declarations.push('pub fnc spin(): int { return f11(); }');
  declarations.push('pub fnc healthy(): int { return 42; }');
  let bad,good;
  try {
    await writeFile(path,compileUntrusted(declarations.join('\n')),{mode:0o600});
    const moduleUrl=pathToFileURL(path).href;
    bad=spawnNodeActor({moduleUrl,exportName:'spin',mode:'call'});
    good=spawnNodeActor({moduleUrl,exportName:'healthy',mode:'call'});
    await Promise.all([bad.ready,good.ready]);
    await assert.rejects(bad.request({args:[]}),/guest execution fuel exhausted/);
    await assert.rejects(bad.request({args:[]}),/actor closed/);
    assert.equal(await good.request({args:[]}),42n);
    assert.equal(await good.request({args:[]}),42n);
  }finally{
    if(bad)await bad.close();
    if(good)await good.close();
    await rm(dir,{recursive:true,force:true});
  }
});
