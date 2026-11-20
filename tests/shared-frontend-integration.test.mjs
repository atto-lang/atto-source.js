import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transpile_to_worker,TranspileError} from '../src/transpile-worker.mjs';

// Executes actual generated ESM only within the trusted JS subset. These
// tests do not certify TenantVM isolation, native AOT, or other backends.
const fixture=(name)=>readFileSync(new URL(name,import.meta.url),'utf8');
const build=async source=>{
  const artifact=transpile_to_worker(source);
  assert.equal(artifact.trusted,true);
  const mod=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(artifact.module_source));
  return mod.create_tenant({tenant:'interop',generation:1});
};
const message=(value,wire_type='i64')=>{
  const buffer=new ArrayBuffer(wire_type==='i64'?8:1);
  const view=new DataView(buffer);
  if(wire_type==='i64')view.setBigInt64(0,BigInt(value),true);
  else view.setUint8(0,Number(value));
  return {actor_id:1,wire_type,buffer};
};
const rejects=(source,code)=>assert.throws(()=>transpile_to_worker(source),
  e=>e instanceof TranspileError&&e.code===code);

test('Result match arrow and caret return coexist with bitwise operators',async()=>{
  const original=fixture('./fixtures/trap-result-v1/parse-id-ok.atto');
  for(const source of [original,original.replace('return match','^ match')]){
    const guest=await build(source);
    assert.equal((await guest.on_message()).value,'42');
    await assert.rejects(guest.on_message(),/E_MAIN_ALREADY_CALLED/);
  }
  const invalid=original.replace('parse_id("42")','parse_id("invalid")')
    .replace('return match','^ match');
  assert.equal((await(await build(invalid)).on_message()).value,'0');
});

test('Result string tokens containing angle and caret operators remain literal data',async()=>{
  const source=fixture('./fixtures/trap-result-v1/parse-id-ok.atto')
    .replace('parse_id("42")','parse_id("<<< >>> ^^ << >> ^")');
  const guest=await build(source);
  assert.equal((await guest.on_message()).value,'0');
});

test('sealed inline actor state and Result arrows retain separate grammars',async()=>{
  const original=fixture('./fixtures/actor-attached-state-v1/pass/inline_counter.atto');
  for(const source of [original,original.replace('return 0;','^ 0;')]){
    const actor=await build(source);
    assert.equal((await actor.on_message()).value,'0');
    await assert.rejects(actor.on_route(message(2)),/E_ADMISSION_PENDING/);
    assert.equal((await actor.on_drain()).stdout,'1\n');
    assert.equal((await actor.on_route(message(2))).stdout,'3\n');
    await assert.rejects(actor.on_route({...message(2),wire_type:'control'}),/E_ROUTE_WIRE/);
    await actor.on_stop();
    await assert.rejects(actor.on_route(message(1)),/E_ACTOR_RETIRED/);
  }
});

test('typed Boolean actor and caret main cannot elevate DATA to CONTROL',async()=>{
  const src='define actor Counter receives bool sends never as '+
    'let bool total = false; receive(ActorMail<bool> mail): void {'+
    'self.total = mail.value; stdio.println(self.total); return; } end '+
    'pub fnc main(): int { val counter = spawn Counter(); ^ 0; }';
  const actor=await build(src);
  assert.equal((await actor.on_message()).value,'0');
  assert.equal((await actor.on_route(message(1,'bool'))).stdout,'true\n');
  await assert.rejects(actor.on_route({...message(0,'bool'),wire_type:'control'}),/E_ROUTE_WIRE/);
});

test('nested Mutex generic closer cannot be mistaken for stream read',()=>{
  const base='pub fnc main(): int { val item = ';
  rejects(base+'Mutex<Option<int>>(0); return 0; }','E_NEW_REQUIRED');
  rejects(base+'new Mutex<Option<int>>(0); return 0; }','E_LOCK_UNSUPPORTED');
  rejects('pub fnc main(): int { return 8 >> 2; }','E_IO_UNSUPPORTED');
  rejects('pub fnc main(): int { return 8 << 2; }','E_IO_UNSUPPORTED');
});

test('single caret is statement return, not an infix or power operator',async()=>{
  const guest=await build('pub fnc main(): int { ^ 12 ^^ 10; }');
  assert.equal((await guest.on_message()).value,'6');
  rejects('pub fnc main(): int { return 12 ^ 10; }','E_UNSUPPORTED_SYNTAX');
  rejects('pub fnc main(): int { ^; }','E_UNSUPPORTED_EXPRESSION');
  rejects('pub fnc main(): int { return (^ 5); }','E_UNSUPPORTED_EXPRESSION');
});

test('raw control and line separator rules precede every subcompiler',()=>{
  const scalar='pub fnc main(): int { ^ 42; }';
  for(const ending of ['\r','\n','\u0085','\u2028','\u2029'])
    assert.equal(transpile_to_worker('// ^ >> <<<'+ending+scalar).trusted,true);
  for(const ch of ['\0','\x1b','\x7f','\u202e','\ud800'])
    assert.throws(()=>transpile_to_worker('//'+ch+'\n'+scalar),
      e=>e instanceof TranspileError);
});
