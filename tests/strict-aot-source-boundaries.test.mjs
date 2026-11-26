import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileProgramV2, compileToProgramIRV2 } from "../src/program-v2.mjs";
import { validateProgramIRV2 } from "../src/program-ir-v2.mjs";

// This suite exercises the existing experimental JavaScript *subset*.
// It is not proof of sealed full guest AOT, zero process GC or backend parity.
const importGuest = async (source) => import("data:text/javascript;charset=utf-8," +
  encodeURIComponent(compileProgramV2(source)));

test("generated ESM rejects JavaScript coercion at integer and boolean ABI boundaries", async () => {
  const source = [
    "pub fnc choose(bool enabled,int yes,int no):int{return enabled ? yes : no;}",
    "pub fnc same(int a,int b):bool{return a eq b;}",
    "pub fnc positive(int a):bool{return a > 0;}"
  ].join("\n");
  const guest = await importGuest(source);
  assert.equal(guest.choose(true, 7n, 8n), 7n);
  assert.equal(guest.choose(false, 7n, 8n), 8n);
  assert.equal(guest.same(4n, 4n), true);
  assert.equal(guest.positive(1n), true);

  for (const value of [1, 1n, 0, "true", null, undefined, {}, [], new Boolean(true)]) {
    assert.throws(() => guest.choose(value, 7n, 8n), undefined,
      "truthy/falsy host value must not become a guest bool");
  }
  for (const value of [1, true, "7", 7.0, null, undefined, {}, Object(7n)]) {
    assert.throws(() => guest.same(value, 7n), undefined,
      "host coercion must not manufacture a guest int");
  }
});

test("source rejects forbidden dynamic/operator forms rather than synthesizing ESM", () => {
  const invalid = [
    "pub fnc bad():int{return eval(1);}",
    "pub fnc bad():int{return 1 ^ 2;}",
    "pub fnc bad():int{return true ^^ false;}",
    "pub fnc bad():bool{return 1 and true;}",
    "pub fnc bad():bool{return false or 1;}",
    "pub fnc bad():int{return true;}",
    "pub fnc bad():int{return 1 eq 1;}",
    "pub fnc bad():int{return new Function();}",
    "operator +(int a,int b):int{return a;}"
  ];
  for (const source of invalid) {
    assert.throws(() => compileToProgramIRV2(source), undefined,
      "invalid source must fail during typed source/IR admission: " + source);
    assert.throws(() => compileProgramV2(source), undefined,
      "invalid source must not produce executable ESM: " + source);
  }
});

test("canonical typed IR and emitted ESM agree on accepted boolean decisions", async () => {
  const source = [
    "pub fnc all(bool a,bool b):bool{return a and b;}",
    "pub fnc any(bool a,bool b):bool{return a or b;}",
    "pub fnc selected(bool a,bool b):int{return a or b ? 42 : 0;}"
  ].join("\n");
  const ir = compileToProgramIRV2(source);
  assert.deepEqual(validateProgramIRV2(JSON.parse(JSON.stringify(ir))), ir);
  const guest = await importGuest(source);
  for (const a of [false, true]) {
    for (const b of [false, true]) {
      assert.equal(guest.all(a, b), a && b);
      assert.equal(guest.any(a, b), a || b);
      assert.equal(guest.selected(a, b), a || b ? 42n : 0n);
    }
  }
});

test("the JS-specific policy remains a draft and never claims native guest AOT or process zero-GC", () => {
  const policy = readFileSync(new URL("../docs/AOT_ZERO_GC_DYNAMISM.md", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../.github/copilot-instructions.md", import.meta.url), "utf8");
  assert.match(policy, /DRAFT \/ target guidance; not an implementation receipt/u);
  assert.match(policy, /not native full guest AOT/u);
  assert.match(policy, /the JS engine may JIT and uses GC/u);
  assert.match(policy, /Legacy\/experimental divergence is labeled/u);
  // Local agent instructions delegate governance to the canonical org policy;
  // the backend evidence policy explicitly retains the zero-step rule.
  assert.match(agent, /github\.com\/atto-lang\/\.github\/blob\/main\/AGENTS\.md/u);
  assert.match(policy, /steps=\[\]/u);
  assert.match(policy, /steps=null/u);
  assert.match(policy, /NOT_EXECUTED/u);
  assert.match(copilot, /the JS engine may still JIT and use tracing GC/u);
});
