// Trusted Node host only. This format is not source, storage, or execution
// authority. No guest imports and no browser signing. Secrets stay outside cache.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isProxy,isSharedArrayBuffer} from 'node:util/types';
const BAD='E_CACHE_KEY: invalid input', INVALID='E_CACHE_RECEIPT: invalid envelope';
const fail=(message=BAD)=>{throw new TypeError(message);};
const fields=['stage','owner','unitKind','unit','compiler','toolchain','target','configuration','sources','bindings','generated','dependencies'];
function record(value,keys){
 if(value===null||typeof value!=='object'||isProxy(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const desc=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(desc).length!==keys.length)fail();
 const out=Object.create(null);
 for(const key of keys){const d=desc[key];if(!d||!Object.hasOwn(d,'value'))fail();out[key]=d.value;}
 return out;
}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function id(s){if(typeof s!=='string'||s.length<1||s.length>512||/[^!-~]/.test(s))fail();return [u32(s.length),Buffer.from(s,'ascii')];}
function digest(s){if(typeof s!=='string'||s.length!==64||/[^0-9a-f]/.test(s))fail();return Buffer.from(s,'hex');}
function sha(bytes){return createHash('sha256').update(bytes).digest();}
export function encodeCacheKey(input){
 const x=record(input,fields);
 if(x.unitKind!=='namespace'&&x.unitKind!=='source-unit')fail();
 const d=x.dependencies;
 if(isProxy(d)||!Array.isArray(d)||Object.getPrototypeOf(d)!==Array.prototype||d.length>128)fail();
 const descriptors=Object.getOwnPropertyDescriptors(d);
 if(Reflect.ownKeys(descriptors).length!==d.length+1)fail();
 const deps=[];
 for(let i=0;i<d.length;i++){const field=descriptors[i];if(!field||!Object.hasOwn(field,'value'))fail();const dep=record(field.value,['identity','digest']);deps.push({name:dep.identity,id:id(dep.identity),hash:digest(dep.digest)});}
 deps.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 for(let i=1;i<deps.length;i++)if(deps[i-1].name===deps[i].name)fail();
 const out=[Buffer.from('atto.compiler.cache-key.v1\0','ascii')];
 for(const k of fields.slice(0,4))out.push(...id(x[k]));
 for(const k of fields.slice(4,10))out.push(digest(x[k]));
 if(x.generated===null)out.push(Buffer.from([0]));else out.push(Buffer.from([1]),digest(x.generated));
 out.push(u32(deps.length));for(const d of deps)out.push(...d.id,d.hash);
 return sha(Buffer.concat(out)).toString('hex');
}
// Use native typed-array slots, not attacker-overridable .buffer/.length
// properties or iterators. Reject shared backing; copy before hashing.
const slots=Object.getOwnPropertyDescriptors(Object.getPrototypeOf(Uint8Array.prototype));
function owned(input,max){
 if(isProxy(input)||!Buffer.isBuffer(input))fail(INVALID);
 let length,backing,offset;
 try{length=slots.byteLength.get.call(input);backing=slots.buffer.get.call(input);offset=slots.byteOffset.get.call(input);}catch{fail(INVALID);}
 if(length>max||isSharedArrayBuffer(backing))fail(INVALID);
 try{return Buffer.from(new Uint8Array(backing,offset,length));}catch{fail(INVALID);}
}
const HEADER=112,MAX=4*1024*1024,MAGIC=Buffer.from('ATTOCAC1');
const tag=(secret,header)=>createHmac('sha256',secret).update('atto.compiler.artifact-receipt.v1\0','ascii').update(header.subarray(0,80)).digest();
function keyBytes(key){try{return digest(key);}catch{fail(INVALID);}}
export function sealReceipt(key,artifact,secret){
 const k=keyBytes(key),p=owned(artifact,MAX),s=owned(secret,32);
 if(s.length!==32)fail(INVALID);
 try{const h=Buffer.alloc(HEADER);MAGIC.copy(h);k.copy(h,8);h.writeBigUInt64BE(BigInt(p.length),40);sha(p).copy(h,48);tag(s,h).copy(h,80);return Buffer.concat([h,p]);}
 finally{s.fill(0);}
}
export function verifyReceipt(key,envelope,secret){
 const k=keyBytes(key),b=owned(envelope,HEADER+MAX),s=owned(secret,32);
 if(s.length!==32)fail(INVALID);
 try{if(b.length<HEADER||!timingSafeEqual(MAGIC,b.subarray(0,8))||!timingSafeEqual(k,b.subarray(8,40))||
 b.readBigUInt64BE(40)!==BigInt(b.length-HEADER)||!timingSafeEqual(tag(s,b),b.subarray(80,112))||
 !timingSafeEqual(sha(b.subarray(HEADER)),b.subarray(48,80)))fail(INVALID);
 return Buffer.from(b.subarray(HEADER));}finally{s.fill(0);}
}

// Trusted host admission only: the current pin and master must be
// independently supplied. No durable authority or executable loading grant.
const LEDGER_BAD='E_CACHE_LEDGER: invalid or stale record';
const LEDGER_MAGIC=Buffer.from('ATTOLED1');
function ledgerScope(scope){
 try{return id(scope);}catch{fail(LEDGER_BAD);}
}
function ledgerBytes(value,max){
 try{return owned(value,max);}catch{fail(LEDGER_BAD);}
}
function ledgerEpoch(epoch){
 if(typeof epoch!=='bigint'||epoch<1n||epoch>0xffffffffffffffffn)fail(LEDGER_BAD);
 const b=Buffer.alloc(8);b.writeBigUInt64BE(epoch);return b;
}
function deriveLedgerKey(scope,epoch,master){
 const [length,name]=ledgerScope(scope),e=ledgerEpoch(epoch);
 const s=ledgerBytes(master,32);
 try{
  if(s.length!==32||timingSafeEqual(s,Buffer.alloc(32)))fail(LEDGER_BAD);
  return createHmac('sha256',s).update('atto.compiler.local-receipt-key.v1\0','ascii').update(length).update(name).update(e).digest();
 }finally{s.fill(0);}
}
export function makeLedgerRecord(scope,epoch,master){
 const [length,name]=ledgerScope(scope),e=ledgerEpoch(epoch);
 const k=deriveLedgerKey(scope,epoch,master);
 try{return Buffer.concat([LEDGER_MAGIC,length,name,e,sha(k)]);}finally{k.fill(0);}
}
export function admitLedgerRecord(scope,record,currentPin,master){
 const [length,name]=ledgerScope(scope),b=ledgerBytes(record,564),pin=ledgerBytes(currentPin,32);
 if(pin.length!==32||b.length!==52+name.length||!timingSafeEqual(sha(b),pin)||
    !timingSafeEqual(b.subarray(0,8),LEDGER_MAGIC)||!timingSafeEqual(b.subarray(8,12),length)||
    !timingSafeEqual(b.subarray(12,12+name.length),name))fail(LEDGER_BAD);
 const k=deriveLedgerKey(scope,b.readBigUInt64BE(12+name.length),master);
 if(!timingSafeEqual(sha(k),b.subarray(20+name.length))){k.fill(0);fail(LEDGER_BAD);}
 return k;
}
