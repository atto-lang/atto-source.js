import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compile} from '../src/compiler.mjs';
import {
  MAX_TIME_NS, StdTimeRuntime, nanoseconds, microseconds, milliseconds,
  seconds, minutes, hours, checked_add, checked_sub, checked_mul
} from '../src/std-time-runtime.mjs';

function clockHarness({limit=2,initial=0n,scheduleFailure=false}={}) {
  let tick=initial,next=0;
  const queue=new Map();
  const adapter=new StdTimeRuntime({
    now_ns:()=>tick,limit,
    schedule:(fn,ms)=>{
      if(scheduleFailure)throw Error('scheduler failure');
      const id=++next;
      queue.set(id,{fn,ms});
      return id;
    },
    cancel:id=>queue.delete(id)
  });
  return {
    adapter,queue,
    setAt(value){tick=value;},
    pendingDelays(){return [...queue.values()].map(v=>v.ms);},
    fireAt(value){
      tick=value;
      const [id,job]=queue.entries().next().value??[];
      assert.ok(job,'expected timer registration');
      queue.delete(id);
      job.fn();
    }
  };
}
test('duration constructors require lossless nonnegative i64 nanoseconds',()=>{
  assert.equal(nanoseconds(0n),0n);
  assert.equal(microseconds(1n),1000n);
  assert.equal(milliseconds(1n),1000000n);
  assert.equal(seconds(1n),1000000000n);
  assert.equal(minutes(1n),60000000000n);
  assert.equal(hours(1n),3600000000000n);
  assert.equal(hours(2562047n),9223369200000000000n);
  for(const bad of [0,1,1.3,'1',NaN,{},null])
    assert.throws(()=>nanoseconds(bad),/DurationType/);
  assert.throws(()=>milliseconds(-1n),/NegativeDuration/);
  assert.throws(()=>hours(2562048n),/DurationOverflow/);
  assert.throws(()=>milliseconds(9223372036855n),/DurationOverflow/);
  assert.equal(nanoseconds(MAX_TIME_NS),MAX_TIME_NS);
  assert.throws(()=>nanoseconds(MAX_TIME_NS+1n),/DurationOverflow/);
});
test('checked arithmetic never wraps or loses nanosecond precision',()=>{
  assert.equal(checked_add(1n,2n),3n);
  assert.equal(checked_sub(3n,2n),1n);
  assert.equal(checked_mul(3n,4n),12n);
  assert.equal(checked_mul(MAX_TIME_NS,0n),0n);
  assert.throws(()=>checked_add(MAX_TIME_NS,1n),/DurationOverflow/);
  assert.throws(()=>checked_sub(0n,1n),/DurationUnderflow/);
  assert.throws(()=>checked_mul(MAX_TIME_NS,2n),/DurationOverflow/);
  assert.throws(()=>checked_mul(3n,-1n),/NegativeDuration/);
});
test('spurious early timer wakeup re-arms until inclusive monotonic deadline',async()=>{
  const h=clockHarness();
  const p=h.adapter.sleep_ns(milliseconds(150n));
  assert.deepEqual(h.pendingDelays(),[150]);
  h.fireAt(milliseconds(20n));
  assert.deepEqual(h.pendingDelays(),[130]);
  h.fireAt(milliseconds(149n));
  assert.deepEqual(h.pendingDelays(),[1]);
  h.fireAt(milliseconds(150n));
  await p;
  assert.equal(h.adapter.pending,0);
  assert.equal(h.queue.size,0);
});
test('submillisecond positive delays round up; zero still schedules a tick',async()=>{
  const h=clockHarness();
  const zero=h.adapter.sleep_ns(0n);
  assert.deepEqual(h.pendingDelays(),[0]);
  h.fireAt(0n);
  await zero;
  const micro=h.adapter.sleep_ns(1n);
  assert.deepEqual(h.pendingDelays(),[1]);
  h.fireAt(1n);
  await micro;
  assert.equal(h.adapter.pending,0);
});
test('bounded capacity is reclaimed after a completed timer',async()=>{
  const h=clockHarness({limit:1});
  const first=h.adapter.sleep_ns(10n);
  assert.throws(()=>h.adapter.sleep_ns(1n),/TimerCapacityExceeded/);
  h.fireAt(10n);
  await first;
  const second=h.adapter.sleep_ns(1n);
  h.fireAt(11n);
  await second;
  assert.equal(h.adapter.pending,0);
});
test('abort cancels once and releases pending timer capacity',async()=>{
  const h=clockHarness({limit:1});
  const controller=new AbortController();
  const p=h.adapter.sleep_ns(seconds(1n),{signal:controller.signal});
  controller.abort();
  await assert.rejects(p,/TimerCancelled/);
  assert.equal(h.adapter.pending,0);
  assert.equal(h.queue.size,0);
  assert.throws(()=>h.adapter.sleep_ns(2n,{signal:{aborted:false}}),/InvalidAbortSignal/);
  const p2=h.adapter.sleep_ns(1n);
  h.fireAt(1n); await p2;
});
test('invalid and regressed clock samples fail closed without leaks',async()=>{
  const h=clockHarness({limit:1});
  const first=h.adapter.sleep_ns(100n);
  h.fireAt(40n);
  h.fireAt(39n);
  await assert.rejects(first,/ClockWentBackwards/);
  assert.equal(h.adapter.pending,0);
  assert.equal(h.queue.size,0);
  h.setAt(-1n);
  assert.throws(()=>h.adapter.sleep_ns(0n),/InvalidMonotonicClock/);
  h.setAt(0n);
  const second=h.adapter.sleep_ns(1n);
  h.setAt(1);
  h.fireAt(1);
  await assert.rejects(second,/InvalidMonotonicClock/);
  assert.equal(h.adapter.pending,0);
});
test('deadline overflow and invalid config fail before timer admission',()=>{
  const h=clockHarness({initial:MAX_TIME_NS});
  assert.throws(()=>h.adapter.sleep_ns(1n),/DeadlineOverflow/);
  assert.equal(h.adapter.pending,0);
  assert.throws(()=>new StdTimeRuntime({limit:0}),/InvalidTimerHost/);
  assert.throws(()=>new StdTimeRuntime({limit:4097}),/InvalidTimerHost/);
  assert.throws(()=>new StdTimeRuntime({schedule:42}),/InvalidTimerHost/);
});
test('scheduler failure and synchronous callback fail closed and refund quota',async()=>{
  const h=clockHarness({limit:1,scheduleFailure:true});
  await assert.rejects(h.adapter.sleep_ns(1n),/scheduler failure/);
  assert.equal(h.adapter.pending,0);
  const sync=new StdTimeRuntime({
    now_ns:()=>0n,
    schedule:(fn)=>{fn();return 1;},
    cancel:()=>{}
  });
  await assert.rejects(sync.sleep_ns(0n),/SynchronousTimerCallback/);
  assert.equal(sync.pending,0);
});
test('compiler refuses std/time imports and the full class module until supported',async()=>{
  // A host timer adapter must NEVER be mistaken for a compiler-imported guest.
  const source=await readFile(new URL('../stdlib/std/time.atto',import.meta.url),'utf8');
  assert.match(source,/define module time as/);
  assert.match(source,/define pub class Duration as/);
  assert.match(source,/pub fnc manual_clock\(/);
  assert.throws(()=>compile(source),/error:/);
  assert.throws(()=>compile('import module time from "std/time"; pub fnc main(): int { return time.seconds(1); }'),/error:/);
  assert.match(compile('pub fnc main(): int { return 42; }'),/export/);
});
