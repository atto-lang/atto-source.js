import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile,compileToIR,check} from '../src/compiler.mjs';

test('actual scalar compiler rejects singleton spellings with one stable capability diagnostic',()=>{
  for(const src of [
    'define singleton S as end',
    'define pub singleton S as end',
    'pub define singleton S as end',
    'define /* inert */ singleton S as end',
    'define module M as define singleton S as end end',
    'pub fnc main(): int { return 7; } define singleton S as end',
  ]) {
    for(const fn of [compileToIR,compile,check])
      assert.throws(()=>fn(src),/ORES-SINGLETON-UNSUPPORTED/,src);
  }
});

test('singleton stays contextual, comments and similar identifiers are not declarations',()=>{
  for(const src of [
    'pub fnc singleton(): int { return 7; }',
    'pub fnc main(int singleton): int { return singleton; }',
    'pub fnc main(): int { return singleton(); } fnc singleton(): int { return 7; }',
    '// define singleton Fake as end\npub fnc main(): int { return 7; }',
    '/* define pub singleton Fake as end */ pub fnc main(): int { return 7; }',
    'pub fnc singleton_factory(): int { return 7; }',
  ]) assert.doesNotThrow(()=>compile(src),src);
});

test('rejected singleton cannot publish a JS artifact from the shipping CLI',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ores-js-singleton-'));
  const src=join(dir,'source.atto'),out=join(dir,'output.mjs');
  try {
    await writeFile(src,'define pub singleton S as end');
    const done=spawnSync(process.execPath,[resolve('bin/oreslang-jsc.mjs'),src,'--out='+out],{encoding:'utf8'});
    assert.notEqual(done.status,0);
    assert.match(done.stderr,/ORES-SINGLETON-UNSUPPORTED/);
    await assert.rejects(readFile(out),{code:'ENOENT'});
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
