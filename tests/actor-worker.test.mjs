import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker, TranspileError} from '../src/transpile-worker.mjs';
import {rejectUnsupportedWorkerPlacement} from '../src/worker-actor-client.mjs';

// Same Atto source shape as atto-source.rs/tests/fixtures/browser/remote-actor-receiver.atto.
const actor_source = `
define actor Counter as
    let int total = 0;
    receive(ActorMail<int> mail): void {
        self.total = self.total + mail.value;
        stdio.println(self.total);
        return;
    }
end
pub fnc main(): int {
    val counter = spawn Counter();
    return 0;
}
`;
const build=async(source)=>{
  const artifact=transpile_to_worker(source);
  assert.equal(artifact.backend,'js');
  assert.equal(artifact.trusted,true);
  assert.equal(artifact.guest_abi,'atto.js.browser.actor-subset.v1');
  const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  return module.create_tenant({tenant:'js',generation:1});
};
const message=(n)=>{
  const buffer=new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0,BigInt(n),true);
  return {actor_id:1,wire_type:'i64',buffer};
};
test('compiled actor keeps per-tenant state and same i64 route/receipt payload as Wasm receiver',async()=>{
  const a=await build(actor_source),b=await build(actor_source);
  await assert.rejects(a.on_route(message(1)),/E_GUEST_NOT_READY/);
  assert.deepEqual(await a.on_message(),{value:'0',stdout:'',actors:1});
  assert.deepEqual(await b.on_message(),{value:'0',stdout:'',actors:1});
  assert.deepEqual(await a.on_route(message(40)),{value:'delivered',stdout:'40\n',actors:1});
  assert.deepEqual(await a.on_route(message(2)),{value:'delivered',stdout:'42\n',actors:1});
  assert.equal((await b.on_route(message(5))).stdout,'5\n','a different tenant never shares state');
  await assert.rejects(a.on_message(),/E_MAIN_ALREADY_CALLED/);
  await assert.rejects(a.on_route({...message(1),actor_id:2}),/E_ACTOR_REF/);
  await assert.rejects(a.on_route({...message(1),wire_type:'bytes'}),/E_ROUTE_WIRE/);
});
test('checked i64 overflow carries supervisor-ready actor panic metadata without mutating state',async()=>{
  const source=actor_source.replace('let int total = 0;','let int total = 9223372036854775807;');
  const actor=await build(source);
  await actor.on_message();
  await assert.rejects(actor.on_route(message(1)),error=>{
    assert.equal(error.message,'E_GUEST_PANIC_1');
    assert.deepEqual(error.actor_failure,{
      kind:'panic',actor_id:1,parent_id:0,actor_type:'Counter',reason:'E_GUEST_PANIC_1'
    });
    return true;
  });
  assert.equal((await actor.on_route(message(0))).stdout,'9223372036854775807\n');
});
test('strict actor subset rejects unsupported effects, injections, extra actors and malformed AST',()=>{
  const rejects=[
    actor_source.replace('self.total = self.total + mail.value;','self.total = mail.value;'),
    actor_source.replace('self.total + mail.value','self.total * mail.value'),
    actor_source.replace('return 0;','return foo();'),
    actor_source.replace('spawn Counter()','spawn Other()'),
    actor_source.replace('return;\n    }','await sleep(); return;\n    }'),
    actor_source.replace('end\npub','end\nend\npub'),
    actor_source+'import("evil");',
    actor_source.replace('let int total = 0;','let int total = 9223372036854775808;'),
    actor_source.replace('ActorMail<int>','ActorMail<bool>'),
    actor_source.replace('stdio.println(self.total);','stdio.println(mail.value);')
  ];
  for(const source of rejects)
    assert.throws(()=>transpile_to_worker(source),error=>error instanceof TranspileError);
});
test('elastic actor worker placement fails closed before spawning unsupported JS Worker', () => {
  const denied = [
    'maxParallelism','max_parallelism','minParallelism','min_parallelism',
    'poolSize','pool_size','pool','threadPool','threadPolicy',
    'affinity','threadAffinity','pinnedWorker','dedicatedWorker',
    'schedule','actor_schedule','actorSchedule'
  ];
  for (const key of denied) {
    const options = Object.assign(Object.create(null), {[key]: 1});
    assert.throws(() => rejectUnsupportedWorkerPlacement(options),
      /elastic actor scheduling/, key);
  }
  assert.doesNotThrow(() => rejectUnsupportedWorkerPlacement({
    moduleUrl: 'file:///trusted/guest.mjs', mode: 'handler', maxPending: 8
  }));
  assert.throws(
    () => transpile_to_worker(
      '@actor_schedule(max_parallelism = pool_size)\n' + actor_source),
    error => error instanceof TranspileError,
    'no unverified source annotation silently ignored by actor lowering'
  );
});
