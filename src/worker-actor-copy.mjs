// Copy-only actor wire profile: no shared-memory or transferable authority.
// Reject hostile/overlarge graphs BEFORE structuredClone allocates a copy.
// The byte budget is an approximate content budget, not a wire-size guarantee.
const MAX_NODES=8192;
const MAX_DEPTH=64;
const MAX_CONTENT_BYTES=8*1024*1024;
// Intrinsic getters avoid invoking user-overridden instance accessors.
const regexpSourceGetter=Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get;
const bigintHex=BigInt.prototype.toString;

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
    if(typeof SharedArrayBuffer!=='undefined'&&node instanceof SharedArrayBuffer)
      throw new TypeError('shared-memory actor message forbidden in copy-only profile');
    if(node instanceof ArrayBuffer) {addBytes(node.byteLength);return;}
    if(ArrayBuffer.isView(node)) {
      check(node.buffer,depth+1);
      return;
    }
    if(typeof Blob!=='undefined'&&node instanceof Blob) {
      addBytes(node.size);return;
    }
    if(node instanceof RegExp) {
      // RegExp's potentially huge source is stored in an internal slot,
      // not an own property. structuredClone copies it nevertheless.
      addBytes(regexpSourceGetter.call(node).length*2);
    }
    if(node instanceof BigInt) {
      const hex=bigintHex.call(node,16);
      addBytes(Math.ceil((hex.length-(hex[0]==='-'?1:0))/2));
    }
    if(node instanceof Map) {
      for(const [key,item] of node){
        if(++entries>MAX_NODES)throw new RangeError('actor message complexity exceeded');
        check(key,depth+1);check(item,depth+1);
      }
    }else if(node instanceof Set) {
      for(const item of node){
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
