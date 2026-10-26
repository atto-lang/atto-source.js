const MAX_CHANNEL_CAPACITY = 1_048_576;
const MAX_WAITER_LIMIT = 4096;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

function requireI64(value) {
  if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX)
    throw new TypeError('selectable i64 channel requires signed i64 BigInt');
}

class ReadCell {
  value = 0n;
  hasValue = false;

  _set(value) {
    this.value = value;
    this.hasValue = true;
  }

  reset() {
    this.value = 0n;
    this.hasValue = false;
  }
}

class ChannelSubscription {
  #owner;
  #kind;
  #index;
  #id;

  constructor(owner, kind, index, id) {
    this.#owner = owner;
    this.#kind = kind;
    this.#index = index;
    this.#id = id;
  }

  get active() {
    return this.#owner._matches(
      this, this.#kind, this.#index, this.#id);
  }

  close() {
    return this.#owner._close(
      this, this.#kind, this.#index, this.#id);
  }

  _identity() {
    return {
      owner: this.#owner,
      kind: this.#kind,
      index: this.#index,
      id: this.#id
    };
  }
}

class NotificationBatch {
  #owner;
  #callbacks;
  #subscriptions;
  #count = 0;

  constructor(owner, capacity) {
    this.#owner = owner;
    this.#callbacks = new Array(capacity).fill(null);
    this.#subscriptions = new Array(capacity).fill(null);
  }

  get size() { return this.#count; }

  _requireOwner(owner) {
    if (this.#owner !== owner)
      throw new Error('notification batch belongs to another channel');
    if (this.#count !== 0)
      throw new Error('channel notification batch must be empty');
  }

  _add(callback, subscription) {
    if (this.#count >= this.#callbacks.length)
      throw new Error('channel notification batch overflow');
    this.#callbacks[this.#count] = callback;
    this.#subscriptions[this.#count] = subscription;
    this.#count++;
  }

  dispatch() {
    let firstFailure = null;
    for (let i=0;i<this.#count;i++) {
      const callback=this.#callbacks[i];
      const subscription=this.#subscriptions[i];
      this.#callbacks[i]=null;
      this.#subscriptions[i]=null;
      try {
        if (callback !== null && subscription !== null)
          callback(subscription);
      } catch (error) {
        firstFailure ??=
          error instanceof Error ? error : new Error(String(error));
      }
    }
    this.#count=0;
    if (firstFailure !== null)
      this.#owner._recordNotificationFailure(firstFailure);
  }
}

/**
 * Runtime-only bounded signed-i64 channel with revocable readiness
 * subscriptions. This is not source Channel<T> support.
 *
 * JavaScript has no lock to hold here, but the same transaction boundary as
 * LLVM/.NET is preserved: readiness callbacks are advisory; buffer mutation
 * occurs only inside a SelectArbiter conditional commit; captured opposite-
 * direction notifications dispatch only after the select commit returns.
 */
export class SelectableI64Channel {
  #values;
  #head = 0;
  #tail = 0;
  #count = 0;
  #readers;
  #writers;
  #nextWaiterId = 1;
  #notificationFailure = null;

  constructor(capacity, {maxWaiters=64}={}) {
    if (!Number.isSafeInteger(capacity) ||
        capacity < 1 || capacity > MAX_CHANNEL_CAPACITY)
      throw new RangeError(
        'channel capacity must be an integer in 1..'+MAX_CHANNEL_CAPACITY);
    if (!Number.isSafeInteger(maxWaiters) ||
        maxWaiters < 1 || maxWaiters > MAX_WAITER_LIMIT)
      throw new RangeError(
        'channel maxWaiters must be an integer in 1..'+MAX_WAITER_LIMIT);
    this.#values=new Array(capacity).fill(0n);
    this.#readers=Array.from(
      {length:maxWaiters},()=>({id:0,active:false,notify:null}));
    this.#writers=Array.from(
      {length:maxWaiters},()=>({id:0,active:false,notify:null}));
  }

  get capacity() { return this.#values.length; }
  get size() { return this.#count; }
  get pendingReaders() { return this.#activeCount(this.#readers); }
  get pendingWriters() { return this.#activeCount(this.#writers); }
  get notificationFailure() { return this.#notificationFailure; }

  createNotificationBatch() {
    return new NotificationBatch(this,this.#readers.length);
  }

  createReadCell() {
    return new ReadCell();
  }

  subscribeReadable(notify) {
    return this.#subscribe('read',notify);
  }

  subscribeWritable(notify) {
    return this.#subscribe('write',notify);
  }

  tryCommitRead(subscription, readCell, notifications) {
    if (!(readCell instanceof ReadCell))
      throw new TypeError('readCell must come from createReadCell()');
    readCell.reset();
    if (!(notifications instanceof NotificationBatch))
      throw new TypeError(
        'notifications must come from createNotificationBatch()');
    notifications._requireOwner(this);

    const identity=subscription?._identity?.();
    if (!identity || !this._matches(
        subscription,'read',identity.index,identity.id) ||
        this.#count===0)
      return false;

    this.#capture(this.#writers,'write',notifications);
    const value=this.#values[this.#head];
    this.#head=(this.#head+1)%this.#values.length;
    this.#count--;
    this.#closeSlot(this.#readers[identity.index]);
    readCell._set(value);
    return true;
  }

  tryCommitWrite(subscription, value, notifications) {
    requireI64(value);
    if (!(notifications instanceof NotificationBatch))
      throw new TypeError(
        'notifications must come from createNotificationBatch()');
    notifications._requireOwner(this);

    const identity=subscription?._identity?.();
    if (!identity || !this._matches(
        subscription,'write',identity.index,identity.id) ||
        this.#count===this.#values.length)
      return false;

    this.#capture(this.#readers,'read',notifications);
    this.#values[this.#tail]=value;
    this.#tail=(this.#tail+1)%this.#values.length;
    this.#count++;
    this.#closeSlot(this.#writers[identity.index]);
    return true;
  }

  tryWrite(value) {
    requireI64(value);
    if (this.#count===this.#values.length) return false;

    const notifications=this.createNotificationBatch();
    this.#capture(this.#readers,'read',notifications);
    this.#values[this.#tail]=value;
    this.#tail=(this.#tail+1)%this.#values.length;
    this.#count++;
    notifications.dispatch();
    return true;
  }

  tryRead() {
    if (this.#count===0) return {ok:false,value:0n};

    // Allocate the public result before mutating the buffer so allocation
    // failure cannot consume a value without a returned receipt.
    const result={ok:true,value:0n};
    const notifications=this.createNotificationBatch();
    this.#capture(this.#writers,'write',notifications);
    result.value=this.#values[this.#head];
    this.#head=(this.#head+1)%this.#values.length;
    this.#count--;
    notifications.dispatch();
    return result;
  }

  _matches(subscription,kind,index,id) {
    if (!(subscription instanceof ChannelSubscription) ||
        !Number.isSafeInteger(index) || index<0)
      return false;
    const identity=subscription._identity();
    if (identity.owner!==this || identity.kind!==kind ||
        identity.index!==index || identity.id!==id)
      return false;
    const waiters=kind==='read'?this.#readers:this.#writers;
    if (index>=waiters.length) return false;
    const waiter=waiters[index];
    return waiter.active && waiter.id===id;
  }

  _close(subscription,kind,index,id) {
    if (!this._matches(subscription,kind,index,id)) return false;
    const waiters=kind==='read'?this.#readers:this.#writers;
    this.#closeSlot(waiters[index]);
    return true;
  }

  _recordNotificationFailure(error) {
    this.#notificationFailure ??=
      error instanceof Error ? error : new Error(String(error));
  }

  #subscribe(kind,notify) {
    if (typeof notify!=='function')
      throw new TypeError('channel readiness callback must be a function');
    const waiters=kind==='read'?this.#readers:this.#writers;
    const index=waiters.findIndex(waiter=>!waiter.active);
    if (index<0)
      throw new Error('channel select waiter capacity exhausted');
    if (!Number.isSafeInteger(this.#nextWaiterId) ||
        this.#nextWaiterId>=Number.MAX_SAFE_INTEGER)
      throw new Error('channel select waiter identity exhausted');

    const id=this.#nextWaiterId++;
    const subscription=new ChannelSubscription(this,kind,index,id);
    const waiter=waiters[index];
    waiter.id=id;
    waiter.active=true;
    waiter.notify=notify;

    const ready=kind==='read'
      ? this.#count!==0
      : this.#count!==this.#values.length;
    if (ready) {
      try {
        notify(subscription);
      } catch (error) {
        subscription.close();
        throw error;
      }
    }
    return subscription;
  }

  #capture(waiters,kind,notifications) {
    notifications._requireOwner(this);
    // Subscription objects are allocated before any buffer mutation. If
    // allocation fails, the channel operation has not committed.
    for(let index=0;index<waiters.length;index++) {
      const waiter=waiters[index];
      if(!waiter.active||waiter.notify===null)continue;
      notifications._add(
        waiter.notify,
        new ChannelSubscription(this,kind,index,waiter.id)
      );
    }
  }

  #closeSlot(waiter) {
    waiter.active=false;
    waiter.notify=null;
  }

  #activeCount(waiters) {
    let count=0;
    for(const waiter of waiters)if(waiter.active)count++;
    return count;
  }
}
