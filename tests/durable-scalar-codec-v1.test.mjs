import test from 'node:test';
import assert from 'node:assert/strict';
import {compile_durable_scalar_codec_v1 as compile} from '../src/durable-scalar-codec-v1.mjs';
const source='define durable actor Ledger as state balance: int = -9223372036854775808; state open: bool = true; state last: int = 9223372036854775807; end';
const golden='4154544f5354303101f9b8eff04a5474590300010000000000000080020101ffffffffffffff7f4191e1156e4df645';
async function guest(s=source){const c=compile(s);assert.equal(c.guest_abi,'atto.js.durable.scalar-codec.v1');assert.equal(c.trusted,undefined);return {c,m:await import('data:text/javascript;base64,'+Buffer.from(c.module_source).toString('base64'))};}
const hex=b=>Buffer.from(b).toString('hex');
const min=-(1n<<63n),max=(1n<<63n)-1n;
function rehash(b){let h=0xcbf29ce484222325n;for(const x of b.subarray(0,b.length-8))h=BigInt.asUintN(64,(h^BigInt(x))*0x100000001b3n);new DataView(b.buffer).setBigUint64(b.length-8,h,true);}
test('actual emitted JS codec matches golden and all 10001 round trips',async()=>{
 const {c,m}=await guest();assert.equal(c.schema_id,'5974544af0efb8f9');assert.equal(c.module_source,compile(source).module_source);
 const b=m.atto_initial_state_v1();assert.equal(hex(b),golden);assert.deepEqual(m.atto_decode_state_v1(b),[min,true,max]);
 b.fill(0);assert.equal(hex(m.atto_initial_state_v1()),golden);
 for(let i=-5000n;i<=5000n;i++){const v=[i,i%2n===0n,-i];assert.deepEqual(m.atto_decode_state_v1(m.atto_encode_state_v1(...v)),v);}
 const other=await guest(source.replace('balance','renamed'));assert.throws(()=>other.m.atto_decode_state_v1(m.atto_initial_state_v1()));
});
test('rejects torn, corrupt, noncanonical and aliased input',async()=>{
 const {m}=await guest(),b=m.atto_initial_state_v1(),dec=m.atto_decode_state_v1;
 for(let i=0;i<b.length;i++){assert.throws(()=>dec(b.slice(0,i)));for(let bit=0;bit<8;bit++){const bad=b.slice();bad[i]^=1<<bit;assert.throws(()=>dec(bad));}}
 const bad=b.slice();bad[29]=2;rehash(bad);assert.throws(()=>dec(bad));
 assert.throws(()=>dec(new Uint8Array(b.length+1)));assert.throws(()=>dec(new Proxy(b,{})));assert.throws(()=>dec(new Uint8Array(new SharedArrayBuffer(b.length))));
 let traps=0;assert.throws(()=>dec(new Proxy(b,{getPrototypeOf(){traps++;return Uint8Array.prototype;}})));assert.equal(traps,0);
 const forged=new Uint8ClampedArray(b);Object.setPrototypeOf(forged,Uint8Array.prototype);assert.throws(()=>dec(forged));
 assert.throws(()=>dec(new Uint16Array(b.length)));assert.throws(()=>dec({byteLength:b.length}));
 for(const v of [[0,true,0n],[0n,1,0n],[min-1n,true,0n],[0n,false,max+1n],[0n,true]])assert.throws(()=>m.atto_encode_state_v1(...v));
 const offset=new Uint8Array(b.length+2);offset.set(b,1);assert.deepEqual(dec(offset.subarray(1,-1)),[min,true,max]);
});
test('schema source is bounded and complete; 256 fields and empty schema work',async()=>{
 for(const s of [source.replace('durable','persistent'),source.replace('durable ',''),source.replace('balance','self'),source.replace('state last','state balance'),source.replace('int = -9223372036854775808','int = -9223372036854775809'),source.replace('9223372036854775807','9223372036854775808'),source.replace('bool = true','bool = 1'),source.replace('bool = true','Socket = true'),source+' fnc main(): int {return 0;}',source+' // comment',source+'\u0000',source.replace('Ledger','"Ledger"'),source.replace('int = -9223372036854775808','int = 00')])assert.throws(()=>compile(s),/E_DURABLE_SCALAR_SCHEMA_V1/);
 const empty=await guest('define durable actor EmptyActor as end');assert.equal(hex(empty.m.atto_initial_state_v1()),'4154544f5354303101c3fbc65066197bff0000b3c015f0f5029da5');
 const fields=Array.from({length:256},(_,i)=>`state f${i}: int = ${i};`).join(' ');
 const large=await guest('define durable actor Maximum as '+fields+' end');assert.equal(large.m.atto_initial_state_v1().length,2331);assert.deepEqual(large.m.atto_decode_state_v1(large.m.atto_initial_state_v1()),Array.from({length:256},(_,i)=>BigInt(i)));
 assert.throws(()=>compile('define durable actor Maximum as '+fields+' state extra: bool = true; end'));
});

test('all four shared wire vectors match emitted code',async()=>{
 for(const [s,expected] of [
  ['define durable actor Counter as state count: int = 100; state enabled: bool = true; end','4154544f5354303101c9a1af17fc8684bd020001640000000000000002018fd7fcf2f2744e29'],
  ['define durable actor Counter as state count: int = -9223372036854775808; state enabled: bool = false; end','4154544f5354303101c9a1af17fc8684bd0200010000000000000080020058ebbfc357901b30'],
  ['define durable actor EmptyActor as end','4154544f5354303101c3fbc65066197bff0000b3c015f0f5029da5'],
  ['define durable actor OtherCounter as state count: int = 100; end','4154544f53543031010201d7f4b9c36b6c0100016400000000000000eb0202552d636527']
 ]){const {m}=await guest(s);const b=m.atto_initial_state_v1();assert.equal(hex(b),expected);assert.equal(hex(m.atto_encode_state_v1(...m.atto_decode_state_v1(b))),expected);}
});
