import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';

async function probeWorker() {
  const worker = new Worker(new URL('./fixtures/worker-control-loop-node-fixture.mjs', import.meta.url));
  const frames = [];
  let wait;
  worker.on('message', frame => {
    frames.push(frame);
    wait?.();
  });
  const next = async (kind) => {
    for (let attempt=0; attempt<30; attempt++) {
      const match = frames.find(frame => frame.kind === kind);
      if (match) return match;
      await new Promise((resolve,reject) => {
        const timeout = setTimeout(() => {wait=null;reject(Error('timed out awaiting ' + kind));},1000);
        wait = () => {clearTimeout(timeout);wait=null;resolve();};
      });
    }
    throw Error('message sequence unbounded');
  };
  return {worker, frames, next};
}

test('real Node worker uses event-loop handoff, no inline reactor continuation, stale epoch fenced',async()=>{
  const {worker,frames,next} = await probeWorker();
  try {
    await next('ready');
    worker.postMessage({kind:'complete',value:42});
    assert.equal((await next('after')).accepted,true);
    await next('resumed');
    assert.deepEqual(frames.map(f=>f.kind).slice(0,4),['ready','before','after','resumed']);
    assert.equal(frames.find(f=>f.kind==='resumed').value,42);
    worker.postMessage({kind:'retire'});
    assert.deepEqual(await next('retired'), {kind:'retired',retired:true,stale:false,attached:true});
    worker.postMessage({kind:'complete',value:43});
    await next('resumed2');
    assert.equal(frames.find(f=>f.kind==='resumed2').value,43);
    worker.postMessage({kind:'close'});
    assert.equal((await next('closed')).stats.closed,true);
  } finally {await worker.terminate();}
});
