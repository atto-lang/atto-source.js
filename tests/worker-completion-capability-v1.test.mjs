import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {createWorkerCompletionCapabilitiesV1,WORKER_COMPLETION_V1}
  from '../src/worker-completion-capability-v1.mjs';

const makeLoop=()=> {
  const turns=[];
  return {turns,loop:createWorkerControlLoop({postTurn:fn=>turns.push(fn)})};
};
const completeFrame=(grant,value=42n)=>({...grant,value});
const tickUntil=async(predicate)=>{
  for(let i=0;i<400;i++) {
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw new Error('worker completion timed out');
};

test('capability v1 admits only exact single-use i64 frame and defers execution',()=>{
  const {loop,turns}=makeLoop(),results=[];
  const auth=createWorkerCompletionCapabilitiesV1({loop,owner:'worker-a',epoch:11,maxPending:1});
  assert.equal(auth.version,WORKER_COMPLETION_V1);
  const grant=auth.reserve(v=>results.push(v));
  assert.equal(grant.capability.length,32);
  assert.equal(auth.reserve(()=>{}),null,'quota is reserved until completion/cancel');
  assert.equal(auth.complete({...completeFrame(grant),owner:'worker-b'}),false);
  assert.equal(auth.complete({...completeFrame(grant),epoch:12}),false);
  assert.equal(auth.complete({...completeFrame(grant),capability:'a'.repeat(32)}),false);
  assert.equal(auth.complete({...completeFrame(grant),value:1}),false);
  assert.equal(auth.complete({...completeFrame(grant),value:1n<<63n}),false);
  assert.equal(auth.complete({...completeFrame(grant),unexpected:true}),false);
  let getterRan=false;
  const getter={...grant,get value(){getterRan=true;return 42n;}};
  assert.equal(auth.complete(getter),false);
  assert.equal(getterRan,false,'no accessor evaluation in untrusted message');
  assert.equal(results.length,0);
  assert.equal(auth.complete(completeFrame(grant)),true);
  assert.equal(auth.complete(completeFrame(grant)),false,'replay denied');
  assert.equal(auth.cancel(grant),false,'already settled ticket');
  assert.equal(results.length,0,'completion cannot run guest callback inline');
  assert.equal(turns.length,1);
  turns.shift()();
  assert.deepEqual(results,[42n]);
  assert.equal(auth.stats.accepted,1);
  assert.equal(auth.stats.rejected,8);
  assert.equal(auth.close(),true);
  assert.equal(auth.close(),false);
  assert.equal(loop.stats.owners,0);
});

test('cancellation, quota refund and epoch restart fence stale capabilities',()=>{
  const {loop}=makeLoop();
  const one=createWorkerCompletionCapabilitiesV1({loop,owner:'restart',epoch:1,maxPending:1});
  const stale=one.reserve(()=>{throw Error('should not resume');});
  assert.equal(one.cancel({...stale}),false,'forged host cancel cannot revoke ticket');
  assert.equal(one.cancel(stale),true);
  assert.equal(one.reserve(()=>{})?.ticket,2,'cancel refunded one pending slot');
  assert.equal(one.close(),true);
  assert.equal(one.complete(completeFrame(stale)),false);
  const two=createWorkerCompletionCapabilitiesV1({loop,owner:'restart',epoch:2});
  const fresh=two.reserve(()=>{});
  assert.equal(two.complete(completeFrame(stale)),false);
  assert.equal(two.complete(completeFrame(fresh,(-1n<<63n))),true);
  assert.equal(two.close(),true);
  assert.equal(loop.stats.owners,0);
  assert.equal(loop.stats.suspended,0);
});

test('real Node Worker sends a one-use completion over a dedicated MessagePort',async(t)=>{
  const {loop,turns}=makeLoop(),results=[];
  const auth=createWorkerCompletionCapabilitiesV1({loop,owner:'remote-worker',epoch:7});
  const grant=auth.reserve(value=>results.push(value));
  const channel=new MessageChannel();
  auth.bindPort(channel.port1);
  const worker=new Worker(`
    const {parentPort}=require('node:worker_threads');
    parentPort.once('message',({port,grant})=>{
      const frame={...grant,value:42n};
      port.postMessage(frame);
      port.postMessage(frame); // duplicate/replay from another Worker turn
    });
  `,{eval:true});
  t.after(async()=>{auth.close();channel.port1.close();await worker.terminate();});
  worker.postMessage({port:channel.port2,grant},[channel.port2]);
  await tickUntil(()=>auth.stats.accepted===1&&auth.stats.rejected>=1);
  assert.equal(results.length,0,'real Worker completion cannot execute inline');
  assert.equal(turns.length,1);
  turns.shift()();
  assert.deepEqual(results,[42n]);
  assert.equal(auth.stats.pending,0);
  assert.equal(auth.stats.accepted,1);
  assert.equal(auth.stats.rejected,1);
});
