// Host continuation-fence regression only; not compiler-backed actor execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('failed admission preserves live tickets and slot reuse never revives a consumed one',()=>{
  const lane=new SelectContinuationFence({generation:10,maxTickets:2});
  const first=lane.register(10),second=lane.register(10);
  assert.equal(lane.pendingTickets,2);
  assert.throws(()=>lane.register(10),/capacity exhausted/);
  assert.equal(first.active,true);
  assert.equal(second.active,true);
  assert.equal(Object.isFrozen(first),true);
  assert.equal(lane.tryConsume(first),true);
  assert.equal(lane.tryConsume(first),false);
  const replacement=lane.register(10);
  assert.equal(replacement.active,true);
  assert.equal(first.active,false);
  assert.equal(lane.tryConsume(Object.assign({},replacement)),false);
  assert.equal(lane.tryConsume(replacement),true);
  assert.equal(second.active,true);
  assert.equal(lane.pendingTickets,1);
});

test('wrong generation cannot retire work and close is terminal and idempotent',()=>{
  const lane=new SelectContinuationFence({generation:3,maxTickets:2});
  const a=lane.register(),b=lane.register();
  assert.equal(lane.advance(2),false);
  assert.equal(lane.pendingTickets,2);
  assert.equal(a.active,true);
  assert.equal(lane.advance(3),true);
  assert.equal(lane.generation,4);
  assert.equal(a.active,false);
  assert.equal(b.close(),false);
  assert.equal(lane.pendingTickets,0);
  assert.equal(lane.close(),true);
  assert.equal(lane.close(),false);
  assert.equal(lane.advance(4),false);
  assert.throws(()=>lane.register(),/closed/);
});

test('unknown, getter-backed and inherited configuration fields cannot authorize a fence',()=>{
  let called=0;
  const opts={};
  Object.defineProperty(opts,'maxTickets',{enumerable:true,get(){called++;return 2;}});
  assert.throws(()=>new SelectContinuationFence(opts),/own data/);
  assert.equal(called,0);
  assert.throws(()=>new SelectContinuationFence({maxTickets:4097}),/1\.\.4096/);
  assert.throws(()=>new SelectContinuationFence({generation:0}),/positive integer/);
  assert.throws(()=>new SelectContinuationFence(Object.create({generation:1})),/plain data/);
});