import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('ticket is one shot',()=>{
  const fence=new SelectContinuationFence();
  const ticket=fence.register();
  assert.equal(fence.tryConsume(ticket),true);
  assert.equal(fence.tryConsume(ticket),false);
  assert.equal(fence.pendingTickets,0);
});

test('advance rejects an older queued ticket',()=>{
  const fence=new SelectContinuationFence();
  const old=fence.register(1);
  assert.equal(fence.advance(1),true);
  assert.equal(fence.generation,2);
  assert.equal(fence.tryConsume(old),false);
});

test('slot reuse keeps ticket identities distinct',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const old=fence.register();
  assert.equal(fence.advance(1),true);
  const current=fence.register(2);
  assert.notEqual(current.id,old.id);
  assert.equal(fence.tryConsume(old),false);
  assert.equal(fence.tryConsume(current),true);
});

test('closed ticket cannot deliver',()=>{
  const fence=new SelectContinuationFence();
  const ticket=fence.register();
  assert.equal(ticket.close(),true);
  assert.equal(ticket.close(),false);
  assert.equal(fence.tryConsume(ticket),false);
});

test('stale advance leaves current tickets intact',()=>{
  const fence=new SelectContinuationFence({generation:7});
  const ticket=fence.register(7);
  assert.equal(fence.advance(6),false);
  assert.equal(fence.generation,7);
  assert.equal(fence.tryConsume(ticket),true);
});

test('stale registration fails',()=>{
  const fence=new SelectContinuationFence({generation:3});
  assert.throws(()=>fence.register(2),/stale actor generation/);
  assert.equal(fence.pendingTickets,0);
});

test('ticket belongs to its fence',()=>{
  const first=new SelectContinuationFence();
  const second=new SelectContinuationFence();
  const ticket=first.register();
  assert.equal(second.tryConsume(ticket),false);
  assert.equal(ticket.close(),true);
});

test('delivery rechecks generation after queueing',()=>{
  const fence=new SelectContinuationFence();
  const queued=fence.register();
  assert.equal(fence.advance(1),true);
  let delivered=0;
  if(fence.tryConsume(queued))delivered++;
  assert.equal(delivered,0);
  const current=fence.register(2);
  if(fence.tryConsume(current))delivered++;
  assert.equal(delivered,1);
});

test('capacity rejection preserves tickets and closing restores one slot',()=>{
  const fence=new SelectContinuationFence({maxTickets:2});
  const first=fence.register();
  const second=fence.register();
  assert.throws(()=>fence.register(),/capacity exhausted/);
  assert.equal(fence.pendingTickets,2);
  assert.equal(first.active,true);
  assert.equal(second.active,true);
  assert.equal(first.close(),true);
  const replacement=fence.register();
  assert.equal(first.close(),false);
  assert.equal(fence.pendingTickets,2);
  assert.equal(fence.tryConsume(second),true);
  assert.equal(fence.tryConsume(replacement),true);
  assert.equal(fence.pendingTickets,0);
});

test('advance invalidates every occupied slot and restores full capacity',()=>{
  const fence=new SelectContinuationFence({maxTickets:2});
  const old=[fence.register(),fence.register()];
  assert.equal(fence.advance(1),true);
  assert.equal(fence.pendingTickets,0);
  const current=[fence.register(2),fence.register(2)];
  for(const ticket of old){
    assert.equal(ticket.active,false);
    assert.equal(ticket.close(),false);
    assert.equal(fence.tryConsume(ticket),false);
  }
  assert.equal(fence.pendingTickets,2);
  for(const ticket of current)assert.equal(fence.tryConsume(ticket),true);
});

test('generation overflow leaves outstanding tickets and generation unchanged',()=>{
  const generation=Number.MAX_SAFE_INTEGER;
  const fence=new SelectContinuationFence({generation,maxTickets:1});
  const ticket=fence.register(generation);
  assert.equal(fence.advance(generation-1),false);
  assert.throws(()=>fence.advance(generation),/generation exhausted/);
  assert.equal(fence.generation,generation);
  assert.equal(fence.pendingTickets,1);
  assert.equal(ticket.active,true);
  assert.equal(fence.tryConsume(ticket),true);
});

test('invalid configuration rejects before any ticket allocation',()=>{
  for(const generation of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>new SelectContinuationFence({generation}),RangeError);
  for(const maxTickets of [0,-1,1.5,NaN,Infinity,4097])
    assert.throws(()=>new SelectContinuationFence({maxTickets}),RangeError);
  const fence=new SelectContinuationFence({maxTickets:4096});
  assert.equal(fence.pendingTickets,0);
});

test('missing tickets are rejected without consuming a live reservation',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const ticket=fence.register();
  assert.equal(fence.tryConsume(null),false);
  assert.equal(fence.tryConsume(undefined),false);
  assert.equal(fence.pendingTickets,1);
  assert.equal(fence.tryConsume(ticket),true);
});

test('ticket identity is immutable and reconstruction cannot consume a current reservation',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const old=fence.register();
  assert.equal(Object.isFrozen(old),true);
  assert.throws(()=>{old.generation=2;},TypeError);
  assert.equal(fence.advance(1),true);
  const live=fence.register(2);
  const reconstructed=new old.constructor(fence,live.index,live.id,live.generation);
  assert.equal(fence.tryConsume(reconstructed),false);
  assert.equal(fence.tryConsume({...live}),false);
  assert.equal(fence.tryConsume(old),false);
  assert.equal(fence.pendingTickets,1);
  assert.equal(fence.tryConsume(live),true);
});

test('unissued getter-bearing tickets cannot run code or clear live reservations',()=>{
  const fence=new SelectContinuationFence();
  const live=fence.register();
  let reads=0;
  const invalid={get owner(){reads++;throw Error('unexpected getter');}};
  assert.equal(fence.tryConsume(invalid),false);
  assert.equal(fence._close(invalid),false);
  assert.equal(reads,0);
  assert.equal(fence.pendingTickets,1);
  assert.equal(fence.tryConsume(live),true);
});

test('terminal close invalidates all tickets and cannot reopen',()=>{
  const fence=new SelectContinuationFence({maxTickets:2});
  const tickets=[fence.register(),fence.register()];
  assert.equal(fence.closed,false);
  assert.equal(fence.close(),true);
  assert.equal(fence.closed,true);
  assert.equal(fence.close(),false);
  assert.equal(fence.pendingTickets,0);
  assert.equal(fence.generation,1);
  assert.equal(fence.advance(1),false);
  assert.throws(()=>fence.register(1),/closed/);
  for(const ticket of tickets){
    assert.equal(ticket.active,false);
    assert.equal(ticket.close(),false);
    assert.equal(fence.tryConsume(ticket),false);
  }
});

test('close succeeds even at exhausted generation',()=>{
  const fence=new SelectContinuationFence({generation:Number.MAX_SAFE_INTEGER});
  fence.register();
  assert.equal(fence.close(),true);
  assert.equal(fence.advance(Number.MAX_SAFE_INTEGER),false);
  assert.equal(fence.pendingTickets,0);
  assert.throws(()=>fence.register(),/closed/);
});

test('queued delivery observes terminal close before invoking callback',async()=>{
  const fence=new SelectContinuationFence();
  const ticket=fence.register();
  let delivered=0;
  const delivery=Promise.resolve().then(()=>{
    if(fence.tryConsume(ticket))delivered++;
  });
  fence.close();
  await delivery;
  assert.equal(delivered,0);
});

test('completion before terminal close remains one-shot',async()=>{
  const fence=new SelectContinuationFence();
  const ticket=fence.register();
  let delivered=0;
  await Promise.resolve().then(()=>{
    if(fence.tryConsume(ticket))delivered++;
  });
  assert.equal(fence.close(),true);
  assert.equal(fence.tryConsume(ticket),false);
  assert.equal(delivered,1);
});

test('terminal close is local to its owning fence',()=>{
  const stopped=new SelectContinuationFence();
  const sibling=new SelectContinuationFence();
  const ticket=sibling.register();
  stopped.close();
  assert.equal(sibling.closed,false);
  assert.equal(sibling.tryConsume(ticket),true);
});
