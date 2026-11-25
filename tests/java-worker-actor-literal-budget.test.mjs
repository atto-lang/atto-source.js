import test from 'node:test';
import assert from 'node:assert/strict';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// This trusted actor subset accepts only a bounded signed-i64 initializer.
// Long source literals must be range-checked before allocating a huge BigInt.
const actor=initial=>[
  'define actor Counter as let int total='+initial+';',
  'receive(ActorMail<int> mail):void{',
  'self.total=self.total+mail.value;stdio.println(self.total);^;',
  '} end pub fnc main():int{val counter=spawn Counter();^0;}'
].join(' ');

const build=initial=>transpile_to_worker(actor(initial));
const run=async initial=>{
  const artifact=build(initial);
  assert.equal(artifact.guest_abi,'atto.js.browser.actor-subset.v1');
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(artifact.module_source));
  const runtime=await mod.create_tenant({tenant:'actor-literal',generation:1});
  assert.equal((await runtime.on_message()).value,'0');
  return {artifact,runtime};
};
const wire=value=>{
  const buffer=new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0,value,true);
  return {actor_id:1,wire_type:'i64',buffer};
};

test('actor literal bounds preserve signed-i64 and leading-zero semantics',async()=>{
  for(const [source,initial] of [
    ['0',0n],['00042',42n],
    ['0'.repeat(4096)+'42',42n],
    ['9223372036854775807',9223372036854775807n],
    ['-9223372036854775808',-9223372036854775808n]
  ]){
    const {artifact,runtime}=await run(source);
    assert.match(artifact.module_source,new RegExp('let total='+initial+'n;'));
    assert.equal((await runtime.on_route(wire(0n))).stdout,initial+'\n');
  }
});

test('actor literal overflow fails closed before BigInt materialization',()=>{
  const rejected=[
    '9223372036854775808',
    '-9223372036854775809',
    '9'.repeat(60000),
    '-9'.repeat(60000),
    '0'.repeat(4096)+'9223372036854775808'
  ];
  for(const value of rejected)
    assert.throws(()=>build(value),error=>error instanceof TranspileError&&error.code==='E_INT_OVERFLOW');
  assert.throws(()=>build('9'.repeat(66000)),error=>error instanceof TranspileError&&error.code==='E_SOURCE_LIMIT');
});

test('actor overflow panic leaves owned state unchanged after rejected message',async()=>{
  const {runtime}=await run('9223372036854775807');
  await assert.rejects(runtime.on_route(wire(1n)),error=>
    error?.message==='E_GUEST_PANIC_1'&&
    error.actor_failure?.kind==='panic'&&
    error.actor_failure.actor_id===1&&error.actor_failure.parent_id===0);
  assert.equal((await runtime.on_route(wire(-1n))).stdout,'9223372036854775806\n');
});
