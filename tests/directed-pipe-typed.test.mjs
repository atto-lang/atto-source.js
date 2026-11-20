import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectedPipeError,plan_directed_pipe,check_unicast_pipe_plans} from '../src/directed-pipe-typed.mjs';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Compiler-owned metadata, not guest-created ActorRef or host route grants.
const producer={id:'producer',tenant:'tenant_a',kind:'actor',receives:'int',emits:'int'};
const consumer={id:'consumer',tenant:'tenant_a',kind:'actor',receives:'int',emits:null};
const channel={id:'channel',tenant:'tenant_a',kind:'channel',receives:'int',emits:'int'};
const transform={id:'transform',tenant:'tenant_a',kind:'stream-duplex',receives:'int',emits:'int'};
const sink={id:'sink',tenant:'tenant_a',kind:'stream-sink',receives:'int',emits:null};
const source={id:'source',tenant:'tenant_a',kind:'stream-readable',receives:null,emits:'int'};
const fail=(fn,code)=>assert.throws(fn,e=>e instanceof DirectedPipeError&&e.code===code,code);
const without_indices=p=>p.dataEdges.map(({source,sink,payload})=>({source,sink,payload}));

test('named actor pipe and rpipe describe identical directed DATA without duplex',()=>{
 const a=plan_directed_pipe([producer,consumer],'pipe');
 const b=plan_directed_pipe([consumer,producer],'rpipe');
 assert.deepEqual(without_indices(a),without_indices(b));
 assert.deepEqual(without_indices(a),[{source:'producer',sink:'consumer',payload:'int'}]);
 assert.deepEqual(a.flowIndices,[0,1]);assert.deepEqual(b.flowIndices,[1,0]);
 assert.equal(b.writtenStages[0].id,'consumer');
 fail(()=>check_unicast_pipe_plans([a,b]),'E_PIPE_DUPLICATE_EDGE');
});

test('channel and stream segments normalize four-stage pipe and rpipe',()=>{
 const a=plan_directed_pipe([producer,channel,transform,consumer],'pipe');
 const b=plan_directed_pipe([consumer,transform,channel,producer],'rpipe');
 assert.deepEqual(without_indices(a),without_indices(b));
 assert.equal(a.dataEdges.length,3);
 assert.equal(a.dataEdges[0].source_written_index,0);
 assert.equal(b.dataEdges[0].source_written_index,3);
});
test('readable and sink-only stream ports are directional',()=>{
 assert.equal(plan_directed_pipe([source,consumer],'pipe').dataEdges.length,1);
 assert.equal(plan_directed_pipe([producer,sink],'pipe').dataEdges.length,1);
 fail(()=>plan_directed_pipe([producer,source],'pipe'),'E_PIPE_MISSING_RECEIVES');
 fail(()=>plan_directed_pipe([sink,consumer],'pipe'),'E_PIPE_MISSING_EMITS');
});

test('missing declared emits cannot be inferred from receives or sends',()=>{
 fail(()=>plan_directed_pipe([{...producer,emits:null,sends:'int'},consumer],'pipe'),
   'E_PIPE_MISSING_EMITS');
 fail(()=>plan_directed_pipe([consumer,producer],'pipe'),'E_PIPE_MISSING_EMITS');
 fail(()=>plan_directed_pipe([producer,consumer],'rpipe'),'E_PIPE_MISSING_EMITS');
});
test('exact nominal type, tenant and duplicate stages are checked first',()=>{
 fail(()=>plan_directed_pipe([producer,{...consumer,receives:'bool'}],'pipe'),
   'E_PIPE_TYPE_MISMATCH');
 fail(()=>plan_directed_pipe([producer,{...consumer,tenant:'tenant_b'}],'pipe'),
   'E_PIPE_TENANT_BOUNDARY');
 fail(()=>plan_directed_pipe([producer,{...producer}],'pipe'),
   'E_PIPE_DUPLICATE_STAGE');
});
test('bad roles, budgets and malicious metadata fail before publication',()=>{
 fail(()=>plan_directed_pipe([producer],'pipe'),'E_PIPE_STAGE_LIMIT');
 fail(()=>plan_directed_pipe([producer,...Array.from({length:16},(_,i)=>({...channel,id:'c'+i}))],'pipe'),
   'E_PIPE_STAGE_LIMIT');
 fail(()=>plan_directed_pipe([producer,consumer],'|>'),'E_PIPE_DIRECTION');
 fail(()=>plan_directed_pipe([{...channel,emits:'bool'},consumer],'pipe'),
   'E_PIPE_CHANNEL_PORTS');
 fail(()=>plan_directed_pipe([{...source,receives:'int'},consumer],'pipe'),
   'E_PIPE_READONLY_PORT');
 fail(()=>plan_directed_pipe([{...sink,emits:'int'},consumer],'pipe'),
   'E_PIPE_WRITEONLY_PORT');
 fail(()=>plan_directed_pipe([producer,{...consumer,id:'bad\u202e'}],'pipe'),'E_PIPE_ID');
 fail(()=>plan_directed_pipe([producer,{...consumer,receives:'int\n'}],'pipe'),
   'E_PIPE_TYPE_LABEL');
});
test('no getters, sparse source arrays or attacker iterators are invoked',()=>{
 let called=0;
 const evil={...producer};
 Object.defineProperty(evil,'id',{get(){called++;return 'producer';}});
 fail(()=>plan_directed_pipe([evil,consumer],'pipe'),'E_PIPE_DESCRIPTOR');
 assert.equal(called,0);
 const missing=Object.create(producer);
 fail(()=>plan_directed_pipe([missing,consumer],'pipe'),'E_PIPE_DESCRIPTOR');
 fail(()=>plan_directed_pipe(new Array(2),'pipe'),'E_PIPE_DESCRIPTOR');
 const array=[producer,consumer];
 Object.defineProperty(array,Symbol.iterator,{value(){called++;throw Error('iterator');}});
 assert.equal(plan_directed_pipe(array,'pipe').dataEdges.length,1);
 assert.equal(called,0);
});
test('cross-expression output occupancy requires explicit fanout',()=>{
 const a=plan_directed_pipe([producer,consumer],'pipe');
 const b=plan_directed_pipe([producer,sink],'pipe');
 fail(()=>check_unicast_pipe_plans([a,b]),'E_PIPE_OUTPUT_OCCUPIED');
 const c=plan_directed_pipe([{...producer,id:'other'},consumer],'pipe');
 fail(()=>check_unicast_pipe_plans([a,c]),'E_PIPE_INPUT_OCCUPIED');
 const reverse=plan_directed_pipe([consumer,{...producer,id:'third'}],'rpipe');
 fail(()=>check_unicast_pipe_plans([a,reverse]),'E_PIPE_INPUT_OCCUPIED');
 const independent=plan_directed_pipe([{...producer,id:'other'},sink],'pipe');
 assert.equal(check_unicast_pipe_plans([a,independent]),true);
});
test('forged plan cannot pass as compiler-generated capability',()=>{
 fail(()=>check_unicast_pipe_plans([{tenant:'tenant_a',dataEdges:[]}]),'E_PIPE_PLAN_CAPABILITY');
 const plan=plan_directed_pipe([producer,consumer],'pipe');
 assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.writtenStages)&&
  Object.isFrozen(plan.dataEdges)&&Object.isFrozen(plan.dataEdges[0]));
 assert.equal(typeof plan.activate,'undefined');
 assert.equal(typeof plan.send,'undefined');
 assert.equal(typeof plan.supervisor,'undefined');
});
test('the actual narrow JS compiler rejects continuous pipe and rpipe before artifact',()=>{
 for (const op of ['pipe','rpipe']) {
  const sourceText='pub fnc main(): int { val x = a '+op+' b; return 0; }';
  assert.throws(()=>transpile_to_worker(sourceText),
   e=>e instanceof TranspileError&&e.code==='E_UNSUPPORTED_CONTINUOUS_PIPE');
 }
 const good=transpile_to_worker('// pipe rpipe\npub fnc main(): int { return 42; }');
 assert.equal(good.backend,'js');
});
