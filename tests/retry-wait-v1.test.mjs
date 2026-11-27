import test from 'node:test';
import assert from 'node:assert/strict';
import {RetryWaitV1} from '../src/retry-wait-v1.mjs';
import {StdTimeRuntime} from '../src/std-time-runtime.mjs';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';
const MS=1000000n;
function setup() {
  let now=0n, serial=0;
  const queued=new Map();
  const timer=new StdTimeRuntime({now_ns:()=>now,limit:1,
    schedule:fn=>{queued.set(++serial,fn);return serial;},cancel:id=>queued.delete(id)});
  const fence=new SelectContinuationFence({maxTickets:1});
  const wait=new RetryWaitV1(timer,fence,10n*MS);
  return {timer,fence,wait,clock:n=>{now=n*MS;},fire:()=>{const [id,fn]=queued.entries().next().value;queued.delete(id);fn();},queued};
}
test('zero delay yields; only actor lane claims and holds execution credit',async()=>{
  const s=setup();const pending=s.wait.arm(0n);
  assert.equal(s.wait.claim(),null);assert.equal(s.timer.pending,1);
  s.fire();assert.equal(await pending,'ready');assert.equal(s.fence.executing,0);
  const lease=s.wait.claim();assert.ok(lease);assert.equal(s.fence.executing,1);
  assert.equal(s.wait.claim(),null);assert.equal(s.wait.cancel(),false);
  assert.equal(s.fence.advance(1),false);lease.close();assert.equal(s.fence.advance(1),true);
});
test('cancellation before wake, after wake and before arm',async()=>{
  for(const phase of ['waiting','ready','idle']) {
    const s=setup();let p;
    if(phase!=='idle')p=s.wait.arm(MS);
    if(phase==='ready'){s.clock(1n);s.fire();await p;}
    assert.equal(s.wait.cancel(),true);assert.equal(s.wait.cancel(),false);
    if(p)await p;assert.equal(s.wait.claim(),null);assert.equal(s.wait.state,'cancelled');
    assert.equal(s.timer.pending,0);assert.equal(s.fence.pendingTickets,0);assert.equal(s.queued.size,0);
  }
});
test('generation retirement invalidates queued and ready wakes',async()=>{
  for(const phase of ['waiting','ready']) {
    const s=setup();const p=s.wait.arm(MS);
    if(phase==='ready'){s.clock(1n);s.fire();await p;}
    assert.equal(s.fence.advance(1),true);
    if(phase==='waiting'){s.clock(1n);s.fire();assert.equal(await p,'stale');}
    assert.equal(s.wait.claim(),null);assert.equal(s.wait.state,'stale');
    assert.equal(s.fence.pendingTickets,0);assert.equal(s.timer.pending,0);
  }
});
test('deadline at admission, delayed wake and delayed dispatch',async()=>{
  const a=setup();assert.equal(await a.wait.arm(10n*MS),'deadline');assert.equal(a.timer.pending,0);
  const b=setup();const p=b.wait.arm(MS);b.clock(10n);b.fire();assert.equal(await p,'deadline');
  const c=setup();const q=c.wait.arm(MS);c.clock(1n);c.fire();assert.equal(await q,'ready');c.clock(10n);
  assert.equal(c.wait.claim(),null);assert.equal(c.wait.state,'deadline');assert.equal(c.fence.pendingTickets,0);
});
test('quota refusal and clock regression release only owned reservations',async()=>{
  const a=setup();const occupied=a.fence.register();await assert.rejects(a.wait.arm(MS),/capacity/);
  assert.equal(a.fence.pendingTickets,1);occupied.close();assert.equal(a.timer.pending,0);
  const b=setup();b.clock(2n);const p=b.wait.arm(MS);b.clock(1n);b.fire();await assert.rejects(p,/ClockWentBackwards/);
  assert.equal(b.fence.pendingTickets,0);assert.equal(b.timer.pending,0);assert.equal(b.wait.state,'failed');
});
test('actual event-loop timer resolves readiness without claiming execution',async()=>{
  const timer=new StdTimeRuntime();const fence=new SelectContinuationFence({maxTickets:1});
  const wait=new RetryWaitV1(timer,fence,timer.monotonic_now()+5_000_000_000n);
  const p=wait.arm(0n);assert.equal(wait.claim(),null);
  assert.equal(await p,'ready');assert.equal(timer.pending,0);assert.equal(fence.executing,0);
  const lease=wait.claim();assert.ok(lease);lease.close();assert.equal(fence.executing,0);
});
test('late cancelled callback cannot consume replacement generation ticket',async()=>{
  const s=setup();const p=s.wait.arm(MS);const late=s.queued.values().next().value;
  assert.equal(s.wait.cancel(),true);assert.equal(await p,'cancelled');
  assert.equal(s.fence.advance(1),true);const replacement=s.fence.register(2);
  late();assert.equal(s.wait.claim(),null);assert.equal(s.timer.pending,0);
  assert.equal(replacement.active,true);assert.equal(s.fence.pendingTickets,1);replacement.close();
});
test('timer quota and actor shutdown remain fail closed',async()=>{
  const s=setup();const controller=new AbortController();
  const unrelated=s.timer.sleep_ns(MS,{signal:controller.signal});
  await assert.rejects(s.wait.arm(MS),/TimerCapacityExceeded/);
  assert.equal(s.fence.pendingTickets,0);assert.equal(s.timer.pending,1);
  controller.abort();await assert.rejects(unrelated,/TimerCancelled/);
  const t=setup();const p=t.wait.arm(MS);t.fence.close();t.clock(1n);t.fire();
  assert.equal(await p,'stale');assert.equal(t.wait.claim(),null);assert.equal(t.fence.retirementReady,true);
});
