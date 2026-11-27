// Host-only per-descriptor admission substrate. Not a guest intrinsic.
// The owner must be a trusted tenant runtime and must fence guest continuations.
const OK = Object.freeze({ok:true});
const failed = code => Object.freeze({ok:false,code});
// Count UTF-8 scalar bytes without allocating an encoded byte array.
// Negative denotes malformed UTF-16; caller bounds code units before scanning.
export function boundedUtf8Bytes(text) {
  if(typeof text!=='string'||text.length>65536)return -1;
  let bytes=0;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){
      if(++i>=text.length)return -1;
      const low=text.charCodeAt(i);
      if(low<0xdc00||low>0xdfff)return -1;
      bytes+=4;
    }else if(c>=0xdc00&&c<=0xdfff)return -1;
    else bytes+=c<=0x7f?1:c<=0x7ff?2:3;
  }
  return bytes;
}
const bounded = (n,max) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError('invalid stdio quota');
  return n;
};
function receipt() {
  let resolve;
  const promise = new Promise(r=>{resolve=r;});
  return {promise,resolve};
}
export class BufferedStdioHost {
  #sink; #maxRecords; #maxBytes; #maxWaiters; #maxPendingBytes;
  #queue=[]; #waiting=[]; #active=null; #bytes=0; #pendingBytes=0;
  #scheduled=false; #running=false; #sealed=false; #failure=null; #closed=receipt(); #quiescent=receipt();
  constructor(sink, maxRecords=1024, maxBytes=4194304, maxWaiters=64, maxPendingBytes=1048576) {
    if (typeof sink !== 'function') throw new TypeError('trusted sink function required');
    this.#sink=sink;
    this.#maxRecords=bounded(maxRecords,1024);
    this.#maxBytes=bounded(maxBytes,4194304);
    this.#maxWaiters=bounded(maxWaiters,64);
    this.#maxPendingBytes=bounded(maxPendingBytes,1048576);
  }
  get accounting() {
    return Object.freeze({acceptedRecords:this.#queue.length+Number(this.#active!==null),
      acceptedBytes:this.#bytes, pendingRecords:this.#waiting.length,pendingBytes:this.#pendingBytes});
  }
  // Logical terminal receipt and physical sink exit are separate witnesses.
  get quiescence(){return this.#quiescent.promise;}
  #fits(e) {
    return this.#queue.length+Number(this.#active!==null)<this.#maxRecords &&
      e.bytes<=this.#maxBytes-this.#bytes;
  }
  #commit(e) {
    e.state='accepted'; this.#bytes+=e.bytes; this.#queue.push(e);
    e.admission?.resolve(OK);
  }
  #finish(e,outcome) {
    e.state='terminal'; e.text=null; e.delivery?.resolve(outcome);
  }
  #reject(e,outcome) {
    e.admission.resolve(outcome); this.#finish(e,outcome);
  }
  #promote() {
    if (this.#sealed || this.#failure) return;
    while (this.#waiting.length && this.#fits(this.#waiting[0])) {
      const e=this.#waiting.shift(); this.#pendingBytes-=e.bytes; this.#commit(e);
    }
  }
  // Trusted scheduler fast path: null means ordinary pressure; no write was
  // committed and the caller must use owned pending admission. No per-record
  // Promise or delivery handle is allocated on success. Terminal failures
  // remain observable by the descriptor owner via seal()/subsequent admission.
  tryAdmitImmediate(text) {
    if(this.#failure||this.#sealed)return this.#failure??failed('CLOSED');
    const bytes=boundedUtf8Bytes(text);
    if(bytes<0)return failed('INVALID_RECORD');
    if(bytes>65536||bytes>this.#maxBytes)return failed('OVERSIZE');
    const e={text,bytes,state:'new',admission:null,delivery:null};
    if(this.#waiting.length||!this.#fits(e))return null;
    this.#commit(e);this.#schedule();return OK;
  }
  // Outcomes are resolved rather than rejected: an unobserved delivery receipt
  // cannot generate an unhandled rejection. Cancellation wins only precommit.
  admit(text) {
    const a=receipt(), d=receipt();
    const e={text:null,bytes:0,state:'new',admission:a,delivery:d};
    const handle=Object.freeze({admitted:a.promise,delivered:d.promise,cancel:()=>{
      if(e.state!=='waiting') return false;
      const i=this.#waiting.indexOf(e);
      if(i<0) return false;
      this.#waiting.splice(i,1); this.#pendingBytes-=e.bytes;
      this.#reject(e,failed('CANCELLED')); this.#promote(); this.#schedule(); return true;
    }});
    if(this.#failure || this.#sealed) {this.#reject(e,this.#failure??failed('CLOSED'));return handle;}
    const bytes=boundedUtf8Bytes(text);
    if(bytes<0) {
      this.#reject(e,failed('INVALID_RECORD'));return handle;
    }
    if(bytes>65536||bytes>this.#maxBytes) {this.#reject(e,failed('OVERSIZE'));return handle;}
    e.text=text;e.bytes=bytes;
    if(!this.#waiting.length&&this.#fits(e)) this.#commit(e);
    else if(this.#waiting.length>=this.#maxWaiters||bytes>this.#maxPendingBytes-this.#pendingBytes)
      this.#reject(e,failed('WAITER_QUOTA'));
    else {e.state='waiting';this.#waiting.push(e);this.#pendingBytes+=bytes;}
    this.#schedule();return handle;
  }
  #schedule() {
    if(this.#scheduled||this.#running||this.#failure||!this.#queue.length)return;
    this.#scheduled=true;
    // Yield to other event-loop work after at most 32 sink records.
    setTimeout(()=>{this.#scheduled=false;void this.#drain();},0);
  }
  async #drain() {
    if(this.#running||this.#failure)return;
    this.#running=true;
    try {
      for(let i=0;i<32&&this.#queue.length&&!this.#failure;i++) {
        const e=this.#queue.shift();this.#active=e;
        let sinkFailed=false;
        try {await this.#sink(e.text);}
        catch {sinkFailed=true;this.abort('SINK_FAILURE');}
        // Keep physical payload charge until the sink actually settles,
        // even when its logical delivery receipt has already failed.
        this.#active=null;this.#bytes-=e.bytes;
        if(this.#failure||sinkFailed)return;
        this.#finish(e,OK);this.#promote();
      }
    } finally {this.#running=false;this.#finishClose();this.#schedule();}
  }
  #finishClose() {
    if(this.#sealed&&!this.#active&&!this.#queue.length) {
      this.#closed.resolve(this.#failure??OK);
      this.#quiescent.resolve(OK); // physical exit only, not delivery success
    }
  }
  seal() {
    if(!this.#sealed) {
      this.#sealed=true;
      for(const e of this.#waiting)this.#reject(e,failed('CLOSED'));
      this.#waiting=[];this.#pendingBytes=0;
    }
    this.#finishClose();this.#schedule();return this.#closed.promise;
  }
  // Trusted owner calls on shutdown deadline, sink failure or revocation.
  // An already started host write cannot be retracted; no false delivery receipt.
  abort(code='ABORTED') {
    if(this.#failure||this.#sealed&&!this.#active&&!this.#queue.length)return false;
    this.#failure=failed(code);this.#sealed=true;
    for(const e of this.#waiting)this.#reject(e,this.#failure);
    for(const e of this.#queue)this.#finish(e,this.#failure);
    if(this.#active)this.#finish(this.#active,this.#failure);
    this.#waiting=[];this.#queue=[];
    this.#pendingBytes=0;this.#bytes=this.#active?.bytes??0;
    this.#closed.resolve(this.#failure);
    this.#finishClose();return true;
  }
}
