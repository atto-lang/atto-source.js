import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeCacheKey,sealReceipt,verifyReceipt,makeLedgerRecord,admitLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
const hs=Array.from({length:10},(_,i)=>i.toString(16).padStart(2,'0').repeat(32));
const deps=[{identity:'@org/project/b',digest:hs[7]},{identity:'@org/project/c',digest:hs[8]}];
const input={stage:'typed-ir',owner:'@org/project/a',unitKind:'namespace',unit:'network',compiler:hs[1],toolchain:hs[2],target:hs[3],configuration:hs[4],sources:hs[5],bindings:hs[6],generated:null,dependencies:deps};
const key='6d0658c41d4e45ede029ca0c7654333c5aa0bc117f3179f12832aa7b1d22b657';
const secret=Buffer.from(Array.from({length:32},(_,i)=>i)),payload=Buffer.from('6174746f2d61727469666163742d763100ff','hex');
test('canonical cache key and hostile metadata',()=>{
 assert.equal(encodeCacheKey(input),key);assert.equal(encodeCacheKey({...input,dependencies:[...deps].reverse()}),key);
 for(const field of ['compiler','toolchain','target','configuration','sources','bindings'])assert.notEqual(encodeCacheKey({...input,[field]:hs[9]}),key);
 assert.notEqual(encodeCacheKey({...input,generated:hs[0]}),key);
 for(const bad of [{...input,owner:'x\n'},{...input,owner:'é'},{...input,compiler:'F'.repeat(64)},{...input,dependencies:[deps[0],deps[0]]},{...input,dependencies:Array(129).fill(deps[0])},{...input,generated:undefined},{...input,unitKind:'package'}])assert.throws(()=>encodeCacheKey(bad),/E_CACHE_KEY/);
 let invoked=false;const accessor={...input,get owner(){invoked=true;return input.owner;}};assert.throws(()=>encodeCacheKey(accessor));assert.equal(invoked,false);
 const proxy=new Proxy(input,{ownKeys(){invoked=true;throw Error('trap');}});assert.throws(()=>encodeCacheKey(proxy));assert.equal(invoked,false);
});
test('canonical authenticated envelope and tamper rejection',()=>{
 const receipt=sealReceipt(key,payload,secret);assert.equal(receipt.subarray(80,112).toString('hex'),'3653396c79c689b07bb08274d60b4de17d57d0c9dd4fd22180aa7af88940b524');
 assert.deepEqual(verifyReceipt(key,receipt,secret),payload);
 for(const i of [0,8,40,48,80,112,receipt.length-1]){const bad=Buffer.from(receipt);bad[i]^=1;assert.throws(()=>verifyReceipt(key,bad,secret),/E_CACHE_RECEIPT/);}
 const forged=Buffer.from(receipt);forged[112]^=1;createHash('sha256').update(forged.subarray(112)).digest().copy(forged,48);assert.throws(()=>verifyReceipt(key,forged,secret));
 assert.throws(()=>verifyReceipt(hs[0],receipt,secret));assert.throws(()=>verifyReceipt(key,receipt,Buffer.alloc(32)));assert.throws(()=>verifyReceipt(key,Buffer.concat([receipt,Buffer.alloc(1)]),secret));
 assert.throws(()=>sealReceipt(key,Buffer.alloc(4*1024*1024+1),secret));assert.throws(()=>sealReceipt(key,Buffer.from(new SharedArrayBuffer(16)),secret));
 const copy=verifyReceipt(key,receipt,secret);copy[0]^=1;assert.deepEqual(verifyReceipt(key,receipt,secret),payload);
 console.log('CACHE_NODE_ENVELOPE|canonical-vector|forgery-rejected|shared-backing-denied|defensive-copy');
});

test('canonical current ledger pin and epoch revocation',()=>{
 const hash=b=>createHash('sha256').update(b).digest(), master=Buffer.alloc(32,7);
 const record=makeLedgerRecord('tenant/a',2n,master),pin=hash(record);
 assert.equal(record.toString('hex'),'4154544f4c4544310000000874656e616e742f610000000000000002a63c8f18ca3245c9d319f61b2ca45a2a6605ea3293664ad236792133ce088462');
 assert.equal(pin.toString('hex'),'95c69714073e8a9a4c845fa54d0f87706f718fed1f5879016723780618b83309');
 const current=admitLedgerRecord('tenant/a',record,pin,master);
 assert.equal(current.toString('hex'),'d2153371616fc59b235d24aff7417a37fea38a6fdc5391503a54ea33f429a90e');
 const old=makeLedgerRecord('tenant/a',1n,secret),prior=admitLedgerRecord('tenant/a',old,hash(old),secret);
 assert.throws(()=>verifyReceipt(key,sealReceipt(key,payload,prior),current),/E_CACHE_RECEIPT/);
 const deny=fn=>assert.throws(fn,/E_CACHE_LEDGER/);
 deny(()=>admitLedgerRecord('tenant/a',old,pin,secret));
 deny(()=>admitLedgerRecord('tenant/b',record,pin,master));
 deny(()=>admitLedgerRecord('tenant/a',record,pin,secret));
 deny(()=>admitLedgerRecord('tenant/a',record,Buffer.from(new SharedArrayBuffer(32)),master));
 deny(()=>admitLedgerRecord('tenant/a',record,pin,Buffer.from(new SharedArrayBuffer(32))));
 for(const i of [0,8,12,20,record.length-1]){const bad=Buffer.from(record);bad[i]^=1;deny(()=>admitLedgerRecord('tenant/a',bad,pin,master));}
 for(const n of [0,1,record.length-1,record.length+1,565])deny(()=>admitLedgerRecord('tenant/a',Buffer.alloc(n),pin,master));
 for(const epoch of [0n,-1n,2,0x10000000000000000n])deny(()=>makeLedgerRecord('tenant/a',epoch,master));
 deny(()=>makeLedgerRecord('tenant/a',2n,Buffer.alloc(32)));
 deny(()=>makeLedgerRecord('tenant\n/a',2n,master));
 const high=makeLedgerRecord('tenant/a',0xffffffffffffffffn,master);
 assert.equal(admitLedgerRecord('tenant/a',high,hash(high),master).length,32);
 console.log('CACHE_LEDGER_NODE|canonical-vector|revoked-receipt-denied|stale-pin-denied|shared-backing-denied');
});
