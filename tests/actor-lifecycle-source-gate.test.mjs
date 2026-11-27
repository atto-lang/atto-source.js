// Actual strict JS compiler frontend: stable lifecycle diagnostics and
// source->NO GUEST guarantees for actor features not yet lowered.
// A host graph-planner "pass" is never a compiled actor runtime pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

const scalar='pub fnc main(): int { return 42; }';
const actor=`define actor Counter receives int as
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
}`;
const fail=(source,code)=>{
  assert.throws(()=>transpile_to_worker(source),
    error=>error instanceof TranspileError&&error.code===code,
    'unsupported actor source must emit no module: '+code);
};

test('pipe and rpipe contextual forms cannot become a generated JS guest',()=>{
  for(const op of ['pipe','pipe!','rpipe','rpipe!']){
    fail('pub fnc main(): int { val link = p '+op+' c; return 0; }',
      'E_UNSUPPORTED_CONTINUOUS_PIPE');
  }
  fail('pub fnc main(): int { val link = c rpipe! p; return 0; }',
    'E_UNSUPPORTED_CONTINUOUS_PIPE');
});

test('graceful stop! is explicit unsupported, never silent force-stop',()=>{
  for(const spacing of ['stop! worker','stop!\tworker']){
    fail('pub fnc main(): int { '+spacing+'; return 0; }',
      'E_STOP_BACKEND_UNSUPPORTED');
  }
  fail('pub fnc main(): int { stop!worker; return 0; }',
    'E_BANG_KEYWORD_WHITESPACE');
  // Separated stop ! has no contextual bang meaning.
  fail('pub fnc main(): int { stop ! worker; return 0; }',
    'E_UNSUPPORTED_SYNTAX');
});

test('get_ready and get_done methods produce distinct unlowered Future diagnostics',()=>{
  fail('pub fnc main(): int { await worker.get_ready(); return 0; }',
    'E_UNSUPPORTED_ACTOR_READY_FUTURE');
  fail('pub fnc main(): int { await worker.get_done(); return 0; }',
    'E_UNSUPPORTED_ACTOR_DONE_FUTURE');
  fail('pub fnc main(): int { val task = worker.get_ready(); return 0; }',
    'E_UNSUPPORTED_ACTOR_READY_FUTURE');
});

test('property aliases ready and done do not silently replace method calls',()=>{
  fail('pub fnc main(): int { val task = worker.ready; return 0; }',
    'E_UNSUPPORTED_ACTOR_LIFECYCLE_PROPERTY');
  fail('pub fnc main(): int { val task = worker.done; return 0; }',
    'E_UNSUPPORTED_ACTOR_LIFECYCLE_PROPERTY');
});

test('inert comments do not trigger context-sensitive lifecycle diagnostics',()=>{
  const good='// stop! worker; x pipe! y; await x.get_ready(); x.done;\n'+scalar;
  const artifact=transpile_to_worker(good);
  assert.equal(artifact.backend,'js');
  assert.equal(typeof artifact.module_source,'string');
  assert.ok(artifact.module_source.includes('create_tenant'));
  // No "pipe" false positive inside an ordinary identifier.
  assert.ok(transpile_to_worker('// pipeline_ready\n'+scalar).module_source);
});

test('strict JS actor subset still generates the previously admitted worker guest',()=>{
  const generated=transpile_to_worker(actor);
  assert.equal(generated.backend,'js');
  assert.equal(generated.guest_abi,'atto.js.browser.actor-subset.v1');
  assert.ok(generated.module_source.includes('on_route'));
});
