import test from 'node:test';
import assert from 'node:assert/strict';
import {copyOwnedValue,copyOwnedValueWithBytes} from '../src/worker-actor-copy.mjs';

test('nested mutable object graphs are deeply copied with no retained aliases',()=>{
  const input={nested:{counter:7}, list:[1,{value:2}], bytes:new Uint8Array([1,2,3]),
    map:new Map([['foo',{amount:11}]]), set:new Set([{flag:true}])};
  const copied=copyOwnedValue(input);
  input.nested.counter=99;
  input.list[1].value=21;
  input.bytes[0]=100;
  input.map.get('foo').amount=101;
  assert.equal(copied.nested.counter,7);
  assert.equal(copied.list[1].value,2);
  assert.deepEqual([...copied.bytes],[1,2,3]);
  assert.equal(copied.map.get('foo').amount,11);
  assert.notStrictEqual(copied.nested,input.nested);
  copied.nested.counter=70;
  assert.equal(input.nested.counter,99);
});

test('cycles and shared subgraphs retain topology without aliasing source',()=>{
  const shared={id:5}, value={first:shared,second:shared};
  value.self=value;
  const output=copyOwnedValueWithBytes(value);
  assert.equal(Object.isFrozen(output),true);
  assert.ok(output.bytes>=0);
  assert.notStrictEqual(output.value,value);
  assert.strictEqual(output.value.self,output.value);
  assert.strictEqual(output.value.first,output.value.second);
  assert.notStrictEqual(output.value.first,shared);
});

test('accessors, executable values, symbol keys and custom classes fail closed',()=>{
  let reads=0;
  const getter={get secret(){reads++;throw Error('getter executed');}};
  assert.throws(()=>copyOwnedValue(getter),/accessors forbidden/);
  assert.equal(reads,0);
  assert.throws(()=>copyOwnedValue({call:()=>42}),/unsupported actor wire value/);
  assert.throws(()=>copyOwnedValue({[Symbol('x')]:1}),/symbol key/);
  assert.throws(()=>copyOwnedValue(new class Foo {constructor(){this.value=1;}}()),/unsupported actor wire object type/);
});

test('shared-memory, sparse huge arrays and overly deep graphs are not cloned',()=>{
  if(typeof SharedArrayBuffer==='function')
    assert.throws(()=>copyOwnedValue(new SharedArrayBuffer(8)),/shared-memory/);
  assert.throws(()=>copyOwnedValue(new Array(8193)),/complexity exceeded/);
  let node={};for(let i=0;i<66;i++)node={child:node};
  assert.throws(()=>copyOwnedValue(node),/complexity exceeded/);
});

test('copy receipt measures content and does not expose a borrowed input',()=>{
  const input={text:'safe',buffer:new Uint8Array([0,1,2,3])};
  const receipt=copyOwnedValueWithBytes(input);
  assert.ok(Number.isSafeInteger(receipt.bytes));
  assert.ok(receipt.bytes>=4);
  input.buffer[0]=9;
  assert.equal(receipt.value.buffer[0],0);
  assert.throws(()=>{receipt.bytes=0;},TypeError);
});
