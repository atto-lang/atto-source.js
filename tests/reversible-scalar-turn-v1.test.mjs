import test from 'node:test';
import assert from 'node:assert/strict';
import {ReversibleScalarTurnV1, retryAfterFailure} from '../src/reversible-scalar-turn-v1.mjs';
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;

test('tail undo, redo, branch invalidation and original duplicate receipt', () => {
  const t = new ReversibleScalarTurnV1(100n, 2, 8);
  const first = t.apply(1n,0n,'commit',0n);
  assert.deepEqual(first,{status:'ok',version:1n,value:0n});
  assert.equal(t.apply(2n,1n,'commit',7n).status,'ok');
  assert.equal(t.apply(1n,0n,'commit',0n),first);
  assert.equal(t.apply(1n,0n,'commit',9n).status,'id_reuse');
  assert.equal(t.apply(3n,1n,'undo',2n).status,'conflict');
  assert.equal(t.apply(3n,2n,'undo',1n).status,'invalid_history');
  assert.deepEqual(t.apply(3n,2n,'commit',11n),{status:'quota',version:2n,value:7n});
  assert.equal(t.apply(3n,2n,'undo',2n).value,0n);
  assert.equal(t.apply(4n,3n,'undo',1n).value,100n);
  assert.equal(t.apply(5n,4n,'redo',1n).value,0n);
  assert.equal(t.apply(6n,5n,'commit',42n).value,42n);
  assert.deepEqual(t.apply(7n,6n,'redo',2n),{status:'invalid_history',version:6n,value:42n});
});

test('i64 bounds, bounded receipts and no coercion', () => {
  const t = new ReversibleScalarTurnV1(MIN,1,2);
  const hostile = {valueOf(){throw new Error('must not coerce');}};
  for (const arg of [MAX+1n,MIN-1n,1,hostile])
    assert.equal(t.apply(1n,0n,'commit',arg).status,'invalid_command');
  assert.equal(t.apply(0n,0n,'commit',0n).status,'invalid_command');
  assert.equal(t.apply(1n,0n,hostile,0n).status,'invalid_command');
  const first = t.apply(1n,0n,'commit',MAX);
  assert.throws(()=>{first.value=0n;},TypeError);
  assert.equal(t.apply(2n,1n,'undo',1n).value,MIN);
  assert.equal(t.apply(3n,2n,'redo',1n).status,'quota');
  assert.equal(t.apply(1n,0n,'commit',MAX),first);
  assert.equal(t.version,2n);
  assert.equal(t.value,MIN);
  assert.throws(()=>new ReversibleScalarTurnV1(0n,4097,1),RangeError);
});

test('retry admission: strict deadline, saturation and cancellation', () => {
  const p=(c,e,eligible=true,cancelled=false)=>retryAfterFailure(5,c,100n,250n,1000n,e,'exponential',eligible,cancelled);
  assert.equal(p(1,0n).delay,100n);
  assert.equal(p(2,100n).delay,200n);
  assert.equal(p(3,300n).delay,250n);
  assert.equal(p(5,800n).decision,'exhausted');
  assert.equal(p(4,750n).decision,'deadline');
  assert.equal(p(1,0n,true,true).decision,'cancelled');
  assert.equal(p(1,0n,false).decision,'ineligible');
  assert.equal(p(0,0n).decision,'invalid');
  assert.equal(p(1,0n,1).decision,'invalid');
  assert.equal(retryAfterFailure(2147483647,2147483646,1n,MAX,MAX,0n,'exponential',true,false).decision,'deadline');
  assert.equal(retryAfterFailure(2,1,0n,0n,1n,0n,'fixed',true,false).decision,'wait');
  assert.equal(retryAfterFailure(2,1,0n,0n,1n,1n,'fixed',true,false).decision,'deadline');
});
