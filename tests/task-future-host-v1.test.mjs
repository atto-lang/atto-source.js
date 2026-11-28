// Host-only TaskFuture control/receipt tests, not compiled Atto source parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskFutureHostV1,TASK_FUTURE_HOST_V1}
  from '../src/task-future-host-v1.mjs';

test('owned TaskFuture splits exactly one Future receipt and retains target control',async()=>{
  let cancels=0,cooperates=0;
  const task=createTaskFutureHostV1({
    result:Promise.resolve(42n),
    cancelTask(){cancels++;},
    requestCooperate(){cooperates++;}
  });
  assert.equal(task.version,TASK_FUTURE_HOST_V1);
  assert.ok(Object.isFrozen(task));
  assert.equal(Object.hasOwn(task,'result'),false,'never expose a replayable Promise');
  const future=task.get_ready();
  assert.ok(Object.isFrozen(future));
  task.cooperate();task.cancel_task();
  assert.equal(cooperates,1);assert.equal(cancels,1);
  assert.equal(await future,42n);
  assert.throws(()=>task.get_ready(),/E_TASK_RESULT_CONSUMED/);
  await assert.rejects(Promise.resolve(future),/E_TASK_RESULT_CONSUMED/);
  await assert.rejects(Promise.resolve(task),/E_TASK_RESULT_CONSUMED/);
});

test('await TaskFuture consumes the same result right as get_ready',async()=>{
  const task=createTaskFutureHostV1({
    result:Promise.resolve(42n),cancelTask(){},requestCooperate(){}
  });
  assert.equal(await task,42n);
  assert.throws(()=>task.get_ready(),/E_TASK_RESULT_CONSUMED/);
  await assert.rejects(Promise.resolve(task),/E_TASK_RESULT_CONSUMED/);
});

test('cancel_task is a void request and does not consume a pending Future receipt',async()=>{
  let rejectResult,cancels=0,cooperates=0;
  const result=new Promise((_,reject)=>{rejectResult=reject;});
  const t=createTaskFutureHostV1({
    result,
    cancelTask(){cancels++;rejectResult(new Error('TaskCancelled'));},
    requestCooperate(){cooperates++;}
  });
  const future=t.get_ready();
  assert.equal(t.cancel_task(),undefined);
  assert.equal(t.cooperate(),undefined);
  assert.equal(cancels,1);assert.equal(cooperates,1);
  await assert.rejects(Promise.resolve(future),/TaskCancelled/);
  assert.throws(()=>t.get_ready(),/E_TASK_RESULT_CONSUMED/);
});

test('TaskFuture refuses malformed host delegates before minting control capabilities',()=>{
  assert.throws(()=>createTaskFutureHostV1(),/E_TASK_FUTURE_HOST_ARGUMENT/);
  assert.throws(()=>createTaskFutureHostV1({result:Promise.resolve(1)}),
    /E_TASK_FUTURE_HOST_ARGUMENT/);
  assert.throws(()=>createTaskFutureHostV1({
    result:Promise.resolve(1),cancelTask(){},requestCooperate:null
  }),/E_TASK_FUTURE_HOST_ARGUMENT/);
});
