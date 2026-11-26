import {SelectArbiter} from './select-runtime.mjs';
import {SelectableI64Channel} from './selectable-i64-channel.mjs';
import {SelectableI64Future} from './selectable-i64-future.mjs';

// Trusted host-only, single-isolate driver. Readiness callbacks mark a
// round dirty, never run guest code. The owner explicitly pumps a round.
// No scheduler, cross-Worker transfer, guest arm or compiler lowering.
export class CountedSelectI64Cursor {
  #count; #live; #values=[]; #cursor=0; #policy;
  #state; #round=null; #busy=false; #failure=null;
  constructor(count,sources,policy='fair') {
    if(!Number.isSafeInteger(count)||count<0||count>1024)throw new RangeError('SelectCountInvalid');
    if(!['fair','first'].includes(policy))throw new TypeError('unsupported counted policy');
    this.#count=count;this.#policy=policy;
    if(count===0){this.#live=[];this.#state='success';return;}
    if(!Array.isArray(sources)||sources.length<1||sources.length>256)
      throw new RangeError('counted source count');
    this.#live=sources.map(source=>{
      if(!(source instanceof SelectableI64Channel)&&!(source instanceof SelectableI64Future))
        throw new TypeError('counted selection requires trusted i64 source');
      return source;
    });
    this.#state='ready';
  }
  get state(){return this.#state;}
  get failure(){return this.#failure;}
  get dirty(){return this.#round?.dirty??false;}
  #enter(){
    if(this.#busy)throw new Error('counted selection driver reentry');
    this.#busy=true;
  }
  #fail(error){
    this.#round=null;this.#live=[];this.#values=[];this.#failure=error;this.#state='failed';
  }
  beginRound(){
    if(this.#state!=='ready')throw new Error('round not ready');
    this.#enter();
    const round={arbiter:new SelectArbiter(this.#live.length),cases:[],dirty:true};
    this.#round=round;this.#state='waiting';
    try{
      for(let i=0;i<this.#live.length;i++){
        const source=this.#live[i],reg=round.arbiter.registerCase(i);
        const channel=source instanceof SelectableI64Channel;
        const cell=channel?source.createReadCell():source.createResultCell();
        const batch=channel?source.createNotificationBatch():null;
        // Ignore late/stale notifications after a round is retired.
        const notify=()=>{if(this.#round===round)round.dirty=true;};
        const sub=channel?source.subscribeReadable(notify):source.subscribeReady(notify);
        reg.arm(()=>sub.close());
        round.cases.push({source,reg,channel,cell,batch,sub});
      }
    }catch(error){
      round.arbiter.cancel();
      this.#fail(error);
      throw error;
    }finally{this.#busy=false;}
  }
  // Poll only from the trusted owner; a false return means no winner. One
  // winning source per round, and no next round until notifications drain.
  pump(){
    if(this.#state!=='waiting')throw new Error('no active round');
    this.#enter();
    const round=this.#round;
    try{
      round.dirty=false;
      const n=round.cases.length,start=this.#policy==='first'?0:this.#cursor;
      for(let k=0;k<n;k++){
        const i=(start+k)%n,c=round.cases[i];
        const won=c.reg.tryWin(()=>c.channel
          ?c.source.tryCommitRead(c.sub,c.cell,c.batch)
          :c.source.tryCommit(c.sub,c.cell));
        if(!won)continue;
        if(c.batch)c.batch.dispatch();
        round.arbiter.throwIfCleanupFailed();
        this.#round=null;
        const eof=c.channel&&c.cell.eof;
        if(!c.channel&&c.cell.status!=='value'){
          this.#fail(c.cell.error??new Error('selected Future cancelled'));
          return true;
        }
        if(!eof)this.#values.push(c.cell.value);
        const next=(i+1)%n;
        if(eof||!c.channel){
          // Retire source identities, including aliases. Find the next
          // surviving lexical case from the previous cursor rotation.
          const nextSource=Array.from({length:n},(_,j)=>this.#live[(next+j)%n])
            .find(source=>source!==c.source);
          this.#live=this.#live.filter(source=>source!==c.source);
          this.#cursor=Math.max(0,this.#live.indexOf(nextSource));
        }else this.#cursor=next;
        if(this.#values.length===this.#count){this.#live=[];this.#state='success';}
        else if(!this.#live.length)this.#fail(new Error('SelectExhausted'));
        else this.#state='ready';
        return true;
      }
      return false;
    }catch(error){
      round.arbiter.cancel();this.#fail(error);throw error;
    }finally{this.#busy=false;}
  }
  cancel(){
    if(this.#state!=='ready'&&this.#state!=='waiting')return false;
    this.#enter();
    try{
      this.#round?.arbiter.cancel();
      this.#round?.arbiter.throwIfCleanupFailed();
      this.#round=null;this.#live=[];this.#values=[];this.#state='cancelled';
      return true;
    }catch(error){this.#fail(error);throw error;}
    finally{this.#busy=false;}
  }
  result(){
    if(this.#state!=='success')throw new Error('batch not successful');
    return this.#values.slice();
  }
}
