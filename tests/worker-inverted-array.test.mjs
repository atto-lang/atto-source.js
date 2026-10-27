import test from "node:test";
import assert from "node:assert/strict";
import {InvertedRowIndex} from "../src/inverted-row-index.mjs";
import {InvertedSchema, WorkerInvertedArray} from "../src/worker-inverted-array.mjs";
import {WorkerMixedLayout} from "../src/worker-mixed-layout.mjs";

const spec = () => new InvertedSchema([
  {name: "id", type: "i64"},
  {name: "x", type: "f64"},
  {name: "ready", type: "bool"}
]);
const make = (schema, capacity = 4) => new WorkerInvertedArray(schema, {capacity});

test("signed i64 is an aligned native cell in the existing SoA geometry", () => {
  const store = new WorkerMixedLayout({
    fields: [{name: "id", type: "i64"}, {name: "x", type: "f64"},
      {name: "ready", type: "bool"}], layout: "soa", rows: 2
  });
  assert.equal(store.address(0, "id").type, "i64");
  assert.equal(store.address(0, "id").absoluteByteOffset % 8, 0);
  store.write(0, "id", -(1n << 63n));
  store.write(1, "id", (1n << 63n) - 1n);
  assert.equal(store.read(0, "id"), -(1n << 63n));
  assert.equal(store.read(1, "id"), (1n << 63n) - 1n);
  for (const value of [1n << 63n, -(1n << 63n) - 1n, 12, "3", 1.25])
    assert.throws(() => store.write(0, "id", value));
  store.retire();
  assert.throws(() => store.read(0, "id"), /retired/);
});

test("nominal bindings, dense ordering, swap-delete and ABA prevention", () => {
  const schema = spec(), x = schema.bindField("x");
  const id = schema.bindField("id"), ready = schema.bindField("ready");
  const rows = make(schema);
  const a = rows.push({id: 11n, x: 1.25, ready: false});
  const b = rows.push({id: 22n, x: 2.5, ready: true});
  const c = rows.push({id: 33n, x: 3.75, ready: false});
  assert.equal(rows.resolve(b), 1);
  rows.eraseSwap(a);
  assert.equal(rows.resolve(c), 0);
  assert.equal(rows.readAt(0, id), 33n);
  assert.equal(rows.readAt(1n, ready), true);
  rows.write(c, x, 9.5);
  assert.equal(rows.readAt(0, x), 9.5);
  rows.eraseSwap(b);
  assert.throws(() => rows.read(b, id), /stale/);
  const d = rows.push({id: 44n, x: 4.5, ready: true});
  assert.equal(rows.read(d, id), 44n);
  assert.throws(() => rows.resolve(b), /stale/);
  assert.equal(rows.handleAt(0).slot, c.slot);
  const foreign = make(spec());
  const fh = foreign.push({id: 1n, x: 0, ready: false});
  assert.throws(() => rows.read(fh, id), /foreign|invalid/);
  assert.throws(() => rows.read(c, spec().bindField("x")), /foreign|invalid/);
  assert.throws(() => rows.read(c, {}), /foreign|invalid/);
  assert.throws(() => rows.readAt(0, schema.bindField("nonexistent")), /unknown/);
  for (const bad of [-1, -0, 1.1, Infinity, NaN, "0", 2n ** 63n])
    assert.throws(() => rows.readAt(bad, x));
  assert.deepEqual(rows.snapshot(id), [33n, 44n]);
  foreign.close();
  rows.close();
  assert.throws(() => rows.read(c, id), /closed/);
});

test("insertion validates full own-data row before touching storage", () => {
  const schema = spec(), rows = make(schema, 2);
  const id = schema.bindField("id");
  const good = rows.push({id: 7n, x: 7, ready: true});
  const cases = [
    {id: 1n << 63n, x: 4, ready: false},
    {id: 8n, x: "bad", ready: false},
    {id: 8n, x: 4, ready: 1},
    {id: 8n, x: 4, ready: true, extra: 1},
    Object.defineProperty({id: 8n, ready: false}, "x", {get() {throw Error("getter called");}})
  ];
  for (const input of cases) {
    assert.throws(() => rows.push(input));
    assert.equal(rows.size, 1);
    assert.equal(rows.read(good, id), 7n);
  }
  rows.push({id: 8n, x: 8, ready: false});
  assert.throws(() => rows.push({id: 9n, x: 9, ready: false}), /capacity/);
  rows.close();
});

test("failed handle mint never publishes an unreachable row, including slot reuse", () => {
  const index = new InvertedRowIndex();
  const a = index.push();
  index.eraseSwap(a);
  const original = Object.freeze;
  // Controlled test-only failure at the last allocation step of issue().
  Object.freeze = function (value) {
    if (value && Object.hasOwn(value, "owner")) throw Error("injected issue failure");
    return original(value);
  };
  try {
    assert.throws(() => index.push(), /injected issue failure/);
  } finally {
    Object.freeze = original;
  }
  assert.equal(index.size, 0);
  const b = index.push();
  assert.equal(index.resolve(b), 0);
  assert.notEqual(a.generation, b.generation);
  index.close();

  const schema = spec(), rows = make(schema), id = schema.bindField("id");
  const r = rows.push({id: 1n, x: 1, ready: true});
  Object.freeze = function (value) {
    if (value && Object.hasOwn(value, "owner")) throw Error("injected issue failure");
    return original(value);
  };
  try {
    assert.throws(() => rows.push({id: 2n, x: 2, ready: false}), /injected issue failure/);
  } finally {
    Object.freeze = original;
  }
  assert.equal(rows.size, 1);
  assert.deepEqual(rows.snapshot(id), [1n]);
  rows.push({id: 3n, x: 3, ready: false});
  assert.deepEqual(rows.snapshot(id), [1n, 3n]);
  assert.equal(rows.resolve(r), 0);
  rows.close();
});

test("column read/write loan exclusion, structural fencing and retirement", () => {
  const schema = spec(), rows = make(schema);
  const x = schema.bindField("x"), id = schema.bindField("id");
  const a = rows.push({id: 4n, x: 0.5, ready: false});
  const r1 = rows.borrowRead(x), r2 = rows.borrowRead(x);
  assert.equal(r1.get(a), 0.5);
  assert.throws(() => rows.borrowWrite(x), /conflicting/);
  assert.throws(() => rows.writeAt(0, x, 1), /loan/);
  assert.throws(() => rows.eraseSwap(a), /loan/);
  assert.throws(() => rows.push({id: 5n, x: 3, ready: false}), /loan/);
  const idWrite = rows.borrowWrite(id);
  idWrite.set(a, 9n);
  assert.equal(idWrite.getAt(0), 9n);
  assert.throws(() => rows.read(a, id), /exclusive/);
  idWrite.close();
  r1.close();
  assert.throws(() => rows.borrowWrite(x), /conflicting/);
  r2.close();
  const w = rows.borrowWrite(x);
  w.setAt(0, 2.5);
  assert.equal(w.get(a), 2.5);
  assert.throws(() => rows.snapshot(x), /exclusive/);
  w.close();
  assert.throws(() => w.get(a), /released/);
  assert.equal(rows.addF64At(0, x, 3.25), 5.75);
  assert.equal(rows.read(a, x), 5.75);
  assert.throws(() => rows.addF64At(0, id, 1), /f64/);
  const live = rows.borrowRead(x);
  rows.close();
  assert.throws(() => live.getAt(0), /closed|released/);
  live.close();
});

test("Proxy field validation cannot reenter mutation or retire the owning array", () => {
  const schema = spec(), rows = make(schema), id = schema.bindField("id");
  const first = rows.push({id: 1n, x: 1, ready: true});
  const row = new Proxy({id: 2n, x: 2, ready: false}, {
    ownKeys(target) {
      assert.throws(() => rows.push({id: 99n, x: 0, ready: false}), /reentrant/);
      assert.throws(() => rows.eraseSwap(first), /reentrant/);
      assert.throws(() => rows.close(), /reentrant/);
      assert.throws(() => rows.writeAt(0, id, 99n), /reentrant/);
      assert.throws(() => rows.borrowRead(id), /reentrant/);
      return Reflect.ownKeys(target);
    }
  });
  const second = rows.push(row);
  assert.equal(rows.size, 2);
  assert.equal(rows.read(first, id), 1n);
  assert.equal(rows.read(second, id), 2n);
  rows.close();
});

test("loan facade allocation failure does not publish reader or writer rights", () => {
  const schema = spec(), rows = make(schema), x = schema.bindField("x");
  const h = rows.push({id: 5n, x: 5, ready: true});
  const freeze = Object.freeze;
  Object.freeze = value => {
    if (value && typeof value.getAt === "function" && typeof value.close === "function")
      throw Error("injected loan facade allocation failure");
    return freeze(value);
  };
  try {
    assert.throws(() => rows.borrowRead(x), /injected loan facade/);
    assert.throws(() => rows.borrowWrite(x), /injected loan facade/);
  } finally {
    Object.freeze = freeze;
  }
  assert.equal(rows.read(h, x), 5);
  rows.write(h, x, 6);
  const w = rows.borrowWrite(x);
  w.set(h, 7);
  w.close();
  assert.equal(rows.read(h, x), 7);
  rows.eraseSwap(h);
  assert.equal(rows.size, 0);
  rows.close();
});
