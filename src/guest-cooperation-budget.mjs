/**
 * Host-owned cooperative execution budget for future compiler-inserted
 * backedges. NOT a sandbox: arbitrary JavaScript can omit these calls.
 * All method names are snake_case to match the source-language convention.
 */
const MAX_FUEL = 100_000_000;
export const COOPERATION_POLL_INTERVAL = 128;
// The compiler must split larger basic blocks into bounded charges.
// At most one 128-unit boundary can be crossed by one compiler charge.
export const MAX_METERED_BLOCK_WEIGHT = 128;

export class GuestFuelExhausted extends Error {
  constructor() { super('logical guest fuel exhausted'); this.name = 'GuestFuelExhausted'; }
}

export class GuestCooperationBudget {
  #remaining;
  // The poll phase persists across dispatches, including short resumes.
  #ticks = 0;
  #dispatch_ticks = 0;
  // Counts recursive/helper/basic-block work too, not just loop edges.
  #dispatch_work = 0;
  #polls = 0;

  constructor(fuel = MAX_FUEL) {
    if (!Number.isSafeInteger(fuel) || fuel < 1 || fuel > MAX_FUEL)
      throw new RangeError('invalid logical guest fuel');
    this.#remaining = fuel;
  }

  get remaining_fuel() { return this.#remaining; }
  get slow_polls_due() { return this.#polls; }
  get backedges_this_dispatch() { return this.#dispatch_ticks; }
  get work_units_this_dispatch() { return this.#dispatch_work; }

  // Reset dispatch fairness only. Never reset poll phase or hard fuel:
  // repeated 127-backedge resumptions must not suppress all slow polls.
  begin_dispatch() { this.#dispatch_ticks = 0; this.#dispatch_work = 0; }

  // A backedge is a completed unit of guest work. The hot path has no
  // clock read, scheduler call, Promise or Worker operation.
  charge_backedge(weight = 1) {
    const due = this.charge_operation(weight);
    this.#dispatch_ticks++;
    return due; // A slow poll is due, not authorization to suspend in critical.
  }

  // Also use at recursive/function entry and bounded basic blocks. It
  // returns checkpoint eligibility without claiming a resumable yield.
  // Failed charges neither spend fuel nor advance the poll phase.
  charge_operation(weight) {
    if (!Number.isSafeInteger(weight) || weight < 1 ||
        weight > MAX_METERED_BLOCK_WEIGHT)
      throw new RangeError('invalid guest work weight');
    if (weight > this.#remaining) throw new GuestFuelExhausted();
    this.#remaining -= weight;
    this.#dispatch_work += weight;
    const total = this.#ticks + weight;
    this.#ticks = total & (COOPERATION_POLL_INTERVAL - 1);
    if (total < COOPERATION_POLL_INTERVAL) return false;
    this.#polls++;
    return true;
  }
}
