import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

// Failed spawn cleanup must never replace the original admission failure.
test('getter-backed terminate method is invoked only once and cannot throw outward',()=>{
 let reads=0;
 const worker={get terminate(){reads++;throw Error('poisoned terminate getter');}};
 assert.doesNotThrow(()=>terminateFailedWorkerSpawn(worker));
 assert.equal(reads,1);
});
test('thenable with a throwing then getter is assimilated and rejection observed',async()=>{
 let reads=0,terminations=0;
 const result={get then(){reads++;throw Error('then getter rejected');}};
 assert.doesNotThrow(()=>terminateFailedWorkerSpawn({terminate(){terminations++;return result;}}));
 await Promise.resolve();await Promise.resolve();
 assert.equal(terminations,1);assert.equal(reads,1);
});
test('successful browser and Node cleanup results preserve one-call admission',async()=>{
 let calls=0;
 for(const value of [undefined,Promise.resolve(1)]){
  assert.doesNotThrow(()=>terminateFailedWorkerSpawn({terminate(){calls++;return value;}}));
 }
 await Promise.resolve();assert.equal(calls,2);
});
test('missing or null failed-worker handles cannot obscure original caller error',()=>{
 const original=Error('original admission failure');
 for(const worker of [null,{}]){
  assert.throws(()=>{try{throw original;}catch(e){terminateFailedWorkerSpawn(worker);throw e;}},e=>e===original);
 }
});
