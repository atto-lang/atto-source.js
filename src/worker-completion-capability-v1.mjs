// Versioned, single-use cross-Worker completion admission for trusted host I/O.
// A 128-bit random bearer capability authenticates possession, not worker identity.
// The sender must receive the capability over a trusted dedicated MessagePort.
// Untrusted/compromised holders can complete their own ticket; this is NOT a
// sandbox, a general Future<T> codec, or a compiled guest import.
// Completion only enqueues a scheduler turn; it never runs guest code inline.
export const WORKER_COMPLETION_V1='atto.continuation.complete.v1';
const OWNER=/^[A-Za-z0-9_-]{1,128}$/;
const TOKEN=/^[0-9a-f]{32}$/;
const MIN_I64=-(1n<<63n),MAX_I64=(1n<<63n)-1n;
const validEpoch=x=>Number.isSafeInteger(x)&&x>0;
const validLimit=x=>Number.isSafeInteger(x)&&x>0&&x<=65536;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function secureToken() {
  const crypto=globalThis.crypto;
  if(typeof crypto?.getRandomValues!=='function')throw new Error('E_COMPLETION_NO_CSPRNG');
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function equalToken(a,b) {
  if(typeof a!=='string'||!TOKEN.test(a)||b.length!==32)return false;
  let diff=0;
  for(let i=0;i<32;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const FRAME_FIELDS=['capability','epoch','owner','ticket','type','value'];
function snapshotFrame(o) {
  if(!o||typeof o!=='object'||Array.isArray(o))return null;
  const desc=Object.getOwnPropertyDescriptors(o);
  if(Reflect.ownKeys(desc).length!==FRAME_FIELDS.length)return null;
  const frame=Object.create(null);
  for(const k of FRAME_FIELDS) {
    if(!own(desc,k)||!own(desc[k],'value')||!desc[k].enumerable)return null;
    frame[k]=desc[k].value;
  }
  return frame;
}
export function createWorkerCompletionCapabilitiesV1({loop,owner,epoch,maxPending=1024}={}) {
  if(!loop||!['attachOwner','retireOwner','beginSuspension','complete','cancel']
      .every(k=>typeof loop[k]==='function'))throw new TypeError('E_COMPLETION_LOOP');
  if(typeof owner!=='string'||!OWNER.test(owner)||!validEpoch(epoch)||
      !validLimit(maxPending))throw new TypeError('E_COMPLETION_IDENTITY');
  // Fail closed before accepting any tickets or ports if entropy is absent.
  secureToken();
  if(!loop.attachOwner(owner,epoch))throw new Error('E_COMPLETION_OWNER_ADMISSION');

  const active=new Map(),byGrant=new WeakMap();
  let nextTicket=1,closed=false,accepted=0,rejected=0;
  let boundPort=null,boundHandler=null;
  function reserve(resume) {
    if(closed||active.size>=maxPending||!Number.isSafeInteger(nextTicket))return null;
    // The scheduler itself validates that this is a synchronous-turn callback.
    const token=secureToken();
    const pending=loop.beginSuspension(owner,epoch,resume);
    if(!pending)return null;
    const id=nextTicket++;
    const grant=Object.freeze({type:WORKER_COMPLETION_V1,owner,epoch,ticket:id,capability:token});
    const record={pending,token,grant};
    active.set(id,record);byGrant.set(grant,record);
    return grant;
  }
  function complete(input) {
    try {
      // Treat the frame as untrusted structured-clone data. No getter values,
      // polymorphic payloads, functions, extra fields or object-valued results.
      const frame=closed?null:snapshotFrame(input);
      if(!frame||frame.type!==WORKER_COMPLETION_V1||
         frame.owner!==owner||frame.epoch!==epoch||
         !Number.isSafeInteger(frame.ticket)||frame.ticket<=0||
         typeof frame.value!=='bigint'||frame.value<MIN_I64||frame.value>MAX_I64) {
        rejected++;return false;
      }
      const record=active.get(frame.ticket);
      if(!record||!equalToken(frame.capability,record.token)) {
        rejected++;return false;
      }
      // Loop.complete is non-reentrant: it queues the trusted resume callback.
      // If the scheduler was retired, invalidate the grant regardless.
      // Consume before calling the trusted scheduler. A throwing admission
      // must not make a single-use capability replayable.
      active.delete(frame.ticket);
      byGrant.delete(record.grant);
      let admitted;
      try {admitted=loop.complete(record.pending,frame.value);}
      catch (error) {
        try {loop.cancel(record.pending);} catch { /* Best-effort cleanup. */ }
        throw error;
      }
      if(admitted)accepted++;else rejected++;
      return admitted;
    } catch {
      rejected++;return false;
    }
  }
  function cancel(grant) {
    const record=grant&&typeof grant==='object'?byGrant.get(grant):undefined;
    if(closed||!record||active.get(grant.ticket)!==record)return false;
    active.delete(grant.ticket);
    byGrant.delete(record.grant);
    return loop.cancel(record.pending);
  }
  function bindPort(port) {
    if(closed||boundPort||typeof port?.addEventListener!=='function'||
       typeof port?.removeEventListener!=='function'||typeof port?.start!=='function')
      throw new TypeError('E_COMPLETION_PORT');
    boundHandler=event=>{complete(event.data);};
    boundPort=port;
    port.addEventListener('message',boundHandler);
    port.start();
  }
  function close() {
    if(closed)return false;
    closed=true;
    if(boundPort) {
      boundPort.removeEventListener('message',boundHandler);
      boundPort=null;boundHandler=null;
    }
    for(const record of active.values()) {
      loop.cancel(record.pending);
      byGrant.delete(record.grant);
    }
    active.clear();
    loop.retireOwner(owner,epoch);
    return true;
  }
  return Object.freeze({
    version:WORKER_COMPLETION_V1,reserve,complete,cancel,bindPort,close,
    get stats(){return Object.freeze({closed,pending:active.size,accepted,rejected});}
  });
}
