// Host-side logical continuation queue shared by browser and Node Worker hosts.
// Not a Wasm guest ABI, NIO implementation, or an untrusted TenantVM sandbox.
// Reactor/MessagePort callbacks may *admit* a completion, never run guest code.
const validLimit = (n, maximum) => Number.isSafeInteger(n) && n >= 1 && n <= maximum;
const validEpoch = n => Number.isSafeInteger(n) && n >= 1;
const validOwner = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);

export function createWorkerControlLoop({
  maxOwners = 256, maxSuspended = 1024, maxReady = 1024, maxControl = 4,
  postTurn = callback => setTimeout(callback, 0),
  onTurnError = () => {}
} = {}) {
  if (![maxOwners,maxSuspended,maxReady,maxControl].every(n => validLimit(n, 65536)) ||
      typeof postTurn !== 'function' || typeof onTurnError !== 'function') {
    throw new TypeError('invalid control-loop configuration');
  }

  const owners = new Map(), waiting = new Map(), ready = [], control = [];
  let nextTicket = 1, scheduled = false, executing = false, closed = false;
  let completed = 0, dropped = 0, errors = 0;
  const active = (owner, epoch) => owners.get(owner) === epoch;
  const validRun = run => typeof run === 'function';
  const backlog = () => ready.length + control.length;

  function report(error) {
    errors++;
    try {onTurnError(error);} catch { /* Error observers cannot break the loop. */ }
  }

  function schedule() {
    if (scheduled || executing || closed || backlog() === 0) return;
    scheduled = true;
    try {postTurn(() => {
      scheduled = false;
      if (!closed) dispatchOne();
    });} catch (error) {
      // A broken host scheduler is fatal; never run queued guest code inline.
      closed = true;
      owners.clear(); waiting.clear(); ready.length = 0; control.length = 0;
      report(error);
    }
  }

  function dispatchOne() {
    if (executing || closed) return;
    executing = true;
    try {
      // CONTROL has reserved queue capacity independent of DATA readiness.
      const item = control.length ? control.shift() : ready.shift();
      if (!item) return;
      if (!active(item.owner, item.epoch)) {dropped++; return;}
      try {
        const result = item.run(item.value);
        // Quanta must not await a JS Promise while claiming an actor turn.
        // The compiler must snapshot a continuation and explicitly resume it.
        if (result != null && (typeof result === 'object' || typeof result === 'function')) {
          const then = result.then;
          if (typeof then === 'function') {
            // Observe a real rejected Promise so the host does not leak an
            // unhandled rejection; no settlement re-enters this turn.
            void Promise.resolve(result).catch(() => {});
            throw new TypeError('control-loop turns must be synchronous quanta');
          }
        }
        completed++;
      } catch (error) {report(error);}
    } finally {
      executing = false;
      schedule();
    }
  }

  function enqueue(queue, limit, owner, epoch, run, value) {
    if (!validOwner(owner) || !validEpoch(epoch) || !validRun(run))
      throw new TypeError('invalid continuation');
    if (closed || !active(owner, epoch)) return false;
    if (queue.length >= limit) return false;
    queue.push({owner, epoch, run, value});
    schedule();
    return true;
  }

  return Object.freeze({
    attachOwner(owner, epoch) {
      if (!validOwner(owner) || !validEpoch(epoch)) throw new TypeError('invalid owner epoch');
      if (closed || owners.has(owner) || owners.size >= maxOwners) return false;
      owners.set(owner, epoch);
      return true;
    },
    admitData(owner, epoch, run, value) {
      return enqueue(ready, maxReady, owner, epoch, run, value);
    },
    admitControl(owner, epoch, run, value) {
      return enqueue(control, maxControl, owner, epoch, run, value);
    },
    beginSuspension(owner, epoch, resume) {
      if (!validOwner(owner) || !validEpoch(epoch) || !validRun(resume))
        throw new TypeError('invalid suspension');
      if (closed || !active(owner, epoch) || waiting.size >= maxSuspended ||
          !Number.isSafeInteger(nextTicket)) return null;
      const ticket = Object.freeze({owner, epoch, id: nextTicket++});
      waiting.set(ticket.id, {ticket, resume});
      return ticket;
    },
    // Host-only ticket *object identity* prevents accidental cross-owner
    // completion. Serialized worker frames need a separate authenticated ABI.
    complete(ticket, value) {
      if (closed || !ticket || typeof ticket !== 'object') return false;
      const entry = waiting.get(ticket.id);
      if (!entry || entry.ticket !== ticket || !active(ticket.owner, ticket.epoch)) return false;
      if (ready.length >= maxReady) return false; // retain waiter for backpressure
      waiting.delete(ticket.id);
      ready.push({owner: ticket.owner, epoch: ticket.epoch, run: entry.resume, value});
      schedule();
      return true;
    },
    cancel(ticket) {
      if (!ticket || typeof ticket !== 'object') return false;
      const entry = waiting.get(ticket.id);
      if (!entry || entry.ticket !== ticket) return false;
      waiting.delete(ticket.id);
      return true;
    },
    retireOwner(owner, epoch) {
      if (!active(owner, epoch)) return false;
      owners.delete(owner);
      for (const [id, entry] of waiting) {
        if (entry.ticket.owner === owner && entry.ticket.epoch === epoch) waiting.delete(id);
      }
      // Retained DATA/CONTROL records are generation-checked on dispatch.
      // Pending active guard cleanup is NOT certified by this host-only queue.
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      owners.clear(); waiting.clear(); ready.length = 0; control.length = 0;
    },
    get stats() {
      return Object.freeze({closed, owners: owners.size, suspended: waiting.size,
        ready: ready.length, control: control.length, completed, dropped, errors});
    }
  });
}
