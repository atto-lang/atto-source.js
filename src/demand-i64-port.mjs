import {SelectableI64Channel} from './selectable-i64-channel.mjs';

const MAX_CAPACITY = 65536;
const MAX_LOANS = 4096;
const MAX_DEMAND = 1_000_000;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

/**
 * Runtime-only, demand-gated unicast i64 channel. This adapter deliberately
 * does NOT claim compiler-lowered source Flow<T>, async waiter scheduling,
 * zero allocations or thread-safe coordination across worker isolates.
 * Scalar BigInt values have no externally mutable payload graph.
 */
export class DemandI64Port {
  #channel;
  #maxBytes;
  #maxDemand;
  #credits = 0;
  #retained = 0;
  #subscriber = null;
  #loans;
  #ticket = 1;
  #complete = false;
  #cancelled = false;

  constructor({capacity, maxInFlight = 4, maxBytes = (capacity + maxInFlight) * 8,
               maxDemand = MAX_DEMAND} = {}) {
    for (const [name, value, bound] of [
      ['capacity', capacity, MAX_CAPACITY],
      ['maxInFlight', maxInFlight, MAX_LOANS],
      ['maxBytes', maxBytes, Number.MAX_SAFE_INTEGER],
      ['maxDemand', maxDemand, MAX_DEMAND],
    ]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > bound)
        throw new RangeError(name + ' exceeds finite demand-port budget');
    }
    if (maxBytes < 8) throw new RangeError('maxBytes must admit one i64');
    this.#channel = new SelectableI64Channel(capacity);
    this.#maxBytes = maxBytes;
    this.#maxDemand = maxDemand;
    this.#loans = new Array(maxInFlight).fill(0);
  }

  subscribe() {
    if (this.#subscriber !== null || this.#complete || this.#cancelled)
      throw new Error('exclusive reader lease unavailable');
    const lease = Object.freeze(Object.create(null));
    this.#subscriber = lease;
    return lease;
  }

  #check(lease) {
    if (this.#subscriber === null || lease !== this.#subscriber)
      throw new Error('foreign or missing demand reader lease');
  }

  request(lease, count) {
    this.#check(lease);
    if (!Number.isSafeInteger(count) || count < 1)
      throw new RangeError('demand must be a positive safe integer');
    if (this.#complete || this.#cancelled)
      throw new Error('terminal demand port');
    if (count > this.#maxDemand - this.#credits)
      throw new RangeError('demand exceeds outstanding credit limit');
    this.#credits += count;
  }

  tryOffer(value) {
    if (typeof value !== 'bigint' || value < MIN_I64 || value > MAX_I64)
      throw new TypeError('signed i64 BigInt required');
    if (this.#complete || this.#cancelled) return 'closed';
    if (this.#subscriber === null) return 'no-subscriber';
    if (this.#credits === 0) return 'no-demand';
    if (this.#retained > this.#maxBytes - 8) return 'byte-budget';
    if (!this.#channel.tryWrite(value)) return 'full';
    this.#credits--;
    this.#retained += 8;
    return 'accepted';
  }

  tryNext(lease) {
    this.#check(lease);
    if (this.#cancelled) return {kind: 'cancelled'};
    const free = this.#loans.indexOf(0);
    if (free === -1) return {kind: 'not-ready'};
    if (this.#ticket >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('delivery tickets exhausted');
    const next = this.#channel.tryRead();
    if (!next.ok) return {kind: next.eof ? 'complete' : 'not-ready'};
    const ticket = this.#ticket++;
    this.#loans[free] = ticket;
    return {kind:'item', value:next.value, ticket};
  }

  ack(lease, ticket) {
    this.#check(lease);
    if (!Number.isSafeInteger(ticket) || ticket < 1) return false;
    const index = this.#loans.indexOf(ticket);
    if (index < 0) return false;
    this.#loans[index] = 0;
    this.#retained -= 8;
    return true;
  }

  complete() {
    if (this.#complete || this.#cancelled) return false;
    this.#complete = true;
    this.#credits = 0;
    this.#channel.close();
    return true;
  }

  cancel() {
    if (this.#complete || this.#cancelled) return false;
    this.#complete = true;
    this.#cancelled = true;
    this.#credits = 0;
    this.#channel.close();
    for (;;) {
      const next = this.#channel.tryRead();
      if (!next.ok) break;
      this.#retained -= 8;
    }
    return true;
  }

  get queued() { return this.#channel.size; }
  get retainedBytes() { return this.#retained; }
  get outstandingDemand() { return this.#credits; }
  get inFlight() { return this.#loans.filter(x => x !== 0).length; }
}
