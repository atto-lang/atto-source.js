import test from 'node:test';
import assert from 'node:assert/strict';
import {create_execution_context} from '../src/unwind-context.mjs';

let seq = 0;
const new_context = () => create_execution_context({tenant_id:`tenant-${++seq}`,actor_id:2,generation:3});

test('normal return evaluates result before LIFO cleanup and never runs recover', () => {
  const c=new_context(), events=[]; c.push_frame(1);
  let result=17;
  c.register_defer(()=>{events.push('first');result=0;});
  c.register_defer(()=>events.push('second'));
  c.register_recover(()=>{throw Error('must not run');});
  assert.deepEqual(c.return_frame(result),{kind:'returned',value:17});
  assert.deepEqual(events,['second','first']);
  assert.equal(c.depth,0);
});

test('throw searches full caller chain and outer catch beats inner recover', () => {
  const c=new_context(), log=[], err=Error('same');
  c.push_frame(1);
  c.register_catch(Error,e=>{assert.equal(e,err);log.push('catch');return 42;});
  c.push_frame(2); c.register_recover(()=>{log.push('bad-recover');return c.recovered(9);});
  c.register_defer(()=>log.push('defer-inner'));
  const r=c.dispatch_failure('throw',err);
  assert.deepEqual({kind:r.kind,value:r.value},{kind:'caught',value:42});
  assert.equal(r.error,err);
  assert.deepEqual(log,['defer-inner','catch']);
  assert.equal(c.depth,1,'catcher frame remains alive');
  assert.equal(c.return_frame(4).value,4);
});

test('raise ignores catch and trap, cleans before nearest recover',()=>{
  const c=new_context(),events=[],err=Error('raise');
  c.push_frame(1); c.register_catch(Error,()=>{events.push('BAD');});
  c.push_frame(2); c.register_recover((view)=>{
    events.push('recover'); assert.equal(view.is_raise,true);
    assert.equal(view.message,'raise'); return c.recovered(31);
  }); c.register_defer(()=>events.push('cleanup'));
  const out=c.dispatch_failure('raise',err);
  assert.equal(out.kind,'recovered'); assert.equal(out.value,31);
  assert.equal(out.error,err);
  assert.deepEqual(events,['cleanup','recover']);
  assert.equal(c.depth,1);
});

test('unhandled throw delegates newest-to-oldest once, retaining original error',()=>{
  const c=new_context(),events=[],err=Error('origin');
  c.push_frame(1);c.register_recover((v)=>{events.push('older:'+v.is_raise);return c.recovered(11);});
  c.push_frame(2);c.register_recover((v,cursor)=>{events.push('newer:'+v.is_raise);cursor.next();});
  c.register_defer(()=>events.push('inner-clean'));
  assert.equal(c.dispatch_failure('throw',err).value,11);
  assert.deepEqual(events,['inner-clean','newer:false','older:false']);
  assert.equal(c.depth,0);
});

test('recovery callback with no explicit decision fails closed',()=>{
  const c=new_context();c.push_frame(1);c.register_recover(()=>undefined);
  const r=c.dispatch_failure('raise',Error('x'));
  assert.equal(r.failure_kind,'host-fatal');
  assert.match(r.error.message,/E_RECOVERY_DECISION_REQUIRED/);
});

test('one-shot cursor cannot be reused after invocation',()=>{
  const c=new_context();c.push_frame(1);let saved;
  c.register_recover((_,cursor)=>{saved=cursor;cursor.next();});
  const r=c.dispatch_failure('raise',Error('x'));
  assert.equal(r.kind,'unhandled'); assert.equal(r.failure_kind,'raise');
  assert.throws(()=>saved.next(),/E_RECOVERY_CURSOR_STALE/);
});

test('catch matches nearest typed subtype, not nonmatching subclass',()=>{
  class E1 extends Error{};class E2 extends Error{};
  const c=new_context(),log=[];c.push_frame(1);
  c.register_catch(E2,()=>log.push('wrong'));
  c.register_catch(E1,()=>{log.push('right');return 6;});
  assert.equal(c.dispatch_failure('throw',new E1()).value,6);
  assert.deepEqual(log,['right']);
});

test('panic, cancellation and host fatal never invoke recover',()=>{
  for (const kind of ['panic','cancel','host-fatal']) {
    const c=new_context(),log=[];c.push_frame(1);
    c.register_defer(()=>log.push('cleanup'));
    c.register_catch(Error,()=>log.push('BAD-catch'));
    c.register_recover(()=>{log.push('BAD-recover');return c.recovered(1);});
    const failure=Error('x'),r=c.dispatch_failure(kind,failure);
    assert.equal(r.failure_kind,kind);assert.equal(r.error,failure);
    assert.deepEqual(log,['cleanup']);
  }
});

test('cleanup host failure supersedes throw but preserves original diagnostics',()=>{
  const c=new_context(),e=Error('throw'),host=Error('host'),trace=[];
  c.push_frame(1);c.register_recover(()=>{trace.push('BAD-recover');});
  c.register_defer(()=>trace.push('always-run'));
  c.register_defer(()=>{throw host;});
  const out=c.dispatch_failure('throw',e);
  assert.equal(out.kind,'unhandled'); assert.equal(out.failure_kind,'host-fatal');
  assert.equal(out.error,host);assert.equal(out.suppressed[0],e);
  assert.deepEqual(trace,['always-run']);
});

test('return cleanup failure never returns success',()=>{
  const c=new_context();c.push_frame(1);c.register_defer(()=>{throw Error('boom');});
  const out=c.return_frame(7);
  assert.equal(out.kind,'unhandled');assert.equal(out.failure_kind,'host-fatal');
});

test('await suspension preserves each logical context without cross-task unwind',async()=>{
  const a=new_context(),b=new_context(),events=[];
  a.push_frame(1); a.register_defer(()=>events.push('a'));
  b.push_frame(1); b.register_defer(()=>events.push('b'));
  await Promise.resolve();
  assert.equal(b.return_frame(2).value,2);
  await Promise.resolve();
  assert.equal(a.return_frame(1).value,1);
  assert.deepEqual(events,['b','a']);
  assert.notEqual(a.owner.tenant_id,b.owner.tenant_id);
  assert.equal(a.depth,0);assert.equal(b.depth,0);
});

test('retirement requires drained frames and prohibits further use',()=>{
  const c=new_context();c.push_frame(1);
  assert.throws(()=>c.retire(),/E_CONTEXT_NOT_QUIESCENT/);
  c.return_frame(undefined); c.retire();
  assert.throws(()=>c.push_frame(2),/E_CONTEXT_RETIRED/);
});

test('bounded registrations and frame stack fail closed',()=>{
  const c=new_context();c.push_frame(1);
  for(let i=0;i<1024;i++)c.register_defer(()=>{});
  assert.throws(()=>c.register_defer(()=>{}),/E_UNWIND_REGISTRATION_LIMIT/);
  c.return_frame(0);
  const d=new_context();for(let i=0;i<128;i++)d.push_frame(i);
  assert.throws(()=>d.push_frame(128),/E_UNWIND_FRAME_LIMIT/);
});

test('do not accept arbitrary source failure kinds or non-Error payloads',()=>{
  const c=new_context();c.push_frame(1);
  assert.throws(()=>c.dispatch_failure('custom',Error('x')),/E_INVALID_FAILURE_KIND/);
  assert.throws(()=>c.dispatch_failure('raise',{message:'fake'}),/E_ERROR_REQUIRED/);
  assert.equal(c.depth,1);
});

test('async cleanup is not silently treated as complete before retirement',()=>{
  const c=new_context();c.push_frame(1);
  c.register_defer(()=>Promise.resolve());
  const out=c.return_frame(8);
  assert.equal(out.failure_kind,'host-fatal');
  assert.match(out.error.message,/E_ASYNC_CLEANUP_UNSUPPORTED/);
});

test('callbacks cannot mutate or reenter the same unwinding context',()=>{
  const c=new_context();c.push_frame(1);
  c.register_defer(()=>assert.throws(()=>c.push_frame(99),/E_UNWIND_REENTRANT/));
  assert.equal(c.return_frame(1).kind,'returned');
});

test('recovery cursor double decision cannot forge a recovered success',()=>{
  const c=new_context();c.push_frame(1);
  c.register_recover((view,cursor)=>{
    try { cursor.next(); } catch { /* compromised callback tries to keep running */ }
    return c.recovered('bad-success');
  });
  const out=c.dispatch_failure('raise',Error('x'));
  assert.equal(out.kind,'unhandled');
  assert.equal(out.failure_kind,'host-fatal');
  assert.match(out.error.message,/E_RECOVERY_DECISION_REQUIRED/);
});

test('suppressed cleanup diagnostics have a finite allocation bound',()=>{
  const c=new_context();c.push_frame(1);
  for(let i=0;i<50;i++)c.register_defer(()=>{throw Error('cleanup');});
  const r=c.dispatch_failure('raise',Error('origin'));
  assert.equal(r.failure_kind,'host-fatal');
  assert.equal(r.suppressed.length,16);
  assert.equal(r.suppressed[0].message,'origin');
});
