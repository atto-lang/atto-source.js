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
  let receivingFrame=false;
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
    // Real Worker transports clone frames, but injected host adapters may
    // synchronously reenter through accessor-backed properties.
    if(receivingFrame){fail('reentrant actor frame');return;}
    receivingFrame=true;
    try {
    if(terminal)return;
    if(!frame||typeof frame!=='object'){
      fail('invalid actor frame');return;
    }
    const protocol=frame.protocol,kind=frame.kind;
    if(terminal)return;
    if(protocol!==PROTOCOL||!['init','deliver'].includes(kind)){
      fail('invalid actor frame');return;
    }
    if(kind==='init'){
      if(initializing||initialized){fail('duplicate initialization');return;}
      initializing=true;
      const moduleUrl=frame.moduleUrl,exportName=frame.exportName;
      const mode=frame.mode,pendingLimit=frame.maxPending;
      const pendingByteLimit=frame.maxPendingBytes;
      if(terminal)return;
      if(typeof moduleUrl!=='string'||!moduleUrl||
         typeof exportName!=='string'||
         !/^[A-Za-z_][A-Za-z0-9_]*$/.test(exportName)||
         !['handler','call'].includes(mode)||
         !Number.isSafeInteger(pendingLimit)||
         pendingLimit<1||pendingLimit>65536||
         !Number.isSafeInteger(pendingByteLimit)||
         pendingByteLimit<1||
         pendingByteLimit>MAX_CONFIGURED_PENDING_BYTES){
        fail('invalid actor module descriptor');return;
      }
      maxPending=pendingLimit;
      maxPendingBytes=pendingByteLimit;
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
    // Bind the control identity once. Re-reading a getter here could validate
    // one ID, advance lastId using another, then reply to a third receipt.
    const id=frame.id,replyRequested=frame.reply;
    if(terminal)return;
    if(!initialized||!Number.isSafeInteger(id)||id<=lastId||
       typeof replyRequested!=='boolean'){
      fail('invalid or premature delivery');return;
    }
    // Includes the one currently executing turn, not only the queued frames.
    if(inFlight>=maxPending){fail('actor mailbox capacity exceeded');return;}
    // Do not invoke an untrusted payload getter for an invalid ID or a
    // mailbox that is already full. Preserve the terminal fence after copy.
    let snapshot,bytes;
    try{const payload=frame.value;({value:snapshot,bytes}=copyOwnedValueWithBytes(payload));}
    catch{fail('invalid actor delivery payload');return;}
    if(terminal)return;
    if(bytes>maxPendingBytes-inFlightBytes){
      fail('actor mailbox byte capacity exceeded');return;
    }
    lastId=id;
    inFlight++;
    inFlightBytes+=bytes;
    queue.push({id,reply:replyRequested,value:snapshot,bytes});
    void drain();
    } catch {fail('invalid actor frame');}
    finally {receivingFrame=false;}
  });
}
