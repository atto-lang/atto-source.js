import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('physical lease blocks advance and retains capacity until exactly-once retirement',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const first=fence.register();
  const lease=fence.tryClaim(first);
  assert.ok(lease);
  assert.equal(fence.pendingTickets,0);
  assert.equal(fence.executing,1);
  assert.equal(first.active,false);
  assert.equal(fence.tryClaim(first),null);
  assert.equal(first.close(),false);
  assert.equal(fence.advance(1),false);
  assert.throws(()=>fence.register(),/capacity/);
  assert.equal(lease.close(),true);
  assert.equal(lease.close(),false);
  assert.equal(fence.executing,0);
  assert.equal(fence.advance(1),true);
  const fresh=fence.register();
  assert.equal(fence.tryClaim(first),null);
  assert.equal(fresh.active,true);
  const live=fence.tryClaim(fresh);
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,false);
  assert.equal(fence.advance(2),false);
  assert.equal(live.close(),true);
  assert.equal(fence.retirementReady,true);
});
test('close revokes pending but does not release a claimed execution',()=>{
  const fence=new SelectContinuationFence({maxTickets:2});
  const a=fence.register(),b=fence.register();
  const lease=fence.tryClaim(a);
  assert.equal(fence.close(),true);
  assert.equal(b.active,false);
  assert.equal(fence.tryClaim(b),null);
  assert.equal(fence.executing,1);
  assert.equal(fence.retirementReady,false);
  assert.equal(lease.close(),true);
  assert.equal(fence.retirementReady,true);
});

test('mixed pending/executing churn preserves quota and rejects stale identities',()=>{
  const capacity=64;
  const fence=new SelectContinuationFence({maxTickets:capacity});
  let prior=[];
  for(let round=0;round<256;round++){
    const pending=Array.from({length:capacity},()=>fence.register());
    assert.equal(new Set(pending.map(t=>t.index)).size,capacity);
    const leases=pending.slice(0,32).map(t=>fence.tryClaim(t));
    assert.equal(fence.executing,32);
    assert.equal(fence.pendingTickets,32);
    assert.throws(()=>fence.register(),/capacity/);
    assert.equal(fence.advance(fence.generation),false);
    for(const t of prior){
      assert.equal(fence.tryClaim(t),null);
      assert.equal(t.close(),false);
    }
    for(const t of pending.slice(32))assert.equal(t.close(),true);
    const fresh=Array.from({length:32},()=>fence.register());
    assert.equal(new Set(fresh.map(t=>t.index)).size,32);
    for(const lease of leases){
      assert.equal(lease.close(),true);
      assert.equal(lease.close(),false);
    }
    assert.equal(fence.executing,0);
    assert.equal(fence.pendingTickets,32);
    assert.equal(fence.advance(fence.generation),true);
    assert.equal(fence.pendingTickets,0);
    prior=[...pending,...fresh];
  }
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,true);
});

test('internal admission cannot be redirected by an overridden inspection method',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const issued=fence.register();
  fence._matches=()=>true;
  assert.equal(fence.tryClaim({}),null);
  assert.equal(fence.tryConsume({}),false);
  assert.equal(fence._close({}),false);
  assert.equal(fence.pendingTickets,1);
  const lease=fence.tryClaim(issued);
  assert.ok(lease);
  assert.equal(lease.close(),true);
  assert.equal(fence.pendingTickets,0);
});
