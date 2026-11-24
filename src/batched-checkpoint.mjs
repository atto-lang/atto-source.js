/** Host-only reference for a future compiler-injected AttoLang checkpoint.
 * Not a sandbox: uninstrumented functions and opaque FFI must not be admitted.
 * A work unit must be compiler-proven bounded before it may be batched.
 */
const INTERVALS = new Set([64, 128, 256, 512]);

export class BatchedCheckpoint {
  #interval;
  #fuel;
  #pending = 0;
  #next;
  #poll;
  #inPoll = false;
  #terminal = false;

  constructor({interval = 128, hardFuel, poll} = {}) {
    if (!INTERVALS.has(interval)) throw new RangeError('checkpoint interval must be 64, 128, 256 or 512');
    if (!Number.isSafeInteger(hardFuel) || hardFuel < 0)
      throw new RangeError('hardFuel must be a nonnegative safe integer');
    if (typeof poll !== 'function') throw new TypeError('checkpoint requires a trusted synchronous poll');
    this.#interval = interval;
    this.#fuel = hardFuel;
    this.#next = Math.min(interval, hardFuel);
    this.#poll = poll;
  }

  /** Complete exactly one verified bounded work unit, after committing its effects.
   * The fast path does not call the clock, scheduler or any user callback.
   * Exhaustion is terminal and cannot be reset by an await/cooperation handoff.
   */
  completeWorkUnit() {
    if (this.#terminal || this.#inPoll) throw new Error('checkpoint is terminal or reentrant');
    if (this.#fuel === this.#pending) {
      this.#terminal = true;
      throw new Error('hard execution fuel exhausted');
    }
    this.#pending++;
    if (this.#pending < this.#next) return false;
    const charged = this.#pending;
    this.#fuel -= charged;
    this.#pending = 0;
    this.#next = Math.min(this.#interval, this.#fuel);
    this.#inPoll = true;
    try {
      const result = this.#poll(Object.freeze({charged, remainingFuel: this.#fuel}));
      if (result && typeof result.then === 'function')
        throw new TypeError('checkpoint poll must not suspend');
    } catch (error) {
      this.#terminal = true;
      throw error;
    } finally {
      this.#inPoll = false;
    }
    return true;
  }

  get remainingFuel() { return this.#fuel - this.#pending; }
}
