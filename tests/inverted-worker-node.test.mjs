import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnNodeActor} from "../src/actor-host.node.mjs";
import {compileProgramV2} from "../src/program-v2.mjs";

const trustedRuntime=new URL("../src/worker-inverted-array.mjs",import.meta.url).href;
const positive=[
  "positive-positional-read.ores",
  "positive-handle-swap.ores"
];
const negative=[
  "reject-row-view-escape.ores",
  "reject-overlapping-column-loans.ores",
  "reject-loan-across-await.ores",
  "reject-nominal-row-handle.ores"
];
const readFixture=name=>readFile(new URL("./fixtures/inverted-v1/"+name,import.meta.url),"utf8");

test("two source-compiled inverted classes execute inside actual Node Workers",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"ores-inverted-node-worker-"));
  const actors=[];
  try {
    for(let i=0;i<positive.length;i++){
      const source=await readFixture(positive[i]);
      const compiled=compileProgramV2(source,{
        experimentalInvertedV1:true,
        runtimeSpecifier:trustedRuntime
      });
      assert.match(compiled,/new WorkerInvertedArray/);
      const artifact=join(directory,"inverted-"+i+".mjs");
      await writeFile(artifact,compiled,{flag:"wx",mode:0o600});
      const actor=spawnNodeActor({
        moduleUrl:pathToFileURL(artifact).href,
        exportName:"main",
        mode:"call"
      });
      actors.push(actor);
      await actor.ready;
      assert.equal(await actor.request({args:[]}),42n,positive[i]);
      assert.equal(await actor.request({args:[]}),42n,"subsequent call owns a fresh arena");
    }
    assert.equal(actors.length,2);
  } finally {
    const closeResults=await Promise.allSettled(actors.map(actor=>actor.close()));
    await rm(directory,{recursive:true,force:true});
    const failedClose=closeResults.find(result=>result.status==="rejected");
    if(failedClose)throw failedClose.reason;
  }
});

test("negative inverted sources cannot reach Node Worker artifact admission",async()=>{
  for(const name of negative) {
    const source=await readFixture(name);
    assert.throws(()=>compileProgramV2(source,{experimentalInvertedV1:true}),
      /inverted-v1/);
  }
});
