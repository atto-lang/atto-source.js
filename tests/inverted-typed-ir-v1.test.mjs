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


test("checked compound i64 positional/handle source lowering produces 42n", async () => {
  const header=[
    "define inverted class Particle as",
    "  int id;",
    "  float x;",
    "  bool ready;",
    "end",
    "define pub fnc main(): int {",
    "  let rows = InvertedArray<Particle>.with_capacity(3);",
    "  let h = rows.push(Particle {id: 37, x: 1.0, ready: true});"
  ].join("\n")+"\n";
  for(const update of ["rows[h].id += 5;","rows[0].id += 5;"]) {
    const input=header+update+" return rows[h].id; }";
    const ir=compileToInvertedIRV1(input);
    const op=ir.statements.find(s=>s.kind==="add_i64");
    assert.deepEqual(op.delta,{type:"i64",value:"5"});
    const esm=compileInvertedIRV1(ir,{runtimeSpecifier});
    assert.match(esm,/\.addI64(?:At)?\(/);
    assert.doesNotMatch(esm,/\.readAt\([^;\n]*\.writeAt\(/);
    assert.equal(await main(esm),42n);
    assert.equal(await main(compileProgramV2(input,{
      experimentalInvertedV1:true,runtimeSpecifier
    })),42n);
  }
});

test("signed i64 compound overflow traps and never wraps", async () => {
  const head=[
    "define inverted class Particle as",
    "  int id;",
    "end",
    "define pub fnc main(): int {",
    "  let rows = InvertedArray<Particle>.with_capacity(2);",
    "  let h = rows.push(Particle {id: 9223372036854775807});",
    "  rows[h].id += 1;",
    "  return rows[h].id;",
    "}"
  ].join("\n");
  const mod=await import("data:text/javascript,"+encodeURIComponent(
    compileProgramV2(head,{experimentalInvertedV1:true,runtimeSpecifier})
  ));
  assert.throws(()=>mod.main(),/ORES_I64_OVERFLOW/);
});

test("typed IR rejects non-i64 +=, forged owner, field, delta, or erased handles", () => {
  const header=[
    "define inverted class Particle as",
    "  int id;",
    "  float x;",
    "  bool ready;",
    "end",
    "define pub fnc main(): int {",
    "  let rows = InvertedArray<Particle>.with_capacity(2);",
    "  let h = rows.push(Particle {id: 37, x: 1.0, ready: true});",
    "  rows[h].id += 5;",
    "  return rows[h].id;",
    "}"
  ].join("\n");
  const ir=compileToInvertedIRV1(header);
  const tamper=[
    q=>{q.statements[2].owner=1;},
    q=>{q.statements[2].field=1;},
    q=>{q.statements[2].index.slot=0;},
    q=>{q.statements[2].delta.type="f64";},
    q=>{q.statements[2].delta.value="9223372036854775808";},
    q=>{q.statements[2].delta.value="1;throw Error()";},
    q=>{q.statements[2].index={kind:"position",value:"1n"};},
    q=>{q.statements[2].op="+";},
    q=>{q.statements.splice(2,0,{kind:"erase",owner:0,handle:1});},
    q=>{q.statements[2].kind="write";},
  ];
  for(const attack of tamper) {
    const candidate=copy(ir);
    attack(candidate);
    assert.throws(()=>compileInvertedIRV1(candidate),InvertedIRError);
  }
  for(const source of [
    header.replace("rows[h].id += 5","rows[h].x += 5"),
    header.replace("rows[h].id += 5","rows[h].ready += 5"),
    header.replace("rows[h].id += 5","rows[h].id += true"),
    header.replace("rows[h].id += 5","rows[h].id += 9223372036854775808"),
    header.replace("rows[h].id += 5","rows[h].id += -9223372036854775809"),
  ])assert.throws(()=>compileToInvertedIRV1(source));
});


test("f64 -0.0 preserves IEEE signed zero through typed IR and emitted ESM", () => {
  const source=[
    "define inverted class Particle as",
    "  int id;",
    "  float x;",
    "end",
    "define pub fnc main(): int {",
    "  let rows = InvertedArray<Particle>.with_capacity(1);",
    "  let h = rows.push(Particle {id: 42, x: -0.0});",
    "  rows[h].x = -0.0;",
    "  return rows[h].id;",
    "}"
  ].join("\n");
  const ir=compileToInvertedIRV1(source);
  assert.deepEqual(ir.statements[1].values[1],{type:"f64",value:"-0"});
  assert.deepEqual(ir.statements[2].value,{type:"f64",value:"-0"});
  const emitted=compileInvertedIRV1(ir,{runtimeSpecifier});
  assert.match(emitted,/\["x"\]:-0\b/);
  assert.match(emitted,/\.write\([^;\n]*,-0\);/);
  const valid=validateInvertedIRV1(ir);
  assert.equal(valid.statements[1].values[1].value,"-0");

  const malformed=copy(ir);
  malformed.statements[1].values[1].value="-0.0";
  assert.throws(()=>compileInvertedIRV1(malformed),InvertedIRError);
  malformed.statements[1].values[1].value="-0e0";
  assert.throws(()=>compileInvertedIRV1(malformed),InvertedIRError);
});
