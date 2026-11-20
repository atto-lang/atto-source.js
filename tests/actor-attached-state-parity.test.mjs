import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

const read=(kind,name)=>readFileSync(new URL(`./fixtures/actor-attached-state-v1/${kind}/${name}.atto`,import.meta.url),'utf8');
const build=async(source)=>{
  const artifact=transpile_to_worker(source);
  assert.equal(artifact.backend,'js');
  assert.equal(artifact.trusted,true);
  assert.equal(artifact.guest_abi,'atto.js.browser.actor-state-counter-preview.v1');
  const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  return module.create_tenant({tenant:'t',generation:1});
};
const message=value=>{
  const buffer=new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0,BigInt(value),true);
  return {actor_id:1,wire_type:'i64',buffer};
};

for(const fixture of ['inline_counter','attached_counter','attached_initialized']){
  test(`real source transpilation and bounded JS guest turn: ${fixture}`,async()=>{
    const source=read('pass',fixture);
    const a=await build(source),b=await build(source);
    await assert.rejects(a.on_route(message(1)),/E_GUEST_NOT_READY/);
    assert.deepEqual(await a.on_message(),{value:'0',stdout:'',actors:1});
    assert.deepEqual(await b.on_message(),{value:'0',stdout:'',actors:1});
    await assert.rejects(a.on_route(message(2)),/E_ADMISSION_PENDING/);
    // send(1) succeeded as admission, NOT as handler completion.
    const drain=await a.on_drain();
    assert.deepEqual(drain,{value:'drained',stdout:'1\n',actors:1,processed:1});
    assert.deepEqual(await a.on_route(message(2)),{value:'delivered',stdout:'3\n',actors:1});
    assert.equal((await b.on_drain()).stdout,'1\n','actor state must be instance-local');
    await assert.rejects(a.on_route({...message(2),actor_id:2}),/E_ACTOR_REF/);
    await assert.rejects(a.on_route({...message(2),wire_type:'bytes'}),/E_ROUTE_WIRE/);
    await a.on_stop();
    await assert.rejects(a.on_route(message(3)),/E_ACTOR_RETIRED/);
  });
}

const negatives=[
 'inline_and_attached','initialization_missing','direct_field',
 'read_guard_write','missing_write_effect','nested_lease',
 'state_view_escape','unknown_actor_attachment',
 'actor_attachment_to_class','await_inside_guard'
];
test('all ten byte-identical shared negative fixtures reject without output',()=>{
  for(const name of negatives){
    assert.throws(()=>transpile_to_worker(read('fail',name)),
      error=>error instanceof TranspileError,`unexpected accepted invalid fixture ${name}`);
  }
});
test('prevents forged guard rights, init omissions, raw state and effect escalation',()=>{
  const good=read('pass','inline_counter');
  const invalid=[
    good.replace('using state.write','using state.read'),
    good.replace('critical-read','critical-write'),
    good.replace('s.count += mail.value','s.count = mail.value'),
    good.replace('stdio.println(observed);','await leak(s);'),
    good.replace('val observed = self.handle_state','val observed = rt deref self.handle_state'),
    good.replace('self.handle_state(critical-read |s| -> s.count)','self.handle_state(critical-read |s| -> s)'),
    good.replace('counter.send(1);','counter.send(1); counter.send(2);'),
    good.replace('on_start(): void using state.write','on_start(): void'),
    good.replace('let int count;','let int count; let int count;'),
  ];
  for(const source of invalid) assert.throws(()=>transpile_to_worker(source),
    error=>error instanceof TranspileError);
});
test('checked overflow aborts actor incarnation before publishing partial state',async()=>{
  const source=read('pass','inline_counter').replace('s.count = 0;','s.count = 9223372036854775807;');
  const actor=await build(source);
  await actor.on_message();
  await assert.rejects(actor.on_drain(),error=>{
    assert.equal(error.message,'E_GUEST_PANIC_1');
    assert.deepEqual(error.actor_failure,{
      kind:'panic',actor_id:1,parent_id:0,actor_type:'Counter',reason:'E_GUEST_PANIC_1'
    });
    return true;
  });
  await assert.rejects(actor.on_route(message(0)),/E_ACTOR_RETIRED/);
  await assert.rejects(actor.on_drain(),/E_ACTOR_RETIRED/);
});

test('a fatal checked overflow retires only the failing instance; new instances initialize independently',async()=>{
  const original=read('pass','inline_counter');
  const overflowSource=original.replace('s.count = 0;','s.count = 9223372036854775807;');
  const failed=await build(overflowSource);
  const sibling=await build(original);
  await failed.on_message();
  await sibling.on_message();
  await assert.rejects(failed.on_drain(),error=>{
    assert.equal(error.message,'E_GUEST_PANIC_1');
    assert.equal(error.actor_failure?.actor_id,1);
    assert.equal(error.actor_failure?.kind,'panic');
    return true;
  });
  await assert.rejects(failed.on_drain(),/E_ACTOR_RETIRED/);
  await assert.rejects(failed.on_route(message(0)),/E_ACTOR_RETIRED/);
  assert.equal((await sibling.on_drain()).stdout,'1\\n');
  const restarted=await build(original);
  await restarted.on_message();
  assert.equal((await restarted.on_drain()).stdout,'1\\n',
    'fresh guest instance starts from its source-owned initializer');
});

test('a pending admitted turn cannot be bypassed by forged route; malformed wire stays rejected',async()=>{
  const actor=await build(read('pass','inline_counter'));
  await actor.on_message();
  for(const forged of [
    {...message(1),actor_id:2},
    {...message(1),wire_type:'control'},
    {...message(1),buffer:new ArrayBuffer(3)}
  ]) {
    await assert.rejects(actor.on_route(forged),/E_ADMISSION_PENDING/);
  }
  assert.equal((await actor.on_drain()).stdout,'1\\n');
  await assert.rejects(actor.on_route({...message(1),actor_id:2}),/E_ACTOR_REF/);
  await assert.rejects(actor.on_route({...message(1),wire_type:'control'}),/E_ROUTE_WIRE/);
  await assert.rejects(actor.on_route({...message(1),buffer:new ArrayBuffer(3)}),/E_ROUTE_WIRE/);
  await assert.rejects(actor.on_message(),/E_MAIN_ALREADY_CALLED/);
});

test('inline and attached protected Counter layouts generate identical executable modules',()=>{
  const inline=transpile_to_worker(read('pass','inline_counter'));
  const attached=transpile_to_worker(read('pass','attached_counter'));
  assert.equal(inline.guest_abi,'atto.js.browser.actor-state-counter-preview.v1');
  assert.equal(attached.module_source,inline.module_source,
    'declaration placement must not alter state layout, checked effects or emitted code');
});

test('actor creation rejects malformed tenant handles and incarnation generations',async()=>{
  const artifact=transpile_to_worker(read('pass','inline_counter'));
  const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  const bad=[
    undefined,{}, {tenant:'t'}, {tenant:'',generation:1},
    {tenant:' t',generation:1}, {tenant:'t',generation:0},
    {tenant:'t',generation:-1}, {tenant:'t',generation:NaN},
    {tenant:'t',generation:Infinity},{tenant:'t',generation:1.5},
    {tenant:'t',generation:Number.MAX_SAFE_INTEGER+1},
    {tenant:{toString:()=> 't'},generation:1}
  ];
  for(const value of bad){
    await assert.rejects(()=>module.create_tenant(value),
      /E_TENANT_ID|E_TENANT_GENERATION/);
  }
  const a=await module.create_tenant({tenant:'tenantA',generation:1});
  const b=await module.create_tenant({tenant:'tenantA',generation:2});
  await a.on_message();
  await b.on_message();
  assert.equal((await a.on_drain()).stdout,'1\\n');
  assert.equal((await b.on_drain()).stdout,'1\\n',
    'one new incarnation must never reuse stale actor state');
});

test('huge signed literals fail with explicit bound before BigInt parsing',()=>{
  const source=read('pass','inline_counter');
  for(const literal of ['9'.repeat(4096),'-'+'9'.repeat(4096)]){
    assert.throws(()=>transpile_to_worker(
      source.replace('counter.send(1)',`counter.send(${literal})`)),
      error=>error instanceof TranspileError && error.code==='E_INT_OVERFLOW');
  }
  // Long leading-zero spelling is valid and has the same i64 semantics.
  const padded=source.replace('counter.send(1)','counter.send('+'0'.repeat(2048)+'1)');
  assert.equal(transpile_to_worker(padded).module_source,
               transpile_to_worker(source).module_source);
});
