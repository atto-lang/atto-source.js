import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn as cleanup} from '../src/worker-actor-spawn-cleanup.mjs';

test('synchronous browser Worker termination is observed without leaking its exception',()=>{
 let invocations=0;
 const worker={terminate(){invocations++;throw Error('browser terminated unexpectedly');}};
 assert.doesNotThrow(()=>cleanup(worker));
 assert.equal(invocations,1);
});

test('asynchronous Node Worker termination rejection is caught without unhandled failure',async()=>{
 const worker={terminate(){return Promise.reject(Error('node worker exit race'));}};
 assert.equal(cleanup(worker),undefined);
 await Promise.resolve();
 await Promise.resolve();
});

test('a thenable returned by terminate may reject without replacing original failure',async()=>{
 let settled=0;
 const worker={terminate(){return {then(resolve,reject){settled++;reject(Error('thenable failed'));}};}};
 assert.doesNotThrow(()=>cleanup(worker));
 await Promise.resolve();
 await Promise.resolve();
 assert.equal(settled,1);
});

test('a missing or getter-backed terminate implementation cannot leak during cleanup',()=>{
 let touched=0;
 const worker={};
 Object.defineProperty(worker,'terminate',{get(){touched++;throw Error('host trap');}});
 assert.doesNotThrow(()=>cleanup(worker));
 assert.equal(touched,1);
 assert.doesNotThrow(()=>cleanup({}));
});
