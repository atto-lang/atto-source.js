// Copy-only actor wire profile: no shared-memory or transferable authority.
// Reject hostile/overlarge graphs BEFORE structuredClone allocates a copy.
// The byte budget is an approximate content budget, not a wire-size guarantee.
const MAX_NODES=8192;
const MAX_DEPTH=64;
const MAX_CONTENT_BYTES=8*1024*1024;

function validateOwnedValue(value) {
  const seen=new WeakSet();
  let nodes=0,bytes=0;
  function addBytes(size) {
    if(!Number.isSafeInteger(size)||size<0||
       size>MAX_CONTENT_BYTES-bytes)
      throw new RangeError('actor message byte budget exceeded');
    bytes+=size;
  }
  function check(node,depth) {
    if(typeof node==='string') {addBytes(node.length*2);return;}
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
    if(node instanceof Map) {
      for(const [key,item] of node){check(key,depth+1);check(item,depth+1);}
    }else if(node instanceof Set) {
      for(const item of node)check(item,depth+1);
    }else{
      for(const key of Reflect.ownKeys(node)){
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
}
export function copyOwnedValue(value) {
  // Preflight rejects oversized binary buffers and SAB *before* clone cost.
  validateOwnedValue(value);
  const snapshot=structuredClone(value);
  // Revalidate after clone: accessors or concurrent mutation of the input
  // can change the cloned payload. Never publish an unchecked clone.
  validateOwnedValue(snapshot);
  return snapshot;
}
