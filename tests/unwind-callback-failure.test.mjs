import test from 'node:test';
import assert from 'node:assert/strict';
import {create_execution_context} from '../src/unwind-context.mjs';
const context = () => create_execution_context({tenant_id:'test',actor_id:1,generation:1});
test('escaping guest throw/raise becomes panic, remaining defers run',()=>{
  for(const kind of ['throw','raise']){
    const c=context(),original=Error('original'),cause=Error('cause'),trace=[];
    c.push_frame(1);
    c.register_defer(()=>trace.push('remaining'));
    c.register_defer(()=>c.signal_failure(kind,cause));
    c.register_recover(()=>c.recovered(42));
    const r=c.dispatch_failure('throw',original);
    assert.equal(r.failure_kind,'panic');assert.equal(r.error,cause);
    assert.deepEqual(r.suppressed,[original]);assert.deepEqual(r.suppressed_kinds,['throw']);
    assert.deepEqual(trace,['remaining']);
  }
});
test('first panic wins and cancellation outranks cleanup panic',()=>{
  const c=context(),a=Error('A'),b=Error('B'),stop=Error('stop');
  c.push_frame(1);c.register_defer(()=>c.signal_failure('raise',a));
  c.register_defer(()=>c.signal_failure('throw',b));
  const r=c.return_frame(40);
  assert.equal(r.failure_kind,'panic');assert.equal(r.error,b);assert.deepEqual(r.suppressed,[a]);
  c.push_frame(2);c.register_defer(()=>c.signal_failure('throw',a));
  const q=c.dispatch_failure('cancel',stop);
  assert.equal(q.failure_kind,'cancel');assert.equal(q.error,stop);
  assert.deepEqual(q.suppressed,[a]);assert.deepEqual(q.suppressed_kinds,['panic']);
});
test('recovery failure becomes panic without entering older handlers',()=>{
  const c=context(),original=Error('original'),cause=Error('recover');
  c.push_frame(1);c.register_recover(()=>c.recovered(42));
  c.register_recover(()=>c.signal_failure('throw',cause));
  const r=c.dispatch_failure('raise',original);
  assert.equal(r.failure_kind,'panic');assert.equal(r.error,cause);
  assert.deepEqual(r.suppressed,[original]);
});
test('cross-context and stale recovery decisions cannot forge success',()=>{
  const a=context(),b=context();let saved;
  assert.throws(()=>a.recovered(1),/E_NO_ACTIVE_RECOVERY/);
  a.push_frame(1);a.register_recover(()=>{saved=a.recovered(42);return saved;});
  assert.equal(a.dispatch_failure('raise',Error('x')).value,42);
  for(const c of [a,b]){
    c.push_frame(2);c.register_recover(()=>saved);
    assert.equal(c.dispatch_failure('raise',Error('y')).failure_kind,'host-fatal');
  }
});
test('replayed or forged callback signal cannot become a guest panic',()=>{
  const c=context();let saved;
  c.push_frame(1);c.register_defer(()=>{try{c.signal_failure('throw',Error('old'));}catch(e){saved=e;}});
  assert.equal(c.return_frame(42).value,42);
  for(const token of [saved,{kind:'throw',error:Error('forged')}]){
    c.push_frame(2);c.register_defer(()=>{throw token;});
    assert.equal(c.return_frame(42).failure_kind,'host-fatal');
  }
});
test('supplemental diagnostics are bounded and report overflow',()=>{
  const c=context();c.push_frame(1);
  for(let i=0;i<50;i++)c.register_defer(()=>c.signal_failure('raise',Error('cleanup')));
  const r=c.dispatch_failure('throw',Error('original'));
  assert.equal(r.failure_kind,'panic');assert.equal(r.suppressed.length,16);
  assert.equal(r.suppressed_kinds.length,16);assert.equal(r.suppressed_overflow,34);
});
test('terminal cleanup failure on return drains outer frames without recovery',()=>{
  const c=context(),trace=[],err=Error('panic');
  c.push_frame(1);c.register_defer(()=>trace.push('outer'));
  c.register_recover(()=>c.recovered(42));
  c.push_frame(2);c.register_defer(()=>c.signal_failure('raise',err));
  const r=c.return_frame(40);
  assert.equal(r.failure_kind,'panic');assert.equal(r.error,err);
  assert.equal(c.depth,0);assert.deepEqual(trace,['outer']);c.retire();
});
