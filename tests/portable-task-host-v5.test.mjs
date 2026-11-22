// Contract tests for the host protocol. Rust PR #197 separately exercises
// real compiler-generated v5 Wasm in Node and Chromium; this guest is a
// purpose-built constant Wasm ABI fixture, not proof of Rust lowering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {WORKER_COMPLETION_V1} from '../src/worker-completion-capability-v1.mjs';
import {createPortableTaskHostV5,verifyPortableTaskGuestV5}
  from '../src/portable-task-host-v5.mjs';

const enc=new TextEncoder();
function leb(n){const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;}
const str=s=>[...leb(enc.encode(s).length),...enc.encode(s)];
const sec=(k,bytes)=>[k,...leb(bytes.length),...bytes];
const sig=(args,rets)=>[0x60,...leb(args.length),...args,...leb(rets.length),...rets];
const custom=(key,val)=>sec(0,[...str(key),val]);
const body=(op,value)=>[0,op,value,0x0b];
function fixture() {
  const I32=0x7f,I64=0x7e;
  const types=[
    sig([I32,I32],[I32]),sig([I32,I32,I32],[I32]),
    sig([I32,I32,I32],[I64]),sig([],[I32]),
    sig([I32,I32,I32,I64,I64],[I32]),sig([],[])
  ];
  const names=['task_start_v5','task_resume_v5','task_cancel_v5',
    'task_drop_v5','task_result_v5','task_capacity_v5',
    'task_complete_v5','task_pending_v5'];
  const code=[
    body(0x41,17),body(0x41,2),body(0x41,4),body(0x41,0),
    body(0x42,42),body(0x41,16),body(0x41,0),body(0x42,41)
  ];
  return new WebAssembly.Module(new Uint8Array([
    0,97,115,109,1,0,0,0,
    ...sec(1,[...leb(types.length),...types.flat()]),
    ...sec(2,[1,...str('atto'),...str('cooperate'),0,5]),
    ...sec(3,[8,0,1,1,1,2,3,4,2]),
    ...sec(7,[8,...names.flatMap((s,i)=>[...str(s),0,i+1])]),
    ...sec(10,[8,...code.flatMap(c=>[...leb(c.length),...c])]),
    ...custom('atto.async',2),
    ...custom('atto.browser.guest.v5',5)
  ]));
}
const module=fixture();
const harness=()=>{const turns=[];return {
  turns,loop:createWorkerControlLoop({maxOwners:16,maxSuspended:16,
    maxReady:64,postTurn:f=>turns.push(f)})
};};
function flush(turns,count){
  for(let i=0;i<count;i++){assert.ok(turns.length, 'expected scheduler turn '+i);turns.shift()();}
}
const frame=(grant,value)=>({...grant,value});
test('versioned future ABI rejects missing or mixed artifacts',()=>{
  assert.equal(verifyPortableTaskGuestV5(module),true);
  assert.throws(()=>verifyPortableTaskGuestV5(null),/E_V5_MODULE/);
  assert.throws(()=>verifyPortableTaskGuestV5(
    new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]))),/E_V5_MARKER/);
});
test('16 pending host tasks never resume eagerly; authenticated completions are one-shot',async()=>{
  const {turns,loop}=harness(),pending=[],host=createPortableTaskHostV5({module,loop});
  const tasks=Array.from({length:16},(_,i)=>host.spawn({
    owner:'task-'+i,ownerId:i+1,epoch:1,onPending:info=>pending.push(info)
  }));
  assert.equal(host.stats.turns,0);
  flush(turns,16);
  assert.equal(host.stats.starts,16);
  assert.equal(host.stats.peak,16);
  assert.equal(turns.length,0,'no pending future must poll or schedule itself');
  assert.equal(loop.stats.suspended,16);
  assert.equal(pending.length,16);
  assert.throws(()=>host.spawn({
    owner:'over-cap',ownerId:99,epoch:1,onPending(){}}),/E_V5_FRAME_QUOTA/);
  assert.throws(()=>host.spawn({
    owner:'task-99',ownerId:1,epoch:2,onPending(){}}),/E_V5_FRAME_QUOTA|E_V5_OWNER_ID_COLLISION/);
  const {grant}=pending[0];
  assert.equal(tasks[0].complete({...frame(grant,42n),owner:'foreign'}),false);
  assert.equal(tasks[0].complete({...frame(grant,42n),epoch:2}),false);
  assert.equal(tasks[0].complete(frame(grant,0)),false,'non-i64 value rejected');
  assert.equal(turns.length,0);
  for(let i=15;i>=0;i--){
    assert.equal(tasks[i].complete(frame(pending[i].grant,42n)),true);
    assert.equal(tasks[i].complete(frame(pending[i].grant,42n)),false,'single use');
  }
  assert.equal(host.stats.completions,0,'reactor does not execute compiled guest');
  flush(turns,32);
  assert.deepEqual(await Promise.all(tasks.map(t=>t.result)),Array(16).fill(42n));
  assert.equal(host.stats.completions,16);
  assert.equal(host.stats.resumes,16);
  assert.equal(host.stats.liveFrames,0);
  assert.equal(host.stats.drops,16);
  assert.equal(loop.stats.suspended,0);
  assert.equal(loop.stats.owners,0);
  assert.equal(host.close(),true);
});
test('cancel revokes a pending bearer before CONTROL and prevents stale replay',async()=>{
  const {turns,loop}=harness(),pending=[],host=createPortableTaskHostV5({module,loop});
  const task=host.spawn({owner:'revoke',ownerId:1,epoch:1,onPending:x=>pending.push(x)});
  task.result.catch(()=>{});
  flush(turns,1);
  assert.equal(task.stats.pending,true);
  const old=frame(pending[0].grant,42n);
  assert.equal(task.cancel(),true);
  assert.equal(task.complete(old),false,'revoked synchronously');
  flush(turns,1);
  await assert.rejects(task.result,/E_V5_CANCELLED/);
  assert.equal(host.stats.liveFrames,0);
  assert.equal(host.stats.drops,1);
  assert.equal(task.cancel(),false);
  assert.equal(loop.stats.owners,0);
  assert.equal(host.close(),true);
});
test('closed scheduler still permits owner-driven frame teardown',async()=>{
  const {turns,loop}=harness(),host=createPortableTaskHostV5({module,loop});
  const task=host.spawn({owner:'shutdown',ownerId:1,epoch:1,onPending(){}});
  task.result.catch(()=>{});
  flush(turns,1);
  loop.close();
  assert.equal(host.close(),true);
  await assert.rejects(task.result,/E_V5_HOST_CLOSED/);
  assert.equal(host.stats.drops,1);
  assert.equal(host.stats.liveFrames,0);
  assert.throws(()=>host.spawn({owner:'new',ownerId:2,epoch:2,onPending(){}}),/E_V5_HOST_CLOSED/);
});
test('real Node Worker MessagePort: bearer completion schedules guest in a later turn',async()=>{
  const worker=new Worker(`
    const {parentPort}=require('node:worker_threads');
    let port;
    parentPort.on('message',data=>{
      if(data.port){port=data.port;parentPort.postMessage('ready');}
      if(data.grant)port.postMessage({...data.grant,value:42n});
    });
  `,{eval:true});
  const {port1,port2}=new MessageChannel();
  try{
    const ready=new Promise(resolve=>worker.once('message',resolve));
    worker.postMessage({port:port2},[port2]);assert.equal(await ready,'ready');
    const {turns,loop}=harness();
    let grants=0;
    const host=createPortableTaskHostV5({module,loop});
    const task=host.spawn({owner:'worker',ownerId:1,epoch:1,port:port1,
      onPending:({grant})=>{grants++;worker.postMessage({grant});}});
    flush(turns,1);
    assert.equal(grants,1);
    assert.equal(host.stats.completions,0);
    // The actual Node MessagePort receives and admits a token asynchronously.
    // A short async wait is fine in test code, NEVER a guest scheduler quantum.
    for(let i=0;i<50&&turns.length===0;i++)
      await new Promise(r=>setTimeout(r,5));
    assert.ok(turns.length>0,'Worker completion was queued');
    assert.equal(host.stats.completions,0,'no guest execution in MessagePort handler');
    flush(turns,2);
    assert.equal(await task.result,42n);
    assert.equal(host.stats.drops,1);
    host.close();
    port1.close();
  }finally{port1.close();await worker.terminate();}
});
