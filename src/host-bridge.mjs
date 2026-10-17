/** Pure, environment-independent ESM host bridge. NOT a security sandbox. */
export const HOST_ABI = 'oreslang-js-int64-v1';
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export class HostBridgeError extends Error {
  constructor(message) { super(message); this.name = 'HostBridgeError'; }
}

/** Reject oversized, lossy, noncanonical or out-of-range JSON int64 values. */
export function decodeInt64(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'value') ||
      value.type !== 'int64' || typeof value.value !== 'string' ||
      value.value.length > 20 || !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value.value)) {
    throw new HostBridgeError('invalid canonical int64 wire value');
  }
  const v = BigInt(value.value);
  if (v < I64_MIN || v > I64_MAX) throw new HostBridgeError('int64 out of range');
  return v;
}

export function encodeInt64(value) {
  if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX)
    throw new HostBridgeError('guest result is not a signed int64 BigInt');
  return {type:'int64', value:value.toString(10)};
}

/**
 * Invoke a reviewed and explicitly allowlisted ESM module namespace.
 * Host must import a trusted, pinned module in its own security boundary.
 * This adapter cannot safely execute untrusted code or establish isolation.
 */
export function invokeTrustedModule(namespace, {entry, allowlist, args} = {}) {
  if (!namespace || typeof namespace !== 'object' ||
      Object.prototype.toString.call(namespace) !== '[object Module]' ||
      Object.getPrototypeOf(namespace) !== null) {
    throw new HostBridgeError('expected a trusted ESM module namespace');
  }
  if (typeof entry !== 'string' || !NAME.test(entry) ||
      !Array.isArray(allowlist) || !allowlist.includes(entry) ||
      allowlist.length > 128 || allowlist.some(name => typeof name !== 'string' || !NAME.test(name))) {
    throw new HostBridgeError('entrypoint not permitted');
  }
  if (!Array.isArray(args) || args.length > 128)
    throw new HostBridgeError('invalid argument list');
  const decoded = args.map(decodeInt64);
  const desc = Object.getOwnPropertyDescriptor(namespace, entry);
  if (!desc || typeof desc.value !== 'function') throw new HostBridgeError('entrypoint is not a public function');
  let result;
  try { result = desc.value(...decoded); }
  catch { throw new HostBridgeError('guest invocation failed'); }
  return encodeInt64(result);
}
