// Host-only ActorFuture ABI fixture tests. The Rust compiler carrier
// separately executes actual compiled guest Wasm and real Node/Chromium Workers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {ACTOR_FUTURE_REQUEST_V1,ActorFutureFailure,
  verifyActorFutureGuestV1,createActorFutureHostV1}
  from '../src/actor-future-host-v1.mjs';

const enc=new TextEncoder();
const leb=n=>{const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return out;};
const str=s=>[...leb(enc.encode(s).length),...enc.encode(s)];
const sec=(i,b)=>[i,...leb(b.length),...b];
const sig=(a,r)=>[0x60,...leb(a.length),...a,...leb(r.length),...r];
const custom=(n,p)=>sec(0,[...str(n),...p]);
const body=(opcode,n)=>[0,opcode,n,0x0b];
function fixture(actorId=7,key=41n) {
  const i32=0x7f,i64=0x7e;
  const types=[sig([i32,i32],[i32]),sig([i32,i32,i32],[i32]),
    sig([i32,i32,i32],[i64]),sig([],[i32]),
    sig([i32,i32,i32,i64,i64],[i32]),sig([],[])];
  const names=['task_start_v5','task_resume_v5','task_cancel_v5',
    'task_drop_v5','task_result_v5','task_capacity_v5',
    'task_complete_v5','task_pending_v5'];
  const code=[
    body(0x41,17),body(0x41,2),body(0x41,4),body(0x41,0),
    body(0x42,42),body(0x41,16),body(0x41,0),body(0x42,41)
  ];
  const keyBytes=Array.from({length:8},(_,i)=>Number((key>>BigInt(i*8))&255n));
  const actorBytes=Array.from({length:4},(_,i)=>(actorId>>>(i*8))&255);
  return new WebAssembly.Module(new Uint8Array([
    0,97,115,109,1,0,0,0,
    ...sec(1,[...leb(types.length),...types.flat()]),
    ...sec(2,[1,...str('atto'),...str('cooperate'),0,5]),
    ...sec(3,[8,0,1,1,1,2,3,4,2]),
    ...sec(7,[8,...names.flatMap((n,i)=>[...str(n),0,i+1])]),
    ...sec(10,[8,...code.flatMap(b=>[...leb(b.length),...b])]),
    ...custom('atto.async',[2]),...custom('atto.browser.guest.v5',[5]),
    ...custom('atto.browser.source.actor_future.v1',
      [1,1,...actorBytes,...keyBytes])
  ]));
}
const mk=()=>{const turns=[];return {
  loop:createWorkerControlLoop({postTurn:fn=>turns.push(fn)}),turns
};};
const tick=turns=>{assert.ok(turns.length);turns.shift()();};
test('ActorFuture manifest is explicit and producer is nonzero',()=>{
  assert.equal(verifyActorFutureGuestV1(fixture()),true);
  assert.throws(()=>verifyActorFutureGuestV1(fixture(0)),/E_ACTOR_FUTURE_MANIFEST_VALUE/);
  const bare=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
  assert.throws(()=>verifyActorFutureGuestV1(bare));
});
test('actor incarnation and supervisor stop revoke a pending future',async()=>{
  const notices=[],{loop,turns}=mk(),m=new MessageChannel();
  const host=createActorFutureHostV1({module:fixture(),loop,
    onSupervisorNotice:n=>notices.push(n)});
  try{
    assert.equal(host.registerActor({actorId:7,incarnation:1,controlPort:m.port1}),true);
    const t=host.spawn({owner:'scope1',ownerId:1,epoch:1});
    t.result.catch(()=>{});
    tick(turns);
    assert.equal(t.stats.pending,true);
    assert.equal(host.stats.liveFrames,1);
    assert.equal(host.stopActor({actorId:7,incarnation:1,kind:'panic',reason:'actor fault'}),true);
    assert.equal(host.stopActor({actorId:7,incarnation:1,kind:'panic'}),false);
    tick(turns); // CONTROL must revoke/destroy without entering guest
    await assert.rejects(t.result,e=>e instanceof ActorFutureFailure&&e.code==='E_ACTOR_FUTURE_PANIC');
    assert.equal(host.stats.liveFrames,0);
    assert.equal(host.stats.revocations,1);
    assert.deepEqual(notices,[{actorId:7,incarnation:1,kind:'panic',reason:'actor fault'}]);
    assert.throws(()=>host.spawn({owner:'unknown',ownerId:2,epoch:1}),/NOT_REGISTERED/);
    assert.throws(()=>host.registerActor({actorId:7,incarnation:1,controlPort:m.port1}),/STALE_INCARNATION/);
    assert.equal(host.registerActor({actorId:7,incarnation:2,controlPort:m.port1}),true);
    assert.equal(host.close(),true);
  }finally {m.port1.close();m.port2.close();}
});
test('real actor Worker receives only incarnation-matched one-shot reply port',async()=>{
  const service=new Worker(`
    const {parentPort}=require('node:worker_threads');
    let control;
    parentPort.on('message',m=>{
      if(m.port){
        control=m.port;
        control.on('message',request=>{
          if(request.type!=='atto.actor.future.request.v1'||request.actorId!==7||
             request.incarnation!==9||request.key!==41n||request.requestIndex!==0)
            throw Error('E_ACTOR_REQUEST_METADATA');
          request.port.postMessage({...request.grant,value:42n});
          request.port.postMessage({...request.grant,value:999n}); // replay denied
          parentPort.postMessage('sent');
        });
        parentPort.postMessage('ready');
      }
    });
  `,{eval:true});
  const link=new MessageChannel(),{loop,turns}=mk();
  let noticeCount=0;
  const host=createActorFutureHostV1({module:fixture(),loop,
    onSupervisorNotice:()=>noticeCount++});
  try{
    const ready=new Promise(resolve=>service.once('message',resolve));
    service.postMessage({port:link.port2},[link.port2]);
    assert.equal(await ready,'ready');
    host.registerActor({actorId:7,incarnation:9,controlPort:link.port1});
    const task=host.spawn({owner:'actor-future-owner',ownerId:5,epoch:1});
    tick(turns);
    assert.equal(host.stats.requests,1);
    assert.equal(host.stats.completions,0);
    for(let i=0;i<80&&turns.length===0;i++)
      await new Promise(r=>setTimeout(r,5));
    assert.ok(turns.length,'actor Worker reply queued');
    assert.equal(host.stats.completions,0,'actor callback must not execute guest');
    tick(turns);tick(turns); // completion and separate resume
    assert.equal(await task.result,42n);
    assert.equal(host.stats.drops,1);
    assert.equal(host.stats.liveFrames,0);
    assert.equal(host.stats.requests,1,'one-shot actor future cannot stream extra replies');
    assert.equal(noticeCount,0);
    host.close();
  }finally {
    link.port1.close();await service.terminate();
  }
});
