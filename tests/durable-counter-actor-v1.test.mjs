import test from 'node:test';
import assert from 'node:assert/strict';
import {compile_durable_counter_actor_v1,transpile_to_worker} from '../src/transpile-worker.mjs';

const source=`define durable actor Counter as
    state count: int = 0;
    receive(ActorMail<int> mail) -> void {
        self.count = self.count + mail.value;
    }
end
`;
async function guest(text=source) {
  const c=compile_durable_counter_actor_v1(text);
  assert.equal(c.guest_abi,'atto.js.durable.counter.v1');
  assert.equal(c.trusted,undefined);
  return {c,m:await import('data:text/javascript;base64,'+Buffer.from(c.module_source).toString('base64'))};
}
function fnv(data) {
  let h=0xcbf29ce484222325n;
  for(const b of data)h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);
  return h;
}
function sized(b) {
  const len=Buffer.alloc(4);len.writeUInt32LE(b.length);
  return Buffer.concat([len,b]);
}
function verify(m,field) {
  const d=Buffer.from(m.atto_durable_state_v1());let i=0;
  assert.equal(d[i++],1);
  function take() {
    let len=0,shift=0,b;
    do{assert.ok(i<d.length&&shift<=28);b=d[i++];len+=(b&127)*2**shift;shift+=7;}while(b&128);
    assert.ok(len<=d.length-i);
    const out=d.subarray(i,i+len);i+=len;return out;
  }
  const actor=take(),name=take();
  assert.equal(actor.toString(),'Counter');assert.equal(name.toString(),field);
  assert.equal(d[i++],1);
  const snapshot=take();assert.equal(i,d.length);
  assert.equal(snapshot.length,36);
  assert.equal(snapshot.subarray(0,8).toString(),'ATTOST01');
  assert.equal(snapshot[8],1);
  assert.equal(snapshot.readBigUInt64LE(9),fnv(Buffer.concat([
    Buffer.from('atto.actor.state.schema.v1'),Buffer.from([0]),sized(actor),sized(name),Buffer.from([1])
  ])));
  assert.equal(snapshot.readUInt16LE(17),1);assert.equal(snapshot[19],1);
  assert.equal(snapshot.readBigInt64LE(20),0n);
  assert.equal(snapshot.readBigUInt64LE(28),fnv(snapshot.subarray(0,28)));
  return d;
}
test('actual emitted ESM executes the same bounded durable transition as Rust',async()=>{
  const {m}=await guest();
  assert.deepEqual(Object.keys(m).sort(),['atto_durable_state_v1','atto_durable_transition_v1']);
  const t=m.atto_durable_transition_v1;
  for(const [state,op,delta,result] of [
    [0n,1n,42n,42n],[42n,1n,5n,47n],[47n,2n,0n,47n],
    [999999999n,1n,1n,1000000000n],[1000000000n,1n,1n,-1n],
    [0n,1n,-1n,-1n],[-1n,1n,1n,-1n],[0n,3n,1n,-1n],
    [0n,2n,1n,-1n],[0n,1n,0n,-1n],[0n,1n,1000000001n,-1n]
  ])assert.equal(t(state,op,delta),result);
  assert.throws(()=>t(0,1n,1n),/E_DURABLE_COUNTER_ACTOR_ABI/);
});
test('generated schema bytes are deterministic and bind the field, not the parameter',async()=>{
  const first=await guest(),repeat=await guest();
  assert.equal(first.c.module_source,repeat.c.module_source);
  const d=verify(first.m,'count');
  const renamed=await guest(source.replaceAll('count','balance').replaceAll('mail','event'));
  assert.notDeepEqual(verify(renamed.m,'balance'),d);
  const mail=await guest(source.replaceAll('mail','event'));
  assert.deepEqual(verify(mail.m,'count'),d);
  const copy=first.m.atto_durable_state_v1();copy.fill(0);
  assert.deepEqual(verify(first.m,'count'),d);
});
test('unsupported durable syntax rejects with no guest and normal worker cannot admit it',()=>{
  for(const invalid of [
    source.replace('durable actor','actor'),
    source.replace('durable actor','persistent actor'),
    source.replace('= 0;','= 1;'),
    source.replace('state count','pub state count'),
    source.replace('self.count + mail.value','self.count - mail.value'),
    source.replace('mail.value','9'),
    source.replace('ActorMail<int>','ActorMail<bool>'),
    source.replace('self.count =','self.unknown ='),
    source.replace('receive(','pub receive('),
    source.replace('self.count = self.count + mail.value;','self.count = self.count + mail.value; self.count = 0;'),
    source+'\npub fnc main()->int {return 0;}',
    source.replaceAll('count','self')
  ])assert.throws(()=>compile_durable_counter_actor_v1(invalid),/E_DURABLE_COUNTER_ACTOR_ABI/);
  assert.throws(()=>transpile_to_worker(source));
  assert.throws(()=>compile_durable_counter_actor_v1(source+'//\u0000'),/E_RAW_SOURCE_CONTROL/);
});
