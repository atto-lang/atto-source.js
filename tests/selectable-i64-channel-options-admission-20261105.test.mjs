import test from "node:test";
import assert from "node:assert/strict";
import {SelectableI64Channel} from "../src/selectable-i64-channel.mjs";

test("channel construction never evaluates maxWaiters accessors",()=>{
 let invoked=0;
 for(const options of [
   Object.defineProperty({},"maxWaiters",{enumerable:true,get(){invoked++;return 1;}}),
   Object.defineProperty({},"maxWaiters",{enumerable:true,get(){invoked++;throw Error("hostile");}})
 ])assert.throws(()=>new SelectableI64Channel(1,options),/own data fields/);
 assert.equal(invoked,0);
});
test("channel preserves safe quotas, FIFO values and rejects disguised options",()=>{
 const channel=new SelectableI64Channel(2,Object.assign(Object.create(null),{maxWaiters:1}));
 assert.equal(channel.capacity,2);
 assert.equal(channel.tryWrite(41n),true);
 assert.equal(channel.tryWrite(42n),true);
 assert.equal(channel.tryWrite(43n),false);
 assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:41n});
 assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:42n});
 const defaults=new SelectableI64Channel(1,{maxWaiters:undefined});
 assert.equal(defaults.capacity,1);
 for(const bad of [null,[],Object.create({maxWaiters:1}),{unknown:true},{maxWaiters:0}])
   assert.throws(()=>new SelectableI64Channel(1,bad));
 const symbol={maxWaiters:1};symbol[Symbol("grant")]=true;
 assert.throws(()=>new SelectableI64Channel(1,symbol),/unknown channel option/);
});
