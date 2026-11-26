import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compile} from '../src/compiler.mjs';
import {compileCachedScalarUnit,scalarCompilerClosureSha256} from '../src/compile-cached-scalar-unit.node.mjs';
import {makeLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
const source='pub fnc main(): int { return 42; }',scope='tenant/unit',master=Buffer.alloc(32,7);
const ledgerRecord=makeLedgerRecord(scope,1n,master),ledgerPin=createHash('sha256').update(ledgerRecord).digest();
const config={source,owner:'example@1',unit:'main.atto',scope,master,ledgerRecord,ledgerPin,expectedCompilerSha256:scalarCompilerClosureSha256()};
const execute=async code=>(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();
test('actual compiler cold/warm persistent source-unit API and process restart',async()=>{
 const child=process.env.ATTO_CACHED_UNIT_CHILD;
 if(child){const hit=compileCachedScalarUnit({...config,root:child});assert.equal(hit.emitted,0);assert.equal(hit.reused,1);assert.equal(await execute(hit.code),42n);console.log('CACHED_SCALAR_CHILD_HIT');return;}
 const root=mkdtempSync(join(tmpdir(),'atto-cached-unit-'));
 try{
  const opts={...config,root};
  assert.throws(()=>compileCachedScalarUnit({...opts,cold:true,ledgerPin:Buffer.alloc(32)}),/E_CACHE_LEDGER/);
  const a=compileCachedScalarUnit(opts);assert.equal(a.emitted,1);assert.equal(a.code,compile(source));assert.equal(await execute(a.code),42n);
  const b=compileCachedScalarUnit(opts);assert.equal(b.reused,1);assert.equal(a.code,b.code);
  const env={...process.env,ATTO_CACHED_UNIT_CHILD:root};delete env.NODE_TEST_CONTEXT;
  const p=spawnSync(process.execPath,['--test','--test-reporter=tap',new URL(import.meta.url).pathname],{env,encoding:'utf8',timeout:60000});
  assert.equal(p.status,0,p.stdout+p.stderr);assert.match(p.stdout,/CACHED_SCALAR_CHILD_HIT/);
  const edit=source.replace('42','43');const c=compileCachedScalarUnit({...opts,source:edit});assert.notEqual(c.key,a.key);assert.equal(c.emitted,1);assert.equal(c.code,compile(edit));assert.equal(await execute(c.code),43n);
  const file=join(root,'slot-'+c.key[0]),before=readFileSync(file);
  assert.throws(()=>compileCachedScalarUnit({...opts,source:'pub fnc main(): int { return missing(); }'}),/unresolved identifier/);
  assert.deepEqual(readFileSync(file),before);
  assert.throws(()=>compileCachedScalarUnit({...opts,expectedCompilerSha256:'0'.repeat(64)}),/E_CACHE_COMPILER/);
  assert.throws(()=>compileCachedScalarUnit({...opts,source:source+'\ud800'}),/E_CACHE_INPUT/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
