import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorGenerationFence} from '../src/actor-generation-fence.mjs';

test('terminal close seals all issued leases and new captures',()=>{
  const fence=new ActorGenerationFence();
  const first=fence.capture();
  fence.advanceGeneration();
  const live=fence.capture();
  assert.equal(first.current,false);
  assert.equal(live.current,true);
  assert.equal(fence.closed,false);
  assert.equal(fence.close(),true);
  assert.equal(fence.closed,true);
  assert.equal(fence.close(),false);
  assert.equal(live.current,false);
  let invoked=0;
  assert.equal(live.tryRun(()=>{invoked++;return true;}),false);
  assert.equal(invoked,0);
  assert.throws(()=>fence.capture(),/closed/);
  assert.throws(()=>fence.advanceGeneration(),/closed/);
});

test('terminal closure invalidates queued microtasks',async()=>{
  const fence=new ActorGenerationFence();
  const lease=fence.capture();
  let count=0;
  const queued=Promise.resolve().then(()=>lease.tryRun(()=>{count++;return true;}));
  fence.close();
  assert.equal(await queued,false);
  assert.equal(count,0);
});

test('close cannot reenter a fenced commit',()=>{
  const fence=new ActorGenerationFence();
  const lease=fence.capture();
  assert.throws(()=>lease.tryRun(()=>{fence.close();return true;}),/cannot close inside/);
  assert.equal(fence.closed,false);
  assert.equal(lease.current,true);
  assert.equal(lease.tryRun(()=>true),true);
});

test('close of one fence never revokes another actor generation',()=>{
  const stopped=new ActorGenerationFence();
  const sibling=new ActorGenerationFence();
  const a=stopped.capture();
  const b=sibling.capture();
  stopped.close();
  assert.equal(a.current,false);
  assert.equal(b.current,true);
  assert.equal(b.tryRun(()=>true),true);
});
