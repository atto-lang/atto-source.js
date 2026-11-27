import test from 'node:test';
import assert from 'node:assert/strict';
import {create_execution_context} from '../src/unwind-context.mjs';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';

// Actual scheduler with deterministic host wakeup injection.
function harness(options={}) {
  const turns=[], errors=[];
  const loop=createWorkerControlLoop({...options,postTurn:f=>turns.push(f),onTurnError:e=>errors.push(e)});
  loop.attachOwner('a',1);
  return {loop,turns,errors,turn(){assert.ok(turns.length);turns.shift()();assert.deepEqual(errors,[]);}};
}
const context=()=>create_execution_context({tenant_id:'t',actor_id:1,generation:1});
test('scheduled LIFO return: no inline wakeup, single delivery, busy until settlement',()=>{
  const {loop,turns,turn}=harness(), c=context(), trace=[];
  let complete,done;
  c.push_frame(1);c.register_defer(()=>trace.push('outer'));
  c.register_scheduled_defer(()=>{trace.push('before');return c.suspend_step(ok=>{complete=ok;},v=>trace.push(v));});
  assert.equal(c.return_frame_scheduled(42,loop,'a',r=>{done=r;}),true);
  assert.equal(c.unwind_busy,true);assert.deepEqual(trace,[]);
  assert.throws(()=>c.push_frame(2),/E_UNWIND_REENTRANT/);
  turn();assert.deepEqual(trace,['before']);
  assert.equal(complete('after'),true);assert.equal(complete('duplicate'),false);
  assert.deepEqual(trace,['before']);assert.equal(done,undefined);
  turn();assert.deepEqual(trace,['before','after','outer']);assert.equal(done.value,42);
  assert.equal(c.unwind_busy,false);assert.equal(turns.length,0);c.retire();
});
test('synchronous reactor completion still yields to scheduler; multiple suspension steps',()=>{
  const {loop,turn}=harness(),c=context(),trace=[];let done;
  c.push_frame(1);c.register_scheduled_defer(()=>c.suspend_step(ok=>ok(1),v=>{
    trace.push(v);return c.suspend_step(ok=>ok(2),v=>trace.push(v));
  }));
  c.return_frame_scheduled(3,loop,'a',v=>{done=v;});turn();assert.deepEqual(trace,[]);
  turn();assert.deepEqual(trace,[1]);assert.equal(done,undefined);
  turn();assert.deepEqual(trace,[1,2]);assert.equal(done.value,3);
});
test('suspended recover decisions execute only in scheduler and cancellation dominates',()=>{
  const {loop,turn}=harness(),c=context();let complete,done;
  const err=Error('original'),stop=Error('cancel');let older=0;
  c.push_frame(1);c.register_recover(()=>{older++;return c.recovered(8);});
  c.register_scheduled_recover(()=>c.suspend_step(ok=>{complete=ok;},v=>c.recovered(v)));
  c.dispatch_failure_scheduled('raise',err,loop,'a',v=>{done=v;});turn();
  assert.equal(c.request_cancel(stop),true);assert.equal(c.request_cancel(stop),false);
  complete(42);assert.equal(done,undefined);turn();
  assert.equal(done.failure_kind,'cancel');assert.equal(done.error,stop);
  assert.equal(older,0);assert.equal(c.unwind_busy,false);
});
test('successful recover retains original error and returns scheduler-owned decision',()=>{
  const {loop,turn}=harness(),c=context();let complete,done;
  const err=Error('original');c.push_frame(1);
  c.register_scheduled_recover(()=>c.suspend_step(ok=>{complete=ok;},v=>c.recovered(v)));
  c.dispatch_failure_scheduled('raise',err,loop,'a',v=>{done=v;});turn();
  complete(42);assert.equal(done,undefined);turn();
  assert.equal(done.kind,'recovered');assert.equal(done.value,42);assert.equal(done.error,err);
});
test('retirement and scheduler shutdown wait for active cleanup and recovery',()=>{
  for(const kind of ['defer','recover']){
    const {loop,turn}=harness(),c=context();let complete,done,resumed=0;
    c.push_frame(1);const handler=()=>c.suspend_step(ok=>{complete=ok;},()=>{resumed++;return kind==='recover'?c.recovered(1):undefined;});
    const publish=v=>{done=v;assert.equal(loop.retireOwner('a',1),false);assert.equal(loop.close(),false);};
    if(kind==='defer'){c.register_scheduled_defer(handler);c.return_frame_scheduled(42,loop,'a',publish);}
    else{c.register_scheduled_recover(handler);c.dispatch_failure_scheduled('raise',Error('x'),loop,'a',publish);}
    assert.equal(loop.stats.retainedOwners,1);
    assert.equal(loop.retireOwner('a',1),false);assert.equal(loop.close(),false);
    turn();assert.equal(loop.retireOwner('a',1),false);assert.equal(loop.attachOwner('a',2),false);
    assert.equal(c.unwind_busy,true);assert.throws(()=>c.retire(),/E_UNWIND_REENTRANT/);
    assert.equal(complete(42),true);assert.equal(resumed,0);assert.equal(done,undefined);
    assert.equal(loop.retireOwner('a',1),false);turn();
    assert.equal(resumed,1);assert.equal(c.unwind_busy,false);assert.equal(loop.stats.retainedOwners,0);
    c.retire();assert.equal(loop.retireOwner('a',1),true);assert.equal(loop.attachOwner('a',2),true);
    assert.equal(complete(99),false);assert.equal(resumed,1);assert.ok(done);
    loop.close();assert.equal(loop.stats.closed,true);
  }
});
test('legacy Promise path and scheduled callbacks cannot mix; async callback rejected before execution',async()=>{
  const {loop}=harness(),c=context();let ran=0;
  c.push_frame(1);
  assert.throws(()=>c.register_scheduled_defer(async()=>{ran++;}),/E_SYNC_QUANTUM_REQUIRED/);
  c.register_scheduled_defer(()=>{ran++;});
  await assert.rejects(c.return_frame_async(1),/E_SCHEDULED_UNWIND_REQUIRED/);
  assert.equal(c.depth,1);assert.equal(ran,0);
  const d=context();d.push_frame(1);d.register_susp_defer(async()=>{ran++;});
  assert.throws(()=>d.return_frame_scheduled(1,loop,'a',()=>{}),/E_LEGACY_ASYNC_UNWIND_FORBIDDEN/);
  assert.equal(d.depth,1);assert.equal(ran,0);
});
test('rejected suspension can be handled in a generated quantum; unhandled callback raise becomes panic',()=>{
  const {loop,turn}=harness(),c=context(),cause=Error('cause'),trace=[];let done;
  c.push_frame(1);c.register_defer(()=>trace.push('outer'));
  c.register_scheduled_defer(()=>c.suspend_step((ok,fail)=>fail(cause),()=>assert.fail('success'),e=>{
    assert.equal(e,cause);c.signal_failure('raise',e);
  }));
  c.return_frame_scheduled(42,loop,'a',v=>{done=v;});turn();turn();
  assert.equal(done.failure_kind,'panic');assert.equal(done.error,cause);assert.deepEqual(trace,['outer']);
});
test('outer catch wins over inner recover after scheduled cleanup',()=>{
  const {loop,turn}=harness(),c=context(),trace=[];let done;
  c.push_frame(1);c.register_catch(Error,()=>{trace.push('catch');return 42;});
  c.push_frame(2);c.register_recover(()=>{trace.push('bad');return c.recovered(1);});
  c.register_scheduled_defer(()=>c.suspend_step(ok=>ok(0),()=>trace.push('cleanup')));
  c.dispatch_failure_scheduled('throw',Error('x'),loop,'a',v=>{done=v;});turn();turn();
  assert.deepEqual(trace,['cleanup','catch']);assert.equal(done.kind,'caught');assert.equal(done.value,42);
});
test('foreign and replayed suspension tokens cannot be used in another callback',()=>{
  const {loop,turn}=harness(),a=context(),b=context();let token,done;
  a.push_frame(1);a.register_scheduled_defer(()=>{token=a.suspend_step(ok=>ok(0),()=>{});return token;});
  a.return_frame_scheduled(1,loop,'a',()=>{});turn();turn();
  b.push_frame(1);b.register_scheduled_defer(()=>token);
  b.return_frame_scheduled(1,loop,'a',v=>{done=v;});turn();
  assert.equal(done.failure_kind,'host-fatal');assert.match(done.error.message,/E_INVALID_SUSPENSION_STEP/);
});
test('scheduler admission failure leaves frames intact',()=>{
  const {loop}=harness(),c=context();c.push_frame(1);c.register_scheduled_defer(()=>{});
  assert.equal(c.return_frame_scheduled(1,loop,'missing',()=>{}),false);
  assert.equal(c.depth,1);assert.equal(c.unwind_busy,false);
});

test('bounded physical credits reject second context and refund after completion',()=>{
  const {loop,turn}=harness({maxSuspended:1}), a=context(), b=context();let complete;
  a.push_frame(1);a.register_scheduled_defer(()=>a.suspend_step(ok=>{complete=ok;},()=>{}));
  b.push_frame(1);b.register_scheduled_defer(()=>{});
  assert.equal(a.return_frame_scheduled(1,loop,'a',()=>{}),true);
  assert.equal(b.return_frame_scheduled(2,loop,'a',()=>{}),false);
  assert.equal(b.depth,1);assert.equal(b.unwind_busy,false);turn();
  complete(1);turn();assert.equal(loop.stats.retainedOwners,0);
  assert.equal(b.return_frame_scheduled(2,loop,'a',()=>{}),true);turn();
  assert.equal(loop.stats.retainedOwners,0);
});
test('failed ready queue admission refunds physical credit',()=>{
  const {loop,turn}=harness({maxReady:1}),c=context();
  loop.admitData('a',1,()=>{});c.push_frame(1);c.register_scheduled_defer(()=>{});
  assert.equal(c.return_frame_scheduled(1,loop,'a',()=>{}),false);
  assert.equal(loop.stats.retainedOwners,0);assert.equal(c.depth,1);turn();
});
test('physical credit cannot be released twice or acquired for stale generations',()=>{
  const {loop}=harness({maxSuspended:2});const x=loop.retainOwner('a',1),y=loop.retainOwner('a',1);
  assert.equal(loop.retainOwner('a',1),null);assert.equal(x.close(),true);assert.equal(x.close(),false);
  assert.equal(loop.retireOwner('a',1),false);assert.equal(y.close(),true);
  assert.equal(loop.retireOwner('a',1),true);assert.equal(loop.attachOwner('a',2),true);
  assert.equal(loop.retainOwner('a',1),null);assert.equal(loop.stats.retainedOwners,0);
});
test('terminal publication failure refunds physical credit without allowing premature retirement',()=>{
  const {loop,turns,errors}=harness(),c=context();c.push_frame(1);
  c.return_frame_scheduled(1,loop,'a',()=>{assert.equal(loop.retireOwner('a',1),false);throw Error('publish');});
  turns.shift()();assert.equal(errors.length,1);assert.match(errors[0].message,/publish/);
  assert.equal(loop.stats.retainedOwners,0);assert.equal(loop.retireOwner('a',1),true);
});
test('cancellation through reserved CONTROL settles before actor retirement',()=>{
  const {loop,turn}=harness(),c=context(),trace=[];let complete,done;
  c.push_frame(1);c.register_defer(()=>trace.push('outer'));
  c.register_scheduled_defer(()=>c.suspend_step(ok=>{complete=ok;},()=>trace.push('resume')));
  c.return_frame_scheduled(1,loop,'a',v=>{done=v;});turn();
  loop.admitControl('a',1,()=>{c.request_cancel(Error('stop'));assert.equal(loop.retireOwner('a',1),false);});
  complete(0);turn();assert.deepEqual(trace,[]);turn();
  assert.deepEqual(trace,['resume','outer']);assert.equal(done.failure_kind,'cancel');
  assert.equal(loop.retireOwner('a',1),true);
});
