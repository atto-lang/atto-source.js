// Internal JS backend byte primitive, NOT compiled Atto guest code or a verified
// TenantVM sandbox. The trusted host must issue unique opaque owner tokens and
// enforce aggregate tenant quotas. Raw backing bytes never escape this class.
const NativeBytes = Uint8Array;
const nativeFill = Uint8Array.prototype.fill;
const trustedApply = Reflect.apply;
const MAX_REGION = 1024 * 1024;

export class OwnedBytesV1 {
  #owner;
  #bytes;
  #retired = false;
  constructor(ownerToken, length, regionQuota) {
    if (!ownerToken || typeof ownerToken !== 'object' || Array.isArray(ownerToken))
      throw new TypeError('trusted owner token required');
    if (!Number.isSafeInteger(length) || length < 0 ||
        !Number.isSafeInteger(regionQuota) || regionQuota < 0 ||
        length > regionQuota || length > MAX_REGION)
      throw new RangeError('byte allocation quota exceeded');
    this.#owner = ownerToken;
    this.#bytes = new NativeBytes(length); // zeros before publication
  }
  #check(ownerToken) {
    if (this.#retired) throw new Error('byte storage retired');
    if (ownerToken !== this.#owner) throw new Error('foreign byte owner');
  }
  getLength(ownerToken) {
    this.#check(ownerToken);
    return this.#bytes.length;
  }
  #offset(ownerToken, offset, width, endian) {
    this.#check(ownerToken);
    if (width !== 1 && width !== 2 && width !== 4)
      throw new RangeError('unsupported integer width');
    if (endian !== 'le' && endian !== 'be')
      throw new TypeError('explicit endianness required');
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        width > this.#bytes.length || offset > this.#bytes.length - width)
      throw new RangeError('byte range out of bounds');
    return offset;
  }
  readUint(ownerToken, offset, width, endian) {
    const at = this.#offset(ownerToken, offset, width, endian);
    let value = 0;
    for (let i = 0; i < width; i++) {
      const shift = 8 * (endian === 'le' ? i : width - 1 - i);
      value += this.#bytes[at + i] * (2 ** shift);
    }
    return value; // number is exactly representable for u8/u16/u32
  }
  writeUint(ownerToken, offset, width, value, endian) {
    const at = this.#offset(ownerToken, offset, width, endian);
    if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** (8 * width) - 1)
      throw new RangeError('unsigned value out of range');
    // All normal error paths validated before first byte mutation.
    for (let i = 0; i < width; i++) {
      const shift = 8 * (endian === 'le' ? i : width - 1 - i);
      this.#bytes[at + i] = Math.floor(value / (2 ** shift)) % 256;
    }
  }
  retire(ownerToken) {
    this.#check(ownerToken);
    trustedApply(nativeFill, this.#bytes, [0]);
    this.#retired = true;
  }
}
