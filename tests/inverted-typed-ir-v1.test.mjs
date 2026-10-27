import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileProgramV2,checkProgramV2,compileToProgramIRV2} from "../src/program-v2.mjs";
import {compileToInvertedIRV1,compileInvertedIRV1,compileInvertedSourceV1} from "../src/inverted-source-v1.mjs";
import {validateInvertedIRV1,InvertedIRError} from "../src/inverted-ir-v1.mjs";

const runtimeSpecifier=new URL("../src/worker-inverted-array.mjs",import.meta.url).href;
const source=readFileSync(new URL("./fixtures/inverted-v1/positive-positional-read.ores",import.meta.url),"utf8");
const other=readFileSync(new URL("./fixtures/inverted-v1/positive-handle-swap.ores",import.meta.url),"utf8");
const copy=o=>JSON.parse(JSON.stringify(o));
const main=async esm => (await import("data:text/javascript,"+encodeURIComponent(esm))).main();

test("source → strict typed IR → guest ESM via existing program-v2 API", async () => {
  for(const fixture of [source,other]){
    const ir=compileToInvertedIRV1(fixture);
    assert.equal(ir.dialect,"oreslang.inverted");
    assert.equal(ir.integerModel,"signed-i64-checked");
    assert.ok(ir.statements.some(s=>s.kind==="alloc"));
    assert.ok(ir.statements.some(s=>s.kind==="return"));
    const standalone=compileInvertedIRV1(ir,{runtimeSpecifier});
    const dispatched=compileProgramV2(fixture,{experimentalInvertedV1:true,runtimeSpecifier});
    assert.equal(dispatched,standalone,"same typed IR lowering through program-v2");
    assert.equal(await main(dispatched),42n);
    assert.equal(checkProgramV2(fixture,{experimentalInvertedV1:true}),true);
  }
});

test("old program-v2 compiler remains ordinary scalar and opt-in only", async () => {
  const plain="pub fnc main(): int {return 42;}";
  const esm=compileProgramV2(plain);
  assert.equal(await main(esm),42n);
  assert.deepEqual(compileToProgramIRV2(plain).functions.length,1);
  assert.throws(()=>compileProgramV2(source));
  assert.throws(()=>compileToProgramIRV2(source));
  assert.throws(()=>compileProgramV2(plain,{experimentalInvertedV1:true}));
});

test("options gate rejects accessor, unknown settings and implicit module authority", () => {
  for(const opts of [
    {runtimeSpecifier:"./worker-inverted-array.mjs"},
    {experimentalInvertedV1:"true"},
    {experimentalInvertedV1:true,unknown:true},
    Object.defineProperty({}, "experimentalInvertedV1", {get(){throw Error("getter executed");}}),
    null
  ]) assert.throws(()=>compileProgramV2(source,opts));
});

test("IR validator detaches input and rejects foreign owners and shape injection", async () => {
  const clean=compileToInvertedIRV1(source);
  const detached=validateInvertedIRV1(clean);
  const serialized=compileInvertedIRV1(clean,{runtimeSpecifier});
  clean.schema.fields[0].name="HACK";
  assert.equal(detached.schema.fields[0].name,"id");
  assert.equal(await main(serialized),42n);
  const base=compileToInvertedIRV1(source);
  const tamper=[
    p=>{p.schemaVersion=2;},
    p=>{p.integerModel="signed-i64-wrapping";},
    p=>{p.schema.fields[0].name=p.schema.fields[1].name;},
    p=>{p.schema.fields[0].type="Pointer";},
    p=>{p.statements[0].capacity=0;},
    p=>{p.statements[1].owner=20;},
    p=>{p.statements[1].slot=255;},
    p=>{p.statements[1].values[0].type="f64";},
    p=>{p.statements[1].values[0].value="1n";},
    p=>{p.statements[1].values[1].value="NaN";},
    p=>{p.statements[1].values[1].value="1;globalThis.hacked=true";},
    p=>{p.statements.push({kind:"return",expr:{kind:"literal",value:"9"}});},
    p=>{p.schema.extra=true;},
    p=>{p.statements[0].extra=true;},
    p=>{p.statements[2].owner=1;},
    p=>{Object.defineProperty(p.statements[0],"capacity",{get(){throw Error("getter leak");}});}
  ];
  for(const mutate of tamper) {
    const candidate=copy(base);
    mutate(candidate);
    assert.throws(()=>compileInvertedIRV1(candidate,{runtimeSpecifier}),InvertedIRError);
  }
});

test("direct IR handle ownership and indexed field value checks are mandatory", async () => {
  const input=compileToInvertedIRV1(source);
  const injected=copy(input);
  // The second inserted handle belongs to array slot 0, not another owner.
  injected.statements.splice(1,0,{kind:"alloc",slot:1,capacity:2});
  assert.throws(()=>compileInvertedIRV1(injected),InvertedIRError);
  const controlled=copy(input);
  controlled.statements.splice(-1,0,{
    kind:"write",owner:0,index:{kind:"handle",slot:1},field:0,
    value:{type:"i64",value:"41"}
  });
  assert.equal(await main(compileInvertedIRV1(controlled,{runtimeSpecifier})),63n);
  controlled.statements[controlled.statements.length-2].index.slot=0;
  assert.throws(()=>compileInvertedIRV1(controlled),InvertedIRError);
  const malicious=copy(input);
  malicious.statements[malicious.statements.length-1].expr={
    kind:"read",owner:0,index:{kind:"position",value:"-1"},field:1
  };
  assert.throws(()=>compileInvertedIRV1(malicious),InvertedIRError);
});

test("hostile IR kind accessors are rejected without evaluating getters", () => {
  let getterCalls=0;
  const base=compileToInvertedIRV1(source);
  for(const mutate of [
    p=>Object.defineProperty(p.statements[0],"kind",{get(){getterCalls++;throw Error("kind getter executed");}}),
    p=>Object.defineProperty(p.statements.at(-1).expr,"kind",{get(){getterCalls++;throw Error("expression getter executed");}}),
    p=>{p.statements[1].values[0].value="10";
      p.statements.at(-1).expr={kind:"read",owner:0,index:{kind:"position",value:"0"},field:0};
      Object.defineProperty(p.statements.at(-1).expr.index,"kind",{get(){getterCalls++;throw Error("index getter executed");}});}
  ]) {
    const p=copy(base);
    mutate(p);
    assert.throws(()=>compileInvertedIRV1(p),InvertedIRError);
  }
  assert.equal(getterCalls,0);
});

test("direct handles are retired affine values; survivors remain valid after swap-delete", async () => {
  const header=`define inverted class Particle as
    int id;
    float x;
    bool ready;
  end
  define pub fnc main(): int {
    let rows = InvertedArray<Particle>.with_capacity(3);
    let a = rows.push(Particle {id: 1, x: 1.0, ready: true});
    let b = rows.push(Particle {id: 42, x: 2.0, ready: false});
    rows.erase_swap(a);
  `;
  const valid=header+"return rows[b].id; }";
  assert.equal(await main(compileProgramV2(valid,{
    experimentalInvertedV1:true,runtimeSpecifier
  })),42n);
  for(const body of [
    "return rows[a].id; }",
    "rows.erase_swap(a); return rows[b].id; }",
    "rows[a].id = 5; return rows[b].id; }"
  ]) {
    assert.throws(()=>compileToInvertedIRV1(header+body),InvertedIRError);
    assert.throws(()=>compileProgramV2(header+body,{experimentalInvertedV1:true}),InvertedIRError);
  }
});


test("nominal __proto__ field is emitted as an own-data scalar, never object prototype", async () => {
  const source=[
    "define inverted class Particle as",
    "  int __proto__;",
    "  float x;",
    "  bool ready;",
    "end",
    "define pub fnc main(): int {",
    "  let rows = InvertedArray<Particle>.with_capacity(2);",
    "  let h = rows.push(Particle {__proto__: 42, x: 1.0, ready: true});",
    "  return rows[h].__proto__;",
    "}"
  ].join("\n");
  const ir=compileToInvertedIRV1(source);
  const esm=compileInvertedIRV1(ir,{runtimeSpecifier});
  assert.match(esm,/\["__proto__"\]:42n/);
  assert.doesNotMatch(esm,/\{"__proto__":42n/);
  assert.equal(await main(esm),42n);
  assert.equal(await main(compileProgramV2(source,{experimentalInvertedV1:true,runtimeSpecifier})),42n);
});
