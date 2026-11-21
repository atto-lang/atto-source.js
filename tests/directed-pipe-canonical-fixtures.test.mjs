// Exact-byte shared .atto conformance inputs. JS currently has no continuous
// actor-channel-stream guest transport; all must fail CLOSED before JS codegen.
// This is *not* evidence of successful guest pipeline parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

const vectors={
  'actor-forward':'dd59abdb707d05dabac30139feb4bd03b60459d1',
  'actor-reverse':'da3d759d56aac4cfd6919521df862edb594f426f',
  'actor-missing-emits':'6755a01ce43f7ac33f64d86d43dff7c7257185ca',
  'actor-wrong-direction':'12ee1a935c43477213604593d73b0cecf761fead',
  'mixed-channel-stream-forward':'6e2528f7c4b278c0fff9671c8c5985bfbd94adb1',
  'mixed-channel-stream-reverse':'060b61b80cfb3946a9510edd1190be6256212424',
  'actor-duplicate-direction':'d738937d72c791c41d55f088eaed65a5f9ed224f',
  'actor-mixed-directions':'1addd9cc44879d24f7e76b2d5eb69d6837a711ab',
  'stopped-source':'cdfa3473793a0eed556288db06ebaa3ed8f9d4c7',
  'closed-channel':'523e0da79a1e373c03c1ef216259b34c0b0c0889',
  'stopped-consumer':'8896a1bf0aef74926be291ace2d86ecf852985b1',
  'stopped-actor-sink':'329661c81fa4bb832fcacbbff5a4fb068e1bb6dd',
};
test('all twelve canonical .atto fixtures have exact source Git blob hashes',()=>{
  assert.equal(Object.keys(vectors).length,12);
  for(const [name,expected] of Object.entries(vectors)){
    const source=readFileSync(new URL(
      './fixtures/conformance/pipe-rpipe-v1/'+name+'.atto',import.meta.url));
    const gitHash=createHash('sha1')
      .update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
    assert.equal(gitHash,expected,name+': source bytes changed since platform-conformance #102');
  }
});
test('JS compiler fails closed on all canonical typed pipe/rpipe guest programs',()=>{
  for(const name of Object.keys(vectors)){
    const source=readFileSync(new URL(
      './fixtures/conformance/pipe-rpipe-v1/'+name+'.atto',import.meta.url),'utf8');
    assert.throws(()=>transpile_to_worker(source),e=>
      e instanceof TranspileError && e.code==='E_UNSUPPORTED_CONTINUOUS_PIPE',
      name+': must not emit an unverified JavaScript actor/channel graph');
  }
});
test('comments mentioning continuous pipe/rpipe do not grant capabilities',()=>{
  const source='// producer pipe sink; consumer rpipe producer;\n'+
    'pub fnc main(): int { return 42; }';
  assert.equal(transpile_to_worker(source).backend,'js');
});
