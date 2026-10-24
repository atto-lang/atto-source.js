// Copy-only actor wire profile: no shared-memory or transferable authority.
// Reject hostile/overlarge graphs BEFORE structuredClone allocates a copy.
// The byte budget is an approximate content budget, not a wire-size guarantee.
const MAX_NODES=8192;
const MAX_DEPTH=64;
const MAX_CONTENT_BYTES=8*1024*1024;
// Intrinsic getters avoid invoking user-overridden instance accessors.
const regexpSourceGetter=Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get;
const bigintHex=BigInt.prototype.toString;
// Capture built-in internal-slot readers once. Instance properties such as
// byteLength, buffer, size or Symbol.iterator must not hide cloneable bytes.
const arrayBufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const typedArrayBuffer=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'buffer').get;
const dataViewBuffer=Object.getOwnPropertyDescriptor(DataView.prototype,'buffer').get;
const blobSize=typeof Blob==='function'?Object.getOwnPropertyDescriptor(Blob.prototype,'size').get:null;
const mapEntries=Map.prototype.entries;
const setValues=Set.prototype.values;
const mapSize=Object.getOwnPropertyDescriptor(Map.prototype,'size').get;
const setSize=Object.getOwnPropertyDescriptor(Set.prototype,'size').get;
const stringValue=String.prototype.valueOf;
const sabLength=typeof SharedArrayBuffer==='function' ?
  Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,'byteLength').get : null;
const MISSING_SLOT=Symbol('not a cloneable internal slot');
function readSlot(reader,node) {
  try{return reader.call(node);}
  catch(error){
    if(error instanceof TypeError)return MISSING_SLOT;
    throw error;
  }
}

function validateOwnedValue(value) {
  const seen=new WeakSet();
  let nodes=0,entries=0,bytes=0;
  function addBytes(size) {
    if(!Number.isSafeInteger(size)||size<0||
       size>MAX_CONTENT_BYTES-bytes)
      throw new RangeError('actor message byte budget exceeded');
    bytes+=size;
  }
  function check(node,depth) {
    if(typeof node==='string') {addBytes(node.length*2);return;}
    if(typeof node==='bigint') {
      const hex=bigintHex.call(node,16);
      addBytes(Math.ceil((hex.length-(hex[0]==='-'?1:0))/2));
      return;
    }
    if(node===null||typeof node!=='object')return;
    if(depth>MAX_DEPTH)throw new RangeError('actor message complexity exceeded');
    if(seen.has(node))return;
    seen.add(node);
    if(++nodes>MAX_NODES)throw new RangeError('actor message complexity exceeded');
    // Internal-slot probes remain correct after Object.setPrototypeOf().
    // An altered prototype must not conceal a cloneable 9-MiB backing buffer.
    if(sabLength&&readSlot(sabLength,node)!==MISSING_SLOT)
      throw new TypeError('shared-memory actor message forbidden in copy-only profile');
    const arrayBytes=readSlot(arrayBufferLength,node);
    if(arrayBytes!==MISSING_SLOT){addBytes(arrayBytes);return;}
    if(ArrayBuffer.isView(node)) {
      const viewBuffer=readSlot(dataViewBuffer,node);
      const buffer=viewBuffer!==MISSING_SLOT?viewBuffer:
        readSlot(typedArrayBuffer,node);
      if(buffer===MISSING_SLOT)
        throw new TypeError('unknown actor ArrayBuffer view');
      check(buffer,depth+1);
      return;
    }
    if(blobSize){
      const fileBytes=readSlot(blobSize,node);
      if(fileBytes!==MISSING_SLOT){addBytes(fileBytes);return;}
    }
    const hiddenString=readSlot(stringValue,node);
    if(hiddenString!==MISSING_SLOT)addBytes(hiddenString.length*2);
    const hiddenPattern=readSlot(regexpSourceGetter,node);
    if(hiddenPattern!==MISSING_SLOT)addBytes(hiddenPattern.length*2);
    const hiddenBigInt=readSlot(function bigintBase16(){return bigintHex.call(this,16);},node);
    if(hiddenBigInt!==MISSING_SLOT)
      addBytes(Math.ceil((hiddenBigInt.length-(hiddenBigInt[0]==='-'?1:0))/2));
    const isMap=readSlot(mapSize,node)!==MISSING_SLOT;
    const isSet=readSlot(setSize,node)!==MISSING_SLOT;
    if(isMap) {
      for(const [key,item] of mapEntries.call(node)){
        if(++entries>MAX_NODES)throw new RangeError('actor message complexity exceeded');
        check(key,depth+1);check(item,depth+1);
      }
    }else if(isSet) {
      for(const item of setValues.call(node)){
        if(++entries>MAX_NODES)throw new RangeError('actor message complexity exceeded');
        check(item,depth+1);
      }
    }else{
      for(const key of Reflect.ownKeys(node)){
        if(++entries>MAX_NODES)throw new RangeError('actor message complexity exceeded');
        if(typeof key==='string')addBytes(key.length*2);
        const desc=Object.getOwnPropertyDescriptor(node,key);
        // structuredClone invokes getters: only copy plain data properties.
        if(!desc||!Object.hasOwn(desc,'value'))
          throw new TypeError('actor message accessors forbidden in copy-only profile');
        check(desc.value,depth+1);
      }
    }
  }
  check(value,0);
  return bytes;
}
// Measure the *validated snapshot*, rather than the caller's mutable graph.
// This conservative estimate is not a serialized-wire-byte or heap bound.
export function copyOwnedValueWithBytes(value) {
  validateOwnedValue(value);
  const snapshot=structuredClone(value);
  const bytes=validateOwnedValue(snapshot);
  return Object.freeze({value:snapshot,bytes});
}
export function copyOwnedValue(value) {
  return copyOwnedValueWithBytes(value).value;
}
