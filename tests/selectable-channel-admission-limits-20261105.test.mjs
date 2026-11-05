import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectableI64Channel} from '../src/selectable-i64-channel.mjs';

test('channel and waiter capacities are integer-bounded before allocation',()=>{
 for(const invalid of [0,-1,1.2,1048577,Number.MAX_SAFE_INTEGER+1,NaN,'1']){
  assert.throws(()=>new SelectableI64Channel(invalid),/capacity must be an integer/);
 }
 for(const invalid of [0,-1,1.2,4097,Infinity,'2']){
  assert.throws(()=>new SelectableI64Channel(1,{maxWaiters:invalid}),/maxWaiters must be an integer/);
 }
 assert.equal(new SelectableI64Channel(1,{maxWaiters:1}).capacity,1);
});
test('i64 end-points round-trip without wrapping and invalid writes are inert',()=>{
 const ch=new SelectableI64Channel(2);
 const min=-(1n<<63n),max=(1n<<63n)-1n;
 assert.equal(ch.tryWrite(min),true);
 assert.equal(ch.tryWrite(max),true);
 assert.equal(ch.tryWrite(0n),false);
 for(const invalid of [max+1n,min-1n,1,1.5,'1',null]){
  assert.throws(()=>ch.tryWrite(invalid),/signed i64 BigInt/);
  assert.equal(ch.size,2);
 }
 assert.deepEqual(ch.tryRead(),{ok:true,eof:false,value:min});
 assert.deepEqual(ch.tryRead(),{ok:true,eof:false,value:max});
 assert.deepEqual(ch.tryRead(),{ok:false,eof:false,value:0n});
 ch.close();
 assert.deepEqual(ch.tryRead(),{ok:false,eof:true,value:0n});
});
test('recycled one-slot subscriptions stay revoked without ghost notifications',()=>{
 const ch=new SelectableI64Channel(1,{maxWaiters:1});
 let calls=0;
 for(let i=0;i<128;i++){
  const sub=ch.subscribeReadable(()=>{calls++;});
  assert.equal(sub.active,true);
  assert.equal(ch.pendingReaders,1);
  assert.equal(sub.close(),true);
  assert.equal(sub.active,false);
  assert.equal(sub.close(),false);
  assert.equal(ch.pendingReaders,0);
 }
 assert.equal(ch.tryWrite(3n),true);
 assert.equal(calls,0);
 assert.deepEqual(ch.tryRead(),{ok:true,eof:false,value:3n});
});