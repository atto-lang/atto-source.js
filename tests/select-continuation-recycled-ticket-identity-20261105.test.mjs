import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('consumption frees capacity without reviving a consumed continuation',()=>{
 const fence=new SelectContinuationFence({generation:7,maxTickets:1});
 const old=fence.register(7);
 assert.equal(old.active,true);
 assert.throws(()=>fence.register(7),/capacity exhausted/);
 assert.equal(fence.tryConsume(old),true);
 assert.equal(fence.tryConsume(old),false);
 const next=fence.register(7);
 assert.notEqual(next.id,old.id);
 assert.equal(old.active,false);
 assert.equal(fence.tryConsume(next),true);
 assert.equal(fence.pendingTickets,0);
});

test('generation advance invalidates queued tickets after reuse',()=>{
 const fence=new SelectContinuationFence({maxTickets:1});
 const old=fence.register();
 assert.equal(fence.advance(1),true);
 const live=fence.register(2);
 assert.equal(fence.tryConsume(old),false);
 assert.equal(old.close(),false);
 assert.equal(live.active,true);
 assert.throws(()=>fence.register(1),/stale actor generation/);
 assert.equal(fence.tryConsume(live),true);
});

test('reconstructed and getter-bearing tickets cannot consume a real reservation',()=>{
 const fence=new SelectContinuationFence({maxTickets:1});
 const live=fence.register();
 const reconstructed=new live.constructor(fence,live.index,live.id,live.generation);
 assert.equal(fence.tryConsume(reconstructed),false);
 assert.equal(fence.tryConsume({...live}),false);
 let reads=0;
 assert.equal(fence.tryConsume({get index(){reads++;throw Error('hostile');}}),false);
 assert.equal(reads,0);
 assert.equal(fence.pendingTickets,1);
 assert.equal(fence.tryConsume(live),true);
});

test('terminal close cannot reopen an old generation',()=>{
 const fence=new SelectContinuationFence({generation:11,maxTickets:1});
 const live=fence.register(11);
 assert.equal(fence.close(),true);
 assert.equal(fence.close(),false);
 assert.equal(live.active,false);
 assert.equal(live.close(),false);
 assert.equal(fence.advance(11),false);
 assert.equal(fence.pendingTickets,0);
 assert.throws(()=>fence.register(11),/closed/);
});
