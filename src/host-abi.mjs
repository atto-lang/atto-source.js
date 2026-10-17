/**
 * Experimental Oreslang JavaScript scalar host ABI, version 1.
 *
 * Handles typed scalar values at a TRUSTED precompiled ESM module boundary.
 * This does not load code, perform I/O, authorize capabilities, or sandbox guests.
 * A host must independently authenticate the artifact and isolate untrusted code.
 */
export const HOST_ABI_VERSION = 1;
const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;
const INT_RE = /^(?:0|-?[1-9][0-9]{0,18})$/;
const ENTRY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ARGS = 128;

function assertI64(value) {
  if (typeof value !== 'bigint' || value < MIN || value > MAX) {
    throw new TypeError('Oreslang i64 must be a signed 64-bit BigInt');
  }
  return value;
}
function assertWireShape(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('invalid Oreslang scalar envelope');
  }
  const names = Reflect.ownKeys(value);
  if (names.length !== 3 ||
      !['version','type','value'].every(k => Object.hasOwn(value,k))) {
    throw new TypeError('invalid Oreslang scalar envelope keys');
  }
  for (const k of names) {
    const d=Object.getOwnPropertyDescriptor(value,k);
    if (!d || !Object.hasOwn(d,'value')) {
      throw new TypeError('accessors are not valid Oreslang scalar fields');
    }
  }
}
export function encodeI64(value) {
  return {version: HOST_ABI_VERSION, type: 'i64', value: assertI64(value).toString(10)};
}
export function decodeI64(value) {
  assertWireShape(value);
  if (value.version !== HOST_ABI_VERSION || value.type !== 'i64' ||
      typeof value.value !== 'string' || !INT_RE.test(value.value)) {
    throw new TypeError('invalid Oreslang i64 envelope');
  }
  return assertI64(BigInt(value.value));
}
/**
 * Call a public export in an ALREADY LOADED AND TRUSTED ESM namespace.
 * No source evaluation, dynamic import, JS-number coercion or async effects.
 * The caller owns module integrity verification, budgets and OS isolation.
 */
export function invokeTrustedScalar(moduleNamespace, entry, wireArgs = []) {
  if (moduleNamespace === null || typeof moduleNamespace !== 'object' ||
      typeof entry !== 'string' || !ENTRY_RE.test(entry) ||
      !Array.isArray(wireArgs) || wireArgs.length > MAX_ARGS) {
    throw new TypeError('invalid trusted Oreslang entry request');
  }
  if (!Object.hasOwn(moduleNamespace,entry) ||
      typeof moduleNamespace[entry] !== 'function') {
    throw new TypeError('Oreslang public entry is unavailable');
  }
  const args = wireArgs.map(decodeI64);
  const fn = moduleNamespace[entry];
  // All currently supported Oreslang functions are synchronous scalar functions.
  if (fn.length !== args.length) throw new TypeError('Oreslang entry arity mismatch');
  return encodeI64(Reflect.apply(fn,undefined,args));
}
