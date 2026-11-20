// Host continuation fence tests only: no compiled scheduler/actor turn proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('consuming one full-capacity slot never revives its previous ticket',()=>{
  const fence=new SelectContinuationFence({generation:1,maxTickets:2});
  const first=fence.register(),second=fence.register();
  assert.equal(fence.pendingTickets,2);
  assert.throws(()=>fence.register(),/capacity exhausted/);
  assert.equal(fence.tryConsume(first),true);
  assert.equal(first.active,false);
  const replacement=fence.register();
  assert.equal(fence.pendingTickets,2);
  assert.equal(fence.tryConsume(first),false);
  assert.equal(first.close(),false);
  assert.equal(second.active,true);
  assert.equal(fence.tryConsume(second),true);
  assert.equal(replacement.close(),true);
  assert.equal(fence.pendingTickets,0);
});

test('terminal close and generation advance invalidate distinct live tickets',()=>{
  const fence=new SelectContinuationFence({generation:7,maxTickets:2});
  const stale=fence.register(7);
  assert.equal(fence.advance(6),false);
  assert.equal(stale.active,true);
  assert.equal(fence.advance(7),true);
  assert.equal(fence.generation,8);
  assert.equal(stale.active,false);
  assert.equal(fence.tryConsume(stale),false);
  const current=fence.register(8);
  assert.equal(fence.close(),true);
  assert.equal(fence.close(),false);
  assert.equal(current.active,false);
  assert.equal(fence.pendingTickets,0);
  assert.throws(()=>fence.register(),/closed/);
  assert.equal(fence.advance(8),false);
});

test('tickets cannot cross independent continuation owners',()=>{
  const a=new SelectContinuationFence({maxTickets:1});
  const b=new SelectContinuationFence({maxTickets:1});
  const at=a.register(),bt=b.register();
  assert.equal(a.tryConsume(bt),false);
  assert.equal(b.tryConsume(at),false);
  assert.equal(at.active,true);
  assert.equal(bt.active,true);
  assert.equal(a.tryConsume(at),true);
  assert.equal(b.tryConsume(bt),true);
});
