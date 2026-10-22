import test from "node:test";
import assert from "node:assert/strict";
import {WorkerMixedLayout} from "../src/worker-mixed-layout.mjs";
import {MixedLayoutGeometry} from "../src/mixed-layout-geometry.mjs";

const fields=[{name:"id",type:"u32"},{name:"x",type:"f64"},
  {name:"flag",type:"bool"},{name:"next",type:"ref32"}];
const cases=[
  ["aos",{},72,72],
  ["soa",{},51,56],
  ["aosoa",{tileWidth:4},144,144],
  ["soaos",{groups:[["id","flag"],["x","next"]]},72,72]
];
test("all mixed-width physical layouts preserve values, offsets and alignment",()=>{
  for(const [layout,opts,payload,allocation] of cases){
    const rows=layout==="aosoa"?5:3;
    const store=new WorkerMixedLayout({fields,rows,layout,...opts});
    assert.equal(store.payloadBytes,payload);
    assert.equal(store.byteLength,allocation);
    const occupied=new Set();
    for(let row=0;row<rows;row++){
      store.write(row,"id",4294967295-row);
      store.write(row,"x",row===0?-0:row===1?NaN:row+0.25);
      store.write(row,"flag",row%2===0);
      store.write(row,"next",row+1);
      for(const field of store.fields){
        const a=store.address(row,field.name);
        assert.equal(a.absoluteByteOffset % field.alignment,0);
        for(let i=0;i<field.bytes;i++){
          const key=a.absoluteByteOffset+i;
          assert.equal(occupied.has(key),false,"two fields alias physical bytes");
          occupied.add(key);
        }
      }
    }
    assert.equal(store.read(0,"id"),0xffffffff);
    assert.equal(Object.is(store.read(0,"x"),-0),true);
    assert.equal(Number.isNaN(store.read(1,"x")),true);
    assert.equal(store.read(2,"flag"),true);
    assert.equal(store.read(rows-1,"next"),rows);
    assert.throws(()=>store.write(0,"id",-1),/unsigned/);
    assert.throws(()=>store.write(0,"next",0x1_0000_0000),/unsigned/);
    assert.throws(()=>store.write(0,"flag",1),/bool/);
    assert.throws(()=>store.write(0,"x","12"),/f64/);
    assert.throws(()=>store.address(rows,"id"),/bounds/);
    assert.throws(()=>store.address(0,"constructor"),/bounds/);
    assert.equal("buffer" in store,false);
    store.retire();store.retire();
    assert.throws(()=>store.read(0,"id"),/retired/);
  }
});
test("SoAoS grouped stride differs from SoA and AoSoA partial tile is fenced",()=>{
  const soa=new MixedLayoutGeometry({fields,rows:3,layout:"soa"});
  const soaos=new MixedLayoutGeometry({fields,rows:3,layout:"soaos",groups:[["id","flag"],["x","next"]]});
  const aosoa=new MixedLayoutGeometry({fields,rows:5,layout:"aosoa",tileWidth:4});
  assert.deepEqual(soaos.address(2,"next"),{segment:1,byteOffset:40,absoluteByteOffset:64,type:"ref32"});
  assert.equal(soa.address(2,"x").byteOffset,16);
  assert.equal(aosoa.address(4,"id").byteOffset,72);
  assert.throws(()=>aosoa.address(5,"id"),/bounds/);
  assert.equal(Object.isFrozen(soaos.segments),true);
  assert.equal(Object.isFrozen(soaos.fields),true);
  assert.throws(()=>{soaos.segments[0].bytes=0;},TypeError);
});
test("hostile geometry is rejected before allocation",()=>{
  const base={fields,rows:3,layout:"soa"};
  for(const patch of [
    {maxBytes:50},{fields:[{name:"id",type:"u32"},{name:"id",type:"f64"}]},
    {fields:[{name:"wrong",type:"Object"}]},
    {fields:[{name:"__proto__",type:"u32"},{name:"x",type:"f64"}],groups:undefined,layout:"invalid"},
    {rows:-1},{layout:"aosoa",tileWidth:3},
    {layout:"soaos",groups:[["id"],["x"]]},
    {layout:"soaos",groups:[["id","x"],["x","flag","next"]]}
  ]) assert.throws(()=>new WorkerMixedLayout({...base,...patch}));
});
test("native f64 integration updates only selected data and preserves integer columns",()=>{
  const fields=[{name:"id",type:"u32"},{name:"pos",type:"f64"},
    {name:"vel",type:"f64"},{name:"flag",type:"bool"}];
  const store=new WorkerMixedLayout({fields,rows:5,layout:"soaos",groups:[["id","flag"],["pos","vel"]]});
  for(let r=0;r<5;r++){store.write(r,"id",r+10);store.write(r,"pos",r*10);store.write(r,"vel",r+0.5);store.write(r,"flag",true);}
  store.integrate("pos","vel",0.25);
  assert.deepEqual(store.snapshot("pos"),Array.from({length:5},(_,r)=>r*10+(r+0.5)*0.25));
  for(let r=0;r<5;r++){assert.equal(store.read(r,"id"),r+10);assert.equal(store.read(r,"flag"),true);}
  assert.throws(()=>store.integrate("id","vel",0.1),/distinct f64/);
  store.retire();
});

test("mixed schema rejects getter-backed fields, holes and shadowed SoAoS names",()=>{
  const hostile={type:"u32"};
  Object.defineProperty(hostile,"name",{get(){
    throw new Error("untrusted property getter must never run");
  }});
  assert.throws(()=>new MixedLayoutGeometry({
    rows:1,layout:"aos",fields:[hostile]
  }),/own data/);
  const sparse=[];
  sparse.length=1;
  assert.throws(()=>new MixedLayoutGeometry({
    rows:1,layout:"soa",fields:sparse
  }),/own data/);
  const group=[["id"]];
  Object.defineProperty(group,0,{configurable:true,get(){
    throw new Error("group getter must never run");
  }});
  assert.throws(()=>new MixedLayoutGeometry({
    rows:1,layout:"soaos",fields:[{name:"id",type:"u32"}],groups:group
  }),/own data/);
  const safe=new MixedLayoutGeometry({
    rows:2,layout:"soaos",fields:[{name:"__proto__",type:"u32"},{name:"constructor",type:"bool"}],
    groups:[["constructor"],["__proto__"]]
  });
  assert.equal(safe.address(1,"__proto__").type,"u32");
  assert.equal(safe.address(1,"constructor").type,"bool");
  assert.throws(()=>safe.address(1,"toString"),/bounds/);
});

test("mixed field authority survives Array/Map prototype mutation",()=>{
  const store=new WorkerMixedLayout({fields:[
    {name:"pos",type:"f64"},{name:"vel",type:"f64"}
  ],rows:2,layout:"soa"});
  store.write(0,"pos",1);store.write(0,"vel",4);
  const oldSome=Array.prototype.some;
  const oldHas=Map.prototype.has;
  const oldGet=Map.prototype.get;
  const oldSet=Map.prototype.set;
  let actual;
  try {
    Array.prototype.some=()=>{throw new Error("hijacked array scan");};
    Map.prototype.has=()=>{throw new Error("hijacked map lookup");};
    Map.prototype.get=()=>{throw new Error("hijacked map getter");};
    Map.prototype.set=()=>{throw new Error("hijacked map setter");};
    store.integrate("pos","vel",0.25);
    actual=store.read(0,"pos");
  } finally {
    Array.prototype.some=oldSome;
    Map.prototype.has=oldHas;
    Map.prototype.get=oldGet;
    Map.prototype.set=oldSet;
    store.retire();
  }
  assert.equal(actual,2);
});

test("actor ECS hot path bypasses frozen diagnostic address records",()=>{
  const oldAddress=MixedLayoutGeometry.prototype.address;
  const schema=[{name:"pos",type:"f64"},{name:"vel",type:"f64"}];
  const q=new WorkerMixedLayout({fields:schema,rows:9,layout:"aosoa",tileWidth:4});
  for(let i=0;i<9;i++){
    q.write(i,"pos",i);q.write(i,"vel",i+0.5);
  }
  try{
    MixedLayoutGeometry.prototype.address=function(){
      throw new Error("per-cell diagnostic address allocation");
    };
    q.integrate("pos","vel",0.25);
    for(let i=0;i<9;i++)
      assert.equal(q.read(i,"pos"),i+(i+0.5)*0.25);
    q.write(0,"pos",123);
    assert.equal(q.read(0,"pos"),123);
    assert.throws(()=>q.read(9,"pos"),/bounds/);
  }finally{
    MixedLayoutGeometry.prototype.address=oldAddress;
    q.retire();
  }
});
