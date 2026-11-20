import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('generation advancement invalidates queued tickets without reusing authority',()=>{
  const fence=new SelectContinuationFence({generation:7,maxTickets:1});
  const original=fence.register(7);
  assert.equal(original.active,true);
  assert.equal(fence.advance(7),true);
  assert.equal(original.active,false);
  assert.equal(fence.tryConsume(original),false);
  assert.equal(fence.generation,8);
  const next=fence.register(8);
  assert.equal(fence.tryConsume(next),true);
  assert.equal(fence.tryConsume(next),false);
  assert.equal(fence.pendingTickets,0);
});

test('ticket identity cannot be forged by cloning descriptors or crossing owners',()=>{
  const first=new SelectContinuationFence({maxTickets:2});
  const second=new SelectContinuationFence();
  const ticket=first.register();
  const copy={...ticket};
  assert.equal(first.tryConsume(copy),false);
  assert.equal(second.tryConsume(ticket),false);
  let getters=0;
  const forged={};
  Object.defineProperty(forged,'owner',{get(){getters++;throw Error('owner getter');}});
  assert.equal(first.tryConsume(forged),false);
  assert.equal(getters,0);
  assert.equal(ticket.close(),true);
  assert.equal(ticket.close(),false);
  assert.equal(first.pendingTickets,0);
});

test('terminal close invalidates tickets and rejects registration',()=>{
  const fence=new SelectContinuationFence({maxTickets:2});
  const ticket=fence.register();
  assert.equal(fence.close(),true);
  assert.equal(fence.close(),false);
  assert.equal(ticket.active,false);
  assert.equal(ticket.close(),false);
  assert.equal(fence.advance(1),false);
  assert.throws(()=>fence.register(),/continuation fence is closed/);
  assert.equal(fence.pendingTickets,0);
});
