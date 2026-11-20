import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('64 actor generations recycle slots but never ticket authority',()=>{
  const fence=new SelectContinuationFence({generation:1,maxTickets:4});
  const retired=[];
  const ids=new Set();
  for(let generation=1;generation<=64;generation++){
    assert.equal(fence.generation,generation);
    const tickets=Array.from({length:4},()=>fence.register(generation));
    assert.equal(fence.pendingTickets,4);
    for(const ticket of tickets){
      assert.equal(ids.has(ticket.id),false);
      ids.add(ticket.id);
    }
    assert.throws(()=>fence.register(generation),/capacity exhausted/);
    // Deliberately leave half the generation queued at retirement.
    for(const ticket of tickets.slice(0,2))assert.equal(fence.tryConsume(ticket),true);
    assert.equal(fence.pendingTickets,2);
    retired.push(...tickets);
    assert.equal(fence.advance(generation),true);
    assert.equal(fence.pendingTickets,0);
    assert.equal(fence.tryConsume(tickets[2]),false);
    assert.equal(fence.tryConsume(tickets[3]),false);
  }
  assert.equal(ids.size,256);
  for(const ticket of retired){
    assert.equal(ticket.active,false);
    assert.equal(ticket.close(),false);
    assert.equal(fence.tryConsume(ticket),false);
  }
  assert.equal(fence.generation,65);
});

test('terminal close remains idempotent after a long series of generation transitions',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  for(let g=1;g<50;g++){
    const ticket=fence.register(g);
    assert.equal(fence.advance(g),true);
    assert.equal(ticket.active,false);
  }
  const latest=fence.register(50);
  assert.equal(fence.close(),true);
  assert.equal(fence.close(),false);
  assert.equal(fence.advance(50),false);
  assert.equal(latest.close(),false);
  assert.throws(()=>fence.register(50),/closed/);
  assert.equal(fence.pendingTickets,0);
});
