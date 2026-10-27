const META = new WeakMap();
let nextOwner = 1n;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_I32 = 2147483647n;

function checkedIndex(value, length) {
  let n;
  if (typeof value === "bigint") n = value;
  else if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0))
    n = BigInt(value);
  else throw new TypeError("inverted row index must be an integer");
  if (n < 0n || n > MAX_I32 || n >= BigInt(length))
    throw new RangeError("inverted row index outside current length");
  return Number(n);
}

function issue(owner, issuer, slot, generation) {
  const handle = {};
  META.set(handle, {owner, issuer, slot, generation});
  Object.defineProperties(handle, {
    owner: {enumerable: true, value: owner},
    slot: {enumerable: true, value: slot},
    generation: {enumerable: true, value: generation}
  });
  return Object.freeze(handle);
}

export class InvertedRowIndex {
  #owner;
  #issuer = {};
  #rows = [];
  #slots = [];
  #free = [];
  #closed = false;

  constructor() {
    if (nextOwner === MAX_U64) throw new RangeError("inverted row owner identity exhausted");
    this.#owner = nextOwner++;
  }

  get size() {
    this.#open();
    return this.#rows.length;
  }

  push() {
    this.#open();
    if (this.#rows.length >= MAX_I32) throw new RangeError("inverted row count exhausted");
    const row = this.#rows.length;
    const reused = this.#free.length !== 0;
    const slot = reused ? this.#free[this.#free.length - 1] : this.#slots.length;
    const state = reused ? this.#slots[slot] : {row: 0, generation: 1n, live: false};
    if (reused && (!state || state.live || state.generation === MAX_U64))
      throw new Error("corrupt inverted free-slot mapping");
    // Mint before publishing row or consuming a recycled slot. A failed
    // allocation/freeze cannot create a live row without a returned handle.
    const handle = issue(this.#owner, this.#issuer, slot, state.generation);
    if (!reused) this.#slots.push(state);
    try {
      this.#rows.push(slot);
    } catch (error) {
      if (!reused) this.#slots.pop();
      throw error;
    }
    if (reused) this.#free.pop();
    state.row = row;
    state.live = true;
    return handle;
  }

  position(value) {
    this.#open();
    const row = checkedIndex(value, this.#rows.length);
    const slot = this.#rows[row];
    const state = this.#slots[slot];
    if (!state || !state.live || state.row !== row)
      throw new Error("corrupt inverted dense-row mapping");
    return row;
  }

  index(value) {
    const row = this.position(value);
    const slot = this.#rows[row];
    return issue(this.#owner, this.#issuer, slot, this.#slots[slot].generation);
  }

  resolve(handle) {
    this.#open();
    const meta = META.get(handle);
    if (!meta || meta.issuer !== this.#issuer || meta.owner !== this.#owner ||
        !Number.isSafeInteger(meta.slot) || meta.slot < 0 || meta.slot >= this.#slots.length)
      throw new TypeError("foreign or invalid inverted row handle");
    const state = this.#slots[meta.slot];
    if (!state.live || state.generation !== meta.generation)
      throw new RangeError("stale inverted row handle");
    return state.row;
  }

  eraseSwap(handle) {
    const row = this.resolve(handle);
    const meta = META.get(handle);
    const last = this.#rows.length - 1;
    const victim = this.#slots[meta.slot];
    // Reserve the recycled-slot entry before changing live row mappings.
    // If array growth throws, the deletion remains entirely uncommitted.
    const recycle = victim.generation !== MAX_U64;
    if (recycle) this.#free.push(meta.slot);
    if (row !== last) {
      const displaced = this.#rows[last];
      this.#rows[row] = displaced;
      this.#slots[displaced].row = row;
    }
    this.#rows.pop();
    victim.live = false;
    if (recycle) victim.generation++;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#slots) state.live = false;
    this.#rows.length = 0;
    this.#free.length = 0;
  }

  #open() {
    if (this.#closed) throw new Error("inverted row index is closed");
  }
}
