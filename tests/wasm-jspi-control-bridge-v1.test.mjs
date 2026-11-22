import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {createJspiControlBridgeV1,JSPI_CONTROL_BRIDGE_V1} from '../src/wasm-jspi-control-bridge-v1.mjs';

function harness(opts={}) {
  const turns=[],wakes=[];
  const loop=createWorkerControlLoop({postTurn:fn=>turns.push(fn),maxReady:1,maxControl:1,...opts});
  const bridge=createJspiControlBridgeV1({loop,owner:'actor',epoch:1,
    scheduleWake:fn=>{const h={fn};wakes.push(h);return h;},
    cancelWake:h=>{h.cancelled=true;}});
  const tick=()=>{assert.ok(turns.length);turns.shift()();};
  const wake=()=>{assert.ok(wakes.length);const h=wakes.shift();if(!h.cancelled)h.fn();};
  return {loop,bridge,turns,wakes,tick,wake};
}

test('cooperative JSPI wake queues behind reserved CONTROL lane',async()=>{
  const h=harness(),seen=[];
  assert.equal(h.bridge.version,JSPI_CONTROL_BRIDGE_V1);
  const p=h.bridge.cooperate().then(()=>seen.push('jspi'));
  assert.equal(h.loop.stats.suspended,1);
  h.wake();
  assert.equal(h.loop.admitControl('actor',1,()=>seen.push('control')),true);
  assert.deepEqual(seen,[],'reactor admission must not execute guest callbacks');
  h.tick();assert.deepEqual(seen,['control']);
  h.tick();await p;
  assert.deepEqual(seen,['control','jspi']);
  assert.equal(h.bridge.stats.resolved,1);
  assert.equal(h.loop.stats.suspended,0);
});

test('retirement rejects awaiting guest and fences a stale callback across epoch',async()=>{
  const h=harness();
  const p=h.bridge.cooperate();
  const oldWake=h.wakes[0].fn;
  assert.equal(h.bridge.retire(),true);
  await assert.rejects(p,/E_OWNER_RETIRED/);
  oldWake();
  assert.equal(h.loop.stats.suspended,0);
  assert.equal(h.bridge.stats.cancelled,1);
  assert.equal(h.bridge.retire(),false);
  await assert.rejects(h.bridge.cooperate(),/E_OWNER_RETIRED/);
  assert.equal(h.loop.attachOwner('actor',1),false);
  assert.equal(h.loop.attachOwner('actor',2),true);
});

test('bounded waiter quota denies new admission without losing first ticket',async()=>{
  const h=harness({maxSuspended:1});
  const p=h.bridge.cooperate();
  await assert.rejects(h.bridge.cooperate(),/E_BRIDGE_ADMISSION/);
  assert.equal(h.loop.stats.suspended,1);
  h.wake();h.tick();await p;
  assert.equal(h.loop.stats.suspended,0);
});

test('an already-queued wake is revoked before guest JSPI continuation resumes',async()=>{
  const h=harness();
  const p=h.bridge.cooperate();
  h.wake();
  assert.equal(h.loop.stats.ready,1);
  h.bridge.retire();
  await assert.rejects(p,/E_OWNER_RETIRED/);
  h.tick();
  assert.equal(h.loop.stats.completed,0);
});

test('synchronous host wake callbacks are rejected before scheduling guest work',async()=>{
  const loop=createWorkerControlLoop();
  const bridge=createJspiControlBridgeV1({loop,owner:'actor',epoch:1,
    scheduleWake:fn=>fn()});
  await assert.rejects(bridge.cooperate(),/E_WAKE_NOT_ASYNC/);
  assert.equal(loop.stats.suspended,0);
  bridge.retire();
});

test('invalid module and omitted or old marker are rejected',()=>{
  const loop=createWorkerControlLoop();
  const bridge=createJspiControlBridgeV1({loop,owner:'actor',epoch:1});
  assert.throws(()=>bridge.makeCooperateImport({}),/E_ABI_MODULE/);
  const bare=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
  assert.throws(()=>bridge.makeCooperateImport(bare),/E_ABI_ASYNC_VERSION/);
  bridge.retire();
});

test('quota, scheduler errors and invalid owner admission fail closed',async()=>{
  const h=harness(),p=h.bridge.cooperate();
  h.wake();h.tick();await p;
  assert.throws(()=>createJspiControlBridgeV1({loop:h.loop,owner:'actor',epoch:1}),
    /E_OWNER_ADMISSION/);
  h.bridge.retire();
});