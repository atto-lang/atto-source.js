import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorGenerationFence} from '../src/actor-generation-fence.mjs';

test('captured leases are genuine, frozen and generation-bound',()=>{
  const owner=new ActorGenerationFence();
  const old=owner.capture();
  assert.equal(Object.isFrozen(old),true);
  assert.equal(old.current,true);
  assert.equal(old.tryRun(()=>true),true);
  assert.equal(owner.advanceGeneration(),2);
  const live=owner.capture();
  assert.equal(old.current,false);
  assert.equal(old.tryRun(()=>true),false);
  assert.equal(live.current,true);
  assert.equal(live.tryRun(()=>true),true);
  // Class is reachable through lease.constructor, but no outsider can issue it.
  assert.throws(()=>new old.constructor(owner,2),/leases must be captured/);
  assert.throws(()=>new old.constructor(),/leases must be captured/);
});

test('foreign and reconstructed generation claims cannot execute',()=>{
  const owner=new ActorGenerationFence();
  const foreign=new ActorGenerationFence();
  const live=owner.capture();
  let called=0;
  for(const fake of [1,{},null,undefined,{generation:1},foreign.capture()]){
    assert.equal(owner._current(fake),false);
    assert.equal(owner._tryRun(fake,()=>{called++;return true;}),false);
  }
  assert.equal(called,0);
  assert.equal(owner._tryRun(live,()=>{called++;return true;}),true);
  assert.equal(called,1);
});

test('stale leases never regain authority after new captures',()=>{
  const fence=new ActorGenerationFence();
  const stale=fence.capture();
  assert.equal(fence.advanceGeneration(),2);
  const current=fence.capture();
  let commits=0;
  assert.equal(fence._tryRun(stale,()=>{commits++;return true;}),false);
  assert.equal(stale.tryRun(()=>{commits++;return true;}),false);
  assert.equal(fence._tryRun(current,()=>{commits++;return true;}),true);
  assert.equal(commits,1);
});

test('synchronous boolean and generation reentry constraints remain enforced',()=>{
  const owner=new ActorGenerationFence();
  const lease=owner.capture();
  assert.throws(()=>lease.tryRun(()=>{owner.advanceGeneration();return true;}),/cannot advance/);
  assert.throws(()=>lease.tryRun(()=>Promise.resolve(true)),/synchronous boolean/);
  assert.equal(owner.generation,1);
  assert.equal(lease.tryRun(()=>false),false);
  assert.equal(lease.tryRun(()=>true),true);
});

test('post-import WeakMap prototype tampering cannot mint or consume leases',()=>{
  const owner=new ActorGenerationFence();
  const current=owner.capture();
  const initialGet=WeakMap.prototype.get;
  const initialSet=WeakMap.prototype.set;
  const initialFreeze=Object.freeze;
  let uses=0;
  try {
    WeakMap.prototype.get=()=>{uses++;throw Error('polluted get');};
    WeakMap.prototype.set=()=>{uses++;throw Error('polluted set');};
    Object.freeze=value=>value;
    const live=owner.capture();
    assert.equal(Object.isFrozen(live),true);
    assert.equal(current.current,true);
    assert.equal(live.tryRun(()=>true),true);
    assert.equal(owner._tryRun({generation:1},()=>true),false);
    assert.equal(uses,0);
  } finally {
    WeakMap.prototype.get=initialGet;
    WeakMap.prototype.set=initialSet;
    Object.freeze=initialFreeze;
  }
});
