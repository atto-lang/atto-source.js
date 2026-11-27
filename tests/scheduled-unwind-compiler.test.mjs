import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {compileScheduledUnwindV1} from '../src/scheduled-unwind-compiler.mjs';
import * as runtime from '../src/scheduled-unwind-runtime.mjs';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {SelectableI64Future} from '../src/selectable-i64-future.mjs';
const source=readFileSync(new URL('./fixtures/scheduled-unwind-pending.atto',import.meta.url),'utf8');
const identity={tenant_id:'t',actor_id:1,generation:1};
const compile=async s=>import('data:text/javascript,'+encodeURIComponent(compileScheduledUnwindV1(s)));
function harness(){
  const turns=[],errors=[],outcomes=[];
  const loop=createWorkerControlLoop({postTurn:f=>turns.push(f),onTurnError:e=>errors.push(e)});
  loop.attachOwner('a',1);
  return {loop,turns,errors,outcomes,step(){assert.ok(turns.length);turns.shift()();assert.deepEqual(errors,[]);}};
}
test('all four effect spellings emit identical static ESM',()=>{
  const code=compileScheduledUnwindV1(source);
  for(const spelling of ['susp','⧖','∂'])assert.equal(compileScheduledUnwindV1(source.replace('suspends',spelling)),code);
  assert.doesNotMatch(code,/\basync\b|\bawait\b|\bPromise\b|\beval\b|\bfirst\b|\bsecond\b/);
});
test('compiled guest with genuinely pending futures defers LIFO and preserves return',async()=>{
  const guest=await compile(source),h=harness(),first=new SelectableI64Future(),second=new SelectableI64Future();
  assert.equal(guest.start(runtime,h.loop,'a',identity,[first,second],v=>h.outcomes.push(v)),true);
  assert.equal(first.pendingWaiters,0);assert.equal(second.pendingWaiters,0);
  h.step();assert.equal(second.pendingWaiters,1);assert.equal(first.pendingWaiters,0);
  assert.equal(h.loop.retireOwner('a',1),false);
  assert.equal(second.resolve(7n),true);assert.equal(second.resolve(8n),false);
  assert.equal(first.pendingWaiters,0);assert.deepEqual(h.outcomes,[]);
  h.step();assert.equal(first.pendingWaiters,1);assert.deepEqual(h.outcomes,[]);
  first.resolve(9n);assert.deepEqual(h.outcomes,[]);h.step();
  assert.deepEqual(h.outcomes,[{kind:'returned',value:42n}]);
  assert.equal(first.pendingWaiters+second.pendingWaiters,0);assert.equal(h.loop.retireOwner('a',1),true);
});
test('ready futures still yield between cleanup quanta',async()=>{
  const guest=await compile(source),h=harness(),a=new SelectableI64Future(),b=new SelectableI64Future();
  a.resolve(1n);b.resolve(2n);
  guest.start(runtime,h.loop,'a',identity,[a,b],v=>h.outcomes.push(v));h.step();
  assert.deepEqual(h.outcomes,[]);h.step();assert.deepEqual(h.outcomes,[]);h.step();
  assert.equal(h.outcomes[0].value,42n);
});
test('failed cleanup becomes panic and older defer still runs; cancelled cleanup dominates',async()=>{
  const guest=await compile(source);
  for(const cancelled of [false,true]){
    const h=harness(),a=new SelectableI64Future(),b=new SelectableI64Future(),err=Error('cleanup');
    guest.start(runtime,h.loop,'a',identity,[a,b],v=>h.outcomes.push(v));h.step();
    if(cancelled)b.cancel();else b.fail(err);
    h.step();assert.equal(a.pendingWaiters,1);assert.deepEqual(h.outcomes,[]);
    a.resolve(1n);h.step();assert.equal(h.outcomes[0].failure_kind,cancelled?'cancel':'panic');
    if(!cancelled)assert.equal(h.outcomes[0].error,err);
    assert.equal(h.loop.stats.retainedOwners,0);
  }
});
test('invalid source is rejected without artifact or implicit effect',()=>{
  for(const s of [
    source.replace('suspends ',''),
    source.replace('defer await first;','await first;'),
    source.replace('defer await first;','defer await 5;'),
    source.replace('defer await second;','defer await first;'),
    source.replace('Future<int> second','Future<bool> second'),
    source.replace('defer await second;',''),
    source.replace('return 42;','return 9223372036854775808;'),
    source+' pub fnc main(): int { return 1; }',
    source.replace('defer await first;','defer await first; recover {}'),
    source.replace('return 42;','return first;')
  ])assert.throws(()=>compileScheduledUnwindV1(s));
});
test('duplicate, forged or accessor futures fail before scheduler admission',async()=>{
  const guest=await compile(source),h=harness(),a=new SelectableI64Future();
  for(const f of [[a,a],[a,{}],[a],Object.defineProperty([a,a],1,{get(){assert.fail('accessor ran');}})])
    assert.throws(()=>guest.start(runtime,h.loop,'a',identity,f,()=>{}),/E_SCHEDULED_FUTURE_/);
  assert.equal(h.turns.length,0);assert.equal(h.loop.stats.retainedOwners,0);
});

test('real Node Worker executes compiler-emitted ESM with pending futures',async()=>{
  const worker=new Worker(new URL('./fixtures/scheduled-unwind-node-worker.mjs',import.meta.url),{workerData:compileScheduledUnwindV1(source)});
  const frames=[];let wake;
  worker.on('message',frame=>{frames.push(frame);wake?.();});
  const next=async kind=>{
    for(let i=0;i<20;i++){
      const error=frames.find(f=>f.kind==='guest-error');if(error)throw Error(error.message);
      const frame=frames.find(f=>f.kind===kind);if(frame)return frame;
      await new Promise((ok,fail)=>{const timer=setTimeout(()=>{wake=null;fail(Error('timeout '+kind));},1000);wake=()=>{clearTimeout(timer);wake=null;ok();};});
    }
    throw Error('unbounded worker wait');
  };
  try{
    worker.postMessage({kind:'guest-start'});await next('guest-parked');
    worker.postMessage({kind:'guest-second'});await next('guest-first-parked');
    worker.postMessage({kind:'guest-first'});assert.equal((await next('guest-done')).value,'42');
    worker.postMessage({kind:'guest-retire'});await next('guest-retired');
    assert.deepEqual(frames.map(f=>f.kind),['guest-parked','guest-before-second','guest-after-second','guest-first-parked','guest-after-first','guest-done','guest-retired']);
  }finally{await worker.terminate();}
});
