/**
 * Actor-generation lease for compiler-lowered continuations.
 *
 * A lease is issued only by capture() and cannot be reconstructed by calling
 * lease.constructor. The fence authenticates the lease identity before
 * running a synchronous commit; generation advances invalidate old leases.
 * JavaScript is run-to-completion within one isolate.
 */
const ISSUED_LEASES = new WeakMap();
const LEASE_FACTORY_KEY = Symbol('actor-generation-lease-factory');

export class ActorGenerationFence {
  #generation = 1;
  #commitInProgress = false;

  get generation() { return this.#generation; }

  capture() {
    const lease = new ActorGenerationLease(LEASE_FACTORY_KEY);
    ISSUED_LEASES.set(lease, {owner:this, generation:this.#generation});
    return Object.freeze(lease);
  }

  advanceGeneration() {
    if (this.#commitInProgress)
      throw new Error('actor generation cannot advance inside a fenced commit');
    if (!Number.isSafeInteger(this.#generation) ||
        this.#generation >= Number.MAX_SAFE_INTEGER)
      throw new Error('actor generation exhausted');
    return ++this.#generation;
  }

  _current(lease) {
    const identity = ISSUED_LEASES.get(lease);
    return identity?.owner === this && this.#generation === identity.generation;
  }

  _tryRun(lease, commit) {
    if (typeof commit !== 'function')
      throw new TypeError('generation commit must be a function');
    if (!this._current(lease)) return false;
    if (this.#commitInProgress)
      throw new Error('generation commit must not re-enter its fence');

    this.#commitInProgress = true;
    let result;
    try {
      result = commit();
    } finally {
      this.#commitInProgress = false;
    }
    if (typeof result !== 'boolean')
      throw new TypeError('generation commit must return a synchronous boolean');
    return result;
  }
}

class ActorGenerationLease {
  constructor(factoryKey) {
    if (factoryKey !== LEASE_FACTORY_KEY)
      throw new TypeError('generation leases must be captured from their fence');
  }

  get generation() { return ISSUED_LEASES.get(this).generation; }
  get current() { return ISSUED_LEASES.get(this).owner._current(this); }

  tryRun(commit) {
    return ISSUED_LEASES.get(this).owner._tryRun(this, commit);
  }
}
