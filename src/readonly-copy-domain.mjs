// Trusted runtime component; not yet connected to compiler lowering.
// No arbitrary JS object graph traversal, coercion, guest callbacks or raw
// slot maps escape. All handles are opaque and local to one explicit domain.
// Single Worker execution only; no cross-Worker authority or actor mail copy.
const error = code => { throw Object.assign(new Error(code), {code}); };
const token = () => Object.freeze(Object.create(null));
const scalar = x => x === null || ['string','boolean','number','bigint'].includes(typeof x);

export class ReadonlyCopyDomain {
  #roots = new Map();
  #nodes = new WeakMap();
  #loans = new Map();
  #holders = new Map();
  #readers = new Map();
  #limits;
  constructor({maxRoots=64,maxLoans=64,maxWork=65536}={}) {
    if (![maxRoots,maxLoans,maxWork].every(Number.isSafeInteger) ||
        maxRoots<1 || maxRoots>1024 || maxLoans<0 || maxLoans>1024 ||
        maxWork<1 || maxWork>262144) error('E_COPY_BUDGET');
    this.#limits={maxRoots,maxLoans,maxWork};
  }
  #root(owner) { const r=this.#roots.get(owner); if(!r)error('E_COPY_STALE');return r; }
  #node(id) { const n=this.#nodes.get(id);if(!n)error('E_COPY_DOMAIN');return n; }
  #reachable(root,id){if(!root.reach.has(id))error('E_COPY_DOMAIN');return this.#node(id);}
  #write(root,id){const n=this.#reachable(root,id);if(this.#holders.get(id)!==1)error('E_COPY_READONLY');if(this.#readers.has(id))error('E_COPY_LOAN');return n;}
  #walk(start,edit=null){
    const seen=new Set(), pending=[start];let work=0;
    const charge=()=>{if(++work>this.#limits.maxWork)error('E_COPY_BUDGET');};
    const edge=v=>{charge();if(!scalar(v)){this.#node(v);pending.push(v);}};
    while(pending.length){
      const id=pending.pop();charge();if(seen.has(id))continue;
      const n=this.#node(id);seen.add(id);
      for(const [k,s] of n.slots){if(edit&&edit.id===id&&edit.key===k)continue;edge(s.value);}
      if(edit&&edit.id===id&&edit.next)edge(edit.next.value);
    }
    return seen;
  }
  #adjust(map,ids,delta){for(const id of ids){const n=(map.get(id)||0)+delta;if(n===0)map.delete(id);else map.set(id,n);}}
  #publish(id,reach){if(this.#roots.size>=this.#limits.maxRoots)error('E_COPY_BUDGET');const owner=token();this.#roots.set(owner,{id,reach});this.#adjust(this.#holders,reach,1);return owner;}
  // Only scalar initial slots, edges installed via explicit ownership move.
  create({dynamic=false,noncopyable=false}={}){
    const id=token();this.#nodes.set(id,{dynamic:dynamic===true,noncopyable:noncopyable===true,initial:true,slots:new Map()});
    return this.#publish(id,new Set([id]));
  }
  initialize(owner,key,value,writable=true){
    const r=this.#root(owner), n=this.#write(r,r.id);
    if(!n.initial||typeof key!=='string'||n.slots.has(key)||!scalar(value))error('E_COPY_LAYOUT');
    if(n.slots.size+2>this.#limits.maxWork)error('E_COPY_BUDGET');
    n.slots.set(key,{value,writable:writable===true});
  }
  finish(owner){const r=this.#root(owner);this.#write(r,r.id).initial=false;}
  identity(owner){return this.#root(owner).id;}
  read(owner,id,key){const n=this.#reachable(this.#root(owner),id);if(n.initial)error('E_COPY_LAYOUT');return n.slots.get(key)?.value;}
  copy(owner){
    const r=this.#root(owner), n=this.#node(r.id);
    for(const id of r.reach){const child=this.#node(id);if(child.initial)error('E_COPY_LAYOUT');if(child.noncopyable)error('E_COPY_FORBIDDEN');}
    if(this.#roots.size>=this.#limits.maxRoots)error('E_COPY_BUDGET');
    const id=token();this.#nodes.set(id,{dynamic:n.dynamic,noncopyable:false,initial:false,slots:new Map(n.slots)});
    const reach=this.#walk(id);
    // Independent writable outer slots cannot be promised if a retained
    // descendant reaches the original root. Fail before publishing holders.
    if(reach.has(r.id))error('E_COPY_SHALLOW_ALIAS');
    return this.#publish(id,reach);
  }
  #slot(root,id,key,value){
    const n=this.#write(root,id);
    if(n.initial||typeof key!=='string')error('E_COPY_LAYOUT');
    const old=n.slots.get(key);
    if(!old&&!n.dynamic)error('E_COPY_LAYOUT');
    if(old&&!old.writable)error('E_COPY_READONLY_SLOT');
    return {value,writable:true};
  }
  #commit(owner,root,edit,reach){
    const n=this.#node(edit.id);
    if(edit.next)n.slots.set(edit.key,edit.next);else n.slots.delete(edit.key);
    this.#adjust(this.#holders,root.reach,-1);this.#adjust(this.#holders,reach,1);
    this.#roots.set(owner,{id:root.id,reach});
  }
  setScalar(owner,id,key,value){
    if(!scalar(value))error('E_COPY_TYPE');
    const root=this.#root(owner),next=this.#slot(root,id,key,value),n=this.#node(id),old=n.slots.get(key);
    if(old&&scalar(old.value)){n.slots.set(key,next);return;}
    const edit={id,key,next};this.#commit(owner,root,edit,this.#walk(root.id,edit));
  }
  linkWithin(owner,id,key,value){
    const root=this.#root(owner);this.#reachable(root,value);
    const edit={id,key,next:this.#slot(root,id,key,value)};
    this.#commit(owner,root,edit,this.#walk(root.id,edit));
  }
  moveInto(owner,id,key,donor){
    const root=this.#root(owner),source=this.#root(donor);
    if(owner===donor)error('E_COPY_DOMAIN');
    for(const child of source.reach){const n=this.#write(source,child);if(n.initial)error('E_COPY_LAYOUT');}
    const edit={id,key,next:this.#slot(root,id,key,source.id)}, reach=this.#walk(root.id,edit);
    this.#commit(owner,root,edit,reach);this.#roots.delete(donor);this.#adjust(this.#holders,source.reach,-1);
  }
  remove(owner,id,key){
    const root=this.#root(owner);this.#slot(root,id,key,null);
    if(!this.#node(id).dynamic)error('E_COPY_LAYOUT');
    const edit={id,key,next:null};this.#commit(owner,root,edit,this.#walk(root.id,edit));
  }
  readLoan(owner,id){
    this.#reachable(this.#root(owner),id);
    if(this.#loans.size>=this.#limits.maxLoans)error('E_COPY_BUDGET');
    const reach=this.#walk(id), loan=token();this.#loans.set(loan,reach);this.#adjust(this.#readers,reach,1);return loan;
  }
  release(loan){const reach=this.#loans.get(loan);if(!reach)error('E_COPY_STALE');this.#loans.delete(loan);this.#adjust(this.#readers,reach,-1);}
  drop(owner){const r=this.#root(owner);this.#roots.delete(owner);this.#adjust(this.#holders,r.reach,-1);}
  canWrite(owner,id){const r=this.#root(owner);return r.reach.has(id)&&this.#holders.get(id)===1&&!this.#readers.has(id);}
}
