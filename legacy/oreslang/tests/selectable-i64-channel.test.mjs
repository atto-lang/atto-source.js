import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectArbiter} from '../src/select-runtime.mjs';
import {SelectableI64Channel} from '../src/selectable-i64-channel.mjs';

function bindRead(channel,registration,onResult,onCallback) {
  return channel.subscribeReadable(subscription=>{
    onCallback();
    const cell=channel.createReadCell();
    const notifications=channel.createNotificationBatch();
    const won=registration.tryWin(
      ()=>channel.tryCommitRead(subscription,cell,notifications));
    notifications.dispatch();
    if(won) onResult(cell);
  });
}

function bindWrite(channel,registration,value,onResult,onCallback) {
  return channel.subscribeWritable(subscription=>{
    onCallback();
    const cell=channel.createWriteCell();
    const notifications=channel.createNotificationBatch();
    const won=registration.tryWin(
      ()=>channel.tryCommitWrite(subscription,value,cell,notifications));
    notifications.dispatch();
    if(won) onResult(cell);
  });
}

test('first ready read wins without consuming losing channel',()=>{
  const firstChannel=new SelectableI64Channel(2);
  const secondChannel=new SelectableI64Channel(2);
  assert.equal(firstChannel.tryWrite(11n),true);
  assert.equal(secondChannel.tryWrite(22n),true);

  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  let firstValue=0n,secondValue=0n;
  let firstCallbacks=0,secondCallbacks=0;

  const firstWait=bindRead(
    firstChannel,first,c=>{firstValue=c.value;},()=>{firstCallbacks++;});
  first.arm(()=>firstWait.close());

  const secondWait=bindRead(
    secondChannel,second,c=>{secondValue=c.value;},()=>{secondCallbacks++;});
  second.arm(()=>secondWait.close());

  assert.equal(select.winner,0);
  assert.equal(firstValue,11n);
  assert.equal(secondValue,0n);
  assert.equal(firstCallbacks,1);
  assert.equal(secondCallbacks,1);
  assert.equal(firstChannel.size,0);
  assert.equal(secondChannel.size,1);
  assert.equal(firstChannel.pendingReaders,0);
  assert.equal(secondChannel.pendingReaders,0);

  assert.deepEqual(secondChannel.tryRead(),{ok:true,eof:false,value:22n});
});

test('losing write never publishes',()=>{
  const firstChannel=new SelectableI64Channel(2);
  const secondChannel=new SelectableI64Channel(2);
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  let firstCallbacks=0,secondCallbacks=0;

  const firstWait=bindWrite(
    firstChannel,first,31n,()=>{},()=>{firstCallbacks++;});
  first.arm(()=>firstWait.close());

  const secondWait=bindWrite(
    secondChannel,second,32n,()=>{},()=>{secondCallbacks++;});
  second.arm(()=>secondWait.close());

  assert.equal(select.winner,0);
  assert.equal(firstCallbacks,1);
  assert.equal(secondCallbacks,1);
  assert.equal(firstChannel.size,1);
  assert.equal(secondChannel.size,0);
  assert.equal(firstChannel.pendingWriters,0);
  assert.equal(secondChannel.pendingWriters,0);
  assert.deepEqual(firstChannel.tryRead(),{ok:true,eof:false,value:31n});
  assert.deepEqual(secondChannel.tryRead(),{ok:false,eof:false,value:0n});
});

test('delayed readiness wakes one pending read and loser stays detached',()=>{
  const firstChannel=new SelectableI64Channel(1);
  const secondChannel=new SelectableI64Channel(1);
  const select=new SelectArbiter(2);
  const first=select.registerCase(0);
  const second=select.registerCase(1);
  let firstValue=0n,secondValue=0n;
  let firstCallbacks=0,secondCallbacks=0;

  const firstWait=bindRead(
    firstChannel,first,c=>{firstValue=c.value;},()=>{firstCallbacks++;});
  const secondWait=bindRead(
    secondChannel,second,c=>{secondValue=c.value;},()=>{secondCallbacks++;});
  first.arm(()=>firstWait.close());
  second.arm(()=>secondWait.close());

  assert.equal(select.winner,null);
  assert.equal(firstChannel.pendingReaders,1);
  assert.equal(secondChannel.pendingReaders,1);

  assert.equal(secondChannel.tryWrite(42n),true);
  assert.equal(select.winner,1);
  assert.equal(secondValue,42n);
  assert.equal(firstValue,0n);
  assert.equal(firstCallbacks,0);
  assert.equal(secondCallbacks,1);
  assert.equal(firstChannel.pendingReaders,0);
  assert.equal(secondChannel.pendingReaders,0);

  assert.equal(firstChannel.tryWrite(9n),true);
  assert.equal(firstCallbacks,0);
  assert.deepEqual(firstChannel.tryRead(),{ok:true,eof:false,value:9n});
});

test('freeing capacity wakes a pending selected write',()=>{
  const channel=new SelectableI64Channel(1);
  assert.equal(channel.tryWrite(7n),true);

  const select=new SelectArbiter(1);
  const write=select.registerCase(0);
  let callbacks=0;
  const wait=bindWrite(channel,write,8n,()=>{},()=>{callbacks++;});
  write.arm(()=>wait.close());

  assert.equal(select.winner,null);
  assert.equal(channel.pendingWriters,1);

  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:7n});
  assert.equal(select.winner,0);
  assert.equal(callbacks,1);
  assert.equal(channel.pendingWriters,0);
  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:8n});
});

test('select cancellation detaches channel waiter',()=>{
  const channel=new SelectableI64Channel(1);
  const select=new SelectArbiter(1);
  const read=select.registerCase(0);
  let value=0n,callbacks=0;
  const wait=bindRead(
    channel,read,c=>{value=c.value;},()=>{callbacks++;});
  read.arm(()=>wait.close());

  assert.equal(channel.pendingReaders,1);
  assert.equal(select.cancel(),true);
  assert.equal(channel.pendingReaders,0);

  assert.equal(channel.tryWrite(55n),true);
  assert.equal(callbacks,0);
  assert.equal(value,0n);
});

test('stale same-channel read notification cannot consume winning write',()=>{
  const channel=new SelectableI64Channel(1);
  const select=new SelectArbiter(2);
  const read=select.registerCase(0);
  const write=select.registerCase(1);
  let readValue=0n,readCallbacks=0,writeCallbacks=0;

  const readWait=bindRead(
    channel,read,c=>{readValue=c.value;},()=>{readCallbacks++;});
  read.arm(()=>readWait.close());

  const writeWait=bindWrite(
    channel,write,99n,()=>{},()=>{writeCallbacks++;});
  write.arm(()=>writeWait.close());

  assert.equal(select.winner,1);
  assert.equal(writeCallbacks,1);
  assert.equal(readCallbacks,1);
  assert.equal(readValue,0n);
  assert.equal(channel.pendingReaders,0);
  assert.equal(channel.pendingWriters,0);
  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:99n});
});

test('close wakes a pending selected read with EOF',()=>{
  const channel=new SelectableI64Channel(1);
  const select=new SelectArbiter(1);
  const read=select.registerCase(0);
  let result=null,callbacks=0;
  const wait=bindRead(
    channel,read,
    c=>{result={hasValue:c.hasValue,eof:c.eof,value:c.value};},
    ()=>{callbacks++;});
  read.arm(()=>wait.close());

  assert.equal(select.winner,null);
  assert.equal(channel.close(),true);
  assert.equal(channel.close(),false);
  assert.equal(channel.closed,true);
  assert.equal(select.winner,0);
  assert.equal(callbacks,1);
  assert.deepEqual(result,{hasValue:false,eof:true,value:0n});
  assert.equal(channel.pendingReaders,0);
  assert.deepEqual(channel.tryRead(),{ok:false,eof:true,value:0n});
  assert.equal(channel.tryWrite(1n),false);
});

test('close drains buffered values before EOF',()=>{
  const channel=new SelectableI64Channel(1,{maxWaiters:4});
  assert.equal(channel.tryWrite(77n),true);
  assert.equal(channel.close(),true);

  const firstSelect=new SelectArbiter(1);
  const firstRead=firstSelect.registerCase(0);
  let first=null;
  const firstWait=bindRead(
    channel,firstRead,
    c=>{first={hasValue:c.hasValue,eof:c.eof,value:c.value};},
    ()=>{});
  firstRead.arm(()=>firstWait.close());
  assert.equal(firstSelect.winner,0);
  assert.deepEqual(first,{hasValue:true,eof:false,value:77n});

  const eofSelect=new SelectArbiter(1);
  const eofRead=eofSelect.registerCase(0);
  let eof=null;
  const eofWait=bindRead(
    channel,eofRead,
    c=>{eof={hasValue:c.hasValue,eof:c.eof,value:c.value};},
    ()=>{});
  eofRead.arm(()=>eofWait.close());
  assert.equal(eofSelect.winner,0);
  assert.deepEqual(eof,{hasValue:false,eof:true,value:0n});
});

test('close wakes pending selected write with closed outcome',()=>{
  const channel=new SelectableI64Channel(1);
  assert.equal(channel.tryWrite(7n),true);
  const select=new SelectArbiter(1);
  const write=select.registerCase(0);
  let outcome=null,callbacks=0;
  const wait=bindWrite(
    channel,write,8n,
    c=>{outcome={written:c.written,closed:c.closed};},
    ()=>{callbacks++;});
  write.arm(()=>wait.close());

  assert.equal(select.winner,null);
  assert.equal(channel.close(),true);
  assert.equal(select.winner,0);
  assert.equal(callbacks,1);
  assert.deepEqual(outcome,{written:false,closed:true});
  assert.equal(channel.pendingWriters,0);
  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:7n});
  assert.deepEqual(channel.tryRead(),{ok:false,eof:true,value:0n});
});

test('immediate readiness callback failure removes waiter',()=>{
  const channel=new SelectableI64Channel(1,{maxWaiters:2});
  assert.equal(channel.tryWrite(1n),true);

  assert.throws(
    ()=>channel.subscribeReadable(()=>{
      throw new Error('callback failed');
    }),
    /callback failed/
  );
  assert.equal(channel.pendingReaders,0);
  assert.equal(channel.size,1);
});

test('asynchronous notification failure is retained after commit',()=>{
  const channel=new SelectableI64Channel(1,{maxWaiters:2});
  const wait=channel.subscribeReadable(()=>{
    throw new Error('async callback failed');
  });
  assert.equal(channel.pendingReaders,1);

  assert.equal(channel.tryWrite(5n),true);
  assert.equal(channel.size,1);
  assert.match(channel.notificationFailure?.message??'',/async callback failed/);
  assert.equal(wait.close(),true);
  assert.equal(channel.pendingReaders,0);
});

test('foreign subscription and wrong batch fail closed',()=>{
  const first=new SelectableI64Channel(1);
  const second=new SelectableI64Channel(1);
  const foreign=first.subscribeReadable(()=>{});
  const batch=second.createNotificationBatch();
  const readCell=second.createReadCell();
  const writeCell=second.createWriteCell();

  assert.equal(second.tryCommitRead(foreign,readCell,batch),false);
  assert.equal(second.tryCommitWrite(foreign,1n,writeCell,batch),false);
  assert.equal(foreign.close(),true);

  const local=second.subscribeWritable(()=>{});
  const foreignBatch=first.createNotificationBatch();
  assert.throws(
    ()=>second.tryCommitWrite(local,1n,writeCell,foreignBatch),
    /belongs to another channel/
  );
  assert.equal(local.close(),true);
});

test('i64 and capacity bounds fail closed',()=>{
  assert.throws(()=>new SelectableI64Channel(0),/capacity/);
  assert.throws(
    ()=>new SelectableI64Channel(1,{maxWaiters:0}),/maxWaiters/);
  const channel=new SelectableI64Channel(1);
  assert.throws(()=>channel.tryWrite(1),/signed i64 BigInt/);
  assert.throws(()=>channel.tryWrite(1n<<63n),/signed i64 BigInt/);
  assert.throws(()=>channel.tryWrite(-(1n<<63n)-1n),/signed i64 BigInt/);
  assert.equal(channel.tryWrite(-(1n<<63n)),true);
  assert.deepEqual(channel.tryRead(),{ok:true,eof:false,value:-(1n<<63n)});
});
