import test from "node:test";
import assert from "node:assert/strict";
import {spawnNodeActor} from "../src/actor-host.node.mjs";

const moduleUrl = new URL("./fixtures/worker-layout-handler.mjs",import.meta.url).href;

async function withActor(fn) {
  const actor = spawnNodeActor({moduleUrl});
  try { await actor.ready; return await fn(actor); }
  finally { await actor.close(); }
}

test("dedicated Worker owns four-layout actor state without backing-store export", async () => {
  for (const options of [
    {rows:7,fields:4,layout:"aos"},
    {rows:7,fields:4,layout:"soa"},
    {rows:7,fields:4,layout:"aosoa",lanes:4},
    {rows:7,fields:4,layout:"soaos",groupWidths:[2,2]}
  ]) {
    await withActor(async actor => {
      const meta = await actor.request({type:"init",options});
      assert.equal(meta.rows,7);
      assert.equal(meta.fields,4);
      if (options.layout === "aosoa") assert.equal(meta.physicalRows,8);
      if (options.layout === "soaos") assert.equal(meta.groupCount,2);

      for (let row=0;row<7;++row) {
        await actor.request({type:"write",row,field:0,value:row*10});
        await actor.request({type:"write",row,field:1,value:row+0.25});
        await actor.request({type:"write",row,field:2,value:row+0.5});
        await actor.request({type:"write",row,field:3,value:row===0?-0:(row===1?NaN:100+row)});
      }
      assert.equal(Object.is(await actor.request({type:"read",row:0,field:3}),-0),true);
      assert.equal(Number.isNaN(await actor.request({type:"read",row:1,field:3})),true);
      const position = await actor.request({
        type:"integrate",positionField:0,velocityField:2,dt:0.25
      });
      assert.deepEqual(position,Array.from({length:7},(_,row)=>row*10+(row+0.5)*0.25));
      assert.equal(Object.getPrototypeOf(position),Array.prototype);
      assert.equal("buffer" in position,false);
      await actor.request({type:"retire"});
      await assert.rejects(actor.request({type:"read",row:0,field:0}),/retired/);
    });
  }
});

test("same numeric layout in different Workers has independent mutable state", async () => {
  const a = spawnNodeActor({moduleUrl});
  const b = spawnNodeActor({moduleUrl});
  try {
    await Promise.all([a.ready,b.ready]);
    const options={rows:2,fields:2,layout:"soaos",groupWidths:[1,1]};
    await Promise.all([
      a.request({type:"init",options}),
      b.request({type:"init",options})
    ]);
    await a.request({type:"write",row:0,field:0,value:11});
    await b.request({type:"write",row:0,field:0,value:99});
    assert.equal(await a.request({type:"read",row:0,field:0}),11);
    assert.equal(await b.request({type:"read",row:0,field:0}),99);
  } finally {
    await Promise.all([a.close(),b.close()]);
  }
});

test("SoAoS is physically distinct from SoA inside the Worker", async () => {
  const soa = await withActor(async actor => {
    await actor.request({type:"init",options:{rows:4,fields:4,layout:"soa"}});
    return [
      await actor.request({type:"geometry",row:1,field:1}),
      await actor.request({type:"geometry",row:1,field:2})
    ];
  });
  const soaos = await withActor(async actor => {
    await actor.request({
      type:"init",options:{rows:4,fields:4,layout:"soaos",groupWidths:[2,2]}
    });
    return [
      await actor.request({type:"geometry",row:1,field:1}),
      await actor.request({type:"geometry",row:1,field:2})
    ];
  });
  assert.deepEqual(soa,[40,72]);
  assert.deepEqual(soaos,[24,80]);
});

test("Worker layout admission rejects bad groups, lanes and byte geometry", async () => {
  await withActor(async actor => {
    await assert.rejects(actor.request({
      type:"init",options:{rows:1,fields:1,layout:"invented"}
    }),/unknown worker layout/);
  });
  await withActor(async actor => {
    await assert.rejects(actor.request({
      type:"init",options:{rows:4,fields:4,layout:"aosoa",lanes:3}
    }),/power of two/);
  });
  await withActor(async actor => {
    await assert.rejects(actor.request({
      type:"init",options:{rows:4,fields:4,layout:"soaos",groupWidths:[2,1]}
    }),/partition/);
  });
  await withActor(async actor => {
    await assert.rejects(actor.request({
      type:"init",options:{rows:699050,fields:3,layout:"aosoa",lanes:1024}
    }),/padding/);
  });
});
