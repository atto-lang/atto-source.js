/**
 * Host-owned cooperative execution budget for future compiler-inserted
 * backedges. NOT a sandbox: arbitrary JavaScript can omit these calls.
 * All method names are snake_case to match the source-language convention.
 */
const MAX_FUEL = 100_000_000;
export const COOPERATION_POLL_INTERVAL = 128;

export class GuestFuelExhausted extends Error {
  constructor() { super('logical guest fuel exhausted'); this.name = 'GuestFuelExhausted'; }
}

export class GuestCooperationBudget {
  #remaining;
  #ticks = 0;
  #polls = 0;

  constructor(fuel = MAX_FUEL) {
    if (!Number.isSafeInteger(fuel) || fuel < 1 || fuel > MAX_FUEL)
      throw new RangeError('invalid logical guest fuel');
    this.#remaining = fuel;
  }

  get remaining_fuel() { return this.#remaining; }
  get slow_polls_due() { return this.#polls; }

  // Only fairness state resets on resume. Fuel does not.
  begin_dispatch() { this.#ticks = 0; }

  // Hot path: no wall-clock, scheduler callback, Promise or Worker API.
  // Called after the compiler commits its loop-carried state.
  charge_backedge(weight = 1) {
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > MAX_FUEL)
      throw new RangeError('invalid guest work weight');
    if (weight > this.#remaining) throw new GuestFuelExhausted();
    this.#remaining -= weight;
    this.#ticks = (this.#ticks + 1) & (COOPERATION_POLL_INTERVAL - 1);
    if (this.#ticks !== 0) return false;
    this.#polls++;
    return true; // Caller may poll but must not yield inside critical.
  }

  // Charge an admitted operation without creating an arbitrary yield point.
  charge_operation(weight) {
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > MAX_FUEL)
      throw new RangeError('invalid guest work weight');
    if (weight > this.#remaining) throw new GuestFuelExhausted();
    this.#remaining -= weight;
  }
}
