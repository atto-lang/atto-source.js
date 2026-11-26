import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('million fixed-capacity continuation generations preserve physical credit',()=>{
  const fence=new SelectContinuationFence({maxTickets:4});
  let old=null;
  for(let i=0;i<1_000_000;i++){
    const generation=fence.generation;
    const ticket=fence.register(generation);
    const lease=fence.tryClaim(ticket);
    assert.ok(lease);
    assert.equal(fence.executing,1);
    assert.equal(fence.advance(generation),false);
    assert.equal(fence.tryClaim(ticket),null);
    assert.equal(ticket.close(),false);
    if(old){
      assert.equal(fence.tryClaim(old),null);
      assert.equal(old.close(),false);
    }
    assert.equal(lease.close(),true);
    assert.equal(lease.close(),false);
    assert.equal(fence.advance(generation),true);
    assert.equal(fence.pendingTickets,0);
    assert.equal(fence.executing,0);
    old=ticket;
  }
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,true);
});

test('100000 seeded lifecycle operations agree with independent credit model',()=>{
  let seed=0x41c64e6d;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let schedule=0;schedule<1000;schedule++){
    const capacity=1+(next()%8);
    const fence=new SelectContinuationFence({maxTickets:capacity});
    const foreign=new SelectContinuationFence({maxTickets:1});
    const foreignTicket=foreign.register();
    let generation=1,closed=false;
    const pending=new Set(),running=new Set(),stale=[];
    for(let step=0;step<100;step++){
      const op=(next()>>>16)%8;
      const pick=set=>[...set][(next()>>>16)%Math.max(set.size,1)];
      if(op===0){
        if(closed||pending.size+running.size===capacity){
          assert.throws(()=>fence.register(generation),/closed|capacity/);
        }else{
          pending.add(fence.register(generation));
        }
      }else if(op===1&&pending.size){
        const ticket=pick(pending);
        const lease=fence.tryClaim(ticket);
        assert.ok(lease);
        pending.delete(ticket);
        stale.push(ticket);
        running.add(lease);
      }else if(op===2&&pending.size){
        const ticket=pick(pending);
        assert.equal(ticket.close(),true);
        pending.delete(ticket);
        stale.push(ticket);
      }else if(op===3&&running.size){
        const lease=pick(running);
        assert.equal(lease.close(),true);
        assert.equal(lease.close(),false);
        running.delete(lease);
      }else if(op===4){
        const advance=!closed&&running.size===0;
        assert.equal(fence.advance(generation),advance);
        if(advance){generation++;stale.push(...pending);pending.clear();}
      }else if(op===5){
        if(stale.length){
          const ticket=stale[(next()>>>16)%stale.length];
          assert.equal(fence.tryClaim(ticket),null);
          assert.equal(ticket.close(),false);
        }
        assert.equal(fence.tryClaim(foreignTicket),null);
        assert.equal(foreignTicket.active,true);
      }else if(op===6&&step>=85){
        assert.equal(fence.close(),!closed);
        closed=true;
        stale.push(...pending);
        pending.clear();
      }else if(op===7&&!closed&&generation>1){
        assert.throws(()=>fence.register(generation-1),/stale/);
      }
      const context='schedule '+schedule+' step '+step;
      assert.equal(fence.generation,generation,context);
      assert.equal(fence.pendingTickets,pending.size,context);
      assert.equal(fence.executing,running.size,context);
      assert.equal(fence.retirementReady,closed&&running.size===0,context);
    }
    fence.close();
    for(const lease of running)assert.equal(lease.close(),true);
    assert.equal(fence.retirementReady,true);
    assert.equal(foreignTicket.close(),true);
    assert.equal(foreign.close(),true);
  }
});

test('generation exhaustion preserves the current generation and pending ticket',()=>{
  const fence=new SelectContinuationFence({generation:Number.MAX_SAFE_INTEGER,maxTickets:1});
  const ticket=fence.register();
  assert.throws(()=>fence.advance(fence.generation),/generation exhausted/);
  assert.equal(fence.generation,Number.MAX_SAFE_INTEGER);
  assert.equal(ticket.active,true);
  const lease=fence.tryClaim(ticket);
  assert.ok(lease);
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,false);
  assert.equal(lease.close(),true);
  assert.equal(fence.retirementReady,true);
});
