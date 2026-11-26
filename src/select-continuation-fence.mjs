const TICKETS = new WeakMap();

class ContinuationTicket {
  constructor(owner,index,id,generation){
    this.owner=owner;
    this.index=index;
    this.id=id;
    this.generation=generation;
  }
  get active(){return this.owner._matches(this,false);}
  close(){return this.owner._close(this);}
}

function issueTicket(owner,index,id,generation) {
  const ticket=new ContinuationTicket(owner,index,id,generation);
  TICKETS.set(ticket,{owner,index,id,generation});
  return Object.freeze(ticket);
}

/**
 * Runtime-only actor-generation fence for queued select/await continuations.
 *
 * Producers may enqueue a ticket, but must not consume it. The actor lane calls
 * tryConsume(ticket) immediately before running the continuation. Advancing the
 * generation invalidates every outstanding ticket, so a completion queued by an
 * older actor incarnation cannot resume in a newer one.
 * close() rejects registration and clears pending tickets; claimed execution
 * leases retain capacity until closed. advance() rejects while a lease lives.
 * Legacy tryConsume is logical-only; new invocation paths must use tryClaim.
 */
export class SelectContinuationFence {
  #generation;
  #slots;
  #nextId=1;
  #closed=false;
  #executing=0;
  #pending=0;
  #free;

  constructor(options={}){
    if(options===null || typeof options!=='object' || Array.isArray(options))
      throw new TypeError('continuation options must be a plain data object');
    const proto=Object.getPrototypeOf(options);
    if(proto!==Object.prototype&&proto!==null)
      throw new TypeError('continuation options must be a plain data object');
    const keys=Reflect.ownKeys(options);
    if(keys.some(key=>key!=='generation'&&key!=='maxTickets'))
      throw new TypeError('unknown continuation option');
    const own=(key,fallback)=>{
      const desc=Object.getOwnPropertyDescriptor(options,key);
      if(!desc)return fallback;
      if(!Object.hasOwn(desc,'value') || !desc.enumerable)
        throw new TypeError('continuation options require own data fields');
      return desc.value===undefined?fallback:desc.value;
    };
    const generation=own('generation',1),maxTickets=own('maxTickets',64);
    if(!Number.isSafeInteger(generation)||generation<1)
      throw new RangeError('continuation generation must be a positive integer');
    if(!Number.isSafeInteger(maxTickets)||maxTickets<1||maxTickets>4096)
      throw new RangeError('continuation maxTickets must be in 1..4096');
    this.#generation=generation;
    this.#slots=Array.from({length:maxTickets},
      ()=>({id:0,generation:0,active:false}));
    // Preallocate the free-index stack; admission never scans occupied slots.
    this.#free=Array.from({length:maxTickets},(_,i)=>maxTickets-1-i);
  }

  get closed(){return this.#closed;}
  get executing(){return this.#executing;}
  get retirementReady(){return this.#closed&&this.#executing===0&&this.pendingTickets===0;}

  // Terminal shutdown is distinct from advancing to a reusable generation.
  close(){
    if(this.#closed)return false;
    this.#closed=true;
    for(let index=0;index<this.#slots.length;index++) {
      if(this.#slots[index].active)this.#clear(index);
    }
    return true;
  }

  get generation(){return this.#generation;}
  get pendingTickets(){
    return this.#pending;
  }

  register(expectedGeneration=this.#generation){
    if(this.#closed)throw new Error('continuation fence is closed');
    if(expectedGeneration!==this.#generation)
      throw new Error('stale actor generation');
    if(this.#pending+this.#executing>=this.#slots.length)
      throw new Error('continuation physical capacity exhausted');
    const index=this.#free[this.#free.length-1];
    if(index===undefined)throw new Error('continuation ticket capacity exhausted');
    if(this.#nextId>=Number.MAX_SAFE_INTEGER)
      throw new Error('continuation ticket identity exhausted');
    const id=this.#nextId;
    // Create the opaque identity before reserving the slot.
    const ticket=issueTicket(this,index,id,this.#generation);
    this.#nextId++;
    this.#free.pop();
    this.#pending++;
    const slot=this.#slots[index];
    slot.id=id;
    slot.generation=this.#generation;
    slot.active=true;
    return ticket;
  }

  tryConsume(ticket){
    if(!this.#matches(ticket,true))return false;
    this.#clear(TICKETS.get(ticket).index);
    return true;
  }

  /** Claim before invocation; close the lease in a finally block. */
  tryClaim(ticket){return this.#claim(ticket);}

  /**
   * Actor-lane dispatch boundary. Validate the callback before claiming;
   * retain execution credit until its synchronous or asynchronous work ends.
   * The caller still owns scheduling and actor-lane affinity.
   */
  async tryInvoke(ticket,callback){
    if(typeof callback!=='function')throw new TypeError('continuation callback must be a function');
    const lease=this.#claim(ticket);
    if(lease===null)return false;
    try{
      await callback();
      return true;
    }finally{
      lease.close();
    }
  }

  #claim(ticket){
    if(!this.#matches(ticket,true)||this.#closed)return null;
    const generation=this.#generation;
    let active=true;
    // Construct the lease before consuming the pending slot.
    const lease=Object.freeze({generation,get active(){return active;},close:()=>{
      if(!active)return false;
      active=false;
      this.#executing--;
      return true;
    }});
    this.#clear(TICKETS.get(ticket).index);
    this.#executing++;
    return lease;
  }

  advance(expectedGeneration){
    if(this.#closed||this.#executing!==0)return false;
    if(expectedGeneration!==this.#generation)return false;
    if(this.#generation>=Number.MAX_SAFE_INTEGER)
      throw new Error('actor generation exhausted');
    this.#generation++;
    for(let index=0;index<this.#slots.length;index++) {
      if(this.#slots[index].active)this.#clear(index);
    }
    return true;
  }

  _matches(ticket,requireCurrent){return this.#matches(ticket,requireCurrent);}

  #matches(ticket,requireCurrent){
    const identity=TICKETS.get(ticket);
    if(!identity || identity.owner!==this)return false;
    const slot=this.#slots[identity.index];
    if(!slot.active||slot.id!==identity.id||
       slot.generation!==identity.generation)return false;
    return !requireCurrent||identity.generation===this.#generation;
  }

  _close(ticket){
    if(!this.#matches(ticket,false))return false;
    this.#clear(TICKETS.get(ticket).index);
    return true;
  }

  #clear(index){
    const slot=this.#slots[index];
    slot.active=false;
    slot.generation=0;
    this.#pending--;
    this.#free.push(index);
  }
}
