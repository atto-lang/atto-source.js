// Proposed schema-manifest AOT emitter. No actor source admission, disk
// authority, dynamic code generation in the emitted module, or v1 fallback.
const FIELD_MAX=16384,SNAPSHOT_MAX=65536;
const tags=Object.freeze({int:1,bool:2,string:3,bytes:4});
const deny=()=>{throw new Error('E_DURABLE_BOUNDED_SCHEMA_V2');};
function hash(b){let h=0xcbf29ce484222325n;for(const x of b)h=BigInt.asUintN(64,(h^BigInt(x))*0x100000001b3n);return h;}
export function compile_durable_bounded_codec_v2(actor,fields){
  // Trusted compiler-owned schema manifest, not a guest-controlled object.
  const name=n=>typeof n==='string'&&/^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(n);
  if(!name(actor)||!Array.isArray(fields)||fields.length>256)deny();
  const sig=[...new TextEncoder().encode('atto.actor.state.schema.v2'),0],seen=new Set(),types=[];
  const sized=n=>{const b=new TextEncoder().encode(n);sig.push(b.length,0,0,0,...b);};
  sized(actor);
  for(const field of fields){if(!field||!name(field.name)||seen.has(field.name)||!Object.hasOwn(tags,field.type))deny();seen.add(field.name);sized(field.name);types.push(tags[field.type]);sig.push(tags[field.type]);}
  const schema=hash(sig);
  const module_source=`const SCHEMA=${schema}n,TAGS=Object.freeze([${types.join(',')}]),FIELD_MAX=${FIELD_MAX},MAX=${SNAPSHOT_MAX};
const deny=()=>{throw new Error('E_DURABLE_BOUNDED_CHECKPOINT_V2');};
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const getter=(p,k)=>Function.prototype.call.bind(Object.getOwnPropertyDescriptor(p,k).get);
const length=getter(typed,'byteLength'),buffer=getter(typed,'buffer'),offset=getter(typed,'byteOffset'),kind=getter(typed,Symbol.toStringTag),ordinary=getter(ArrayBuffer.prototype,'byteLength');
function owned(input,max){try{const n=length(input);if(n>max||kind(input)!=='Uint8Array'||Object.getPrototypeOf(input)!==Uint8Array.prototype)deny();const b=buffer(input);ordinary(b);return new Uint8Array(new Uint8Array(b,offset(input),n));}catch{deny();}}
function hash(bytes){let h=0xcbf29ce484222325n;for(const b of bytes)h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);return h;}
function utf8(s){if(typeof s!=='string'||s.length>FIELD_MAX)deny();for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=s.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))deny();}else if(c>=0xdc00&&c<=0xdfff)deny();}const bytes=new TextEncoder().encode(s);if(bytes.length>FIELD_MAX)deny();return bytes;}
export function atto_encode_state_v2(...values){
 if(values.length!==TAGS.length)deny();const b=new Uint8Array(MAX),v=new DataView(b.buffer);b.set([65,84,84,79,83,84,48,50,2]);v.setBigUint64(9,SCHEMA,true);v.setUint16(17,TAGS.length,true);let p=19;
 const room=n=>{if(n>MAX-8-p)deny();};
 for(let i=0;i<TAGS.length;i++){const t=TAGS[i],x=values[i];room(1);b[p++]=t;
  if(t===1){if(typeof x!=='bigint'||x<-(1n<<63n)||x>(1n<<63n)-1n)deny();room(8);v.setBigInt64(p,x,true);p+=8;}
  else if(t===2){if(typeof x!=='boolean')deny();room(1);b[p++]=x?1:0;}
  else{const raw=t===3?utf8(x):owned(x,FIELD_MAX);room(4+raw.length);v.setUint32(p,raw.length,true);p+=4;b.set(raw,p);p+=raw.length;}
 }
 v.setBigUint64(p,hash(b.subarray(0,p)),true);return b.slice(0,p+8);
}
export function atto_decode_state_v2(input){
 const b=owned(input,MAX);if(b.length<27)deny();const v=new DataView(b.buffer),end=b.length-8;
 if([65,84,84,79,83,84,48,50,2].some((x,i)=>b[i]!==x)||v.getBigUint64(9,true)!==SCHEMA||v.getUint16(17,true)!==TAGS.length||v.getBigUint64(end,true)!==hash(b.subarray(0,end)))deny();
 const out=[];let p=19;const room=n=>{if(n>end-p)deny();};
 for(const t of TAGS){room(1);if(b[p++]!==t)deny();if(t===1){room(8);out.push(v.getBigInt64(p,true));p+=8;}else if(t===2){room(1);const x=b[p++];if(x>1)deny();out.push(x===1);}else{room(4);const n=v.getUint32(p,true);p+=4;if(n>FIELD_MAX)deny();room(n);const bytes=b.slice(p,p+n);p+=n;if(t===3){try{out.push(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{deny();}}else out.push(bytes);}}
 if(p!==end)deny();return out;
}
`;
  return {guest_abi:'atto.js.durable.bounded-codec.v2.draft',schema_id:schema.toString(16).padStart(16,'0'),module_source};
}
