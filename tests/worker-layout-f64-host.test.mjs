import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerLayoutF64,MAX_WORKER_LAYOUT_BYTES} from '../src/worker-layout-f64.mjs';

const cases=[
  ['aos',{},40],
  ['soa',{},88],
  ['aosoa',{lanes:4},72],
  ['soaos',{groupWidths:[1,2]},64]
];
test('four physical layouts preserve floating values at distinct offsets',()=>{
  const offsets=[];
  for(const [layout,opts,expectedOffset] of cases){
    const store=new WorkerLayoutF64({rows:5,fields:3,layout,...opts});
    assert.equal(store.rows,5);
    assert.equal(store.fields,3);
    assert.equal(store.getPhysicalByteOffset(1,2),expectedOffset);
    offsets.push(expectedOffset);
    for(let row=0;row<5;row++)
      for(let field=0;field<3;field++)
        store.write(row,field,row*10+field+0.25);
    for(let row=0;row<5;row++)
      for(let field=0;field<3;field++)
        assert.equal(store.read(row,field),row*10+field+0.25);
    assert.equal(store.physicalRows,layout==='aosoa'?8:5);
    assert.equal(store.byteLength,store.physicalRows*3*8);
    store.retire();
  }
  assert.equal(new Set(offsets).size,4);
});

test('integrate uses only local position and velocity fields, snapshot is owned',()=>{
  for(const [layout,opts] of cases){
    const store=new WorkerLayoutF64({rows:3,fields:3,layout,...opts});
    for(let row=0;row<3;row++){
      store.write(row,0,row);
      store.write(row,1,2);
      store.write(row,2,77);
    }
    store.integrate(0,1,0.5);
    assert.deepEqual(store.snapshotColumn(0),[1,2,3]);
    assert.deepEqual(store.snapshotColumn(2),[77,77,77]);
    const snapshot=store.snapshotColumn(0);
    snapshot[0]=99;
    assert.equal(store.read(0,0),1);
    store.retire();
  }
});

test('layout configuration, row/field bounds and byte caps fail closed',()=>{
  assert.ok(MAX_WORKER_LAYOUT_BYTES>0);
  assert.throws(()=>new WorkerLayoutF64({rows:0,fields:3,layout:'aos'}),/dimensions/);
  assert.throws(()=>new WorkerLayoutF64({rows:4,fields:3,layout:'unexpected'}),/unknown/);
  assert.throws(()=>new WorkerLayoutF64({rows:4,fields:3,layout:'aosoa',lanes:3}),/power of two/);
  assert.throws(()=>new WorkerLayoutF64({rows:5,fields:3,layout:'aosoa',lanes:4,maxBytes:120}),/padding/);
  assert.throws(()=>new WorkerLayoutF64({rows:5,fields:3,layout:'soaos',groupWidths:[1,1]}),/partition/);
  const store=new WorkerLayoutF64({rows:5,fields:3,layout:'aos'});
  assert.throws(()=>store.read(-1,0),/out of bounds/);
  assert.throws(()=>store.write(5,1,0),/out of bounds/);
  assert.throws(()=>store.write(0,1,'1'),/value must be f64/);
  assert.throws(()=>store.integrate(0,0,0.5),/two valid fields/);
  assert.throws(()=>store.integrate(0,1,Infinity),/finite dt/);
});

test('group width metadata is snapshotted without invoking hostile getters',()=>{
  const widths=[1,2];
  const store=new WorkerLayoutF64({rows:4,fields:3,layout:'soaos',groupWidths:widths});
  const expected=store.getPhysicalByteOffset(1,2);
  widths[0]=3; widths[1]=0;
  assert.equal(store.getPhysicalByteOffset(1,2),expected);
  const evil=[1,2];
  let reads=0;
  Object.defineProperty(evil,'0',{get(){reads++;throw Error('executed getter')},configurable:true});
  assert.throws(()=>new WorkerLayoutF64({rows:3,fields:3,layout:'soaos',groupWidths:evil}),/own positive integers/);
  assert.equal(reads,0);
});

test('retired worker arrays cannot be accessed or revived',()=>{
  const store=new WorkerLayoutF64({rows:3,fields:2,layout:'aos'});
  store.write(0,0,13);
  const snapshot=store.snapshotColumn(0);
  store.retire();
  store.retire();
  assert.equal(store.retired,true);
  assert.equal(snapshot[0],13);
  assert.throws(()=>store.read(0,0),/retired/);
  assert.throws(()=>store.write(0,0,0),/retired/);
  assert.throws(()=>store.snapshotColumn(0),/retired/);
});
