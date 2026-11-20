// Host select/await continuation reference; not guest scheduling proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('hundreds of physical generations cannot revive stale continuation tickets',()=>{
 const fence=new SelectContinuationFence({maxTickets:1,generation:1});
 const retired=[];
 for(let generation=1;generation<=256;generation++){
  const ticket=fence.register(generation);
  assert.equal(ticket.active,true);
  assert.equal(fence.pendingTickets,1);
  for(const prior of retired){
   assert.equal(prior.active,false);
   assert.equal(fence.tryConsume(prior),false);
   assert.equal(prior.close(),false);
  }
  if(generation<256){
   retired.push(ticket);
   assert.equal(fence.advance(generation),true);
   assert.equal(fence.pendingTickets,0);
  }else {
   assert.equal(fence.tryConsume(ticket),true);
   assert.equal(fence.tryConsume(ticket),false);
  }
 }
 assert.equal(fence.generation,256);
 assert.equal(fence.pendingTickets,0);
 assert.equal(fence.close(),true);
 assert.throws(()=>fence.register(),/closed/);
});

test('failed stale advance preserves two live tickets and cannot consume foreign authority',()=>{
 const first=new SelectContinuationFence({generation:10,maxTickets:2});
 const second=new SelectContinuationFence({generation:10,maxTickets:2});
 const a=first.register(10),b=first.register(10),foreign=second.register(10);
 assert.equal(first.advance(9),false);
 assert.equal(first.pendingTickets,2);
 assert.equal(first.tryConsume(foreign),false);
 assert.equal(first.tryConsume({...a}),false);
 assert.equal(first.pendingTickets,2);
 assert.equal(a.close(),true);
 const replacement=first.register(10);
 assert.equal(first.tryConsume(a),false);
 assert.equal(first.tryConsume(b),true);
 assert.equal(first.tryConsume(replacement),true);
 assert.equal(first.pendingTickets,0);
 second.close();first.close();
});

test('invalid getter-backed options do not execute accessors or allocate tickets',()=>{
 let invoked=0;
 const props={generation:1,maxTickets:1};
 Object.defineProperty(props,'maxTickets',{enumerable:true,get(){invoked++;throw Error('should not call getter');}});
 assert.throws(()=>new SelectContinuationFence(props),/own data fields/);
 assert.equal(invoked,0);
 const poisoned=Object.create({generation:7});
 assert.throws(()=>new SelectContinuationFence(poisoned),/plain data object/);
 for(const value of [0,4097,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>new SelectContinuationFence({maxTickets:value}),/maxTickets/);
 }
});
