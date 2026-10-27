import test from "node:test";
import assert from "node:assert/strict";
import {InvertedRowIndex} from "../src/inverted-row-index.mjs";

test("inverted dense index preserves logical identity and rejects edge cases", () => {
  const rows = new InvertedRowIndex();
  for (const bad of [-1, -0, 1.5, NaN, Infinity, -Infinity, "0", -1n,
                     2147483648n, (1n << 63n) - 1n, -(1n << 63n)])
    assert.throws(() => rows.index(bad));

  const first = rows.push();
  const middle = rows.push();
  const last = rows.push();
  const savedMiddle = rows.index(1n);
  assert.equal(rows.resolve(rows.index(0)), 0);
  assert.equal(rows.resolve(savedMiddle), 1);
  assert.equal(savedMiddle.slot, middle.slot);
  assert.equal(savedMiddle.generation, middle.generation);
  assert.throws(() => rows.index(3));

  rows.eraseSwap(first);
  assert.equal(rows.resolve(last), 0);
  assert.equal(rows.resolve(savedMiddle), 1);
  assert.equal(rows.index(0).slot, last.slot);

  rows.eraseSwap(savedMiddle);
  assert.throws(() => rows.resolve(savedMiddle), /stale/);
  const reused = rows.push();
  assert.equal(reused.slot, middle.slot);
  assert.notEqual(reused.generation, middle.generation);
  assert.throws(() => rows.resolve(savedMiddle), /stale/);
  assert.equal(rows.resolve(rows.index(1n)), 1);

  const foreign = new InvertedRowIndex();
  const foreignHandle = foreign.push();
  assert.throws(() => rows.resolve(foreignHandle), /foreign|invalid/);
  foreign.close();

  rows.close();
  assert.throws(() => rows.index(0), /closed/);
  assert.throws(() => rows.resolve(last), /closed/);
});

test("inverted row handles are frozen and cannot be forged from coordinates", () => {
  const rows = new InvertedRowIndex();
  const handle = rows.push();
  assert.equal(Object.isFrozen(handle), true);
  assert.throws(() => rows.resolve({
    owner: handle.owner, slot: handle.slot, generation: handle.generation
  }), /foreign|invalid/);
  rows.close();
});
