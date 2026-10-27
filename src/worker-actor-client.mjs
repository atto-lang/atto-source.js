import {copyOwnedValue,copyOwnedValueWithBytes} from './worker-actor-copy.mjs';
const PROTOCOL = 'ores.js.worker.v1';
// Host applications can replace Map methods after this module loads. Keep
// receipt admission, lookup, revocation and iteration on captured intrinsics;
// otherwise a patched values()/clear() can orphan outstanding Futures.
const NativeMap = Map;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapClear = NativeMap.prototype.clear;
const nativeMapValues = NativeMap.prototype.values;
const nativeMapSize = Object.getOwnPropertyDescriptor(NativeMap.prototype,'size').get;
const nativeMapNext = Object.getPrototypeOf(nativeMapValues.call(new NativeMap())).next;
// An Error message is not necessarily stringifiable (e.g. null-prototype
// structured-clone records). Never allow logging to interrupt settlement.
const errorText = error => {
  try {return String(error?.message ?? error).slice(0,512);}
  catch {return 'uninspectable actor failure';}
};
const DEFAULT_MAX_PENDING_BYTES=32*1024*1024;
const MAX_CONFIGURED_PENDING_BYTES=256*1024*1024;
const UNSUPPORTED_PLACEMENT_KEYS = Object.freeze([
  'placement','cpuAffinity','maxParallelTurns',
  'accelerator','gpuDeviceId','maxGpuInFlight'
]);

export function rejectUnsupportedWorkerPlacement(options) {
  if (!options || typeof options !== 'object')
    throw new TypeError('worker actor options must be an object');
  for (const key of UNSUPPORTED_PLACEMENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options,key)) {
      throw new TypeError(
        'JavaScript Worker backend cannot guarantee CPU/GPU placement: ' + key);
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
  const pending = new NativeMap();
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
    const iterator=nativeMapValues.call(pending);
    for(let step=nativeMapNext.call(iterator);!step.done;step=nativeMapNext.call(iterator))
      step.value.reject(error);
    nativeMapClear.call(pending);
    pendingBytes=0;
  }
  function release(id){
    const entry=nativeMapGet.call(pending,id);
    if(!entry)return;
    nativeMapDelete.call(pending,id);
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
    if (!frame || typeof frame !== 'object' || frame.protocol !== PROTOCOL) {
      failProtocol('invalid actor frame');return;
    }
    // Protocol getters in injected transports may synchronously revoke us.
    if (closed) return;
    // Accessor-backed test transports can mutate control properties between
    // reads. Snapshot each protocol discriminator once before branching.
    const kind=frame.kind;
    if (closed) return;
    if (!['ready','fatal','result'].includes(kind)) {
      failProtocol('invalid actor frame');return;
    }
    if (kind === 'ready') {
      if (ready) {shutdown(new Error('duplicate actor ready'));void terminateWorker();return;}
      ready = true; readyResolve();
    } else if (kind === 'fatal') {
      const reason=errorText(frame.error);
      if (closed) return;
      shutdown(new Error('actor startup/protocol failure: ' + reason));
      void terminateWorker();
    } else if (kind === 'result') {
      if (!ready) {failProtocol('actor result before ready');return;}
      // Control properties may be accessors in custom Worker transports.
      // Match and release the very same receipt, even if an id getter changes.
      const id=frame.id;
      if (closed) return;
      const entry = nativeMapGet.call(pending,id);
      if (!entry) {shutdown(new Error('unexpected actor response id'));void terminateWorker();return;}
      const ok=frame.ok;
      if (closed) return;
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
        // Cloning may synchronously dispatch a terminal host event.
        if (closed) return;
        release(id);
        entry.resolve(snapshot);
      } else if (ok === false) {
        // Parse the negative result before revoking its receipt. An accessor-
        // throwing frame.error must fail the whole protocol and reject every
        // outstanding promise, including this one. Releasing first would
        // orphan the promise because shutdown no longer finds its entry.
        const reason=errorText(frame.error);
        if (closed) return;
        release(id);
        entry.reject(new Error('actor delivery failed: '+reason));
      } else {
        failProtocol('invalid actor response');
      }
    }
  }
  // Real Workers deliver events asynchronously, but injected/custom transports
  // may synchronously reenter a callback through accessor-backed frame data
  // or error messages. Do not let a nested reply settle a receipt before the
  // enclosing failed frame has been adjudicated.
  let dispatchingHostEvent = false;
  function dispatchHostEvent(action) {
    if (dispatchingHostEvent) {
      failProtocol('reentrant actor event');
      return;
    }
    dispatchingHostEvent = true;
    try {action();}
    catch {failProtocol('invalid actor frame');}
    finally {dispatchingHostEvent = false;}
  }
  if (typeof worker.addEventListener === 'function') {
    worker.addEventListener('message', event =>
      dispatchHostEvent(() => onFrame(event.data)));
    worker.addEventListener('error', () => dispatchHostEvent(() => {
      shutdown(new Error('worker execution failure'));
      void terminateWorker();
    }));
    worker.addEventListener('messageerror', () => dispatchHostEvent(() => {
      shutdown(new Error('worker message decoding failure'));
      void terminateWorker();
    }));
  } else if (typeof worker.on === 'function') {
    worker.on('message', frame => dispatchHostEvent(() => onFrame(frame)));
    worker.on('error', error => dispatchHostEvent(() => {
      shutdown(new Error('worker execution failure: ' + errorText(error)));
      void terminateWorker();
    }));
    worker.on('messageerror', () => dispatchHostEvent(() => {
      shutdown(new Error('worker message decoding failure'));
      void terminateWorker();
    }));
    worker.on('exit', code => dispatchHostEvent(() =>
      shutdown(new Error('worker exited: ' + code))));
  } else throw new TypeError('Worker event interface unsupported');
  try {worker.postMessage({protocol: PROTOCOL,kind:'init',moduleUrl,exportName,mode,maxPending,maxPendingBytes});}
  catch (error) {shutdown(error);void terminateWorker();}
  function send(value, reply) {
    if (closed) return Promise.reject(new Error('actor closed'));
    if (nativeMapSize.call(pending) >= maxPending) return Promise.reject(new Error('actor mailbox capacity exceeded'));
    if (!Number.isSafeInteger(nextId)) return Promise.reject(new Error('actor message id exhausted'));
    // Take ownership at admission, not after the Worker startup handshake.
    // This prevents callers from mutating an outstanding queued delivery.
    let snapshot,bytes;
    try {
      ({value:snapshot,bytes}=copyOwnedValueWithBytes(value));
    } catch (error) {return Promise.reject(error);}
    // Copy admission can run host JS via patched structuredClone/proxy traps.
    // A synchronous Worker error/reentrant control frame may revoke the actor
    // while the owned snapshot is being prepared. Never recreate a receipt
    // after shutdown has already cleared the pending ledger.
    if (closed) return Promise.reject(new Error('actor closed'));
    if(bytes>maxPendingBytes-pendingBytes)
      return Promise.reject(new Error('actor mailbox byte capacity exceeded'));
    const id = nextId++;
    pendingBytes+=bytes;
    return new Promise((resolve,reject) => {
      nativeMapSet.call(pending,id,{resolve,reject,reply,bytes});
      void readyPromise.then(() => {
        if (!nativeMapHas.call(pending,id) || closed) return;
        try {worker.postMessage({protocol:PROTOCOL,kind:'deliver',id,reply,value:snapshot});}
        catch (error) {release(id);reject(error);}
      },reject);
    });
  }
  return Object.freeze({
    get ready() {return readyPromise;},
    get pending() {return nativeMapSize.call(pending);},
    get pendingBytes() {return pendingBytes;},
    request(value) {return send(value,true);},
    tell(value) {return send(value,false);},
    async close() {shutdown(new Error('actor closed'));await terminateWorker();}
  });
}
