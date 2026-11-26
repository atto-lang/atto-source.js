import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile,compileToIR} from '../src/compiler.mjs';
import {compileProgramV2,compileToProgramIRV2,compileAttoScalarV1} from '../src/program-v2.mjs';
const compilers=[compile,compileToIR,compileProgramV2,compileToProgramIRV2,compileAttoScalarV1];
test('shared protected state sources reject before emitting JS or typed IR',async()=>{
  for(const name of ['state-short-intrinsics.atto','state-owned-tuple-snapshot.atto','state-write-expressions.atto']){
    const source=await readFile(new URL('fixtures/state-intrinsics-v1/'+name,import.meta.url),'utf8');
    for(const c of compilers)assert.throws(()=>c(source),/STATE_CONTAINER_BACKEND_UNSUPPORTED/,c.name+': '+name);
  }
});
test('declaration variants and nested comments cannot bypass denial',()=>{
  for(const prefix of ['define state container','pub define state container','define pub state /* nested /* x */ */ container']){
    for(const c of compilers)assert.throws(()=>c(prefix+' C as end\npub fnc main(): int { return 42; }'),/STATE_CONTAINER_BACKEND_UNSUPPORTED/);
  }
});
test('ordinary scalar control and inert state words still compile and execute',async()=>{
  const source='pub fnc main(): int { /* define state container C */ return 42; }';
  for(const c of [compile,compileProgramV2,compileAttoScalarV1]){
    const ns=await import('data:text/javascript,'+encodeURIComponent(c(source)));
    assert.equal(ns.main(),42n);
  }
});
