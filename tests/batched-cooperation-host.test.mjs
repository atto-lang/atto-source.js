import test from 'node:test';
import assert from 'node:assert/strict';
import {BatchedCooperationMeter} from '../src/batched-cooperation.mjs';

test('slow callbacks execute only on 128/512-unit boundaries',()=>{
  for(const interval of [128,512]){
    const meter=new BatchedCooperationMeter(interval);
    const polls=[];
    for(let work=1;work<=1024;work++)
      assert.equal(meter.commit_batch(1,r=>polls.push(r)),work%interval===0);
    assert.equal(polls.length,1024/interval);
    assert.equal(polls.at(-1).completed,1024);
    assert.equal(polls.at(-1).overdue,true);
    assert.equal(meter.completed,1024);
    assert.equal(meter.phase,0);
    assert.ok(polls.every(r=>Object.isFrozen(r)));
  }
});

test('a bounded batched charge cannot skip an obligatory boundary',()=>{
  const meter=new BatchedCooperationMeter();
  const polls=[];
  assert.equal(meter.commit_batch(127,r=>polls.push(r)),false);
  assert.equal(meter.commit_batch(2,r=>polls.push(r)),true);
  assert.equal(meter.phase,1);
  assert.equal(meter.completed,129);
  assert.deepEqual(polls.map(x=>x.completed),[129]);
  for(const bad of [0,-1,129,0.5,Infinity,'1',Number.MAX_SAFE_INTEGER])
    assert.throws(()=>meter.commit_batch(bad,()=>{}),/invalid bounded/);
});

test('dispatch reset avoids forgotten work but cannot reset inside callback',()=>{
  const meter=new BatchedCooperationMeter(128);
  meter.commit_batch(128,receipt=>{
    assert.equal(receipt.completed,128);
    assert.throws(()=>meter.begin_dispatch(),/reentrant/);
    assert.throws(()=>meter.commit_batch(1,()=>{}),/reentrant/);
  });
  meter.begin_dispatch();
  assert.equal(meter.completed,0);
  assert.equal(meter.phase,0);
  assert.equal(meter.commit_batch(128,()=>{}),true);
});

test('callback exceptions consume checkpoint and do not replay the same boundary',()=>{
  const meter=new BatchedCooperationMeter();
  let calls=0;
  assert.throws(()=>meter.commit_batch(128,()=>{
    calls++;
    throw new Error('scheduler failure');
  }),/scheduler failure/);
  assert.equal(calls,1);
  assert.equal(meter.phase,0);
  assert.equal(meter.completed,128);
  assert.equal(meter.commit_batch(1,()=>{calls++}),false);
  assert.equal(calls,1);
});

test('scheduler callback thenable is rejected without reading its getter',()=>{
  const meter=new BatchedCooperationMeter();
  let reads=0;
  const object={get then(){reads++;throw Error('should not evaluate then')}};
  assert.throws(()=>meter.commit_batch(128,()=>object),/asynchronous checkpoint callback unsupported/);
  assert.equal(reads,0);
  assert.equal(meter.completed,128);
  assert.throws(()=>new BatchedCooperationMeter(64),/128 or 512/);
  assert.equal(Object.isFrozen(BatchedCooperationMeter),true);
});

test('single charge cannot claim unproved work or skip the slow callback',()=>{
  const meter=new BatchedCooperationMeter();
  assert.throws(()=>meter.commit_batch(128,null),/callback required/);
  assert.equal(meter.completed,0);
  assert.equal(meter.phase,0);
});
