// Restricted schema-only compiler. Does not admit an executable actor or storage authority.
// No comments, imports, constructors, hooks or receive bodies in this profile.
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const deny=()=>{throw new Error('E_DURABLE_SCALAR_SCHEMA_V1');};
const reserved=new Set('define pub private durable persistent actor as state end int bool true false self receive init fnc mtd let val mut const return await suspends susp async critical using with import namespace module class struct contract enum new spawn stop if else match on default void'.split(' '));
function tokens(source){
  if(typeof source!=='string'||source.length>16384||/[^\x20-\x7e\t\r\n]/.test(source))deny();
  const out=[];
  for(let i=0;i<source.length;){
    const tail=source.slice(i),space=/^[ \t\r\n]+/.exec(tail);
    if(space){i+=space[0].length;continue;}
    const match=/^(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[:;=\-])/.exec(tail);
    if(!match||out.length>=4096)deny();
    out.push(match[0]);i+=match[0].length;
  }
  return out;
}
function fnv(bytes){let h=0xcbf29ce484222325n;for(const b of bytes)h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);return h;}
function schema_id(actor,fields){
  const enc=new TextEncoder(),sig=[...enc.encode('atto.actor.state.schema.v1'),0];
  const append=name=>{const b=enc.encode(name),len=new Uint8Array(4);new DataView(len.buffer).setUint32(0,b.length,true);sig.push(...len,...b);};
  append(actor);for(const field of fields){append(field.name);sig.push(field.tag);}
  return fnv(sig);
}
export function compile_durable_scalar_codec_v1(source){
  const ts=tokens(source);let i=0;
  const take=t=>{if(ts[i++]!==t)deny();};
  const name=()=>{const t=ts[i++];if(!/^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(t??'')||reserved.has(t))deny();return t;};
  take('define');take('durable');take('actor');const actor=name();take('as');
  const fields=[],seen=new Set();
  while(ts[i]==='state'){
    if(fields.length>=256)deny();
    take('state');const field=name();if(seen.has(field))deny();seen.add(field);take(':');
    const type=ts[i++];take('=');let initial,tag;
    if(type==='int'){
      let negative=false;if(ts[i]==='-'){i++;negative=true;}
      const literal=ts[i++];if(!/^(?:0|[1-9][0-9]{0,18})$/.test(literal??''))deny();
      initial=BigInt(literal)*(negative?-1n:1n);if(initial<MIN||initial>MAX)deny();tag=1;
    }else if(type==='bool'){
      const literal=ts[i++];if(literal!=='true'&&literal!=='false')deny();initial=literal==='true';tag=2;
    }else deny();
    take(';');fields.push({name:field,tag,initial});
  }
  take('end');if(i!==ts.length)deny();
  const schema=schema_id(actor,fields),size=27+fields.reduce((n,f)=>n+(f.tag===1?9:2),0);
  // No user text is executable. Only bounded numeric metadata and typed literals
  // are substituted into a fixed codec. Fresh arrays on every call.
  const code=`const TAGS=Object.freeze([${fields.map(f=>f.tag).join(',')}]),SIZE=${size},SCHEMA=${schema}n;
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const deny=()=>{throw new Error('E_DURABLE_SCALAR_CHECKPOINT_V1');};
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const get=(p,k)=>Function.prototype.call.bind(Object.getOwnPropertyDescriptor(p,k).get);
const length=get(typed,'byteLength'),buffer=get(typed,'buffer'),offset=get(typed,'byteOffset'),ordinary=get(ArrayBuffer.prototype,'byteLength'),kind=get(typed,Symbol.toStringTag);
function fnv(bytes){let h=0xcbf29ce484222325n;for(const b of bytes)h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);return h;}
export function atto_encode_state_v1(...values){
 if(values.length!==TAGS.length)deny();
 const b=new Uint8Array(SIZE),v=new DataView(b.buffer);b.set([65,84,84,79,83,84,48,49,1]);v.setBigUint64(9,SCHEMA,true);v.setUint16(17,TAGS.length,true);
 let p=19;for(let i=0;i<TAGS.length;i++){const tag=TAGS[i],x=values[i];b[p++]=tag;
  if(tag===1){if(typeof x!=='bigint'||x<MIN||x>MAX)deny();v.setBigInt64(p,x,true);p+=8;}
  else{if(typeof x!=='boolean')deny();b[p++]=x?1:0;}}
 v.setBigUint64(p,fnv(b.subarray(0,p)),true);return b;
}
export function atto_decode_state_v1(input){
 // Physical length/offset/buffer intrinsics; reject shared storage and proxies.
 // Read an owned copy before validation. Only trusted same-realm byte inputs.
 let b;try{if(length(input)!==SIZE||kind(input)!=='Uint8Array'||Object.getPrototypeOf(input)!==Uint8Array.prototype)deny();const backing=buffer(input);ordinary(backing);b=new Uint8Array(new Uint8Array(backing,offset(input),SIZE));}catch{deny();}
 const v=new DataView(b.buffer);if([65,84,84,79,83,84,48,49,1].some((x,i)=>b[i]!==x)||v.getBigUint64(9,true)!==SCHEMA||v.getUint16(17,true)!==TAGS.length||v.getBigUint64(SIZE-8,true)!==fnv(b.subarray(0,SIZE-8)))deny();
 const out=[];let p=19;for(const tag of TAGS){if(b[p++]!==tag)deny();if(tag===1){out.push(v.getBigInt64(p,true));p+=8;}else{const x=b[p++];if(x>1)deny();out.push(x===1);}}
 if(p!==SIZE-8)deny();return out;
}
export function atto_initial_state_v1(){return atto_encode_state_v1(${fields.map(f=>f.tag===1?String(f.initial)+'n':String(f.initial)).join(',')});}
`;
  return {backend:'js',guest_abi:'atto.js.durable.scalar-codec.v1',schema_id:schema.toString(16).padStart(16,'0'),module_source:code};
}
