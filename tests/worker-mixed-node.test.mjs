import test from "node:test";
import assert from "node:assert/strict";
import {spawnNodeActor} from "../src/actor-host.node.mjs";

const moduleUrl=new URL("./fixtures/worker-mixed-handler.mjs",import.meta.url).href;
const options={
  fields:[{name:"id",type:"u32"},{name:"x",type:"f64"},
    {name:"flag",type:"bool"},{name:"next",type:"ref32"}],
  rows:3,layout:"soaos",groups:[["id","flag"],["x","next"]]
};
test("two Node Workers have separate private mixed-width actor stores",async()=>{
  const a=spawnNodeActor({moduleUrl});
  const b=spawnNodeActor({moduleUrl});
  try{
    await Promise.all([a.ready,b.ready]);
    const [left,right]=await Promise.all([
      a.request({type:"init",options}),
      b.request({type:"init",options})
    ]);
    assert.deepEqual(left,right);
    await a.request({type:"write",row:0,field:"id",value:11});
    await b.request({type:"write",row:0,field:"id",value:99});
    await a.request({type:"write",row:1,field:"flag",value:true});
    assert.equal(await a.request({type:"read",row:0,field:"id"}),11);
    assert.equal(await b.request({type:"read",row:0,field:"id"}),99);
    assert.equal(await b.request({type:"read",row:1,field:"flag"}),false);
    await a.request({type:"write",row:0,field:"x",value:-0});
    assert.equal(Object.is(await a.request({type:"read",row:0,field:"x"}),-0),true);
    await a.request({type:"retire"});
    await assert.rejects(a.request({type:"read",row:0,field:"x"}),/retired/);
    assert.equal(await b.request({type:"read",row:0,field:"id"}),99);
  }finally{await Promise.all([a.close(),b.close()]);}
});
