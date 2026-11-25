import test from "node:test";
import assert from "node:assert/strict";
import { InvertedRowIndex } from "../src/inverted-row-index.mjs";

test("checked dense indices yield Some/None without forging row handles", () => {
  const rows = new InvertedRowIndex();
  assert.deepEqual(rows.tryIndex(0), {kind: "None"});
  const first = rows.push();
  const second = rows.push();
  assert.equal(rows.tryIndex(0).kind, "Some");
  assert.equal(rows.resolve(rows.tryIndex(0).value), 0);
  assert.equal(rows.resolve(rows.tryIndex(1n).value), 1);
  for (const i of [-1, 2, 4294967295n, 2147483648n, (1n << 63n) - 1n]) {
    const option = rows.tryIndex(i);
    assert.deepEqual(option, {kind: "None"});
    assert.equal(Object.isFrozen(option), true);
  }
  assert.equal(rows.resolve(first), 0);
  assert.equal(rows.resolve(second), 1);
});

test("malformed indices cannot coerce into an existing slot", () => {
  const rows = new InvertedRowIndex();
  rows.push();
  for (const i of [NaN, Infinity, -0, 0.25, "0", null, undefined,
    Number.MAX_SAFE_INTEGER + 1, {}, Symbol("0")])
    assert.throws(() => rows.tryIndex(i), TypeError);
  assert.equal(rows.size, 1);
});

test("Some handles preserve owner+generation through swap erase and reuse", () => {
  const rows = new InvertedRowIndex(), foreign = new InvertedRowIndex();
  const victim = rows.push(), survivor = rows.push();
  foreign.push();
  const wrapped = rows.tryIndex(1);
  assert.equal(wrapped.kind, "Some");
  assert.throws(() => foreign.resolve(wrapped.value), TypeError);
  rows.eraseSwap(victim);
  assert.equal(rows.resolve(survivor), 0);
  assert.equal(rows.resolve(wrapped.value), 0);
  assert.deepEqual(rows.tryIndex(1), {kind: "None"});
  assert.throws(() => rows.resolve(victim), RangeError);
  rows.push();
  assert.throws(() => rows.resolve(victim), RangeError);
});

test("retired dense index rejects even out-of-range optional reads", () => {
  const rows = new InvertedRowIndex();
  rows.close();
  for (const i of [-1, 0, 1n, 2147483648n])
    assert.throws(() => rows.tryIndex(i), /closed/);
});

test("optional lookup never turns nested missing values into raw null", () => {
  const rows = new InvertedRowIndex();
  const absent = rows.tryIndex(0);
  assert.equal(absent.kind, "None");
  assert.notEqual(absent, null);
  rows.push();
  const present = rows.tryIndex(0);
  assert.equal(present.kind, "Some");
  assert.notEqual(present.value, null);
  assert.equal(Object.isFrozen(present), true);
});
