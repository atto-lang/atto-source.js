import {copyOwnedValue,copyOwnedValueWithBytes} from './worker-actor-copy.mjs';
const PROTOCOL = 'ores.js.worker.v1';
// An Error message is not necessarily stringifiable (e.g. null-prototype
// structured-clone records). Never allow logging to interrupt settlement.
const errorText = error => {
  try {return String(error?.message ?? error).slice(0,512);}
  catch {return 'uninspectable actor failure';}
};
const DEFAULT_MAX_PENDING_BYTES=32*1024*1024;
const MAX_CONFIGURED_PENDING_BYTES=256*1024*1024;
// Single Worker per actor: fail closed on unsupported scheduling authority.
const UNSUPPORTED_PLACEMENT_KEYS = Object.freeze([
  'placement','cpuAffinity','maxParallelTurns',
  'accelerator','gpuDeviceId','maxGpuInFlight',
  'maxParallelism','max_parallelism','minParallelism','min_parallelism',
  'poolSize','pool_size','pool','threadPool','threadPolicy',
  'affinity','threadAffinity','pinnedWorker','dedicatedWorker',
  'schedule','actor_schedule','actorSchedule'
]);

export function rejectUnsupportedWorkerPlacement(options) {
  if (!options || typeof options !== 'object')
    throw new TypeError('worker actor options must be an object');
  for (const key of UNSUPPORTED_PLACEMENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options,key)) {
      throw new TypeError(
        (['placement','cpuAffinity','maxParallelTurns','accelerator','gpuDeviceId','maxGpuInFlight'].includes(key)
          ? 'JavaScript Worker backend cannot guarantee CPU/GPU placement: '
          : 'JavaScript Worker backend cannot guarantee elastic actor scheduling: ') + key);
    }
  }
}
export function createWorkerActorClient({worker, moduleUrl, exportName = 'receive', mode = 'handler', maxPending = 64,
  maxPendingBytes = DEFAULT_MAX_PENDING_BYTES}) {
  if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function')
    throw new TypeError('invalid Worker');
  if (typeof moduleUrl !== 'string' || !moduleUrl || typeof exportName !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(exportName) || !['handler','call'].includes(mode))
    throw new TypeError('invalid entrypoint');
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 65536)
    throw new RangeError('invalid mailbox limit');
  if(!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<1||
     maxPendingBytes>MAX_CONFIGURED_PENDING_BYTES)
    throw new RangeError('invalid actor mailbox byte limit');
  const pending = new Map();
  let pendingBytes=0;
  let nextId = 1, closed = false, ready = false;
  let readyResolve, readyReject;
  const readyPromise = new Promise((resolve,reject) => {readyResolve = resolve; readyReject = reject;});
  void readyPromise.catch(() => {}); // callers can await actor.ready explicitly
  // Failed Worker termination must not create an unhandled host rejection.
  // Record the termination promise before calling the Worker to handle
  // reentrant error events and ensure exactly one termination attempt.
  let terminationPromise;
  function terminateWorker() {
    if (terminationPromise) return terminationPromise;
    let resolveTermination, rejectTermination;
    terminationPromise = new Promise((resolve, reject) => {
      resolveTermination = resolve;
      rejectTermination = reject;
    });
    void terminationPromise.catch(() => {});
    try { resolveTermination(worker.terminate()); }
    catch (error) { rejectTermination(error); }
    return terminationPromise;
  }
  function shutdown(error) {
    if (closed) return;
    closed = true;
    if (!ready) readyReject(error);
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    pendingBytes=0;
  }
  function release(id){
    const entry=pending.get(id);
    if(!entry)return;
    pending.delete(id);
    pendingBytes-=entry.bytes;
  }
  // Worker frames are from the trusted adapter, but malformed/unexpected
  // control frames must still revoke outstanding receipts, never hang them.
  function failProtocol(message) {
    shutdown(new Error(message));
    void terminateWorker();
  }
  function onFrame(frame) {
    if (closed) return;
    // Snapshot kind once: accessor-backed test transports can mutate control
    // properties between reads; never validate one kind and execute another.
    const kind = frame && typeof frame === 'object' ? frame.kind : undefined;
    if (!frame || typeof frame !== 'object' || frame.protocol !== PROTOCOL ||
        !['ready','fatal','result'].includes(kind)) {
      failProtocol('invalid actor frame');return;
    }
    if (kind === 'ready') {
      if (ready) {shutdown(new Error('duplicate actor ready'));void terminateWorker();return;}
      ready = true; readyResolve();
    } else if (kind === 'fatal') {
      shutdown(new Error('actor startup/protocol failure: ' + errorText(frame.error)));
      void terminateWorker();
    } else if (kind === 'result') {
      if (!ready) {failProtocol('actor result before ready');return;}
      // Control properties may be accessors in custom Worker transports.
      // Match and release the very same receipt, even if an id getter changes.
      const id=frame.id;
      const entry = pending.get(id);
      if (!entry) {shutdown(new Error('unexpected actor response id'));void terminateWorker();return;}
      // Like the response id, ok must be read exactly once before settlement.
      const ok = frame.ok;
      if (ok === true) {
        // A Worker response is a new ownership boundary. Even trusted adapter
        // code can regress and return a SharedArrayBuffer, or a test Worker
        // can forge a success frame. Never expose such aliases to callers.
        let snapshot;
        try {snapshot = entry.reply ? copyOwnedValue(frame.value) : undefined;}
        catch {
          failProtocol('invalid actor response payload');
          return;
        }
        release(id);
        entry.resolve(snapshot);
      } else if (ok === false) {
        // Parse the negative result before revoking its receipt. An accessor-
        // throwing frame.error must fail the whole protocol and reject every
        // outstanding promise, including this one. Releasing first would
        // orphan the promise because shutdown no longer finds its entry.
        const reason=errorText(frame.error);
        release(id);
        entry.reject(new Error('actor delivery failed: '+reason));
      } else {
        failProtocol('invalid actor response');
      }
    }
  }
  // A custom Worker adapter or test transport may deliver accessor-backed
  // frames rather than structured-cloned records. An event callback must
  // never throw before revoking outstanding message reservations.
  function guardedOnFrame(frame) {
    try {onFrame(frame);} catch {failProtocol('invalid actor frame');}
  }
  if (typeof worker.addEventListener === 'function') {
    worker.addEventListener('message', e => {
      try {guardedOnFrame(e.data);} catch {failProtocol('invalid actor frame');}
    });
    worker.addEventListener('error', () => {
      shutdown(new Error('worker execution failure'));void terminateWorker();
    });
    worker.addEventListener('messageerror', () => {
      shutdown(new Error('worker message decoding failure'));void terminateWorker();
    });
  } else if (typeof worker.on === 'function') {
    worker.on('message', guardedOnFrame);
    worker.on('error', err => {
      shutdown(new Error('worker execution failure: ' + errorText(err)));
      void terminateWorker();
    });
    worker.on('messageerror', () => {
      shutdown(new Error('worker message decoding failure'));void terminateWorker();
    });
    worker.on('exit', code => shutdown(new Error('worker exited: ' + code)));
  } else throw new TypeError('Worker event interface unsupported');
  try {worker.postMessage({protocol: PROTOCOL,kind:'init',moduleUrl,exportName,mode,maxPending,maxPendingBytes});}
  catch (error) {shutdown(error);void terminateWorker();}
  // Synchronous, atomic host-side admission. Success reserves a private
  // owned snapshot, not an actor execution or an acknowledged send.
  function trySend(value, reply) {
    if (closed) return Object.freeze({accepted:false,reason:'actor closed'});
    if (pending.size >= maxPending)
      return Object.freeze({accepted:false,reason:'actor mailbox capacity exceeded'});
    if (!Number.isSafeInteger(nextId))
      return Object.freeze({accepted:false,reason:'actor message id exhausted'});
    // Reject invalid payloads as errors, never classify them as capacity.
    // Snapshot before consuming message ID or byte credit.
    const {value:snapshot,bytes}=copyOwnedValueWithBytes(value);
    if (bytes>maxPendingBytes-pendingBytes)
      return Object.freeze({accepted:false,reason:'actor mailbox byte capacity exceeded'});
    const id=nextId++;
    pendingBytes+=bytes;
    const completion=new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject,reply,bytes});
      void readyPromise.then(() => {
        if (!pending.has(id) || closed) return;
        try {worker.postMessage({protocol:PROTOCOL,kind:'deliver',id,reply,value:snapshot});}
        catch (error) {release(id);reject(error);}
      },reject);
    });
    return Object.freeze({accepted:true,completion});
  }
  function send(value, reply) {
    try {
      const attempt=trySend(value,reply);
      return attempt.accepted ? attempt.completion : Promise.reject(new Error(attempt.reason));
    } catch(error) {return Promise.reject(error);}
  }
  return Object.freeze({
    get ready() {return readyPromise;},
    get pending() {return pending.size;},
    get pendingBytes() {return pendingBytes;},
    request(value) {return send(value,true);},
    tell(value) {return send(value,false);},
    // Explicit local admission Result. Caller must await completion on success.
    tryRequest(value) {return trySend(value,true);},
    tryTell(value) {return trySend(value,false);},
    async close() {shutdown(new Error('actor closed'));await terminateWorker();}
  });
}
