/**
 * Actor-generation lease for compiler-lowered continuations.
 *
 * JavaScript is run-to-completion within one isolate, so a synchronous
 * tryRun() check is stable for the whole callback. Async/Promise commits are
 * rejected by the select arbiter; generation changes from inside a fenced
 * commit are rejected explicitly.
 */
export class ActorGenerationFence {
  #generation = 1;
  #commitInProgress = false;

  get generation() { return this.#generation; }

  capture() {
    return new ActorGenerationLease(this, this.#generation);
  }

  advanceGeneration() {
    if (this.#commitInProgress)
      throw new Error(
        'actor generation cannot advance inside a fenced commit');
    if (!Number.isSafeInteger(this.#generation) ||
        this.#generation >= Number.MAX_SAFE_INTEGER)
      throw new Error('actor generation exhausted');
    return ++this.#generation;
  }

  _current(generation) {
    return this.#generation === generation;
  }

  _tryRun(generation, commit) {
    if (typeof commit !== 'function')
      throw new TypeError('generation commit must be a function');
    if (this.#generation !== generation) return false;
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
      throw new TypeError(
        'generation commit must return a synchronous boolean');
    return result;
  }
}

class ActorGenerationLease {
  #owner;
  #generation;

  constructor(owner, generation) {
    this.#owner = owner;
    this.#generation = generation;
  }

  get generation() { return this.#generation; }
  get current() { return this.#owner._current(this.#generation); }

  tryRun(commit) {
    return this.#owner._tryRun(this.#generation, commit);
  }
}
