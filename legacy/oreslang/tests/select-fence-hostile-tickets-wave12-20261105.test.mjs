import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('forged proxy and revoked proxy tickets never run traps or drain a live reservation',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const live=fence.register();
  let traps=0;
  const proxy=new Proxy(Object.create(null),{
    get(){traps++;throw Error('ticket getter invoked');},
    getOwnPropertyDescriptor(){traps++;throw Error('ticket descriptor invoked');},
    getPrototypeOf(){traps++;throw Error('ticket prototype invoked');}
  });
  const revoked=Proxy.revocable({},{});
  revoked.revoke();
  for(const fake of [proxy,revoked.proxy]){
    assert.equal(fence.tryConsume(fake),false);
    assert.equal(fence._close(fake),false);
    assert.equal(fence.pendingTickets,1);
  }
  assert.equal(traps,0);
  assert.equal(fence.tryConsume(live),true);
});

test('a proxy around a real issued ticket is not its unforgeable WeakMap identity',()=>{
  const fence=new SelectContinuationFence({maxTickets:1});
  const ticket=fence.register();
  const proxy=new Proxy(ticket,{});
  assert.equal(fence.tryConsume(proxy),false);
  assert.equal(fence._close(proxy),false);
  assert.equal(fence.pendingTickets,1);
  assert.equal(fence.tryConsume(ticket),true);
  assert.equal(fence.tryConsume(proxy),false);
});

test('other actor fences cannot consume or close issued tickets despite equal slot indices',()=>{
  const a=new SelectContinuationFence({generation:7,maxTickets:1});
  const b=new SelectContinuationFence({generation:7,maxTickets:1});
  const first=a.register(7),second=b.register(7);
  assert.equal(first.index,second.index);
  assert.equal(b.tryConsume(first),false);
  assert.equal(a._close(second),false);
  assert.equal(first.active,true);
  assert.equal(second.active,true);
  assert.equal(a.tryConsume(first),true);
  assert.equal(b.tryConsume(second),true);
});
