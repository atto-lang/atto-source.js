import {InvertedRowIndex} from "./inverted-row-index.mjs";
import {WorkerMixedLayout} from "./worker-mixed-layout.mjs";

const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const KINDS = new Set(["i64", "f64", "bool"]);

function checkValue(type, value) {
  if (type === "i64" && (typeof value !== "bigint" || value < MIN_I64 || value > MAX_I64))
    throw new RangeError("i64 field requires a signed 64-bit bigint");
  if (type === "f64" && typeof value !== "number")
    throw new TypeError("f64 field requires number");
  if (type === "bool" && typeof value !== "boolean")
    throw new TypeError("bool field requires boolean");
}
const zero = type => type === "i64" ? 0n : type === "f64" ? 0 : false;

/**
 * Host-only nominal schema. Identity is this instance, not the class spelling
 * or the physical field layout. Only a checked compiler may create/use its
 * field bindings for generated Oreslang guest code.
 */
export class InvertedSchema {
  #fields;
  #byName = new Map();
  #bindings = new WeakMap();

  constructor(fields) {
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > 256)
      throw new TypeError("inverted schema requires 1..256 fields");
    const copied = [];
    for (let i = 0; i < fields.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(fields, String(i));
      if (!entry || !Object.hasOwn(entry, "value") || !entry.value)
        throw new TypeError("inverted schema requires own data fields");
      const item = entry.value;
      const name = Object.getOwnPropertyDescriptor(item, "name");
      const type = Object.getOwnPropertyDescriptor(item, "type");
      if (!name || !type || !Object.hasOwn(name, "value") || !Object.hasOwn(type, "value") ||
          typeof name.value !== "string" || !/^[$A-Za-z_][$\w]*$/.test(name.value) ||
          this.#byName.has(name.value) || !KINDS.has(type.value))
        throw new TypeError("invalid inverted field declaration");
      const declaration = Object.freeze({name: name.value, type: type.value});
      this.#byName.set(name.value, i);
      copied.push(declaration);
    }
    this.#fields = Object.freeze(copied);
  }

  get fields() { return this.#fields; }

  bindField(name) {
    if (typeof name !== "string" || !this.#byName.has(name))
      throw new RangeError("unknown nominal inverted field");
    const ordinal = this.#byName.get(name);
    const binding = Object.freeze(Object.create(null));
    this.#bindings.set(binding, ordinal);
    return binding;
  }

  resolve(binding) {
    if (typeof binding !== "object" || binding === null || !this.#bindings.has(binding))
      throw new TypeError("foreign or invalid nominal inverted field binding");
    return this.#bindings.get(binding);
  }
}

/**
 * Bounded, actor-independent owning inverted array: SoA is the sole physical
 * authority, and the dense index owns all generational row metadata. A JS
 * Worker can own an instance, but construction in the main thread is also
 * valid. Never send an instance or its mutable columns across actor domains.
 *
 * This is a checked host lowering target, NOT guest inverted-class admission.
 * Dynamic growth, fixed POD records, and suspension-safe source loans remain
 * fail-closed until independently implemented.
 */
export class WorkerInvertedArray {
  #schema;
  #store;
  #index = new InvertedRowIndex();
  #loans;
  #capacity;
  #closed = false;

  constructor(schema, {capacity, maxBytes = 16 * 1024 * 1024} = {}) {
    if (!(schema instanceof InvertedSchema))
      throw new TypeError("a nominal inverted schema is required");
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2147483647)
      throw new RangeError("bounded inverted capacity must be 1..2^31-1");
    this.#schema = schema;
    this.#capacity = capacity;
    this.#store = new WorkerMixedLayout({
      fields: schema.fields, layout: "soa", rows: capacity, maxBytes
    });
    this.#loans = schema.fields.map(() => ({readers: 0, writer: false}));
  }

  #live() {
    if (this.#closed) throw new Error("inverted array closed");
  }
  get capacity() { this.#live(); return this.#capacity; }
  get size() { this.#live(); return this.#index.size; }
  get schema() { this.#live(); return this.#schema; }

  #ordinal(binding) { this.#live(); return this.#schema.resolve(binding); }

  #structural() {
    this.#live();
    if (this.#loans.some(loan => loan.readers !== 0 || loan.writer))
      throw new Error("inverted structural change conflicts with a column loan");
  }

  #values(row) {
    if (row === null || typeof row !== "object")
      throw new TypeError("inverted row requires an own-data record");
    const fields = this.#schema.fields;
    const keys = Reflect.ownKeys(row);
    if (keys.length !== fields.length)
      throw new TypeError("inverted row must contain exactly the declared fields");
    const values = [];
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(row, field.name);
      if (!descriptor || !Object.hasOwn(descriptor, "value"))
        throw new TypeError("inverted row disallows accessors or missing fields");
      checkValue(field.type, descriptor.value);
      values.push(descriptor.value);
    }
    return values;
  }

  #clear(row) {
    for (const field of this.#schema.fields)
      this.#store.write(row, field.name, zero(field.type));
  }

  push(row) {
    this.#structural();
    if (this.#index.size >= this.#capacity)
      throw new RangeError("inverted array at bounded capacity");
    // Validate getters, field kinds and i64 overflow before touching columns.
    const values = this.#values(row);
    const position = this.#index.size;
    try {
      for (let i = 0; i < values.length; i++)
        this.#store.write(position, this.#schema.fields[i].name, values[i]);
      // The index mints the handle BEFORE publishing the logical row.
      return this.#index.push();
    } catch (error) {
      this.#clear(position); // no unreachable live row or stale payload
      throw error;
    }
  }

  handleAt(position) { this.#live(); return this.#index.index(position); }
  resolve(handle) { this.#live(); return this.#index.resolve(handle); }

  eraseSwap(handle) {
    this.#structural();
    const position = this.#index.resolve(handle);
    const tail = this.#index.size - 1;
    // Prepare every field value while the old mapping is still valid.
    const fields = this.#schema.fields;
    const moved = position === tail ? null :
      fields.map(field => this.#store.read(tail, field.name));
    // Recycle allocation can throw; in that case the physical data remains
    // unchanged. After success all remaining operations are primitive writes.
    this.#index.eraseSwap(handle);
    if (moved) for (let i = 0; i < fields.length; i++)
      this.#store.write(position, fields[i].name, moved[i]);
    this.#clear(tail);
  }

  #read(row, ordinal, loan = null) {
    this.#live();
    const rights = this.#loans[ordinal];
    if (loan === null && rights.writer)
      throw new Error("inverted field has an exclusive column loan");
    if (loan !== null && loan.closed)
      throw new Error("inverted loan released");
    return this.#store.read(row, this.#schema.fields[ordinal].name);
  }

  #write(row, ordinal, value, loan = null) {
    this.#live();
    const rights = this.#loans[ordinal];
    if (loan === null && (rights.writer || rights.readers))
      throw new Error("inverted field loan prevents external write");
    if (loan !== null && (loan.closed || loan.kind !== "write"))
      throw new Error("inverted loan is not writable");
    const field = this.#schema.fields[ordinal];
    checkValue(field.type, value);
    this.#store.write(row, field.name, value);
  }

  readAt(position, binding) {
    const ordinal = this.#ordinal(binding);
    return this.#read(this.#index.position(position), ordinal);
  }
  writeAt(position, binding, value) {
    const ordinal = this.#ordinal(binding);
    this.#write(this.#index.position(position), ordinal, value);
  }
  read(handle, binding) {
    const ordinal = this.#ordinal(binding);
    return this.#read(this.#index.resolve(handle), ordinal);
  }
  write(handle, binding, value) {
    const ordinal = this.#ordinal(binding);
    this.#write(this.#index.resolve(handle), ordinal, value);
  }

  // Narrow closed primitive transaction; no user callback, await, or
  // intermediate row object. Source += must still be checker-admitted.
  addF64At(position, binding, delta) {
    const ordinal = this.#ordinal(binding);
    if (this.#schema.fields[ordinal].type !== "f64" || typeof delta !== "number")
      throw new TypeError("addF64At requires f64 field and delta");
    const row = this.#index.position(position);
    const value = this.#read(row, ordinal) + delta;
    this.#write(row, ordinal, value);
    return value;
  }

  borrowRead(binding) { return this.#borrow(binding, "read"); }
  borrowWrite(binding) { return this.#borrow(binding, "write"); }

  #borrow(binding, kind) {
    const ordinal = this.#ordinal(binding);
    const state = this.#loans[ordinal];
    if (state.writer || (kind === "write" && state.readers !== 0))
      throw new Error("conflicting inverted column loan");
    if (kind === "read") {
      if (state.readers === Number.MAX_SAFE_INTEGER)
        throw new RangeError("inverted column reader count exhausted");
      state.readers++;
    } else state.writer = true;
    const loan = {kind, closed: false};
    const close = () => {
      if (loan.closed) return;
      loan.closed = true;
      if (!this.#closed) {
        if (kind === "read") state.readers--;
        else state.writer = false;
      }
    };
    const result = {
      getAt: position => {
        if (loan.closed) throw new Error("inverted loan released");
        return this.#read(this.#index.position(position), ordinal, loan);
      },
      get: handle => {
        if (loan.closed) throw new Error("inverted loan released");
        return this.#read(this.#index.resolve(handle), ordinal, loan);
      },
      close
    };
    if (kind === "write") {
      result.setAt = (position, value) => {
        if (loan.closed) throw new Error("inverted loan released");
        this.#write(this.#index.position(position), ordinal, value, loan);
      };
      result.set = (handle, value) => {
        if (loan.closed) throw new Error("inverted loan released");
        this.#write(this.#index.resolve(handle), ordinal, value, loan);
      };
    }
    return Object.freeze(result);
  }

  snapshot(binding) {
    const ordinal = this.#ordinal(binding);
    if (this.#loans[ordinal].writer)
      throw new Error("exclusive inverted column loan prevents snapshot");
    const result = [];
    for (let i = 0; i < this.#index.size; i++)
      result.push(this.#read(i, ordinal));
    return result; // copy, never a backing typed array or ArrayBuffer
  }

  close() {
    if (this.#closed) return;
    this.#closed = true; // revoke every outstanding handle/loan first
    this.#index.close();
    this.#store.retire(); // zero all physical column storage
  }
}
