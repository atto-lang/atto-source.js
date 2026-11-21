import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';

function harness(options = {}) {
  const scheduled = [], errors = [];
  const loop = createWorkerControlLoop({
    postTurn: fn => {scheduled.push(fn);}, onTurnError: err => errors.push(err),
    ...options
  });
  function step() {assert.ok(scheduled.length, 'queued scheduler turn');scheduled.shift()();}
  function drain() {let budget=100;while(scheduled.length){assert.ok(--budget>0);step();}}
  return {loop, scheduled, errors, step, drain};
}

test('reactor completion only queues; CONTROL wins before completed data', () => {
  const h = harness();
  const seen = [];
  assert.equal(h.loop.attachOwner('actor',1), true);
  const ticket = h.loop.beginSuspension('actor',1, value => {seen.push(`resume:${value}`);});
  assert.equal(h.loop.complete(ticket, 42), true);
  assert.equal(h.loop.admitControl('actor',1, () => {seen.push('stop');}), true);
  assert.deepEqual(seen, [], 'no guest code runs inline on reactor completion');
  h.step();
  assert.deepEqual(seen, ['stop']);
  h.drain();
  assert.deepEqual(seen, ['stop','resume:42']);
});

test('DATA FIFO and one quantum per scheduled turn', () => {
  const h = harness(), seen = [];
  h.loop.attachOwner('a',1);
  for (let i=0;i<4;i++) assert.equal(h.loop.admitData('a',1, n => {seen.push(n);},i),true);
  h.step(); assert.deepEqual(seen,[0]);
  h.drain(); assert.deepEqual(seen,[0,1,2,3]);
  assert.equal(h.loop.stats.completed,4);
});

test('single completion, opaque ticket identity, and cancellation', () => {
  const h = harness(), seen=[];
  h.loop.attachOwner('a',2);
  const a=h.loop.beginSuspension('a',2, n=>seen.push(n));
  assert.equal(h.loop.complete({...a},3),false);
  assert.equal(h.loop.complete(a,3),true);
  assert.equal(h.loop.complete(a,4),false);
  const b=h.loop.beginSuspension('a',2, n=>seen.push(n));
  assert.equal(h.loop.cancel({...b}),false);
  assert.equal(h.loop.cancel(b),true);
  assert.equal(h.loop.complete(b,4),false);
  h.drain(); assert.deepEqual(seen,[3]);
});

test('retiring actor fences pending and queued work across same owner new epoch', () => {
  const h=harness(),seen=[];
  h.loop.attachOwner('a',1);
  const old=h.loop.beginSuspension('a',1,n=>seen.push(n));
  h.loop.admitData('a',1,()=>seen.push('old'));
  assert.equal(h.loop.retireOwner('a',1),true);
  assert.equal(h.loop.complete(old,1),false);
  assert.equal(h.loop.attachOwner('a',2),true);
  h.loop.admitData('a',2,()=>seen.push('new'));
  h.drain();
  assert.deepEqual(seen,['new']);
  assert.equal(h.loop.stats.dropped,1);
});

test('CONTROL capacity reserved independently of ready queue; wait quota bounded',()=>{
  const h=harness({maxReady:1,maxControl:1,maxSuspended:1});
  h.loop.attachOwner('a',1);
  assert.equal(h.loop.admitData('a',1,()=>{}),true);
  assert.equal(h.loop.admitData('a',1,()=>{}),false);
  assert.equal(h.loop.admitControl('a',1,()=>{}),true);
  assert.equal(h.loop.admitControl('a',1,()=>{}),false);
  const t=h.loop.beginSuspension('a',1,()=>{});
  assert.ok(t);
  assert.equal(h.loop.beginSuspension('a',1,()=>{}),null);
  assert.equal(h.loop.complete(t,1),false, 'full ready queue retains waiter');
  h.step(); // CONTROL
  h.step(); // DATA
  assert.equal(h.loop.complete(t,1),true);
  h.drain(); assert.equal(h.loop.stats.suspended,0);
});

test('close revokes every waiter and drops scheduled turns',()=>{
  const h=harness(),seen=[];
  h.loop.attachOwner('a',1);
  const t=h.loop.beginSuspension('a',1,()=>seen.push('bad'));
  h.loop.admitData('a',1,()=>seen.push('bad'));
  h.loop.close();
  h.drain();
  assert.equal(h.loop.complete(t,2),false);
  assert.equal(h.loop.admitControl('a',1,()=>{}),false);
  assert.deepEqual(seen,[]);
  assert.equal(h.loop.stats.closed,true);
});

test('throw or a Promise-valued quantum never holds up the control loop',()=>{
  const h=harness(),seen=[];
  h.loop.attachOwner('a',1);
  h.loop.admitData('a',1,()=>{throw Error('boom');});
  h.loop.admitData('a',1,()=>Promise.resolve(1));
  h.loop.admitData('a',1,()=>seen.push('healthy'));
  h.drain();
  assert.deepEqual(seen,['healthy']);
  assert.match(h.errors[0].message,/boom/);
  assert.match(h.errors[1].message,/synchronous quanta/);
  assert.equal(h.loop.stats.completed,1);
});

test('invalid or stale controls fail closed',()=>{
  const h=harness();
  assert.throws(()=>h.loop.attachOwner('a',0),/owner epoch/);
  assert.equal(h.loop.attachOwner('a',1),true);
  assert.equal(h.loop.attachOwner('a',1),false);
  assert.equal(h.loop.admitData('a',2,()=>{}),false);
  assert.throws(()=>h.loop.beginSuspension('a',1,null),/invalid suspension/);
});
