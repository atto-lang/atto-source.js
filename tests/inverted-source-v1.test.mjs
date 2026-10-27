import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {compileInvertedSourceV1, InvertedSourceCompileError} from "../src/inverted-source-v1.mjs";
import {compile as compileScalarV1} from "../src/compiler.mjs";
import {compileProgramV2} from "../src/program-v2.mjs";

const fixtureBlobs = Object.freeze({
  "positive-positional-read.ores": "3e93d20f17120c7b85a59f646e3737e1142d002d",
  "positive-handle-swap.ores": "700eedd0b6422f2361a12d61a903537d33520ff3",
  "reject-row-view-escape.ores": "ebdef4b5bb9acc217cfe09b70de6de8df92d5d3e",
  "reject-overlapping-column-loans.ores": "7a329597b9f471b6fc1fd4a183015c20ddd5b109",
  "reject-loan-across-await.ores": "8816bb413013e104addb37459734e40d0a06df1a",
  "reject-nominal-row-handle.ores": "b34ed3635f3a662201c9b575f387b0df863bb255"
});
function fixture(name) {
  const bytes=readFileSync(new URL("./fixtures/inverted-v1/"+name, import.meta.url));
  const blob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(blob,fixtureBlobs[name], "shared conformance fixture SHA");
  return bytes.toString("utf8");
}
const runtimeSpecifier = new URL("../src/worker-inverted-array.mjs",import.meta.url).href;
async function guest(source) {
  const esm=compileInvertedSourceV1(source,{runtimeSpecifier});
  // This is the exact ESM produced by the compiler; Node's module loader
  // resolves an explicit absolute file URL for the trusted runtime target.
  const mod=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(esm));
  return {esm,value:mod.main()};
}

test("two exact cross-backend positive source vectors emit and execute real ESM", async () => {
  for (const name of ["positive-positional-read.ores","positive-handle-swap.ores"]) {
    const {esm,value}=await guest(fixture(name));
    assert.equal(value,42n,name);
    assert.match(esm,/new WorkerInvertedArray/);
    assert.match(esm,/\.readAt\(|\.read\(/);
    assert.doesNotMatch(esm,/\beval\(|new Function|Reflect\.get/);
  }
});

test("shared negative source vectors fail closed before JS emission", () => {
  for (const name of Object.keys(fixtureBlobs).filter(x=>x.startsWith("reject-"))) {
    assert.throws(()=>compileInvertedSourceV1(fixture(name)),InvertedSourceCompileError,name);
  }
});

const header=`define inverted class Particle as
  int id;
  float x;
  bool ready;
end
define pub fnc main(): int {
  let rows = InvertedArray<Particle>.with_capacity(3);
  let h = rows.push(Particle {id: 1, x: 2.5, ready: true});
`;

test("typed positional assignment, stable handle and checked addition execute", async () => {
  const source=header+"  rows[0].id = 41; return rows[h].id + 1; }";
  const {value,esm}=await guest(source);
  assert.equal(value,42n);
  assert.match(esm,/\.writeAt\(/);
  assert.match(esm,/\.read\(/);
});

test("negative and out-of-bounds dense indexes throw from owning array", async () => {
  for (const index of ["-1","2"]) {
    const source=header+" return rows["+index+"].id; }";
    const esm=compileInvertedSourceV1(source,{runtimeSpecifier});
    const mod=await import("data:text/javascript,"+encodeURIComponent(esm));
    assert.throws(()=>mod.main(),/inverted row index outside current length/);
  }
});

test("checked i64 output arithmetic traps rather than wrapping", async () => {
  const source=header.replace("id: 1","id: 9223372036854775807")+
    " return rows[0].id + 1; }";
  const esm=compileInvertedSourceV1(source,{runtimeSpecifier});
  const mod=await import("data:text/javascript,"+encodeURIComponent(esm));
  assert.throws(()=>mod.main(),/ORES_I64_OVERFLOW/);
});

test("nominal handle ownership rejects cross-array use before emission", () => {
  const source=header.replace(
    "  let h = rows.push",
    "  let others = InvertedArray<Particle>.with_capacity(2);\n  let h = rows.push")+
    " return others[h].id; }";
  assert.throws(()=>compileInvertedSourceV1(source),/foreign or nonnominal row handle/);
});

test("invalid field, assignment kind, row-view escape and async source reject", () => {
  const invalid=[
    header+" return rows[0].not_declared; }",
    header+" rows[0].id = true; return rows[0].id; }",
    header+" return rows[0]; }",
    header+" await h; return rows[0].id; }",
    header+" rows[0].id += 1; return rows[0].id; }",
    header+" return rows[0].ready; }",
    header+" let h2 = rows.push(Particle {id: 3, x: 0.0, ready: 7}); return rows[0].id; }"
  ];
  for(const src of invalid)
    assert.throws(()=>compileInvertedSourceV1(src),InvertedSourceCompileError);
});

test("comment lookalikes do not introduce privileged source grammar", async () => {
  const source="// define inverted class Fake as\n"+header+
    " /* await, cross-actor mutable borrow */ return rows[0].id; }";
  assert.equal((await guest(source)).value,1n);
});

test("ordinary JS compiler lanes stay fail-closed on inverted guest syntax", () => {
  const source=fixture("positive-positional-read.ores");
  assert.throws(()=>compileScalarV1(source));
  assert.throws(()=>compileProgramV2(source));
});
