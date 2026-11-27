// Host-only ABI fixture tests. The cross-repo Rust attoc suite separately
// executes real compiler-generated v4 Wasm (not this synthetic fixture).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';
import {createPortableTaskArenaHostV4,verifyPortableTaskGuestV4,PORTABLE_TASK_V4}
  from '../src/portable-task-host-v4.mjs';

const encoder=new TextEncoder();
const leb=n=>{const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;};
const str=s=>[...leb(encoder.encode(s).length),...encoder.encode(s)];
const sec=(n,b)=>[n,...leb(b.length),...b];
const sig=(ps,rs)=>[0x60,...leb(ps.length),...ps,...leb(rs.length),...rs];
const custom=(name,payload)=>sec(0,[...str(name),...payload]);
const cbody=(opcode,n)=>[0,opcode,n,0x0b];
function fakeModule() {
  const i32=0x7f,i64=0x7e;
  const types=[sig([i32,i32],[i32]),sig([i32,i32,i32],[i32]),
    sig([i32,i32,i32],[i64]),sig([],[i32]),sig([],[])];
  const names=['task_start_v4','task_resume_v4','task_cancel_v4',
    'task_drop_v4','task_result_v4','task_capacity_v4'];
  const bytes=[
    0,97,115,109,1,0,0,0,
    ...sec(1,[...leb(types.length),...types.flat()]),
    ...sec(2,[1,...str('atto'),...str('cooperate'),0,4]),
    ...sec(3,[6,0,1,1,1,2,3]),
    ...sec(7,[6,...names.flatMap((s,i)=>[...str(s),0,i+1])]),
    ...sec(10,[6,...[
      cbody(0x41,17),cbody(0x41,2),cbody(0x41,4),
      cbody(0x41,0),cbody(0x42,42),cbody(0x41,16)
    ].flatMap(b=>[...leb(b.length),...b])]),
    ...custom(PORTABLE_TASK_V4,[4]),
    ...custom('atto.async',[2])
  ];
  return new WebAssembly.Module(new Uint8Array(bytes));
}
const module=fakeModule();
const mk=()=>{const turns=[];return {
  turns,loop:createWorkerControlLoop({postTurn:fn=>turns.push(fn)})
};};
function tick(turns){assert.ok(turns.length);turns.shift()();}
test('v4 artifact admission is versioned and host-side only',()=>{
  assert.equal(verifyPortableTaskGuestV4(module),true);
  assert.throws(()=>verifyPortableTaskGuestV4(null),/E_V4_MODULE/);
  const bare=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
  assert.throws(()=>verifyPortableTaskGuestV4(bare),/E_V4_MARKER/);
});
test('v4 host schedules two independent lifecycle frames on one scheduler',async()=>{
  const {turns,loop}=mk();
  const host=createPortableTaskArenaHostV4({module,loop});
  const a=host.spawn({owner:'task-a',ownerId:1,epoch:1});
  const b=host.spawn({owner:'task-b',ownerId:2,epoch:1});
  assert.equal(host.stats.turns,0);
  assert.equal(host.stats.live,2);
  tick(turns);tick(turns); // two starts, no reentrant guest callbacks
  assert.equal(host.stats.liveFrames,2);
  tick(turns);tick(turns); // two DONE/physical drops
  assert.deepEqual(await Promise.all([a.result,b.result]),[42n,42n]);
  assert.equal(host.stats.peak,2);
  assert.equal(host.stats.resumes,2);
  assert.equal(host.stats.cleanups,2);
  assert.equal(host.stats.liveFrames,0);
  assert.equal(loop.stats.owners,0);
  assert.equal(a.cancel(),false);
  assert.equal(host.close(),true);
});
test('v4 cancellation preempts DATA and physically drops a frame',async()=>{
  const {turns,loop}=mk(),host=createPortableTaskArenaHostV4({module,loop});
  const task=host.spawn({owner:'cancel-test',ownerId:3,epoch:1});
  task.result.catch(()=>{});
  tick(turns); // START -> queued DATA
  assert.equal(task.stats.frameLive,true);
  assert.equal(task.cancel(),true);
  assert.equal(task.cancel(),false);
  tick(turns); // CONTROL before DATA
  await assert.rejects(task.result,/E_V4_CANCELLED/);
  assert.equal(host.stats.cleanups,1);
  assert.equal(host.stats.liveFrames,0);
  while(turns.length)tick(turns);
  assert.equal(host.stats.resumes,0);
  assert.equal(loop.stats.owners,0);
  host.close();
});
test('v4 owner shutdown reclaims Wasm frames after scheduler closure',async()=>{
  const {turns,loop}=mk(),host=createPortableTaskArenaHostV4({module,loop});
  const a=host.spawn({owner:'shutdown',ownerId:10,epoch:1});
  a.result.catch(()=>{});
  tick(turns); // allocate guest frame
  loop.close();
  assert.equal(host.close(),true);
  await assert.rejects(a.result,/E_V4_HOST_CLOSED/);
  assert.equal(host.stats.cleanups,1);
  assert.equal(host.stats.liveFrames,0);
  assert.equal(host.spawn instanceof Function,true);
  assert.throws(()=>host.spawn({owner:'after',ownerId:11,epoch:2}),/E_V4_HOST_CLOSED/);
});
