import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {compileScheduledUnwindV1} from '../src/scheduled-unwind-compiler.mjs';
import * as runtime from '../src/scheduled-unwind-runtime.mjs';
import {SelectableI64Future} from '../src/selectable-i64-future.mjs';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
const source=readFileSync(new URL('./fixtures/scheduled-recover-owned-pending.atto',import.meta.url),'utf8');
const identity={tenant_id:'test',actor_id:1,generation:1};
const compile=async s=>import('data:text/javascript,'+encodeURIComponent(compileScheduledUnwindV1(s)));
async function fixture(s=source){
  const guest=await compile(s),turns=[],errors=[],out=[];
  const loop=createWorkerControlLoop({maxSuspended:1,postTurn:f=>turns.push(f),onTurnError:e=>errors.push(e)});
  loop.attachOwner('a',1);
  const input=new SelectableI64Future(),cleanup=new SelectableI64Future(),fallback=new SelectableI64Future();
  assert.equal(guest.start(runtime,loop,'a',identity,[input,cleanup,fallback],v=>{assert.equal(loop.retireOwner('a',1),false);out.push(v);}),true);
  const step=()=>{assert.ok(turns.length);turns.shift()();assert.deepEqual(errors,[]);};
  return {input,cleanup,fallback,loop,out,step,turns};
}
test('body await preserves result through genuinely pending cleanup; recover not subscribed',async()=>{
  const h=await fixture();h.step();
  assert.equal(h.input.pendingWaiters,1);assert.equal(h.cleanup.pendingWaiters,0);
  assert.equal(h.loop.retireOwner('a',1),false);
  h.input.resolve(42n);assert.deepEqual(h.out,[]);h.step();
  assert.equal(h.cleanup.pendingWaiters,1);assert.equal(h.fallback.pendingWaiters,0);
  h.cleanup.resolve(0n);h.step();assert.deepEqual(h.out,[{kind:'returned',value:42n}]);
  assert.equal(h.loop.stats.retainedOwners,0);assert.equal(h.loop.retireOwner('a',1),true);
});
test('body failure preserves identity through cleanup and scheduled recovery',async()=>{
  const h=await fixture(),err=Error('original');h.step();h.input.fail(err);h.step();
  assert.equal(h.cleanup.pendingWaiters,1);assert.equal(h.fallback.pendingWaiters,0);
  h.cleanup.resolve(0n);h.step();assert.equal(h.fallback.pendingWaiters,1);assert.equal(h.loop.retireOwner('a',1),false);
  assert.equal(h.fallback.resolve(42n),true);assert.equal(h.fallback.resolve(7n),false);assert.deepEqual(h.out,[]);h.step();
  assert.deepEqual(h.out,[{kind:'recovered',value:42n,error:err}]);assert.equal(h.loop.stats.retainedOwners,0);
});
test('body Future cancellation bypasses recovery but drains cleanup',async()=>{
  const h=await fixture();h.step();h.input.cancel();h.step();assert.equal(h.cleanup.pendingWaiters,1);
  h.cleanup.resolve(0n);h.step();assert.equal(h.fallback.pendingWaiters,0);assert.equal(h.out[0].failure_kind,'cancel');
  assert.equal(h.loop.stats.retainedOwners,0);
});
test('failed recovery is panic with original body failure suppressed',async()=>{
  const h=await fixture(),original=Error('original'),failure=Error('recovery');h.step();h.input.fail(original);h.step();
  h.cleanup.resolve(0n);h.step();h.fallback.fail(failure);h.step();
  assert.equal(h.out[0].failure_kind,'panic');assert.equal(h.out[0].error,failure);
  assert.deepEqual(h.out[0].suppressed,[original]);assert.deepEqual(h.out[0].suppressed_kinds,['raise']);
});
test('cleanup panic bypasses recovery and preserves original failure',async()=>{
  const h=await fixture(),original=Error('original'),failure=Error('cleanup');h.step();h.input.fail(original);h.step();h.cleanup.fail(failure);h.step();
  assert.equal(h.fallback.pendingWaiters,0);assert.equal(h.out[0].failure_kind,'panic');assert.equal(h.out[0].error,failure);
  assert.deepEqual(h.out[0].suppressed,[original]);
});
test('aliases identical and wrong arity, shadow, reuse, unsupported expressions rejected',()=>{
  const code=compileScheduledUnwindV1(source);
  for(const alias of ['susp','⧖','∂'])assert.equal(compileScheduledUnwindV1(source.replace('suspends',alias)),code);
  assert.doesNotMatch(code,/\basync\b|\bawait\b|\bPromise\b|\beval\b/);
  for(const s of [source.replace('suspends ',''),source.replace('err, cursor','err, err'),source.replace('err, cursor','input, cursor'),source.replace('await fallback','await input'),source.replace('await input','42'),source.replace('return await fallback','return await fallback + 1'),source.replace('Future<int> fallback','Future<bool> fallback')])assert.throws(()=>compileScheduledUnwindV1(s));
});
test('prototype-forged Futures and own method overrides rejected before admission',async()=>{
  const guest=await compile(source),loop=createWorkerControlLoop(),a=new SelectableI64Future(),b=new SelectableI64Future();
  loop.attachOwner('a',1);
  const forged=Object.create(SelectableI64Future.prototype),overridden=new SelectableI64Future();
  overridden.subscribeReady=()=>assert.fail('overridden method');
  for(const bad of [forged,overridden])assert.throws(()=>guest.start(runtime,loop,'a',identity,[bad,a,b],()=>{}),/E_SCHEDULED_FUTURE_IDENTITY/);
  assert.equal(loop.stats.retainedOwners,0);assert.equal(loop.stats.ready,0);
});

test('real Node Worker executes source-compiled recovery with three pending Futures',async()=>{
  const worker=new Worker(new URL('./fixtures/scheduled-recover-node-worker.mjs',import.meta.url),{workerData:compileScheduledUnwindV1(source)});
  const frames=[];let wake;worker.on('message',f=>{frames.push(f);wake?.();});
  const next=async kind=>{
    for(let i=0;i<20;i++){
      const err=frames.find(f=>f.kind==='recover-error');if(err)throw Error(err.message);
      const f=frames.find(f=>f.kind===kind);if(f)return f;
      await new Promise((ok,fail)=>{const timer=setTimeout(()=>{wake=null;fail(Error('timeout '+kind));},1000);wake=()=>{clearTimeout(timer);wake=null;ok();};});
    }throw Error('unbounded wait');
  };
  try{
    worker.postMessage({kind:'recover-start'});await next('recover-input-parked');
    worker.postMessage({kind:'recover-fail-input'});await next('recover-cleanup-parked');
    worker.postMessage({kind:'recover-complete-cleanup'});await next('recover-fallback-parked');
    worker.postMessage({kind:'recover-complete-fallback'});assert.deepEqual(await next('recover-done'),{kind:'recover-done',value:'42',sameError:true});
    worker.postMessage({kind:'recover-retire'});await next('recover-retired');
    assert.deepEqual(frames.map(f=>f.kind),['recover-input-parked','recover-after-input','recover-cleanup-parked','recover-after-cleanup','recover-fallback-parked','recover-after-fallback','recover-done','recover-retired']);
  }finally{await worker.terminate();}
});

test('borrowed Future formals and malformed ownership markers reject before ESM',()=>{
  for(const s of [
    source.replaceAll('take! ',''),
    source.replace('take! Future','take!Future'),
    source.replace('take! Future','borrow! Future'),
    source.replace('take! Future','move! Future'),
    source.replace('return await input','return await take! input')
  ])assert.throws(()=>compileScheduledUnwindV1(s));
});
test('exclusive handoff prevents a second invocation from consuming any moved Future',async()=>{
  const guest=await compile(source),turns=[];
  const loop=createWorkerControlLoop({postTurn:f=>turns.push(f)});
  loop.attachOwner('a',1);loop.attachOwner('b',1);
  const a=new SelectableI64Future(),b=new SelectableI64Future(),c=new SelectableI64Future(),d=new SelectableI64Future(),e=new SelectableI64Future();
  assert.equal(guest.start(runtime,loop,'a',identity,[a,b,c],()=>{}),true);
  assert.throws(()=>guest.start(runtime,loop,'b',identity,[d,a,e],()=>{}),/E_SCHEDULED_FUTURE_MOVED/);
  // Rejection is atomic: non-overlapping arguments were not consumed.
  assert.equal(guest.start(runtime,loop,'b',identity,[d,e,new SelectableI64Future()],()=>{}),true);
  assert.equal(loop.stats.retainedOwners,2);
  turns.shift()();a.resolve(42n);turns.shift()();turns.shift()();b.resolve(0n);turns.shift()();
  assert.equal(c.pendingWaiters,0);
  assert.throws(()=>guest.start(runtime,loop,'a',identity,[new SelectableI64Future(),new SelectableI64Future(),c],()=>{}),/E_SCHEDULED_FUTURE_MOVED/);
});
test('rejected queue admission refunds all Future claims; successful admission seals them',async()=>{
  const guest=await compile(source),turns=[];
  const loop=createWorkerControlLoop({maxReady:1,postTurn:f=>turns.push(f)});
  loop.attachOwner('a',1);loop.admitData('a',1,()=>{});
  const futures=Array.from({length:3},()=>new SelectableI64Future());
  assert.equal(guest.start(runtime,loop,'a',identity,futures,()=>{}),false);
  assert.equal(loop.stats.retainedOwners,0);turns.shift()();
  assert.equal(guest.start(runtime,loop,'a',identity,futures,()=>{}),true);
  assert.throws(()=>guest.start(runtime,loop,'a',identity,futures,()=>{}),/E_SCHEDULED_FUTURE_MOVED/);
});
