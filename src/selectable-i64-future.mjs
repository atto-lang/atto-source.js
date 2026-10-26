const I64_MIN=-(1n<<63n);
const I64_MAX=(1n<<63n)-1n;
const MAX_WAITERS=4096;

const receipts=new WeakMap();

class FutureReceipt {
  constructor() {
    receipts.set(this,{status:'pending',value:0n,error:null});
    Object.freeze(this);
  }
  get status() { return receipts.get(this).status; }
  get value() { return receipts.get(this).value; }
  get error() { return receipts.get(this).error; }
}

class Subscription {
  #owner;
  #id;
  constructor(owner,id) {
    this.#owner=owner;
    this.#id=id;
    Object.freeze(this);
  }
  get active() { return this.#owner._matches(this,this.#id); }
  close() { return this.#owner._close(this,this.#id); }
  _id() { return this.#id; }
  _owner() { return this.#owner; }
}

/**
 * One-isolate, single-assignment Future<i64> readiness substrate.
 * Subscriptions are revocable and readiness is advisory: only a
 * SelectArbiter conditional commit can consume a ready result.
 * Not a source-level Future<T> or cross-Worker synchronization.
 */
export class SelectableI64Future {
  #status='pending';
  #value=0n;
  #error=null;
  #waiters=new Map();
  #nextId=1;
  #notificationFailure=null;

  constructor({maxWaiters=64}={}) {
    if (!Number.isSafeInteger(maxWaiters) ||
        maxWaiters<1 || maxWaiters>MAX_WAITERS)
      throw new RangeError('future maxWaiters must be in 1..'+MAX_WAITERS);
    this.maxWaiters=maxWaiters;
  }
  get status() { return this.#status; }
  get pendingWaiters() { return this.#waiters.size; }
  get notificationFailure() { return this.#notificationFailure; }

  createReceipt() { return new FutureReceipt(); }

  subscribeReady(callback) {
    if (typeof callback!=='function')
      throw new TypeError('future readiness callback must be a function');
    if (this.#waiters.size>=this.maxWaiters)
      throw new RangeError('future readiness waiter capacity exhausted');
    if (this.#nextId>=Number.MAX_SAFE_INTEGER)
      throw new RangeError('future subscription identity exhausted');
    const token=new Subscription(this,this.#nextId++);
    this.#waiters.set(token._id(),{token,callback});
    if (this.#status!=='pending') {
      try { callback(token); }
      catch(error) { token.close(); throw error; }
    }
    return token;
  }

  tryCommitReady(subscription,receipt) {
    const result=receipts.get(receipt);
    if (!result)
      throw new TypeError('future receipt must come from createReceipt()');
    result.status='pending';
    result.value=0n;
    result.error=null;
    const id=subscription?._id?.();
    if (!this._matches(subscription,id) || this.#status==='pending')
      return false;
    result.status=this.#status;
    result.value=this.#value;
    result.error=this.#error;
    this.#waiters.delete(id);
    return true;
  }

  resolve(value) {
    if (typeof value!=='bigint' || value<I64_MIN || value>I64_MAX)
      throw new TypeError('future requires signed i64 BigInt');
    return this.#settle('resolved',value,null);
  }

  reject(error) {
    if (!(error instanceof Error))
      throw new TypeError('future rejection requires an Error');
    return this.#settle('rejected',0n,error);
  }

  cancel() { return this.#settle('cancelled',0n,null); }

  _matches(token,id) {
    return token instanceof Subscription && token._owner()===this &&
      Number.isSafeInteger(id) && this.#waiters.get(id)?.token===token;
  }

  _close(token,id) {
    if (!this._matches(token,id)) return false;
    this.#waiters.delete(id);
    return true;
  }

  #settle(status,value,error) {
    if (this.#status!=='pending') return false;
    // Allocate/prepare notifications before publishing terminal state.
    const callbacks=Array.from(this.#waiters.values());
    this.#status=status;
    this.#value=value;
    this.#error=error;
    for(const {token,callback} of callbacks) {
      try { callback(token); }
      catch (failure) {
        this.#notificationFailure ??=
          failure instanceof Error?failure:new Error(String(failure));
      }
    }
    return true;
  }
}

/**
 * Actor lifetime proof for one JS isolate. Token checks must occur *inside*
 * the select conditional commit and once again before continuation dispatch.
 * Retire invalidates new entries immediately but physical retirement waits
 * for in-flight synchronous continuation leases to leave.
 */
export class ActorGenerationFence {
  #generation=1;
  #live=true;
  #active=0;

  get generation() { return this.#generation; }
  get live() { return this.#live; }
  get physicallyRetired() { return !this.#live && this.#active===0; }

  capture() {
    const owner=this;
    const epoch=this.#generation;
    return Object.freeze({
      get valid() { return owner.#live && owner.#generation===epoch; },
      runIfCurrent(callback) {
        if (typeof callback!=='function')
          throw new TypeError('continuation must be a function');
        if (!owner.#live || owner.#generation!==epoch) return false;
        owner.#active++;
        try { callback(); }
        finally { owner.#active--; }
        return true;
      }
    });
  }

  retire() {
    if (!this.#live) return false;
    this.#live=false;
    this.#generation++;
    return true;
  }
}
