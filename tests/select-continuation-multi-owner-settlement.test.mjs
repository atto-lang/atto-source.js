import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('64 independent asynchronous failures retain credit until each settles',async()=>{
  const actors=Array.from({length:64},()=>{
    const fence=new SelectContinuationFence({maxTickets:2});
    const ticket=fence.register(),pending=fence.register();
    let reject;
    const gate=new Promise((_,r)=>{reject=r;});
    const invocation=fence.tryInvoke(ticket,()=>gate);
    // Attach the rejection observer before releasing any callback.
    const observed=invocation.then(()=>false,e=>e.message==='actor failure');
    return {fence,ticket,pending,reject,observed};
  });
  for(let i=0;i<actors.length;i++){
    const a=actors[i],b=actors[(i+1)%actors.length];
    assert.equal(a.fence.tryClaim(b.pending),null);
    assert.equal(a.fence.advance(1),false);
    assert.equal(a.fence.close(),true);
    assert.equal(a.pending.active,false);
    assert.equal(a.fence.retirementReady,false);
  }
  for(let i=actors.length-1;i>=0;i--){
    const a=actors[i];
    a.reject(new Error('actor failure'));
    assert.equal(await a.observed,true);
    assert.equal(a.fence.executing,0);
    assert.equal(a.fence.pendingTickets,0);
    assert.equal(a.fence.retirementReady,true);
    if(i>0)assert.equal(actors[i-1].fence.retirementReady,false);
    const successor=new SelectContinuationFence({maxTickets:2});
    const fresh=successor.register();
    assert.equal(successor.tryClaim(a.ticket),null);
    assert.equal(successor.tryClaim(a.pending),null);
    assert.equal(fresh.active,true);
    assert.equal(fresh.close(),true);
    assert.equal(successor.close(),true);
    assert.equal(successor.retirementReady,true);
  }
});
