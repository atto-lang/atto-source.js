import test from 'node:test';
import assert from 'node:assert/strict';
import {terminateFailedWorkerSpawn} from '../src/worker-actor-spawn-cleanup.mjs';

test('synchronous Worker termination errors cannot mask original construction failure',()=>{
 const original=Error('original client construction failure');
 let terminations=0;
 const construct=()=>{
  try{throw original;}
  catch(error){
   terminateFailedWorkerSpawn({terminate(){terminations++;throw Error('termination failed');}});
   throw error;
  }
 };
 assert.throws(construct,error=>error===original);
 assert.equal(terminations,1);
});

test('rejected asynchronous termination is observed without throwing to caller',async()=>{
 let terminations=0;
 assert.doesNotThrow(()=>terminateFailedWorkerSpawn({
  terminate(){terminations++;return Promise.reject(Error('asynchronous termination failure'));}
 }));
 await Promise.resolve();
 await Promise.resolve();
 assert.equal(terminations,1);
});

test('foreign thenables are assimilated and their rejection stays isolated',async()=>{
 let terminations=0,thenInvocations=0;
 const worker={terminate(){
  terminations++;
  return {then(resolve,reject){thenInvocations++;reject(Error('foreign thenable reject'));}};
 }};
 assert.doesNotThrow(()=>terminateFailedWorkerSpawn(worker));
 await Promise.resolve();
 await Promise.resolve();
 assert.equal(terminations,1);
 assert.equal(thenInvocations,1);
});