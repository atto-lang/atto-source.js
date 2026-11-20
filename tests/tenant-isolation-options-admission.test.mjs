import test from "node:test";
import assert from "node:assert/strict";
import {requireSupportedTenantWorkerIsolation as requireWorker} from "../src/tenant-isolation-policy.mjs";

test("tenant isolation never invokes attacker-controlled option getters",()=>{
  let invoked=0;
  for(const key of ["isolation","untrusted"]){
    const options={};
    Object.defineProperty(options,key,{enumerable:true,get(){
      invoked++;return key==="untrusted"?false:"trusted-worker";
    }});
    assert.throws(()=>requireWorker(options),/own data/);
  }
  assert.equal(invoked,0);
});

test("tenant isolation requires own data and denies untrusted or unimplemented domains",()=>{
  assert.doesNotThrow(()=>requireWorker());
  assert.doesNotThrow(()=>requireWorker({isolation:"trusted-worker",untrusted:false}));
  const nullProto=Object.assign(Object.create(null),{untrusted:false});
  assert.doesNotThrow(()=>requireWorker(nullProto));
  for(const options of [
    null,{},Object.create({untrusted:false}),
    {untrusted:true},{isolation:"vm-isolate"},
    {isolation:"trusted-worker",extra:"allow"},
    {untrusted:"false"},
  ]){
    if(options!==null && Object.keys(options).length===0 &&
       Object.getPrototypeOf(options)===Object.prototype)continue;
    assert.throws(()=>requireWorker(options));
  }
  const withSymbol={untrusted:false};withSymbol[Symbol.for("grant")]=true;
  assert.throws(()=>requireWorker(withSymbol),/unknown tenant isolation option/);
});
