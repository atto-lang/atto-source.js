import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {
  compileCoreLinkedProgram,compileToCoreLinkedIR,checkCoreLinkedProgram
} from '../src/core-static-link.mjs';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';
import {compileProgramIRV2} from '../src/program-v2.mjs';

const CORE=resolve('tests/fixtures/freestanding-core-java.ores');
const APP=resolve('tests/fixtures/core-import-main.ores');
const load=async code=>import('data:text/javascript,'+encodeURIComponent(code));
const paths=async()=>Promise.all([readFile(APP,'utf8'),readFile(CORE,'utf8')]);

test('core import is compiled into one portable ESM with no runtime host imports',async()=>{
  const [application,coreSource]=await paths();
  const ir=compileToCoreLinkedIR(application,coreSource);
  assert.deepEqual(ir.modules,['core']);
  assert.deepEqual(ir.functions.map(fn=>fn.name),
    ['min_int','max_int','clamp_int','bounded','compose']);
  assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir))),
    compileCoreLinkedProgram(application,coreSource));
  const esm=compileCoreLinkedProgram(application,coreSource);
  assert.doesNotMatch(esm,/\b(?:import|require|process|fs|fetch|Worker|document|window|eval)\b/);
  const exports=await load(esm);
  assert.equal(Object.getPrototypeOf(exports.core),null);
  assert.equal(Object.isFrozen(exports.core),true);
  assert.deepEqual(Object.keys(exports).sort(),['bounded','compose','core']);
  for(const [value,bounded,composed] of [
    [-100n,0n,0n],[0n,0n,0n],[5n,5n,5n],[13n,10n,13n],
    [100n,10n,20n],[9007199254740993n,10n,20n]
  ]) {
    assert.equal(exports.bounded(value),bounded);
    assert.equal(exports.compose(value),composed);
  }
  assert.throws(()=>exports.bounded(4),/BigInt/);
  assert.throws(()=>exports.bounded(1n<<63n),/OVERFLOW/);
  assert.throws(()=>exports.compose(),/arity/);
});

test('legacy std/core is a source-only alias and not an ESM/node import',async()=>{
  const [app,core]=await paths();
  const old=app.replace('from "core"','from "std/core"');
  assert.equal(compileCoreLinkedProgram(app,core),compileCoreLinkedProgram(old,core));
  assert.equal(checkCoreLinkedProgram(old,core),true);
});

test('core-only linkage forbids host APIs, duplicate imports and wrong declarations',async()=>{
  const [,core]=await paths();
  for(const code of [
    'pub fnc main(): int {return 1;}',
    'import module filesystem from "node:fs"; pub fnc main(): int {return 1;}',
    'import module core from "https://example.test/evil"; pub fnc main(): int {return 1;}',
    'import module core from "core"; import module core from "core"; pub fnc main(): int {return 1;}',
    'import module core from "core"; import module fs from "std/fs"; pub fnc main(): int {return 1;}',
    'import module core from "core"; define module core pub fnc x(): int {return 1;} end',
    'import module core from "core";',
    'import module core from "core"; pub fnc main(): int {return fs.read(42);}',
    'import module core from "core"; pub fnc main(): int {return process.exit(0);}',
    'import module core from "core"; pub fnc main(): int {return core.not_public(1);}',
    'import module core from "core"; pub fnc main(): int {return 1; return 2;}'
  ]) assert.throws(()=>compileCoreLinkedProgram(code,core),/error:/,code);
  const impure='define module core pub fnc main(): int {return stdio.stdout.write(1);} end';
  const source='import module core from "core"; pub fnc main(): int {return core.main();}';
  assert.throws(()=>compileCoreLinkedProgram(source,impure),/error:/);
  assert.throws(()=>compileCoreLinkedProgram(source,'define module wrong pub fnc main(): int {return 1;} end'),/error:/);
});

test('core linked program cannot bypass private visibility',()=>{
 const core=[
  'define module core',
  'fnc hidden(int x): int {return x+1;}',
  'pub fnc expose(int x): int {return hidden(x);}',
  'end'
 ].join('\n');
 assert.equal(compileFreestandingCore(core).includes('export {'),true);
 const app='import module core from "core"; pub fnc main(int x): int {return core.hidden(x);}';
 assert.throws(()=>compileCoreLinkedProgram(app,core),/private module member/);
 const good=app.replace('core.hidden','core.expose');
 assert.doesNotThrow(()=>compileCoreLinkedProgram(good,core));
});

test('CLI explicit core path checks and Node runtime output',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ores-js-linked-'));
 const cli=resolve('bin/oreslang-jsc.mjs');
 try {
   const out=join(temp,'linked.mjs');
   const opts=['--core-linked',APP,'--core-source='+CORE,'--out='+out];
   const run=spawnSync(process.execPath,[cli,...opts],{encoding:'utf8'});
   assert.equal(run.status,0,run.stderr);
   const exports=await import(pathToFileURL(out).href);
   assert.equal(exports.bounded(99n),10n);
   assert.equal(exports.compose(14n),14n);
   const check=spawnSync(process.execPath,
     [cli,'--core-linked','--check',APP,'--core-source='+CORE],{encoding:'utf8'});
   assert.equal(check.status,0,check.stderr);
   assert.match(check.stdout,/OK/);
   for(const bad of [
     ['--core-linked',APP],
     ['--core-linked',APP,'--core-source=relative/core.ores'],
     ['--core-linked',APP,'--core-source='+CORE,'--core-source='+CORE],
     ['--core-linked','--check',APP,'--core-source='+CORE,'--out='+join(temp,'x.mjs')]
   ]) {
     const x=spawnSync(process.execPath,[cli,...bad],{encoding:'utf8'});
     assert.notEqual(x.status,0,'invalid CLI arguments must fail');
   }
 } finally {await rm(temp,{recursive:true,force:true});}
});

test('leading trivia is token-aware and bounded before parsing',async()=>{
  const [,core]=await paths();
  const header='import module core from "core"; pub fnc main(): int {return core.min_int(1,2);}';
  const comments=[
    '// import module filesystem from "node:fs";\n',
    '/* fake import module core from "evil"; /*nested*/ */\n',
    '   \n\t// comment only\n'
  ].join('');
  assert.equal(compileCoreLinkedProgram(comments+header,core),
    compileCoreLinkedProgram(header,core));
  for(const text of [
    '/* unterminated '+header,
    '/* nested '.repeat(65)+'*/'.repeat(65)+header
  ]) assert.throws(()=>compileCoreLinkedProgram(text,core),/error:/);
  assert.throws(()=>compileCoreLinkedProgram(' '.repeat(262144)+header,core),
    /combined source exceeds linker size budget/);
});
