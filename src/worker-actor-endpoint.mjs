import {copyOwnedValue,copyOwnedValueWithBytes} from './worker-actor-copy.mjs';
// Trusted host adapter, NOT source-level actor lowering or a sandbox.
// Exactly one guest handler executes per Worker. A fatal protocol violation
// revokes the session and suppresses late replies; it does not preempt code.
const PROTOCOL='ores.js.worker.v1';
const MAX_CONFIGURED_PENDING_BYTES=256*1024*1024;
const errorText=e=>{
  try{return String(e?.message ?? e).slice(0,512);}
  catch{return 'uninspectable actor failure';}
};

export function installWorkerActorEndpoint({subscribe,post}) {
  if(typeof subscribe!=='function'||typeof post!=='function')
    throw new TypeError('invalid actor endpoint transport');
  let initializing=false,initialized=false,terminal=false,receive=null;
  let processing=false,inFlight=0,inFlightBytes=0,lastId=0,maxPending=0,maxPendingBytes=0;
  const queue=[];
  const reply=frame=>post({protocol:PROTOCOL,...frame});
  function fail(reason){
    if(terminal)return;
    terminal=true;
    // Release queued reservations immediately. The current executing turn
    // retains its loan until its finally block runs (no forced preemption).
    for(const item of queue){inFlight--;inFlightBytes-=item.bytes;}
    queue.length=0;
    try{reply({kind:'fatal',error:reason});}catch{/* transport already lost */}
  }
  async function drain(){
    if(processing||!receive||terminal)return;
    processing=true;
    try{
      while(!terminal&&queue.length){
        const frame=queue.shift();
        let completed=false,claimed=false,response;
        const self=Object.freeze({
          respond(value){
            if(terminal||completed||claimed||!frame.reply)
              throw new Error('reply unavailable or already claimed');
            response=copyOwnedValue(value);
            claimed=true;
          },
          done(){
            if(terminal||completed)throw new Error('delivery already completed');
            completed=true;
          }
        });
        try{
          await receive(frame.value,self);
          if(terminal)break;
          if(!completed)throw new Error('actor handler must call self.done()');
          if(frame.reply&&!claimed)
            throw new Error('request completed without self.respond()');
          reply({kind:'result',id:frame.id,ok:true,
            value:frame.reply?response:null});
        }catch(error){
          if(!terminal){
            try{reply({kind:'result',id:frame.id,ok:false,error:errorText(error)});}
            catch{fail('actor result transport failure');}
          }
        }finally{
          completed=true;
          inFlight--;
          inFlightBytes-=frame.bytes;
        }
      }
    }finally{processing=false;}
  }
  subscribe(frame=>{
    try {
    if(terminal)return;
    if(!frame||typeof frame!=='object'||frame.protocol!==PROTOCOL){
      fail('invalid actor frame');return;
    }
    // A custom transport may pass accessor-backed frames instead of a
    // structured clone. Never re-read mutable control fields after admission.
    const kind=frame.kind;
    if(kind!=='init'&&kind!=='deliver'){
      fail('invalid actor frame');return;
    }
    if(kind==='init'){
      if(initializing||initialized){fail('duplicate initialization');return;}
      initializing=true;
      const moduleUrl=frame.moduleUrl,exportName=frame.exportName,mode=frame.mode;
      const requestedMaxPending=frame.maxPending,requestedMaxPendingBytes=frame.maxPendingBytes;
      if(typeof moduleUrl!=='string'||!moduleUrl||
         typeof exportName!=='string'||
         !/^[A-Za-z_][A-Za-z0-9_]*$/.test(exportName)||
         !['handler','call'].includes(mode)||
         !Number.isSafeInteger(requestedMaxPending)||
         requestedMaxPending<1||requestedMaxPending>65536||
         !Number.isSafeInteger(requestedMaxPendingBytes)||
         requestedMaxPendingBytes<1||
         requestedMaxPendingBytes>MAX_CONFIGURED_PENDING_BYTES){
        fail('invalid actor module descriptor');return;
      }
      maxPending=requestedMaxPending;
      maxPendingBytes=requestedMaxPendingBytes;
      void (async()=>{
        try{
          const module=await import(moduleUrl);
          if(terminal)return;
          const fn=Object.getOwnPropertyDescriptor(module,exportName)?.value;
          if(typeof fn!=='function')throw new Error('actor entrypoint not found');
          receive=mode==='handler'?fn:(mail,self)=>{
            if(!mail||!Array.isArray(mail.args)||mail.args.length>128)
              throw new Error('invalid call arguments');
            const result=fn(...mail.args);
            if(result&&typeof result.then==='function')
              throw new Error('async function ABI unsupported');
            self.respond(result);
            self.done();
          };
          if(terminal)return;
          initialized=true;
          reply({kind:'ready'});
        }catch(error){fail(errorText(error));}
      })();
      return;
    }
    // Preserve premature/invalid-id short-circuiting: a malformed frame
    // must not evaluate unrelated accessor-backed control properties.
    if(!initialized){fail('invalid or premature delivery');return;}
    const id=frame.id;
    if(!Number.isSafeInteger(id)||id<=lastId){
      fail('invalid or premature delivery');return;
    }
    const wantsReply=frame.reply;
    if(typeof wantsReply!=='boolean'){
      fail('invalid or premature delivery');return;
    }
    // Includes the one currently executing turn, not only the queued frames.
    if(inFlight>=maxPending){fail('actor mailbox capacity exceeded');return;}
    let snapshot,bytes;
    try{({value:snapshot,bytes}=copyOwnedValueWithBytes(frame.value));}
    catch{fail('invalid actor delivery payload');return;}
    if(bytes>maxPendingBytes-inFlightBytes){
      fail('actor mailbox byte capacity exceeded');return;
    }
    lastId=id;
    inFlight++;
    inFlightBytes+=bytes;
    queue.push({id,reply:wantsReply,value:snapshot,bytes});
    void drain();
    } catch {fail('invalid actor frame');}
  });
}
