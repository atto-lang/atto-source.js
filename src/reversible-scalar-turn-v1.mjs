// Trusted actor-lane primitive; no guest ABI, external effects or durable storage.
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const i64 = v => typeof v === 'bigint' && v >= MIN && v <= MAX;
const quota = v => Number.isInteger(v) && v >= 1 && v <= 4096;
const receipt = (status, version, value) => Object.freeze({status, version, value});

export class ReversibleScalarTurnV1 {
  #history; #receipts; #size = 0; #cursor = 0; #used = 0; #version = 0n; #value;
  constructor(initial, historyCapacity, commandCapacity) {
    if (!i64(initial) || !quota(historyCapacity) || !quota(commandCapacity))
      throw new RangeError('invalid scalar state or quota');
    this.#history = Array(historyCapacity).fill(null);
    this.#receipts = Array(commandCapacity).fill(null);
    this.#value = initial;
  }
  get value() { return this.#value; }
  get version() { return this.#version; }
  #fail(status) { return receipt(status, this.#version, this.#value); }
  apply(id, expected, kind, arg) {
    if (!i64(id) || id <= 0n || !i64(expected) || expected < 0n || !i64(arg) ||
        (kind !== 'commit' && kind !== 'undo' && kind !== 'redo'))
      return this.#fail('invalid_command');
    for (let i = 0; i < this.#used; i++) {
      const e = this.#receipts[i];
      if (e.id === id) return e.expected === expected && e.kind === kind && e.arg === arg
        ? e.result : this.#fail('id_reuse');
    }
    if (expected !== this.#version) return this.#fail('conflict');
    if (this.#used === this.#receipts.length || this.#version === MAX) return this.#fail('quota');
    let next, delta;
    if (kind === 'commit') {
      if (this.#cursor === this.#history.length) return this.#fail('quota');
      next = arg;
      delta = {id, before: this.#value, after: next};
    } else if (kind === 'undo') {
      if (this.#cursor === 0 || this.#history[this.#cursor - 1].id !== arg)
        return this.#fail('invalid_history');
      next = this.#history[this.#cursor - 1].before;
    } else {
      if (this.#cursor === this.#size || this.#history[this.#cursor].id !== arg)
        return this.#fail('invalid_history');
      next = this.#history[this.#cursor].after;
    }
    // No callback or coercion between preparing bookkeeping and publishing state.
    const result = receipt('ok', this.#version + 1n, next);
    const entry = {id, expected, kind, arg, result};
    if (kind === 'commit') {
      for (let i = this.#cursor; i < this.#size; i++) this.#history[i] = null;
      this.#history[this.#cursor++] = delta;
      this.#size = this.#cursor;
    } else if (kind === 'undo') this.#cursor--;
    else this.#cursor++;
    this.#receipts[this.#used++] = entry;
    this.#value = next;
    this.#version = result.version;
    return result;
  }
}

// Pure admission arithmetic. Scheduler must recheck cancellation/deadline at wake.
export function retryAfterFailure(attempts, completed, initial, cap, deadline, elapsed,
                                  backoff, eligible, cancelled) {
  const stop = decision => Object.freeze({decision, delay: 0n});
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 2147483647 ||
      !Number.isInteger(completed) || completed < 1 || completed > attempts ||
      !i64(initial) || initial < 0n || !i64(cap) || cap < initial ||
      !i64(deadline) || deadline <= 0n || !i64(elapsed) || elapsed < 0n ||
      (backoff !== 'fixed' && backoff !== 'exponential') ||
      typeof eligible !== 'boolean' || typeof cancelled !== 'boolean') return stop('invalid');
  if (cancelled) return stop('cancelled');
  if (elapsed >= deadline) return stop('deadline');
  if (!eligible) return stop('ineligible');
  if (completed === attempts) return stop('exhausted');
  let delay = initial;
  if (backoff === 'exponential' && delay !== 0n)
    for (let i = 1; i < completed && delay < cap; i++) delay = delay > cap / 2n ? cap : delay * 2n;
  if (delay >= deadline - elapsed) return stop('deadline');
  return Object.freeze({decision: 'wait', delay});
}
