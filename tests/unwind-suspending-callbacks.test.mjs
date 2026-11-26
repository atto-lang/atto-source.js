import test from 'node:test';
import assert from 'node:assert/strict';
import {create_execution_context} from '../src/unwind-context.mjs';
const context = () => create_execution_context({tenant_id:'host',actor_id:1,generation:1});
test('sync entry rejects before registration retirement; async LIFO waits',async()=>{
  const c=context(),trace=[];
  c.push_frame(1);
  c.register_defer(()=>trace.push('A'));
  c.register_susp_defer(async()=>{trace.push('B1');await Promise.resolve();trace.push('B2');});
  assert.throws(()=>c.return_frame(42),/E_SUSPENDING_UNWIND_REQUIRES_ASYNC_ENTRY/);
  assert.equal(c.depth,1);assert.deepEqual(trace,[]);
  assert.equal((await c.return_frame_async(42)).value,42);
  assert.deepEqual(trace,['B1','B2','A']);assert.equal(c.depth,0);
});
test('awaited callback holds logical context busy and does not block sibling',async()=>{
  const c=context(),sibling=context();
  let release;const gate=new Promise(r=>{release=r;});
  c.push_frame(1);c.register_susp_defer(async()=>gate);
  const pending=c.return_frame_async(40);
  assert.throws(()=>c.retire(),/E_UNWIND_REENTRANT/);
  assert.throws(()=>c.push_frame(2),/E_UNWIND_REENTRANT/);
  sibling.push_frame(1);assert.equal(sibling.return_frame(7).value,7);
  release();assert.equal((await pending).value,40);c.retire();
});
test('suspended recovery cursor delegates once; original failure identity retained',async()=>{
  const c=context(),original=Error('original');let saved;
  c.push_frame(1);c.register_recover(()=>c.recovered(9));
  c.register_susp_recover(async(_,cursor)=>{saved=cursor;await Promise.resolve();cursor.next();});
  const r=await c.dispatch_failure_async('raise',original);
  assert.equal(r.value,9);assert.equal(r.error,original);
  assert.throws(()=>saved.next(),/E_RECOVERY_CURSOR_STALE/);
});
test('pending cancellation dominates suspended cleanup panic',async()=>{
  const c=context(),original=Error('stop'),cause=Error('cleanup'),trace=[];
  c.push_frame(1);c.register_defer(()=>trace.push('remaining'));
  c.register_susp_defer(async()=>{await Promise.resolve();c.signal_failure('throw',cause);});
  c.register_recover(()=>c.recovered(42));
  const r=await c.dispatch_failure_async('cancel',original);
  assert.equal(r.failure_kind,'cancel');assert.equal(r.error,original);
  assert.deepEqual(r.suppressed,[cause]);assert.deepEqual(r.suppressed_kinds,['panic']);
  assert.deepEqual(trace,['remaining']);
});
test('suspended recovery failure is terminal and drains outer cleanup',async()=>{
  const c=context(),original=Error('original'),cause=Error('recover'),trace=[];
  c.push_frame(1);c.register_defer(()=>trace.push('outer'));
  c.register_recover(()=>c.recovered(42));
  c.push_frame(2);c.register_susp_recover(async()=>{await Promise.resolve();c.signal_failure('raise',cause);});
  const r=await c.dispatch_failure_async('raise',original);
  assert.equal(r.failure_kind,'panic');assert.equal(r.error,cause);
  assert.deepEqual(r.suppressed,[original]);assert.deepEqual(trace,['outer']);
  assert.equal(c.depth,0);
});
test('async path never implicitly admits ordinary Promise-returning cleanup',async()=>{
  const c=context();c.push_frame(1);
  c.register_defer(()=>Promise.reject(Error('late host error')));
  const r=await c.return_frame_async(42);
  assert.equal(r.failure_kind,'host-fatal');
  assert.match(r.error.message,/E_ASYNC_CLEANUP_UNSUPPORTED/);
});
test('outer catch still outranks recover after suspended inner cleanup',async()=>{
  const c=context(),err=Error('original'),trace=[];
  c.push_frame(1);c.register_catch(Error,e=>{assert.equal(e,err);trace.push('catch');return 42;});
  c.push_frame(2);c.register_recover(()=>{trace.push('BAD');return c.recovered(9);});
  c.register_susp_defer(async()=>{await Promise.resolve();trace.push('cleanup');});
  const r=await c.dispatch_failure_async('throw',err);
  assert.equal(r.kind,'caught');assert.equal(r.value,42);
  assert.deepEqual(trace,['cleanup','catch']);assert.equal(c.return_frame(0).value,0);
});
