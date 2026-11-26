import assert from 'node:assert/strict';
import test from 'node:test';
import {compile_durable_bounded_receive_v2 as compile} from '../src/durable-bounded-receive-v2.mjs';
const source='define durable actor Ledger as state count: int = 0; state name: string = ""; receive(ActorMail<string> mail) -> void { self.count = self.count + 1; self.name = mail.value; } end';
const c=compile(source);
const m=await import('data:text/javascript;base64,'+Buffer.from(c.module_source).toString('base64'));
test('compiled restricted receive updates both fields without mutating input',()=>{
 assert.equal(c.guest_abi,'atto.js.durable.bounded-receive.v2.draft');
 assert.equal(compile('\n'+source+'\t').module_source,c.module_source);
 let b=m.atto_initial_state_v2();assert.deepEqual(m.atto_decode_state_v2(b),[0n,'']);
 for(let i=1;i<=10001;i++){const original=b.slice(),mail='é😀\0'+i;b=m.atto_receive_v2(b,mail);assert.deepEqual(m.atto_decode_state_v2(b),[BigInt(i),mail]);assert.deepEqual(m.atto_decode_state_v2(original),[BigInt(i-1),i===1?'':'é😀\0'+(i-1)]);}
});
test('bad source and checkpoint or mail fail closed',()=>{
 for(const s of [source.replace('durable','persistent'),source.replace('Ledger','Other'),source.replace(' + 1',' + 2'),source.replace('mail.value','self.name'),source+' fnc main():int{return 1;}',source+' // comment',source.replace('->','- >'),source.replace('""','"x"'),source.replace('string>','int>'),source.replace('self.name = mail.value;',''),source+'\u0000'])assert.throws(()=>compile(s),/E_DURABLE_BOUNDED_RECEIVE_V2/);
 const b=m.atto_initial_state_v2();for(const mail of [null,42,new String('x'),'\ud800','a'.repeat(16385)])assert.throws(()=>m.atto_receive_v2(b,mail));
 for(const n of [-1n,(1n<<63n)-1n])assert.throws(()=>m.atto_receive_v2(m.atto_encode_state_v2(n,'old'),'new'));
 for(let i=0;i<b.length;i++){const bad=b.slice();bad[i]^=1;assert.throws(()=>m.atto_receive_v2(bad,'new'));}
 assert.deepEqual(m.atto_decode_state_v2(b),[0n,'']);
 assert.deepEqual(m.atto_decode_state_v2(m.atto_receive_v2(b,'a'.repeat(16384))),[1n,'a'.repeat(16384)]);
});
