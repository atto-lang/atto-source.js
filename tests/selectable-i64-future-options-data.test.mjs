import test from "node:test";
import assert from "node:assert/strict";
import {SelectableI64Future} from "../src/selectable-i64-future.mjs";

test("future configuration getters never run during waiter budget admission",()=>{
 let called=0;
 for(const opts of [
  Object.defineProperty({},"maxWaiters",{enumerable:true,get(){called++;return 2;}}),
  Object.defineProperty({},"maxWaiters",{enumerable:true,get(){called++;throw Error("untrusted");}})
 ]){
  assert.throws(()=>new SelectableI64Future(opts),/own data fields/);
 }
 assert.equal(called,0);
});

test("plain future options retain one-shot completion and cannot smuggle authority",()=>{
 const future=new SelectableI64Future(Object.assign(Object.create(null),{maxWaiters:1}));
 let notices=0;
 const subscription=future.subscribeReady(()=>{notices++;});
 assert.throws(()=>future.subscribeReady(()=>{}),/capacity exhausted/);
 assert.equal(future.resolve(42n),true);
 assert.equal(notices,1);
 const cell=future.createResultCell();
 assert.equal(future.tryCommit(subscription,cell),true);
 assert.equal(cell.value,42n);
 assert.equal(future.pendingWaiters,0);
 assert.equal(new SelectableI64Future({maxWaiters:undefined}).pendingWaiters,0);
 for(const opts of [null,[],Object.create({maxWaiters:1}),{unused:true},{maxWaiters:0}])
  assert.throws(()=>new SelectableI64Future(opts));
 const withSymbol={maxWaiters:1};withSymbol[Symbol("grant")]=true;
 assert.throws(()=>new SelectableI64Future(withSymbol),/unknown future option/);
});
