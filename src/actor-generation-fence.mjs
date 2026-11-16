/**
 * Actor-generation lease for compiler-lowered continuations.
 *
 * A lease is issued only by capture() and cannot be reconstructed by calling
 * lease.constructor. The fence authenticates the lease identity before
 * running a synchronous commit; generation advances invalidate old leases.
 * JavaScript is run-to-completion within one isolate.
 */
const ISSUED_LEASES = new WeakMap();
const issuedGet = Function.prototype.call.bind(WeakMap.prototype.get);
const issuedSet = Function.prototype.call.bind(WeakMap.prototype.set);
const freeze = Object.freeze;
const LEASE_FACTORY_KEY = Symbol('actor-generation-lease-factory');

export class ActorGenerationFence {
  #generation = 1;
  #commitInProgress = false;

  get generation() { return this.#generation; }

  capture() {
    const lease = new ActorGenerationLease(LEASE_FACTORY_KEY);
    issuedSet(ISSUED_LEASES, lease, {owner:this, generation:this.#generation});
    return freeze(lease);
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
    const identity = issuedGet(ISSUED_LEASES, lease);
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

  get generation() { return issuedGet(ISSUED_LEASES, this).generation; }
  get current() { return issuedGet(ISSUED_LEASES, this).owner._current(this); }

  tryRun(commit) {
    return issuedGet(ISSUED_LEASES, this).owner._tryRun(this, commit);
  }
}
