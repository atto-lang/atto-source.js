import test from 'node:test';
import assert from 'node:assert/strict';
import {compile_durable_bounded_codec_v2 as compile} from '../src/durable-bounded-codec-v2.mjs';
const fields=[{name:'count',type:'int'},{name:'open',type:'bool'},{name:'name',type:'string'},{name:'payload',type:'bytes'}];
async function guest(actor='Ledger',schema=fields){const c=compile(actor,schema);return {c,m:await import('data:text/javascript;base64,'+Buffer.from(c.module_source).toString('base64'))};}
const min=-(1n<<63n),max=(1n<<63n)-1n;
const hex=b=>Buffer.from(b).toString('hex');
const golden='4154544f53543032025b193c24a8de14db0400010000000000000080020103080000004100c3a9f09f9880040300000000ff8074c4cc420e041ac0';
function rehash(b){let h=0xcbf29ce484222325n;for(const x of b.subarray(0,b.length-8))h=BigInt.asUintN(64,(h^BigInt(x))*0x100000001b3n);new DataView(b.buffer).setBigUint64(b.length-8,h,true);}
test('actual emitted codec matches independent C++ golden and round trips',async()=>{
 const {c,m}=await guest();assert.equal(c.schema_id,'db14dea8243c195b');assert.equal(c.module_source,compile('Ledger',fields).module_source);
 const enc=m.atto_encode_state_v2,dec=m.atto_decode_state_v2;
 const v=[min,true,'A\0é😀',new Uint8Array([0,255,128])],b=enc(...v);assert.equal(hex(b),golden);assert.deepEqual(dec(b),v);
 for(let i=-5000n;i<=5000n;i++){const x=[i,i%2n===0n,'a'.repeat(Number((i+5000n)%257n)),new Uint8Array([Number(BigInt.asUintN(8,i)),0,255])];assert.deepEqual(dec(enc(...x)),x);}
 for(const s of ['','\ufeffa','e\u0301','é','\u0000','\u{10ffff}'])assert.equal(dec(enc(max,false,s,new Uint8Array()))[2],s);
 const r=dec(b);r[3].fill(5);assert.equal(hex(b),golden);v[3].fill(9);assert.equal(hex(b),golden);
});
test('bounds, corruption and invalid Unicode cannot pass even with valid checksum',async()=>{
 const {m}=await guest(),enc=m.atto_encode_state_v2,dec=m.atto_decode_state_v2,b=Uint8Array.from(Buffer.from(golden,'hex'));
 for(let i=0;i<b.length;i++){assert.throws(()=>dec(b.slice(0,i)));for(let bit=0;bit<8;bit++){const bad=b.slice();bad[i]^=1<<bit;assert.throws(()=>dec(bad));}}
 for(const mutate of [x=>x[8]=1,x=>x[29]=2,x=>x.fill(255,31,35),x=>x[37]=0xc0]){const bad=b.slice();mutate(bad);rehash(bad);assert.throws(()=>dec(bad));}
 const trailing=new Uint8Array(b.length+1);trailing.set(b.subarray(0,-8));rehash(trailing);assert.throws(()=>dec(trailing));
 for(const s of ['\ud800','\udc00','a\ud800b','😀'.repeat(4097),'a'.repeat(16385)])assert.throws(()=>enc(0n,false,s,new Uint8Array()));
 for(const x of [new Uint8Array(16385),new Uint8Array(new SharedArrayBuffer(1)),new Uint8ClampedArray(1)])assert.throws(()=>enc(0n,false,'',x));
 let traps=0;assert.throws(()=>dec(new Proxy(b,{getPrototypeOf(){traps++;return Uint8Array.prototype;}})));assert.equal(traps,0);
 const forged=new Uint8ClampedArray(b);Object.setPrototypeOf(forged,Uint8Array.prototype);assert.throws(()=>dec(forged));
 assert.throws(()=>dec(new Uint8Array(65537)));assert.throws(()=>dec(new Uint8Array(new SharedArrayBuffer(b.length))));
 assert.throws(()=>enc(0,false,'',new Uint8Array()));assert.throws(()=>enc(0n,1,'',new Uint8Array()));assert.throws(()=>enc(min-1n,true,'',new Uint8Array()));assert.throws(()=>enc(max+1n,true,'',new Uint8Array()));
 assert.equal(dec(enc(0n,false,'a'.repeat(16384),new Uint8Array(16384)))[2].length,16384);
 const wrong=await guest('Other');assert.throws(()=>wrong.m.atto_decode_state_v2(b));
});
test('aggregate size, field count and schema constraints',async()=>{
 const {m}=await guest('Large',['a','b','c','d'].map(name=>({name,type:'bytes'})));const x=[16384,16384,16384,16337].map(n=>new Uint8Array(n));const b=m.atto_encode_state_v2(...x);assert.equal(b.length,65536);assert.deepEqual(m.atto_decode_state_v2(b),x);x[3]=new Uint8Array(16338);assert.throws(()=>m.atto_encode_state_v2(...x));
 const schema=Array.from({length:256},(_,i)=>({name:'f'+i,type:'bool'}));const many=await guest('Many',schema),v=Array(256).fill(true);assert.deepEqual(many.m.atto_decode_state_v2(many.m.atto_encode_state_v2(...v)),v);assert.throws(()=>compile('Many',[...schema,{name:'extra',type:'bool'}]));
 for(const f of [[fields[0],fields[0]],[{name:'bad name',type:'int'}],[{name:'a',type:'constructor'}]])assert.throws(()=>compile('Bad',f));
 const empty=await guest('Empty',[]);assert.equal(empty.m.atto_encode_state_v2().length,27);assert.deepEqual(empty.m.atto_decode_state_v2(empty.m.atto_encode_state_v2()),[]);
});
