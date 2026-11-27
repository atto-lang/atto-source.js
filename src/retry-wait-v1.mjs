// Trusted actor lane only. A timer settles readiness, never runs guest code.
// Caller must retain serial receive ownership and release all state loans before arm.
export class RetryWaitV1 {
  #timer; #fence; #generation; #deadline; #last; #ticket = null;
  #controller = null; #state = 'idle';
  constructor(timer, fence, deadline) {
    const now = timer.monotonic_now();
    if (typeof deadline !== 'bigint' || deadline <= now || deadline > (1n<<63n)-1n)
      throw new RangeError('invalid retry deadline');
    this.#timer = timer; this.#fence = fence; this.#generation = fence.generation;
    this.#deadline = deadline; this.#last = now;
  }
  get state() { return this.#state; }
  #clock() {
    const now = this.#timer.monotonic_now();
    if (now < this.#last) throw new Error('retry clock regressed');
    this.#last = now;
    return now;
  }
  #finish(state) {
    this.#state = state;
    this.#ticket?.close(); this.#ticket = null;
    const c = this.#controller; this.#controller = null;
    c?.abort();
    return state;
  }
  #current() { return !this.#fence.closed && this.#fence.generation === this.#generation && this.#ticket?.active; }
  async arm(delay) {
    if (this.#state !== 'idle') throw new Error('retry wait already used');
    if (typeof delay !== 'bigint' || delay < 0n || delay > (1n<<63n)-1n)
      throw new RangeError('invalid retry delay');
    try {
      const now = this.#clock();
      if (now >= this.#deadline || delay >= this.#deadline-now) return this.#finish('deadline');
      this.#ticket = this.#fence.register(this.#generation);
      this.#controller = new AbortController();
      this.#state = 'waiting';
      await this.#timer.sleep_ns(delay,{signal:this.#controller.signal});
      if (this.#state !== 'waiting') return this.#state;
      if (!this.#current()) return this.#finish('stale');
      if (this.#clock() >= this.#deadline) return this.#finish('deadline');
      this.#state = 'ready';
      return 'ready';
    } catch (error) {
      if (this.#state === 'cancelled') return 'cancelled';
      this.#finish('failed');
      throw error;
    }
  }
  cancel() {
    if (!['idle','waiting','ready'].includes(this.#state)) return false;
    this.#finish('cancelled');
    return true;
  }
  // Called only on the owning serialized actor lane; caller closes lease in finally.
  // Claim is the linearization point for starting the next attempt.
  claim() {
    if (this.#state !== 'ready') return null;
    try {
      if (!this.#current()) { this.#finish('stale'); return null; }
      if (this.#clock() >= this.#deadline) { this.#finish('deadline'); return null; }
      const lease = this.#fence.tryClaim(this.#ticket);
      if (lease === null) { this.#finish('stale'); return null; }
      this.#ticket = null; this.#controller = null; this.#state = 'claimed';
      return lease;
    } catch (error) { this.#finish('failed'); throw error; }
  }
}
