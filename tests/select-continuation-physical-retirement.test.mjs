import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

// Host reference boundary only. Promise ordering here does not certify guest
// lowering, Worker affinity, real I/O, or other backends.
test('64 independent owners retain async physical credit through close and rejection', async()=>{
  for(let round=0;round<10;round++){
    const owners=Array.from({length:64},(_,i)=>{
      const fence=new SelectContinuationFence({maxTickets:2});
      const running=fence.register(),pending=fence.register();
      let release;
      const held=new Promise(resolve=>{release=resolve;});
      const failure=new Error(`callback ${i}`);
      const reject=(i+round)%2===0;
      const result=fence.tryInvoke(running,async()=>{
        await held;
        if(reject)throw failure;
      }).then(value=>({value}),error=>({error}));
      return {fence,running,pending,release,failure,reject,result};
    });
    try{
      for(let i=0;i<owners.length;i++){
        const {fence,running,pending}=owners[i];
        assert.equal(fence.executing,1);
        assert.equal(fence.pendingTickets,1);
        assert.throws(()=>fence.register(),/capacity/);
        assert.equal(fence.advance(1),false);
        assert.equal(owners[(i+1)%owners.length].fence.tryClaim(pending),null);
        assert.equal(running.close(),false);
        assert.equal(fence.close(),true);
        assert.equal(pending.close(),false);
        assert.equal(fence.retirementReady,false);
        assert.equal(fence.pendingTickets,0);
      }
      for(let i=owners.length-1;i>=0;i--){
        const {fence,release,result,reject,failure,running,pending}=owners[i];
        release();
        const observed=await result;
        if(reject)assert.equal(observed.error,failure);
        else assert.equal(observed.value,true);
        assert.equal(fence.retirementReady,true);
        assert.equal(fence.executing,0);
        assert.equal(fence.tryClaim(running),null);
        assert.equal(fence.tryClaim(pending),null);
        if(i>0)assert.equal(owners[i-1].fence.retirementReady,false);
      }
    }finally{
      for(const owner of owners)owner.release();
      await Promise.all(owners.map(owner=>owner.result));
    }
  }
});

test('10000 ordered event-loop claim/cancel schedules preserve generation and capacity',async()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  let invoked=0;
  for(let generation=1;generation<=10000;generation++){
    const ticket=fence.register(generation);
    const claim=()=>fence.tryInvoke(ticket,()=>{invoked++;});
    const cancel=()=>ticket.close();
    let claimed,cancelled;
    if(generation%2===0){
      const a=Promise.resolve().then(claim),b=Promise.resolve().then(cancel);
      [claimed,cancelled]=await Promise.all([a,b]);
    }else{
      const b=Promise.resolve().then(cancel),a=Promise.resolve().then(claim);
      [claimed,cancelled]=await Promise.all([a,b]);
    }
    assert.equal(claimed,generation%2===0);
    assert.notEqual(claimed,cancelled);
    assert.equal(fence.executing,0);
    assert.equal(fence.pendingTickets,0);
    assert.equal(fence.tryClaim(ticket),null);
    assert.equal(fence.advance(generation),true);
  }
  assert.equal(invoked,5000);
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,true);
});

test('invalid and throwing callbacks do not leak physical execution credit',async()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const ticket=fence.register();
  await assert.rejects(fence.tryInvoke(ticket,null),TypeError);
  assert.equal(fence.pendingTickets,1);
  assert.equal(fence.executing,0);
  const failure=new Error('synchronous callback failure');
  await assert.rejects(fence.tryInvoke(ticket,()=>{throw failure;}),e=>e===failure);
  assert.equal(fence.executing,0);
  assert.equal(fence.pendingTickets,0);
  const lease=fence.tryClaim(fence.register());
  assert.ok(lease);
  assert.equal(fence.close(),true);
  assert.equal(fence.retirementReady,false);
  assert.equal(lease.close(),true);
  assert.equal(lease.close(),false);
  assert.equal(fence.retirementReady,true);
});
