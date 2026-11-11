// Worker-private f64 data-oriented storage.
// Intended to live inside one actor's dedicated Worker. No backing ArrayBuffer
// or typed-array view is exposed across the actor/message boundary.
const NativeArray = Array;
const NativeArrayBuffer = ArrayBuffer;
const NativeFloat64Array = Float64Array;
const NativeUint32Array = Uint32Array;
const nativeSafeInteger = Number.isSafeInteger;
const nativeFinite = Number.isFinite;
const nativeIsArray = Array.isArray;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const nativeHasOwn = Object.hasOwn;
const nativeTrunc = Math.trunc;
const nativeSetHas = Set.prototype.has;
const layouts = new Set(["aos","soa","aosoa","soaos"]);

export const MAX_WORKER_LAYOUT_BYTES = 16 * 1024 * 1024;
const MAX_LAYOUT_BYTES = 256 * 1024 * 1024;
const MAX_AOSOA_LANES = 1024;
const F64_BYTES = 8;

function snapshotGroups(groupWidths, fields) {
  if (!nativeIsArray(groupWidths) || groupWidths.length === 0 ||
      groupWidths.length > fields) {
    throw new TypeError("SoAoS requires bounded nonempty field groups");
  }
  const copy = new NativeUint32Array(groupWidths.length);
  let total = 0;
  for (let i = 0; i < groupWidths.length; ++i) {
    const descriptor = nativeOwnDescriptor(groupWidths, String(i));
    if (!descriptor || !nativeHasOwn(descriptor, "value") ||
        !nativeSafeInteger(descriptor.value) || descriptor.value <= 0) {
      throw new TypeError("SoAoS group widths must be own positive integers");
    }
    total += descriptor.value;
    if (total > fields) throw new RangeError("SoAoS groups exceed field count");
    copy[i] = descriptor.value;
  }
  if (total !== fields) throw new RangeError("SoAoS groups must partition every field");
  return copy;
}

export class WorkerLayoutF64 {
  #buffer;
  #cells;
  #rows;
  #fields;
  #layout;
  #lanes;
  #physicalRows;
  #byteLength;
  #groupCount = 0;
  #groupBase = null;
  #fieldOffset = null;
  #groupWidth = null;
  #closed = false;

  constructor({
    rows, fields, layout, lanes = 1, groupWidths = null,
    maxBytes = MAX_WORKER_LAYOUT_BYTES
  } = {}) {
    if (!nativeSafeInteger(rows) || rows <= 0 ||
        !nativeSafeInteger(fields) || fields <= 0) {
      throw new RangeError("invalid worker layout dimensions");
    }
    if (!nativeSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_LAYOUT_BYTES) {
      throw new RangeError("invalid worker layout byte limit");
    }
    if (!nativeSetHas.call(layouts, layout)) throw new RangeError("unknown worker layout");

    const maxScalars = nativeTrunc(maxBytes / F64_BYTES);
    if (rows > nativeTrunc(maxScalars / fields)) {
      throw new RangeError("worker layout exceeds byte limit");
    }

    if (layout === "aosoa") {
      if (!nativeSafeInteger(lanes) || lanes < 1 || lanes > MAX_AOSOA_LANES ||
          (lanes & (lanes - 1)) !== 0) {
        throw new RangeError("AoSoA lanes must be a power of two in [1,1024]");
      }
    } else if (lanes !== 1) {
      throw new RangeError("AoS, SoA, and SoAoS use lane width one");
    }

    const physicalRows = layout === "aosoa"
      ? rows + ((lanes - (rows & (lanes - 1))) & (lanes - 1))
      : rows;
    if (physicalRows > nativeTrunc(maxScalars / fields)) {
      throw new RangeError("AoSoA padding exceeds worker layout byte limit");
    }

    let groups = null;
    if (layout === "soaos") {
      groups = snapshotGroups(groupWidths, fields);
    } else if (groupWidths !== null) {
      throw new TypeError("SoAoS group metadata is invalid for this layout");
    }

    this.#rows = rows;
    this.#fields = fields;
    this.#layout = layout;
    this.#lanes = lanes;
    this.#physicalRows = physicalRows;
    this.#byteLength = physicalRows * fields * F64_BYTES;

    if (groups) {
      this.#groupCount = groups.length;
      this.#groupBase = new NativeUint32Array(fields);
      this.#fieldOffset = new NativeUint32Array(fields);
      this.#groupWidth = new NativeUint32Array(fields);
      let field = 0;
      let base = 0;
      for (let group = 0; group < groups.length; ++group) {
        const width = groups[group];
        for (let within = 0; within < width; ++within) {
          this.#groupBase[field] = base;
          this.#fieldOffset[field] = within;
          this.#groupWidth[field] = width;
          ++field;
        }
        base += rows * width;
      }
    }

    this.#buffer = new NativeArrayBuffer(this.#byteLength);
    this.#cells = new NativeFloat64Array(this.#buffer);
  }

  get rows() { return this.#rows; }
  get fields() { return this.#fields; }
  get layout() { return this.#layout; }
  get lanes() { return this.#lanes; }
  get physicalRows() { return this.#physicalRows; }
  get byteLength() { return this.#byteLength; }
  get groupCount() { return this.#groupCount; }
  get retired() { return this.#closed; }

  #requireLive() {
    if (this.#closed) throw new Error("worker layout retired");
  }

  #scalarIndex(row, field) {
    this.#requireLive();
    if (!nativeSafeInteger(row) || row < 0 || row >= this.#rows ||
        !nativeSafeInteger(field) || field < 0 || field >= this.#fields) {
      throw new RangeError("worker layout row/field out of bounds");
    }

    switch (this.#layout) {
      case "aos":
        return row * this.#fields + field;
      case "soa":
        return field * this.#rows + row;
      case "aosoa":
        return ((nativeTrunc(row / this.#lanes) * this.#fields + field) *
          this.#lanes) + (row % this.#lanes);
      case "soaos":
        return this.#groupBase[field] +
          row * this.#groupWidth[field] + this.#fieldOffset[field];
      default:
        throw new Error("unknown worker layout");
    }
  }

  getPhysicalByteOffset(row, field) {
    return this.#scalarIndex(row, field) * F64_BYTES;
  }

  read(row, field) {
    return this.#cells[this.#scalarIndex(row, field)];
  }

  write(row, field, value) {
    if (typeof value !== "number") throw new TypeError("worker layout value must be f64");
    this.#cells[this.#scalarIndex(row, field)] = value;
  }

  integrate(positionField, velocityField, dt) {
    this.#requireLive();
    if (!nativeSafeInteger(positionField) || !nativeSafeInteger(velocityField) ||
        positionField < 0 || positionField >= this.#fields ||
        velocityField < 0 || velocityField >= this.#fields ||
        positionField === velocityField || !nativeFinite(dt)) {
      throw new RangeError("integrate requires two valid fields and finite dt");
    }
    for (let row = 0; row < this.#rows; ++row) {
      this.write(row, positionField,
        this.read(row, positionField) + this.read(row, velocityField) * dt);
    }
  }

  snapshotColumn(field) {
    this.#requireLive();
    if (!nativeSafeInteger(field) || field < 0 || field >= this.#fields) {
      throw new RangeError("worker layout field out of bounds");
    }
    const result = new NativeArray(this.#rows);
    for (let row = 0; row < this.#rows; ++row) result[row] = this.read(row, field);
    return result;
  }

  retire() {
    if (this.#closed) return;
    for (let i = 0; i < this.#cells.length; ++i) this.#cells[i] = 0;
    this.#closed = true;
    this.#buffer = null;
    this.#cells = null;
    this.#groupBase = null;
    this.#fieldOffset = null;
    this.#groupWidth = null;
  }
}
