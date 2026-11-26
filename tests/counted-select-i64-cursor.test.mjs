import test from 'node:test';
import assert from 'node:assert/strict';
import {CountedSelectI64Cursor as Cursor} from '../src/counted-select-i64-cursor.mjs';
import {SelectableI64Channel as Channel} from '../src/selectable-i64-channel.mjs';
import {SelectableI64Future as Future} from '../src/selectable-i64-future.mjs';
function round(c){c.beginRound();assert.equal(c.pump(),true);}
test('exact fair batch preserves fourth message and never re-registers after success',()=>{
  const a=new Channel(2),b=new Channel(2);
  a.tryWrite(10n);a.tryWrite(30n);b.tryWrite(20n);b.tryWrite(40n);
  const c=new Cursor(3,[a,b]);
  round(c);round(c);round(c);
  assert.deepEqual(c.result(),[10n,20n,30n]);
  assert.equal(b.tryRead().value,40n);
  assert.equal(a.pendingReaders+b.pendingReaders,0);
  assert.throws(()=>c.beginRound(),/not ready/);
  assert.equal(c.cancel(),false);
});
test('pending registration is advisory and cancellation preserves producer',()=>{
  const a=new Channel(1),f=new Future();
  const c=new Cursor(2,[a,f]);
  c.beginRound();assert.equal(c.pump(),false);
  assert.equal(a.pendingReaders,1);assert.equal(f.pendingWaiters,1);
  assert.equal(c.cancel(),true);
  assert.equal(a.pendingReaders+f.pendingWaiters,0);
  assert.equal(f.status,'pending');f.resolve(42n);
  a.tryWrite(21n);assert.equal(a.tryRead().value,21n);
  assert.throws(()=>c.result(),/not successful/);
});
test('future aliases retire and an unresolved remaining source can wake owner',()=>{
  const f=new Future(),g=new Future();
  f.resolve(21n);
  const c=new Cursor(2,[f,f,g]);
  round(c);
  assert.equal(f.pendingWaiters,0);
  c.beginRound();assert.equal(c.pump(),false);assert.equal(c.dirty,false);
  g.resolve(42n);assert.equal(c.dirty,true);
  assert.equal(c.pump(),true);
  assert.deepEqual(c.result(),[21n,42n]);
  assert.equal(g.pendingWaiters,0);
});
test('graceful EOF drains buffered channel then retires aliases without counting EOF',()=>{
  const a=new Channel(1),b=new Channel(1);
  a.tryWrite(1n);a.close();b.tryWrite(2n);
  const c=new Cursor(2,[a,a,b],'first');
  round(c);round(c);round(c);
  assert.deepEqual(c.result(),[1n,2n]);
  assert.equal(a.pendingReaders+b.pendingReaders,0);
});
test('exhaustion and failed Future never publish partial results',()=>{
  const f=new Future();f.resolve(1n);
  const c=new Cursor(2,[f,f]);round(c);
  assert.equal(c.state,'failed');assert.match(c.failure.message,/SelectExhausted/);
  assert.throws(()=>c.result());
  const g=new Future(),h=new Future();g.resolve(1n);h.fail(new Error('producer failed'));
  const d=new Cursor(2,[g,h],'first');round(d);round(d);
  assert.equal(d.state,'failed');assert.match(d.failure.message,/producer failed/);
  assert.throws(()=>d.result());
});
test('zero count, invalid count and partial registration failure release waiters',()=>{
  const a=new Channel(1,{maxWaiters:1});
  assert.deepEqual(new Cursor(0,[]).result(),[]);
  for(const n of [-1,1.2,1025,Infinity])assert.throws(()=>new Cursor(n,[a]),/SelectCountInvalid/);
  const c=new Cursor(2,[a,a]);
  assert.throws(()=>c.beginRound(),/capacity/);
  assert.equal(a.pendingReaders,0);assert.equal(c.state,'failed');
});
test('notification-induced reentry is rejected and cannot consume extra data',()=>{
  const a=new Channel(1);
  a.tryWrite(7n);
  const c=new Cursor(1,[a]);
  let notices=0;
  const sub=a.subscribeWritable(()=>{notices++;assert.throws(()=>c.pump(),/reentry/);});
  round(c);
  assert.equal(notices,1);
  assert.equal(a.notificationFailure,null);
  assert.deepEqual(c.result(),[7n]);sub.close();
  assert.equal(a.pendingReaders,0);
});
test('fair rotation preserves exact surviving lexical occurrence after Future retirement',()=>{
  const a=new Channel(1),b=new Channel(2),d=new Channel(1),f=new Future();
  f.resolve(99n);
  const c=new Cursor(3,[a,b,f,b,d]);
  round(c);
  a.tryWrite(1n);b.tryWrite(2n);b.tryWrite(3n);d.tryWrite(4n);
  round(c);round(c);
  assert.deepEqual(c.result(),[99n,2n,4n]);
  assert.equal(b.tryRead().value,3n);
  assert.equal(a.tryRead().value,1n);
});

test('mixed lexical priority does not group channels before Futures',()=>{
  const a=new Channel(2),f=new Future();
  a.tryWrite(20n);a.tryWrite(30n);f.resolve(10n);
  const c=new Cursor(2,[f,a],'first');
  round(c);round(c);
  assert.deepEqual(c.result(),[10n,20n]);
  assert.equal(a.tryRead().value,30n);
  assert.equal(a.pendingReaders+f.pendingWaiters,0);
});
test('mixed FAIR order survives Future alias retirement',()=>{
  const a=new Channel(2),b=new Channel(2),f=new Future();
  a.tryWrite(10n);a.tryWrite(40n);b.tryWrite(30n);b.tryWrite(50n);f.resolve(20n);
  const c=new Cursor(4,[a,f,b,f]);
  for(let i=0;i<4;i++)round(c);
  assert.deepEqual(c.result(),[10n,20n,30n,40n]);
  assert.equal(b.tryRead().value,50n);
  assert.equal(a.pendingReaders+b.pendingReaders+f.pendingWaiters,0);
});
test('sparse and unsupported source positions fail before registration; zero ignores sources',()=>{
  const a=new Channel(1);
  assert.throws(()=>new Cursor(1,[a,,]),/dense/);
  assert.throws(()=>new Cursor(1,[a,{}]),/trusted i64 source/);
  assert.equal(a.pendingReaders,0);
  const untouched={get length(){throw new Error('zero inspected sources');}};
  assert.deepEqual(new Cursor(0,untouched).result(),[]);
  const dense=[a];dense.map=()=>{throw new Error('must not call caller map');};
  a.tryWrite(42n);
  const c=new Cursor(1,dense);round(c);assert.deepEqual(c.result(),[42n]);
});
