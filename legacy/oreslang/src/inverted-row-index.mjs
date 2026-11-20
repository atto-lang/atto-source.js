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

// A recoverable index miss is distinct from a forged or stale owner token.
// This yields owned generational handles, not borrowed element references.
const NO_ROW = Object.freeze({kind: "None"});
function optionalDenseRow(value, length) {
  let n;
  if (typeof value === "bigint") n = value;
  else if (typeof value === "number" && Number.isSafeInteger(value) &&
      !Object.is(value, -0)) n = BigInt(value);
  else throw new TypeError("inverted row index must be an integer");
  if (n < 0n || n > MAX_I32 || n >= BigInt(length)) return null;
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
    let slot;
    if (this.#free.length) slot = this.#free.pop();
    else {
      slot = this.#slots.length;
      this.#slots.push({row: 0, generation: 1n, live: false});
    }
    const state = this.#slots[slot];
    state.row = row;
    state.live = true;
    this.#rows.push(slot);
    return issue(this.#owner, this.#issuer, slot, state.generation);
  }

  // Candidate Option-like host API. No out-of-bounds handle is minted.
  // Actor/compiler source lowering must still prove borrow and Send rights.
  tryIndex(value) {
    this.#open();
    const row = optionalDenseRow(value, this.#rows.length);
    return row === null ? NO_ROW : Object.freeze({kind: "Some", value: this.index(row)});
  }

  index(value) {
    this.#open();
    const row = checkedIndex(value, this.#rows.length);
    const slot = this.#rows[row];
    const state = this.#slots[slot];
    if (!state || !state.live || state.row !== row)
      throw new Error("corrupt inverted dense-row mapping");
    return issue(this.#owner, this.#issuer, slot, state.generation);
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
    if (row !== last) {
      const displaced = this.#rows[last];
      this.#rows[row] = displaced;
      this.#slots[displaced].row = row;
    }
    this.#rows.pop();
    const victim = this.#slots[meta.slot];
    victim.live = false;
    if (victim.generation !== MAX_U64) {
      victim.generation++;
      this.#free.push(meta.slot);
    }
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
