import test from 'node:test';
import assert from 'node:assert/strict';
import {copyOwnedValue,copyOwnedValueWithBytes} from '../src/worker-actor-copy.mjs';

const MiB=1024*1024;

test('binary payload at byte-budget boundary is copied without aliases',()=>{
  const source=new Uint8Array(8*MiB-14); // 14 UTF-16 bytes for the "payload" key
  source[0]=42;
  const clone=copyOwnedValue({payload:source});
  source[0]=99;
  assert.equal(clone.payload[0],42);
  assert.notEqual(clone.payload.buffer,source.buffer);
});

test('oversized typed arrays and backing ArrayBuffers are rejected before clone',()=>{
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(new Uint8Array(8*MiB+1)),/byte budget exceeded/);
    assert.throws(()=>copyOwnedValue(new ArrayBuffer(8*MiB+1)),/byte budget exceeded/);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('nested Blob, oversized UTF-16 strings and repeated graph ownership are bounded',()=>{
  if(typeof Blob==='function')
    assert.throws(()=>copyOwnedValue({binary:new Blob([new Uint8Array(8*MiB+1)])}),/byte budget exceeded/);
  assert.throws(()=>copyOwnedValue('x'.repeat(4*MiB+1)),/byte budget exceeded/);
  const backing=new ArrayBuffer(5*MiB);
  const value={left:new Uint8Array(backing),right:new DataView(backing)};
  const cloned=copyOwnedValue(value);
  assert.equal(cloned.left.buffer,cloned.right.buffer);
  assert.notEqual(cloned.left.buffer,backing);
});

test('reject accessors without executing them or invoking structuredClone',()=>{
  let getterCalls=0;
  const hostile=Object.defineProperty({},'payload',{
    enumerable:true,get(){getterCalls++;return new ArrayBuffer(16*MiB);}
  });
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(hostile),/accessors forbidden/);
    assert.equal(getterCalls,0);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('reject nested shared memory before clone and preserve cyclic owned graphs',()=>{
  if(typeof SharedArrayBuffer==='function'){
    const original=globalThis.structuredClone;
    let cloneCalls=0;
    globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
    try{
      assert.throws(
        ()=>copyOwnedValue({m:new Map([['bad',new Uint8Array(new SharedArrayBuffer(8))]])}),
        /shared-memory/);
      assert.equal(cloneCalls,0);
    }finally{globalThis.structuredClone=original;}
  }
  const original={answer:42};
  original.self=original;
  const cloned=copyOwnedValue(original);
  assert.notEqual(cloned,original);
  assert.equal(cloned.self,cloned);
});

test('complex graphs are rejected before clone',()=>{
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(Array.from({length:8200},()=>({ok:true}))),/complexity exceeded/);
    const top={},root=top;let p=top;
    for(let i=0;i<67;i++){p.child={};p=p.child;}
    assert.throws(()=>copyOwnedValue(root),/complexity exceeded/);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('wide primitive-only arrays and Map/Set entries reject before clone',()=>{
  const original=globalThis.structuredClone;
  let calls=0;
  globalThis.structuredClone=value=>{calls++;return original(value);};
  try{
    assert.throws(()=>copyOwnedValue(Array.from({length:8200},(_,i)=>i)),/complexity exceeded/);
    assert.throws(()=>copyOwnedValue(new Map(Array.from({length:8200},(_,i)=>[i,true]))),/complexity exceeded/);
    assert.throws(()=>copyOwnedValue(new Set(Array.from({length:8200},(_,i)=>i))),/complexity exceeded/);
    assert.equal(calls,0);
  }finally{globalThis.structuredClone=original;}
});

test('copy receipt measures owned snapshot bytes and counts shared backing only once',()=>{
  const bytes=new ArrayBuffer(1024);
  const receipt=copyOwnedValueWithBytes({
    first:new Uint8Array(bytes),second:new DataView(bytes)
  });
  // UTF-16 key bytes: first=10, second=12, backing=1024.
  assert.equal(receipt.bytes,1046);
  assert.equal(receipt.value.first.buffer,receipt.value.second.buffer);
  assert.notEqual(receipt.value.first.buffer,bytes);
  assert.equal(Object.isFrozen(receipt),true);
  assert.equal(copyOwnedValueWithBytes('hello').bytes,10);
});


test('large RegExp patterns and arbitrarily wide bigint values consume budgets before clone',()=>{
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    const largePattern=new RegExp('a'.repeat(4*MiB+1));
    assert.throws(()=>copyOwnedValue(largePattern),/byte budget exceeded/);
    const wide=BigInt('0x'+'f'.repeat(16*MiB+2));
    assert.throws(()=>copyOwnedValue(wide),/byte budget exceeded/);
    assert.throws(()=>copyOwnedValue(Object(wide)),/byte budget exceeded/);
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('RegExp built-in source accounting ignores hostile overridden source getter',()=>{
  let getterCalls=0;
  const pattern=/abc/;
  Object.defineProperty(pattern,'source',{get(){getterCalls++;return 'evil';}});
  assert.throws(()=>copyOwnedValue(pattern),/accessors forbidden/);
  assert.equal(getterCalls,0);
  assert.ok(copyOwnedValueWithBytes(/abc/).bytes>=6);
  assert.ok(copyOwnedValueWithBytes(2n**256n).bytes>=33);
  assert.ok(copyOwnedValueWithBytes(Object(2n**256n)).bytes>=33);
});

test('spoofed built-in size and buffer properties cannot hide cloneable bytes',()=>{
  const original=globalThis.structuredClone;
  let cloned=0;
  globalThis.structuredClone=value=>{cloned++;return original(value);};
  try{
    const oversized=9*MiB;
    const b=Object.defineProperty(new ArrayBuffer(oversized),'byteLength',{value:0});
    const blob=Object.defineProperty(new Blob([new Uint8Array(oversized)]),'size',{value:0});
    const typed=Object.defineProperty(new Uint8Array(oversized),'buffer',{value:new ArrayBuffer(0)});
    const view=Object.defineProperty(new DataView(new ArrayBuffer(oversized)),'buffer',{value:new ArrayBuffer(0)});
    const map=new Map([['large',new Uint8Array(oversized)]]);
    map[Symbol.iterator]=()=>[][Symbol.iterator]();
    const set=new Set([new Uint8Array(oversized)]);
    set[Symbol.iterator]=()=>[][Symbol.iterator]();
    for(const value of [b,blob,typed,view,map,set])
      assert.throws(()=>copyOwnedValue(value),/byte budget exceeded/);
    assert.equal(cloned,0);
  }finally{globalThis.structuredClone=original;}
});

test('built-in readers preserve the correct bounded Map/Set and view semantics',()=>{
  const backing=new ArrayBuffer(1000);
  const view=Object.defineProperty(new DataView(backing),'buffer',{value:new ArrayBuffer(0)});
  assert.equal(copyOwnedValueWithBytes(view).bytes,1000);
  const map=new Map([[1,{answer:42}]]);
  map[Symbol.iterator]=()=>[][Symbol.iterator]();
  const mapped=copyOwnedValue(map);
  assert.equal(mapped.get(1).answer,42);
  const set=new Set([1,2,3]);
  set[Symbol.iterator]=()=>[][Symbol.iterator]();
  assert.deepEqual([...copyOwnedValue(set)],[1,2,3]);
});

test('cloneable internal slots cannot hide behind changed object prototypes',()=>{
  const size=9*MiB;
  const kinds=[
    new ArrayBuffer(size),
    new Uint8Array(size),
    new DataView(new ArrayBuffer(size)),
    new Map([['buffer',new ArrayBuffer(size)]]),
    new Set([new ArrayBuffer(size)]),
    new RegExp('a'.repeat(4*MiB+1)),
    Object('x'.repeat(4*MiB+1))
  ];
  const original=globalThis.structuredClone;
  let cloneCalls=0;
  globalThis.structuredClone=(value)=>{cloneCalls++;return original(value);};
  try{
    for(const value of kinds){
      Object.setPrototypeOf(value,Object.prototype);
      assert.throws(()=>copyOwnedValue(value),/byte budget exceeded/);
    }
    if(typeof SharedArrayBuffer==='function'){
      const shared=new SharedArrayBuffer(8);
      Object.setPrototypeOf(shared,Object.prototype);
      assert.throws(()=>copyOwnedValue(shared),/shared-memory/);
    }
    assert.equal(cloneCalls,0);
  }finally{globalThis.structuredClone=original;}
});

test('small cloneables remain supported after prototype changes',()=>{
  const map=new Map([['answer',42]]);
  const set=new Set([1,2,3]);
  const pattern=/hello/i;
  const backing=new ArrayBuffer(16);
  const boxed=Object('hello');
  for(const item of [map,set,pattern,backing,boxed])
    Object.setPrototypeOf(item,Object.prototype);
  assert.equal(copyOwnedValue(map).get('answer'),42);
  assert.deepEqual([...copyOwnedValue(set)],[1,2,3]);
  assert.equal(copyOwnedValue(pattern).source,'hello');
  assert.equal(copyOwnedValue(backing).byteLength,16);
  assert.equal(copyOwnedValue(boxed).valueOf(),'hello');
});

test('guest replacement of structuredClone and Object.freeze cannot forge a copy receipt',()=>{
  const clone=globalThis.structuredClone,freeze=Object.freeze;
  let intercepted=0;
  try{
    globalThis.structuredClone=value=>{intercepted++;return value;};
    Object.freeze=value=>value&&typeof value==='object'&&'bytes' in value?
      {value:value.value,bytes:0}:value;
    const source={payload:{answer:42}};
    const receipt=copyOwnedValueWithBytes(source);
    assert.notStrictEqual(receipt.value,source,'owned snapshot must not alias caller data');
    assert.ok(receipt.bytes>0,'guest must not erase byte reservations');
    assert.equal(Object.isFrozen(receipt),true,'guest must not replace frozen receipt');
    source.payload.answer=99;
    assert.equal(receipt.value.payload.answer,42);
    assert.equal(intercepted,0,'guest replacement must not run');
  }finally{
    globalThis.structuredClone=clone;
    Object.freeze=freeze;
  }
});

test('guest Map/Set iterator next replacement cannot conceal oversized backing storage',()=>{
  const oversized=new ArrayBuffer(9*MiB);
  const cases=[
    [Object.getPrototypeOf(new Map().entries()),new Map([['hidden',oversized]])],
    [Object.getPrototypeOf(new Set().values()),new Set([oversized])]
  ];
  for(const [prototype,value] of cases){
    const original=Object.getOwnPropertyDescriptor(prototype,'next');
    assert.ok(original?.configurable);
    Object.defineProperty(prototype,'next',{...original,value(){return {done:true};}});
    try{
      assert.throws(()=>copyOwnedValue(value),/byte budget exceeded/,
        'native iterator must enumerate hidden oversized payload');
    }finally{Object.defineProperty(prototype,'next',original);}
  }
});

test('guest Object.hasOwn replacement cannot admit accessor-backed payloads',()=>{
  const original=Object.hasOwn;
  let invoked=0;
  try{
    Object.hasOwn=()=>true;
    const value={get payload(){invoked++;return {answer:42};}};
    assert.throws(()=>copyOwnedValue(value),/accessors forbidden/);
    assert.equal(invoked,0,'copy validation must never invoke guest getters');
  }finally{Object.hasOwn=original;}
});

test('guest Math.max replacement cannot hide resizable ArrayBuffer capacity',()=>{
  const buffer=new ArrayBuffer(0,{maxByteLength:9*MiB});
  assert.equal(buffer.resizable,true,'Node 22 resizable buffer prerequisite');
  const original=Math.max;
  let calls=0,thrown;
  try{
    Math.max=()=>{calls++;return 0;};
    try{copyOwnedValueWithBytes(buffer);}catch(error){thrown=error;}
  }finally{Math.max=original;}
  assert.match(String(thrown),/byte budget exceeded/,
    'admission must charge the maximum growth capacity');
  assert.equal(calls,0,'guest arithmetic override must not execute');
});

test('guest Math.ceil replacement cannot erase BigInt copy reservations',()=>{
  const original=Math.ceil;
  let calls=0,receipt;
  try{
    Math.ceil=()=>{calls++;return 0;};
    receipt=copyOwnedValueWithBytes(2n**256n);
  }finally{Math.ceil=original;}
  assert.ok(receipt.bytes>=33,'257-bit BigInt must reserve at least 33 bytes');
  assert.equal(calls,0,'guest arithmetic override must not execute');
});

test('guest Number.isSafeInteger replacement cannot deny valid copy admission',()=>{
  const original=Number.isSafeInteger;
  let calls=0,receipt;
  try{
    Number.isSafeInteger=()=>{calls++;return false;};
    receipt=copyOwnedValueWithBytes('safe');
  }finally{Number.isSafeInteger=original;}
  assert.equal(receipt.bytes,8);
  assert.equal(calls,0,'guest integer override must not execute');
});

test('guest WeakSet.prototype.has cannot erase oversized object byte charges',()=>{
  const original=WeakSet.prototype.has;
  let poisonedCalls=0;
  try{
    WeakSet.prototype.has=function(){poisonedCalls++;return true;};
    assert.throws(()=>copyOwnedValueWithBytes(new ArrayBuffer(9*MiB)),
      /byte budget exceeded/);
    assert.equal(poisonedCalls,0,'copy validation must use captured WeakSet.has');
  }finally{WeakSet.prototype.has=original;}
});

test('guest WeakSet constructor replacement cannot forge zero-byte receipts',()=>{
  const OriginalWeakSet=globalThis.WeakSet;
  let constructed=0;
  try{
    globalThis.WeakSet=class {
      constructor(){constructed++;}
      has(){return true;}
      add(){return this;}
    };
    const original={payload:new Uint8Array(64)};
    const receipt=copyOwnedValueWithBytes(original);
    assert.notStrictEqual(receipt.value,original);
    assert.equal(receipt.bytes,78,'payload key UTF-16 plus owned backing bytes');
    assert.equal(constructed,0,'guest replacement must never be instantiated');
  }finally{globalThis.WeakSet=OriginalWeakSet;}
});

test('guest WeakSet.prototype.add cannot break cyclic ownership receipts',()=>{
  const original=WeakSet.prototype.add;
  let poisonedCalls=0;
  try{
    WeakSet.prototype.add=function(){poisonedCalls++;return this;};
    const source={answer:42};
    source.self=source;
    const receipt=copyOwnedValueWithBytes(source);
    assert.equal(receipt.value.self,receipt.value);
    assert.ok(receipt.bytes>0);
    assert.equal(poisonedCalls,0,'copy validation must use captured WeakSet.add');
  }finally{WeakSet.prototype.add=original;}
});

test('guest ArrayBuffer.isView replacement cannot intercept copy admission',()=>{
  const original=ArrayBuffer.isView;
  let intercepted=0;
  try{
    ArrayBuffer.isView=()=>{intercepted++;throw new Error('guest isView override called');};
    assert.equal(copyOwnedValueWithBytes(new DataView(new ArrayBuffer(16))).bytes,16);
    const disguised=new DataView(new ArrayBuffer(9*MiB));
    Object.setPrototypeOf(disguised,Object.prototype);
    assert.throws(()=>copyOwnedValueWithBytes(disguised),/byte budget exceeded/);
    assert.equal(intercepted,0,'guest view predicate must never execute');
  }finally{ArrayBuffer.isView=original;}
});

test('guest Array.isArray replacement cannot hide sparse arrays or intercept admission',()=>{
  const original=Array.isArray;
  let intercepted=0;
  try{
    Array.isArray=()=>{intercepted++;throw new Error('guest isArray override called');};
    const cloned=copyOwnedValue([1,2,3]);
    assert.equal(cloned.length,3);
    assert.equal(cloned[0],1);
    const sparse=new Array(8193);
    Object.setPrototypeOf(sparse,Object.prototype);
    assert.throws(()=>copyOwnedValueWithBytes(sparse),/complexity exceeded/);
    assert.equal(intercepted,0,'guest array predicate must never execute');
  }finally{Array.isArray=original;}
});

test('guest Array iterator cannot skip own-key admission of oversized payload',()=>{
  const original=Array.prototype[Symbol.iterator];
  let poisonedCalls=0,thrown;
  try{
    Array.prototype[Symbol.iterator]=function*(){poisonedCalls++;};
    try{copyOwnedValueWithBytes({payload:new ArrayBuffer(9*MiB)});}
    catch(error){thrown=error;}
  }finally{Array.prototype[Symbol.iterator]=original;}
  assert.match(String(thrown),/byte budget exceeded/,
    'an overridden Array iterator must not hide own payload fields');
  assert.equal(poisonedCalls,0,'own-key admission must use indexed iteration');
});

test('guest Array iterator cannot suppress forbidden accessor detection',()=>{
  const original=Array.prototype[Symbol.iterator];
  let getterCalls=0,poisonedCalls=0,thrown;
  const hostile=Object.defineProperty({},'payload',{
    enumerable:true,get(){getterCalls++;return 42;}
  });
  try{
    Array.prototype[Symbol.iterator]=function*(){poisonedCalls++;};
    try{copyOwnedValueWithBytes(hostile);}
    catch(error){thrown=error;}
  }finally{Array.prototype[Symbol.iterator]=original;}
  assert.match(String(thrown),/accessors forbidden/,
    'own-key iteration must still inspect accessor descriptors');
  assert.equal(getterCalls,0,'admission must not evaluate hostile getters');
  assert.equal(poisonedCalls,0,'guest Array iterator must not execute');
});


test('guest TypeError rebinding cannot deny native record slot admission',()=>{
  const NativeTypeError=globalThis.TypeError;
  let receipt;
  try {
    globalThis.TypeError=class GuestTypeError extends Error {};
    receipt=copyOwnedValueWithBytes({answer:42});
  } finally {globalThis.TypeError=NativeTypeError;}
  assert.equal(receipt.value.answer,42);
  assert.equal(receipt.bytes,12,'answer key is charged as UTF-16');
});

test('guest Object rebinding cannot change native plain-record identity',()=>{
  const NativeObject=globalThis.Object;
  let receipt;
  try {
    globalThis.Object=class GuestObject {};
    receipt=copyOwnedValueWithBytes({answer:42});
  } finally {globalThis.Object=NativeObject;}
  assert.equal(receipt.value.answer,42);
  assert.equal(receipt.bytes,12);
});

test('guest Symbol rebinding cannot invoke an accessor-backed toStringTag',()=>{
  const NativeSymbol=globalThis.Symbol;
  const value={};
  let tagGetterCalls=0,thrown;
  Object.defineProperty(value,NativeSymbol.toStringTag,{
    get(){tagGetterCalls++;return 'Object';}
  });
  try {
    const GuestSymbol=function GuestSymbol(){};
    GuestSymbol.toStringTag=NativeSymbol('decoy toStringTag');
    globalThis.Symbol=GuestSymbol;
    try {copyOwnedValueWithBytes(value);}
    catch(error){thrown=error;}
  } finally {globalThis.Symbol=NativeSymbol;}
  assert.match(String(thrown),/unsupported actor wire symbol key/);
  assert.equal(tagGetterCalls,0,'validator must reject tag descriptor without evaluating getter');
});
