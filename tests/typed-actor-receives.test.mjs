import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transpile_to_worker, TranspileError} from '../src/transpile-worker.mjs';

// Exact subset: one statically typed ActorMail<int> and a trusted JS i64 route.
// These tests EXECUTE generated JS. They do not prove independent Wasm,
// LLVM, Java, .NET, Forge or authentic supervisor CONTROL runtime parity.
const baseline = `
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
const with_header = baseline.replace('define actor Counter as',
                                     'define actor Counter receives int as');
const route = value => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(value), true);
  return {actor_id:1, wire_type:'i64', buffer};
};
const instantiate = async source => {
  const artifact = transpile_to_worker(source);
  assert.equal(artifact.backend, 'js');
  assert.equal(artifact.guest_abi, 'atto.js.browser.actor-subset.v1');
  const module = await import('data:text/javascript;charset=utf-8,' +
                              encodeURIComponent(artifact.module_source));
  return module.create_tenant({tenant:'typed',generation:1});
};
const reject = (source, code) =>
  assert.throws(() => transpile_to_worker(source),
    e => e instanceof TranspileError && e.code === code,
    `must refuse ${code}`);

test('explicit receives int and legacy header execute equivalent checked i64 ingress', async () => {
  for (const source of [baseline, with_header]) {
    const actor = await instantiate(source);
    assert.deepEqual(await actor.on_message(), {value:'0',stdout:'',actors:1});
    assert.deepEqual(await actor.on_route(route(40)),
      {value:'delivered',stdout:'40\n',actors:1});
    assert.equal((await actor.on_route(route(2))).stdout,'42\n');
    await assert.rejects(actor.on_route({...route(1), wire_type:'control'}),
      /E_ROUTE_WIRE/, 'application DATA cannot claim CONTROL by changing wire type');
  }
});

test('actor header cannot widen or disable the concrete ActorMail<int> ingress', () => {
  for (const type of ['String', 'bool', 'ActorMail', 'Any'])
    reject(baseline.replace('Counter as', `Counter receives ${type} as`),
           'E_ACTOR_RECEIVES');
  reject(baseline.replace('Counter as','Counter receives never as'),
         'E_ACTOR_RECEIVES_NEVER_UNSUPPORTED');
  reject(baseline.replace('Counter as','Counter receives int receives int as'),
         'E_ACTOR_CONTRACT');
});

test('empty outbound effect satisfies typed sends bounds without granting host I/O', async () => {
  for (const header of ['Counter', 'Counter receives int']) {
    for (const effect of ['int', 'bool', 'never']) {
      const source = baseline
        .replace('Counter as', `${header} sends ${effect} as`)
        .replace('receive(ActorMail<int>', 'susp receive(ActorMail<int>')
        .replace('pub fnc main()', 'pub susp fnc main()');
      const actor = await instantiate(source);
      assert.deepEqual(await actor.on_message(), {value:'0',stdout:'',actors:1});
      assert.deepEqual(await actor.on_route(route(40)),
        {value:'delivered',stdout:'40\n',actors:1});
    }
  }
});

test('unproved outbound syntax still fails closed before generated JavaScript', () => {
  for (const header of ['Counter', 'Counter receives int']) {
    const mk = clause => baseline.replace('Counter as', `${header} ${clause} as`);
    for (const unknown of ['String', 'Any', 'SomeActor'])
      reject(mk(`sends ${unknown}`), 'E_ACTOR_SENDS_EFFECT_UNSUPPORTED');
    reject(mk('emits int'), 'E_ACTOR_EMITS_EFFECT_UNSUPPORTED');
    reject(mk('sends int sends int'), 'E_ACTOR_CONTRACT');
  }
  // Strings still have no cross-worker owned UTF-8 wire representation.
  reject(baseline.replace('Counter as','Counter receives string sends int as'),
         'E_ACTOR_RECEIVES');
});

test('unsupported unions and rewritten payloads cannot masquerade as typed ingress', () => {
  reject(with_header.replace('receives int as','receives int | String as'),
         'E_UNSUPPORTED_TOKEN');
  reject(with_header.replace('ActorMail<int>','ActorMail<bool>'),
         'E_ACTOR_RECEIVES');
});

test('typed ingress rejects hidden Unicode, invalid surrogates and raw source controls', () => {
  reject(with_header + '// bidi:' + String.fromCodePoint(0x202e), 'E_BIDI_CONTROL');
  reject(with_header + '// invalid UTF-16:' + String.fromCharCode(0xd800), 'E_INVALID_UTF16');
  reject(with_header + '// NUL:' + String.fromCharCode(0), 'E_RAW_SOURCE_CONTROL');
});


// Second independent compiled JavaScript actor DATA profile: a strict bool
// inbox, no JS eval, no dynamic callbacks, and no outbound app send sites.
const boolActor = String.raw`
define actor Flag receives bool sends never as
  let bool enabled = false;
  susp receive(ActorMail<bool> mail): void {
    self.enabled = mail.value;
    stdio.println(self.enabled);
    return;
  }
end
pub susp fnc main(): int {
  val flag = spawn Flag();
  return 0;
}
`;
const boolRoute = n => ({actor_id:1,wire_type:'bool',buffer:Uint8Array.of(n).buffer});

test('typed bool ingress executes generated JS for false, true and never-outbound effect', async () => {
  for (const source of [
    boolActor,
    boolActor.replace('receives bool sends never', 'receives bool sends int'),
    boolActor.replace('receives bool sends never', 'sends never'),
    boolActor.replace('receives bool sends never', ''),
  ]) {
    const actor = await instantiate(source);
    assert.deepEqual(await actor.on_message(), {value:'0',stdout:'',actors:1});
    assert.deepEqual(await actor.on_route(boolRoute(1)),
      {value:'delivered',stdout:'true\n',actors:1});
    assert.deepEqual(await actor.on_route(boolRoute(0)),
      {value:'delivered',stdout:'false\n',actors:1});
  }
});

test('typed bool inbox rejects invalid byte, forged control, wrong size and wrong scalar encoding', async () => {
  const actor = await instantiate(boolActor);
  await actor.on_message();
  for (const bad of [
    boolRoute(2), boolRoute(255),
    {...boolRoute(1), wire_type:'control'},
    {...boolRoute(1), wire_type:'i64'},
    {...boolRoute(1),buffer:new ArrayBuffer(8)},
    {...boolRoute(1),buffer:new ArrayBuffer(0)},
    {...boolRoute(1),actor_id:2},
  ]) {
    await assert.rejects(actor.on_route(bad), /E_ROUTE_WIRE|E_ACTOR_REF/);
  }
  assert.equal((await actor.on_route(boolRoute(1))).stdout, 'true\n',
    'invalid DATA must not poison or mutate valid bool state');
});

test('checked bool header is not silently widened to int or string payload', () => {
  reject(boolActor.replace('receives bool', 'receives int'), 'E_ACTOR_RECEIVES');
  reject(boolActor.replace('receives bool', 'receives string'), 'E_ACTOR_RECEIVES');
  reject(boolActor.replace('ActorMail<bool>', 'ActorMail<int>'), 'E_ACTOR_RECEIVES');
  reject(boolActor.replace('let bool enabled = false', 'let bool enabled = 42'),
    'E_UNSUPPORTED_ACTOR_LITERAL');
  reject(boolActor.replace('self.enabled = mail.value;', 'self.enabled = true;'),
    'E_UNSUPPORTED_ACTOR_SYNTAX');
  reject(boolActor.replace('sends never', 'sends void'), 'E_ACTOR_SEND_CONTRACT');
  reject(boolActor.replace('sends never', 'sends never sends int'), 'E_ACTOR_CONTRACT');
});


test('canonical cross-compiler bool/never .atto fixture generates and executes JS guest', async () => {
  const exactSource=readFileSync(new URL('./fixtures/actor-bool-never-parity-v1.atto',
                                            import.meta.url),'utf8');
  assert.equal(createHash('sha1')
    .update('blob '+Buffer.byteLength(exactSource,'utf8')+String.fromCharCode(0))
    .update(exactSource,'utf8').digest('hex'),
    'a103999dd9b047e24ae79fedd88398374bc10590',
    'exact canonical positive fixture bytes');
  const actor=await instantiate(exactSource);
  assert.deepEqual(await actor.on_message(),{value:'0',stdout:'',actors:1});
  assert.equal((await actor.on_route(boolRoute(1))).stdout,'true\n');
  assert.equal((await actor.on_route(boolRoute(0))).stdout,'false\n');
});

test('checked-i64 panic terminates only the failed generated actor, with one terminal receipt', async () => {
  // The exact Git blob is shared with platform conformance and the HDL
  // fail-closed test; no handwritten test-only variation of the source.
  const guestSource=readFileSync(new URL('./fixtures/atto-theater-v1/checked-i64-terminal.atto',
                                          import.meta.url),'utf8');
  const gitBlob=createHash('sha1')
    .update('blob '+Buffer.byteLength(guestSource,'utf8')+String.fromCharCode(0))
    .update(guestSource,'utf8').digest('hex');
  assert.equal(gitBlob,'8a981a3545e0307387af83b0fc306c012d52f831');
  const failed = await instantiate(guestSource);
  const sibling = await instantiate(guestSource);
  await failed.on_message();
  await sibling.on_message();
  assert.equal((await failed.on_route(route(9223372036854775807n))).stdout,
    '9223372036854775807\n');
  const first = await failed.on_route(route(1)).then(
    () => { throw new Error('overflow unexpectedly accepted'); },
    error => error
  );
  assert.equal(first.message, 'E_GUEST_PANIC_1');
  assert.deepEqual(first.actor_failure, {
    kind:'panic',actor_id:1,parent_id:0,actor_type:'Counter',reason:'E_GUEST_PANIC_1'
  });
  for (const packet of [route(0), route(1), {...route(1), wire_type:'control'}]) {
    const subsequent = await failed.on_route(packet).then(
      () => { throw new Error('terminated actor accepted message'); },
      error => error
    );
    assert.equal(subsequent.message, 'E_ACTOR_TERMINATED');
    assert.equal(subsequent.actor_failure, undefined,
      'an already-terminated actor cannot emit another failure receipt');
  }
  assert.equal((await sibling.on_route(route(41))).stdout, '41\n',
    'failure must not terminate an independent actor instance');
});

test('canonical cross-backend Ensemble share! try_publish fixture fails closed before JS guest emission', () => {
  const source=readFileSync(new URL(
    './fixtures/atto-ensemble-v1/canonical-unlowered-try-publish.atto',
    import.meta.url),'utf8');
  const sha=createHash('sha1')
    .update('blob '+Buffer.byteLength(source,'utf8')+String.fromCharCode(0))
    .update(source,'utf8').digest('hex');
  assert.equal(sha,'c562ad380bb283da9ffa26160653c1186ab63462',
    'pin the exact LLVM/.NET/Wasm/HDL/JS/conformance AttoLang source blob');
  for(const candidate of [
    source,
    'val r = imported_topic.try_publish(share! event)?;',
    'val r = topic?.try_publish(share! event)?;',
    'val r = topic /* trivia */ . try_publish(share!event)?;',
    'val f = topic.try_publish;',
  ]) reject(candidate,'E_ACTOR_PUBSUB_UNSUPPORTED');
  // Quoted strings and comments may mention a topic without granting a
  // capability or invoking a parser fallback.
  for(const candidate of [
    baseline+' // topic.try_publish(share! event)?\n',
    baseline+' /* topic.try_publish(share!event)? */',
  ]) assert.doesNotThrow(()=>transpile_to_worker(candidate));
  assert.throws(()=>transpile_to_worker(
    'pub fnc main(): int { return 42; } "topic.try_publish(share! event)?"'),
    e=>e instanceof TranspileError&&e.code==='E_TRAILING_SOURCE',
    'quoted text is opaque and cannot trigger the pubsub gate');
});


test('canonical bool actor negatives use exact shared fixture blobs and compiler diagnostics', () => {
  const cases = [
  [
    "02-receives-handler-mismatch.atto",
    "fe76f70ef141b7bba74254ecaf7708f881144f32",
    "E_ACTOR_RECEIVES"
  ],
  [
    "03-sends-void-invalid.atto",
    "0f1637268858eeac654cccc7f0c925e4f9c88572",
    "E_ACTOR_SEND_CONTRACT"
  ],
  [
    "04-duplicate-sends-clause.atto",
    "df6aa49bd474e95d7df5092cea4ff41236c286a6",
    "E_ACTOR_CONTRACT"
  ]
];
  for (const [name,sha,code] of cases) {
    const source=readFileSync(new URL('./fixtures/typed-actor-bool-v1/'+name,import.meta.url),'utf8');
    assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(source,'utf8')+String.fromCharCode(0)).update(source,'utf8').digest('hex'),sha);
    reject(source,code);
  }
});
