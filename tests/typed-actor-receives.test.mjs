import test from 'node:test';
import assert from 'node:assert/strict';
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
           'E_ACTOR_RECEIVES_MISMATCH');
  reject(baseline.replace('Counter as','Counter receives never as'),
         'E_ACTOR_RECEIVES_NEVER_UNSUPPORTED');
  reject(baseline.replace('Counter as','Counter receives int receives int as'),
         'E_UNSUPPORTED_ACTOR_SYNTAX');
});

test('unproved sends/emits effect headers fail closed before JavaScript generation', () => {
  for (const header of ['Counter', 'Counter receives int']) {
    const with_sends = baseline.replace('Counter as', `${header} sends int as`);
    const with_emits = baseline.replace('Counter as', `${header} emits int as`);
    reject(with_sends, 'E_ACTOR_SENDS_EFFECT_UNSUPPORTED');
    reject(with_emits, 'E_ACTOR_EMITS_EFFECT_UNSUPPORTED');
  }
});

test('unsupported unions and rewritten payloads cannot masquerade as typed ingress', () => {
  reject(with_header.replace('receives int as','receives int | String as'),
         'E_UNSUPPORTED_TOKEN');
  reject(with_header.replace('ActorMail<int>','ActorMail<bool>'),
         'E_UNSUPPORTED_ACTOR_SYNTAX');
});
