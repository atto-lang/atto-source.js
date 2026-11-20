const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const MAX_WAITER_LIMIT = 4096;

function requireI64(value) {
  if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX)
    throw new TypeError(
      'selectable i64 future requires signed i64 BigInt');
}

class FutureSubscription {
  #owner;
  #index;
  #id;

  constructor(owner, index, id) {
    this.#owner = owner;
    this.#index = index;
    this.#id = id;
  }

  get active() {
    return this.#owner._matches(this, this.#index, this.#id);
  }

  close() {
    return this.#owner._close(this, this.#index, this.#id);
  }

  _identity() {
    return {owner: this.#owner, index: this.#index, id: this.#id};
  }
}

/**
 * Runtime-only one-shot signed-i64 Future readiness source for static select.
 * Observation is non-consuming. Readiness subscriptions remain revocable and
 * identity checked so stale notifications cannot win a select.
 */
export class SelectableFutureI64 {
  #waiters;
  #nextWaiterId = 1;
  #settled = false;
  #outcome = null;
  #notificationFailure = null;

  constructor({maxWaiters = 64} = {}) {
    if (!Number.isSafeInteger(maxWaiters) ||
        maxWaiters < 1 || maxWaiters > MAX_WAITER_LIMIT)
      throw new RangeError(
        'future maxWaiters must be an integer in 1..' +
        MAX_WAITER_LIMIT);
    this.#waiters = Array.from(
      {length: maxWaiters},
      () => ({id: 0, active: false, notify: null}));
  }

  get settled() { return this.#settled; }
  get notificationFailure() { return this.#notificationFailure; }

  get pendingWaiters() {
    let count = 0;
    for (const waiter of this.#waiters)
      if (waiter.active) count++;
    return count;
  }

  subscribeReady(notify) {
    if (typeof notify !== 'function')
      throw new TypeError(
        'future readiness callback must be a function');

    const index = this.#waiters.findIndex(waiter => !waiter.active);
    if (index < 0)
      throw new Error('future select waiter capacity exhausted');
    if (!Number.isSafeInteger(this.#nextWaiterId) ||
        this.#nextWaiterId >= Number.MAX_SAFE_INTEGER)
      throw new Error('future select waiter identity exhausted');

    const id = this.#nextWaiterId++;
    const subscription = new FutureSubscription(this, index, id);
    const waiter = this.#waiters[index];
    waiter.id = id;
    waiter.active = true;
    waiter.notify = notify;

    if (this.#settled) {
      try {
        notify(subscription);
      } catch (error) {
        subscription.close();
        throw error;
      }
    }
    return subscription;
  }

  tryCommit(subscription, outcomeCell) {
    if (outcomeCell === null || typeof outcomeCell !== 'object')
      throw new TypeError('future outcome cell is required');

    const identity = subscription?._identity?.();
    if (!identity ||
        !this._matches(subscription, identity.index, identity.id) ||
        !this.#settled)
      return false;

    outcomeCell.kind = this.#outcome.kind;
    outcomeCell.value = this.#outcome.value;
    this.#closeSlot(this.#waiters[identity.index]);
    return true;
  }

  resolve(value) {
    requireI64(value);
    return this.#settle({kind: 'value', value});
  }

  cancel() {
    return this.#settle({kind: 'cancelled', value: 0n});
  }

  _matches(subscription, index, id) {
    if (!(subscription instanceof FutureSubscription) ||
        !Number.isSafeInteger(index) ||
        index < 0 || index >= this.#waiters.length)
      return false;

    const identity = subscription._identity();
    if (identity.owner !== this ||
        identity.index !== index ||
        identity.id !== id)
      return false;

    const waiter = this.#waiters[index];
    return waiter.active && waiter.id === id;
  }

  _close(subscription, index, id) {
    if (!this._matches(subscription, index, id)) return false;
    this.#closeSlot(this.#waiters[index]);
    return true;
  }

  #closeSlot(waiter) {
    waiter.active = false;
    waiter.notify = null;
  }

  #settle(outcome) {
    if (this.#settled) return false;

    // Allocate/capture every notification token before mutating terminal state.
    // If allocation throws, the Future is still pending and can be retried.
    const callbacks = [];
    for (let index = 0; index < this.#waiters.length; index++) {
      const waiter = this.#waiters[index];
      if (!waiter.active || waiter.notify === null) continue;
      callbacks.push([
        waiter.notify,
        new FutureSubscription(this, index, waiter.id)
      ]);
    }

    this.#settled = true;
    this.#outcome = outcome;

    let firstFailure = null;
    for (const [callback, subscription] of callbacks) {
      try {
        callback(subscription);
      } catch (error) {
        firstFailure ??=
          error instanceof Error ? error : new Error(String(error));
      }
    }
    this.#notificationFailure ??= firstFailure;
    return true;
  }
}
