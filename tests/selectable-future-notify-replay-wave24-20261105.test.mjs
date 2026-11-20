import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectableI64Future as Future} from '../src/selectable-i64-future.mjs';

test('independent observers commit once, retain i64 value, then revoke old tickets',()=>{
 const f=new Future({maxWaiters:2});
 const seen=[];
 const first=f.subscribeReady(sub=>seen.push(['first',sub.active]));
 const second=f.subscribeReady(sub=>seen.push(['second',sub.active]));
 assert.equal(f.pendingWaiters,2);
 assert.equal(f.resolve(17n),true);
 assert.deepEqual(seen,[['first',true],['second',true]]);
 const cell=f.createResultCell();
 assert.equal(f.tryCommit(first,cell),true);
 assert.equal(cell.status,'value');
 assert.equal(cell.value,17n);
 assert.equal(f.tryCommit(first,cell),false);
 assert.equal(cell.status,'pending');
 assert.equal(f.tryCommit(second,cell),true);
 assert.equal(cell.value,17n);
 assert.equal(f.pendingWaiters,0);
 assert.equal(f.resolve(18n),false);
});

test('notifier faults cannot suppress other callback deliveries or terminal outcome',()=>{
 const f=new Future({maxWaiters:2});
 const error=Error('actor failure'),delivered=[];
 const a=f.subscribeReady(()=>{throw Error('notice fault');});
 const b=f.subscribeReady(sub=>delivered.push(sub.active));
 assert.equal(f.fail(error),true);
 assert.deepEqual(delivered,[true]);
 assert.match(f.notificationFailure.message,/notice fault/);
 const cell=f.createResultCell();
 assert.equal(f.tryCommit(a,cell),true);
 assert.equal(cell.status,'failed');
 assert.equal(cell.error,error);
 assert.equal(f.tryCommit(b,cell),true);
 assert.equal(f.pendingWaiters,0);
 assert.equal(f.cancel(),false);
});

test('late observer callback runs synchronously and failed subscription releases its slot',()=>{
 const f=new Future({maxWaiters:1});
 assert.equal(f.cancel(),true);
 assert.throws(()=>f.subscribeReady(()=>{throw Error('late notifier failed');}),/late notifier failed/);
 assert.equal(f.pendingWaiters,0);
 let observed=0;
 const ticket=f.subscribeReady(sub=>{observed++;assert.equal(sub.active,true);});
 assert.equal(observed,1);
 const cell=f.createResultCell();
 assert.equal(f.tryCommit(ticket,cell),true);
 assert.equal(cell.status,'cancelled');
 assert.equal(f.pendingWaiters,0);
});

test('forged, copied and foreign subscriptions cannot consume capacity or authority',()=>{
 const f=new Future({maxWaiters:1}),other=new Future({maxWaiters:1});
 const token=f.subscribeReady(()=>{});
 const forged={...token};
 const cell=f.createResultCell();
 assert.equal(f.tryCommit(forged,cell),false);
 assert.equal(other.tryCommit(token,other.createResultCell()),false);
 assert.throws(()=>f.subscribeReady(()=>{}),/waiter capacity exhausted/);
 assert.throws(()=>f.resolve(1n<<63n),/signed i64 BigInt/);
 assert.equal(f.status,'pending');
 assert.equal(token.close(),true);
 assert.equal(token.close(),false);
 assert.equal(f.pendingWaiters,0);
});
