import test from "node:test";
import assert from "node:assert/strict";
import {SelectContinuationFence} from "../src/select-continuation-fence.mjs";

test("continuation fence options reject untrusted getters without executing them",()=>{
 let getterCalls=0;
 for(const key of ["generation","maxTickets"]){
  const options={};
  Object.defineProperty(options,key,{enumerable:true,get(){
   getterCalls++;throw Error("untrusted option getter");
  }});
  assert.throws(()=>new SelectContinuationFence(options),/own data fields/);
 }
 assert.equal(getterCalls,0);
});
test("plain own options retain generation capacity and reject inherited/hidden authority",()=>{
 assert.equal(new SelectContinuationFence().generation,1);
 assert.equal(new SelectContinuationFence({generation:undefined,maxTickets:undefined}).generation,1);
 const options=Object.assign(Object.create(null),{generation:7,maxTickets:1});
 const fence=new SelectContinuationFence(options);
 const ticket=fence.register(7);
 assert.throws(()=>fence.register(7),/capacity exhausted/);
 assert.equal(fence.tryConsume(ticket),true);
 assert.equal(fence.advance(7),true);
 for(const invalid of [
  null,[],Object.create({generation:1}),{untrusted:false},
  {generation:0},{maxTickets:4097}
 ])assert.throws(()=>new SelectContinuationFence(invalid));
 const symbol={};symbol[Symbol("capability")]=true;
 assert.throws(()=>new SelectContinuationFence(symbol),/unknown continuation option/);
});
