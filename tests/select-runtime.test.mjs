import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectArbiter} from '../src/select-runtime.mjs';

test('exactly one case wins and every loser revokes once',()=> {
  const count=16;
  const select=new SelectArbiter(count);
  const registrations=[];
  const revoked=Array(count).fill(0);
  for(let i=0;i<count;i++) {
    const registration=select.registerCase(i);
    registration.arm(()=>{revoked[i]++;});
    registrations.push(registration);
  }

  let wins=0;
  // JS isolate execution is single-threaded; this checks the runtime
  // linearization contract, not cross-Worker shared-memory concurrency.
  for(const registration of registrations)
    if(registration.tryWin())wins++;

  assert.equal(wins,1);
  assert.equal(select.winner,0);
  assert.equal(registrations[0].isWinner,true);
  assert.deepEqual(revoked,[0,...Array(count-1).fill(1)]);
  assert.equal(select.cancel(),false);
});

test('winner before arm revokes a late loser but never the winner',()=> {
  const select=new SelectArbiter(2);
  const winner=select.registerCase(0);
  const loser=select.registerCase(1);
  let winnerRevoked=0,loserRevoked=0;

  assert.equal(winner.tryWin(),true);
  winner.arm(()=>{winnerRevoked++;});
  loser.arm(()=>{loserRevoked++;});

  assert.equal(winnerRevoked,0);
  assert.equal(loserRevoked,1);
  assert.equal(select.winner,0);
});

test('cancellation revokes armed and late registrations',()=> {
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  let firstRevoked=0,secondRevoked=0;
  first.arm(()=>{firstRevoked++;});

  const cancel=select.cancellationHandle();
  assert.equal(cancel.cancel(),true);
  assert.equal(select.cancelled,true);
  assert.equal(firstRevoked,1);
  second.arm(()=>{secondRevoked++;});
  assert.equal(secondRevoked,1);
  assert.equal(first.tryWin(),false);
  assert.equal(second.tryWin(),false);
  assert.equal(cancel.cancel(),false);
});

test('conditional commit controls winner publication',()=> {
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  let firstRevoked=0,secondRevoked=0,commits=0;
  first.arm(()=>{firstRevoked++;});
  second.arm(()=>{secondRevoked++;});

  assert.equal(first.tryWin(()=>{commits++;return false;}),false);
  assert.equal(select.winner,null);

  assert.throws(
    ()=>first.tryWin(()=>{commits++;throw new Error('commit failure');}),
    /commit failure/
  );
  assert.equal(select.winner,null);

  assert.equal(second.tryWin(()=>{commits++;return true;}),true);
  assert.equal(select.winner,1);
  assert.equal(commits,3);
  assert.equal(firstRevoked,1);
  assert.equal(secondRevoked,0);
});

test('async or nonboolean commit result fails closed without publishing winner',()=> {
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  first.arm(()=>{});
  second.arm(()=>{});

  assert.throws(()=>first.tryWin(()=>1),/synchronous boolean/);
  assert.equal(select.winner,null);
  assert.throws(()=>first.tryWin(()=>Promise.resolve(true)),/synchronous boolean/);
  assert.equal(select.winner,null);
  assert.equal(second.tryWin(),true);
});

test('commit callback cannot re-enter the same arbiter',()=> {
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  first.arm(()=>{});
  second.arm(()=>{});

  assert.throws(
    ()=>first.tryWin(()=>{
      first.tryWin();
      return true;
    }),
    /must not re-enter/
  );
  assert.equal(select.winner,null);
  assert.equal(second.tryWin(),true);
});

test('cleanup failure never rolls back winner and later losers still drain',()=> {
  const select=new SelectArbiter(3);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  const third=select.registerCase(2);
  let thirdRevoked=0;

  first.arm(()=>{});
  second.arm(()=>{throw new Error('cleanup failed');});
  third.arm(()=>{thirdRevoked++;});

  assert.equal(first.tryWin(),true);
  assert.equal(select.winner,0);
  assert.equal(thirdRevoked,1);
  assert.match(select.cleanupFailure?.message??'',/cleanup failed/);
  assert.throws(()=>select.throwIfCleanupFailed(),/cleanup failed/);
});

test('dispose is a deterministic cancellation boundary',()=> {
  const select=new SelectArbiter(1);
  const registration=select.registerCase(0);
  let revoked=0;
  registration.arm(()=>{revoked++;});

  select.dispose();
  assert.equal(select.cancelled,true);
  assert.equal(revoked,1);
  assert.equal(registration.tryWin(),false);
});

test('registration validation fails closed',()=> {
  assert.throws(()=>new SelectArbiter(0),/capacity/);
  assert.throws(()=>new SelectArbiter(4097),/capacity/);

  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  assert.throws(()=>select.registerCase(0),/duplicate/);
  assert.throws(()=>select.registerCase(2),/out of range/);

  first.arm(()=>{});
  assert.throws(()=>first.arm(()=>{}),/already armed/);
  assert.throws(()=>first.arm(null),/function/);
});

test('late-arm cleanup failure is diagnostic rather than winner rollback',()=> {
  const select=new SelectArbiter(2);
  const winner=select.registerCase(0);
  const loser=select.registerCase(1);
  assert.equal(winner.tryWin(),true);

  assert.doesNotThrow(()=>loser.arm(()=>{
    throw new Error('late cleanup failed');
  }));
  assert.equal(select.winner,0);
  assert.match(select.cleanupFailure?.message??'',/late cleanup failed/);
});
