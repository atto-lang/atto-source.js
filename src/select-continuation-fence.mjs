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
 * close() permanently rejects registration and clears pending tickets; it does
 * not wait for callbacks or native workers. The scheduler must serialize
 * consume-and-invoke with lifecycle changes on the actor lane.
 */
export class SelectContinuationFence {
  #generation;
  #slots;
  #nextId=1;
  #closed=false;

  constructor({generation=1,maxTickets=64}={}){
    if(!Number.isSafeInteger(generation)||generation<1)
      throw new RangeError('continuation generation must be a positive integer');
    if(!Number.isSafeInteger(maxTickets)||maxTickets<1||maxTickets>4096)
      throw new RangeError('continuation maxTickets must be in 1..4096');
    this.#generation=generation;
    this.#slots=Array.from({length:maxTickets},
      ()=>({id:0,generation:0,active:false}));
  }

  get closed(){return this.#closed;}

  // Terminal shutdown is distinct from advancing to a reusable generation.
  close(){
    if(this.#closed)return false;
    this.#closed=true;
    for(const slot of this.#slots)this.#clear(slot);
    return true;
  }

  get generation(){return this.#generation;}
  get pendingTickets(){
    return this.#slots.reduce((n,slot)=>n+(slot.active?1:0),0);
  }

  register(expectedGeneration=this.#generation){
    if(this.#closed)throw new Error('continuation fence is closed');
    if(expectedGeneration!==this.#generation)
      throw new Error('stale actor generation');
    const index=this.#slots.findIndex(slot=>!slot.active);
    if(index<0)throw new Error('continuation ticket capacity exhausted');
    if(this.#nextId>=Number.MAX_SAFE_INTEGER)
      throw new Error('continuation ticket identity exhausted');
    const id=this.#nextId++;
    const slot=this.#slots[index];
    slot.id=id;
    slot.generation=this.#generation;
    slot.active=true;
    return issueTicket(this,index,id,this.#generation);
  }

  tryConsume(ticket){
    if(!this._matches(ticket,true))return false;
    this.#clear(this.#slots[TICKETS.get(ticket).index]);
    return true;
  }

  advance(expectedGeneration){
    if(this.#closed)return false;
    if(expectedGeneration!==this.#generation)return false;
    if(this.#generation>=Number.MAX_SAFE_INTEGER)
      throw new Error('actor generation exhausted');
    this.#generation++;
    for(const slot of this.#slots)this.#clear(slot);
    return true;
  }

  _matches(ticket,requireCurrent){
    const identity=TICKETS.get(ticket);
    if(!identity || identity.owner!==this)return false;
    const slot=this.#slots[identity.index];
    if(!slot.active||slot.id!==identity.id||
       slot.generation!==identity.generation)return false;
    return !requireCurrent||identity.generation===this.#generation;
  }

  _close(ticket){
    if(!this._matches(ticket,false))return false;
    this.#clear(this.#slots[TICKETS.get(ticket).index]);
    return true;
  }

  #clear(slot){
    slot.active=false;
    slot.generation=0;
  }
}
