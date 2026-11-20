import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compile} from '../src/compiler.mjs';
import {buildPackage} from '../src/build-package.mjs';

// A host WorkerMixedLayout instance is NOT evidence that the Oreslang source
// compiler supports actor-owned inverted classes, borrowing or ECS rows.
const pendingGuestPrograms=[
  'define inverted class Entity as val int id; end pub fnc main():int{return 42;}',
  'define actor Store as end pub fnc main():int{return 42;}',
  'pub fnc main():int{return rt borrow state;}',
  'pub fnc main():int{return row.id;}',
  'pub fnc main():int{return new Entity();}'
];

test('unsupported actor and inverted-class source fails compiler admission',()=>{
  for(const source of pendingGuestPrograms){
    assert.throws(()=>compile(source),/error:/,
      'prototype host storage must never silently lower unsupported guest syntax');
  }
});

test('unsupported mixed-width Oreslang source rejects without package artifact publication',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ores-js-mixed-admission-'));
  try {
    for(let i=0;i<pendingGuestPrograms.length;i++){
      const sourceFile=join(root,'fixture-'+i+'.ores');
      const outputDir=join(root,'result-'+i);
      await writeFile(sourceFile,pendingGuestPrograms[i]);
      await assert.rejects(buildPackage({
        sourceFile,outputDir,target:'browser',
        declaredCompilerSha:'a'.repeat(40)
      }),/error:/);
      await assert.rejects(access(outputDir),{code:'ENOENT'},
        'rejected Oreslang program must leave no published package directory');
    }
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
